"use client"

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react"

import {
  BTC_PRODUCT_ID,
  COINBASE_WS_URL,
  buildCoinbaseSubscription,
  parseCoinbaseEnvelope,
  type RealtimeBtcTick,
} from "@/lib/btc/realtime"
import {
  analyzeBtcPriceDecision,
  type BtcDirectionBias,
  type BtcDecisionSnapshot,
} from "@/lib/analysis/priceDecision"
import {
  readBtcJournalEntries,
  clearBtcJournalEntries,
  writeBtcJournalEntries,
} from "@/lib/btc/journal"
import type {
  BtcJournalOutcome,
  BtcJournalRow,
  BtcJournalSnapshot,
  BtcJournalWindow,
} from "@/lib/btc/journal-types"

type ConnectionState = "connecting" | "open" | "reconnecting" | "closed" | "error"
type SignalPerformanceWindow = BtcJournalWindow

export interface RealtimeBtcState {
  productId: string
  connectionState: ConnectionState
  reconnectAttempt: number
  isStale: boolean
  lastMessageAtMs: number | null
  lastHeartbeatAtMs: number | null
  error: string | null
  ticks: RealtimeBtcTick[]
  decision: BtcDecisionSnapshot
  latestTick: RealtimeBtcTick | null
  biasSnapshots: BtcJournalSnapshot[]
  signalPerformance: BtcJournalRow[]
  clearJournal: () => void
}

const MAX_TICK_AGE_MS = 75 * 60 * 1000
const STALE_THRESHOLD_MS = 20_000
const HEARTBEAT_THRESHOLD_MS = 12_000
const MAX_TICKS = 2400
const MAX_BIAS_SNAPSHOTS = 18
const NEUTRAL_DIRECTIONAL_BAND_PCT = 0.08
const SIGNAL_WINDOWS: Record<SignalPerformanceWindow, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
}

export function useRealtimeBtc(productId = BTC_PRODUCT_ID): RealtimeBtcState {
  const [ticks, setTicks] = useState<RealtimeBtcTick[]>([])
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting")
  const [reconnectAttempt, setReconnectAttempt] = useState(0)
  const [lastMessageAtMs, setLastMessageAtMs] = useState<number | null>(null)
  const [lastHeartbeatAtMs, setLastHeartbeatAtMs] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isStale, setIsStale] = useState(false)
  const [biasSnapshots, setBiasSnapshots] = useState<BtcJournalSnapshot[]>(() =>
    readBtcJournalEntries().map(stripJournalSnapshot),
  )
  const [nowMs, setNowMs] = useState(() => Date.now())

  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const staleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const closedByCleanupRef = useRef(false)
  const reconnectAttemptRef = useRef(0)
  const lastMessageAtRef = useRef<number | null>(null)
  const lastHeartbeatAtRef = useRef<number | null>(null)
  const decisionRef = useRef<BtcDecisionSnapshot | null>(null)

  useEffect(() => {
    closedByCleanupRef.current = false

    const connect = () => {
      if (closedByCleanupRef.current) {
        return
      }

      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.close()
      }

      setConnectionState("connecting")
      setError(null)

      const socket = new WebSocket(COINBASE_WS_URL)
      socketRef.current = socket

      socket.addEventListener("open", () => {
        if (closedByCleanupRef.current) {
          return
        }

        socket.send(JSON.stringify(buildCoinbaseSubscription([productId])))
        setConnectionState("open")
        reconnectAttemptRef.current = 0
        setReconnectAttempt(0)
      })

      socket.addEventListener("message", (event) => {
        if (closedByCleanupRef.current) {
          return
        }

        const receivedAtMs = Date.now()
        const message = typeof event.data === "string" ? event.data : ""
        const envelope = parseCoinbaseEnvelope(message, receivedAtMs)
        if (!envelope) {
          return
        }

        setLastMessageAtMs(receivedAtMs)
        lastMessageAtRef.current = receivedAtMs

        if (envelope.kind === "tick" && envelope.tick) {
          setTicks((current) => {
            const next = [...current, envelope.tick!].filter(
              (tick) => tick.receivedAtMs >= receivedAtMs - MAX_TICK_AGE_MS,
            )

            if (next.length > MAX_TICKS) {
              return next.slice(-MAX_TICKS)
            }

            return next
          })

          recordBiasSnapshot({
            decision: decisionRef.current,
            receivedAtMs,
            setBiasSnapshots,
          })
        }

        if (envelope.kind === "heartbeat" && envelope.heartbeat) {
          setLastHeartbeatAtMs(receivedAtMs)
          lastHeartbeatAtRef.current = receivedAtMs
          setIsStale(false)
        }

        if (envelope.kind === "error" && envelope.error) {
          setError(envelope.error)
        }
      })

      socket.addEventListener("error", () => {
        if (closedByCleanupRef.current) {
          return
        }

        setConnectionState("error")
        setError("Coinbase websocket reported an error.")
        socket.close()
      })

      socket.addEventListener("close", () => {
        if (closedByCleanupRef.current) {
          return
        }

        setConnectionState("reconnecting")
        scheduleReconnect()
      })
    }

    const scheduleReconnect = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }

      const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 15_000)
      reconnectTimerRef.current = setTimeout(() => {
        if (closedByCleanupRef.current) {
          return
        }

        reconnectAttemptRef.current += 1
        setReconnectAttempt((current) => current + 1)
        setConnectionState("reconnecting")
        connect()
      }, delay)
    }

    connect()

    staleTimerRef.current = setInterval(() => {
      const now = Date.now()
      setNowMs(now)
      const lastObservedAtMs = Math.max(
        lastMessageAtRef.current ?? 0,
        lastHeartbeatAtRef.current ?? 0,
      )
      const nextIsStale =
        lastObservedAtMs > 0
          ? now - lastObservedAtMs > Math.max(STALE_THRESHOLD_MS, HEARTBEAT_THRESHOLD_MS)
          : false

      setIsStale(nextIsStale)

      if (
        nextIsStale &&
        socketRef.current &&
        socketRef.current.readyState === WebSocket.OPEN
      ) {
        socketRef.current.close()
      }
    }, 1000)

    return () => {
      closedByCleanupRef.current = true

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }

      if (staleTimerRef.current) {
        clearInterval(staleTimerRef.current)
      }

      socketRef.current?.close()
    }
  }, [productId])

  const decision = useMemo(
    () =>
      analyzeBtcPriceDecision(ticks, {
        staleThresholdMs: STALE_THRESHOLD_MS,
      }),
    [ticks],
  )

  const latestTick = ticks.at(-1) ?? null

  useEffect(() => {
    decisionRef.current = decision
  }, [decision])

  const signalPerformance = useMemo(
    () =>
      biasSnapshots
        .slice()
        .reverse()
        .map((snapshot) => ({
          ...snapshot,
          outcomes: buildPerformanceOutcomes(
            snapshot,
            latestTick?.price ?? decision.lastPrice,
            nowMs,
          ),
        })),
    [biasSnapshots, decision.lastPrice, latestTick?.price, nowMs],
  )

  useEffect(() => {
    writeBtcJournalEntries(signalPerformance)
  }, [signalPerformance])

  return {
    productId,
    connectionState,
    reconnectAttempt,
    isStale: isStale || decision.dataQuality.stale,
    lastMessageAtMs,
    lastHeartbeatAtMs,
    error,
    ticks,
    decision,
    latestTick,
    biasSnapshots,
    signalPerformance,
    clearJournal: () => {
      clearBtcJournalEntries()
      setBiasSnapshots([])
    },
  }
}

function buildPerformanceOutcomes(
  snapshot: BtcJournalSnapshot,
  currentPrice: number | null,
  nowMs: number,
) {
  return {
    "1m": buildWindowOutcome(snapshot, currentPrice, nowMs, "1m"),
    "5m": buildWindowOutcome(snapshot, currentPrice, nowMs, "5m"),
    "15m": buildWindowOutcome(snapshot, currentPrice, nowMs, "15m"),
    "1h": buildWindowOutcome(snapshot, currentPrice, nowMs, "1h"),
  } satisfies Record<SignalPerformanceWindow, BtcJournalOutcome>
}

function buildWindowOutcome(
  snapshot: BtcJournalSnapshot,
  currentPrice: number | null,
  nowMs: number,
  window: SignalPerformanceWindow,
): BtcJournalOutcome {
  const minutes = SIGNAL_WINDOWS[window]
  const targetAtMs = snapshot.timestampMs + minutes * 60 * 1000
  const resolved = nowMs >= targetAtMs && currentPrice !== null
  const referencePrice = currentPrice ?? snapshot.startingPrice
  const priceChange = referencePrice - snapshot.startingPrice
  const percentChange =
    snapshot.startingPrice === 0 ? 0 : (priceChange / snapshot.startingPrice) * 100
  const directionallyCorrect = resolved
    ? determineDirectionalAccuracy(snapshot.bias, percentChange)
    : null

  return {
    window,
    targetAtMs,
    priceChange,
    percentChange,
    directionallyCorrect,
    resolved,
    status: resolved
      ? directionallyCorrect
        ? "correct"
        : "incorrect"
      : "pending",
  }
}

function recordBiasSnapshot({
  decision,
  receivedAtMs,
  setBiasSnapshots,
}: {
  decision: BtcDecisionSnapshot | null
  receivedAtMs: number
  setBiasSnapshots: Dispatch<SetStateAction<BtcJournalSnapshot[]>>
}) {
  if (
    decision === null ||
    decision.lastPrice === null ||
    decision.latestTickMs === null ||
    !Number.isFinite(decision.lastPrice)
  ) {
    return
  }

  const startingPrice = decision.lastPrice
  const sourceTickMs = decision.latestTickMs

  setBiasSnapshots((current) => {
    const lastSnapshot = current.at(-1)
    if (
      lastSnapshot &&
      lastSnapshot.sourceTickMs === sourceTickMs &&
      lastSnapshot.bias === decision.directionBias &&
      lastSnapshot.confidence === decision.confidenceScore
    ) {
      return current
    }

    const nextSnapshot: BtcJournalSnapshot = {
      id: `${sourceTickMs}-${decision.directionBias}-${current.length}`,
      timestampMs: receivedAtMs,
      startingPrice,
      bias: decision.directionBias,
      confidence: decision.confidenceScore,
      observationWindow: decision.observationWindow,
      sourceTickMs,
      explanation: decision.explanation,
    }

    const next = [...current, nextSnapshot]
    return next.slice(-MAX_BIAS_SNAPSHOTS)
  })
}

function stripJournalSnapshot(row: BtcJournalRow): BtcJournalSnapshot {
  const { outcomes, ...snapshot } = row
  void outcomes
  return snapshot
}

function determineDirectionalAccuracy(
  bias: BtcDirectionBias,
  percentChange: number,
) {
  if (bias === "bullish") {
    return percentChange > 0
  }

  if (bias === "bearish") {
    return percentChange < 0
  }

  return Math.abs(percentChange) <= NEUTRAL_DIRECTIONAL_BAND_PCT
}
