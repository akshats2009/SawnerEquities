"use client"

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react"

import {
  analyzeBtcPriceDecision,
  type BtcDecisionSnapshot,
  type BtcDirectionBias,
} from "@/lib/analysis/priceDecision"
import {
  type BtcMarketRegimeSnapshot,
  type BtcRegimeTransition,
} from "@/lib/analysis/regimeDetection"
import {
  readBtcJournalEntries,
  clearBtcJournalEntries,
  writeBtcJournalEntries,
} from "@/lib/btc/journal"
import {
  appendBtcCatalystEvents,
  clearBtcCatalystEntries,
  readBtcCatalystEntries,
} from "@/lib/btc/catalyst-history"
import type { BtcCatalystHistoryEntry } from "@/lib/btc/catalyst-history"
import {
  appendBtcWatchEntry,
  clearBtcWatchEntries,
  readBtcWatchEntries,
} from "@/lib/btc/watch-monitor"
import type { BtcMarketWatchEntry } from "@/lib/btc/watch-monitor"
import type {
  BtcJournalOutcome,
  BtcJournalRow,
  BtcJournalSnapshot,
  BtcJournalWindow,
} from "@/lib/btc/journal-types"
import { fetchFreeCryptoNewsItems } from "@/lib/news/freeCryptoNews"
import {
  BTC_EXCHANGE_CONFIGS,
  buildBtcPriceConsensus,
  buildConsensusTick,
  type BtcExchangeConnectionState,
  type BtcExchangeFeedState,
  type BtcExchangeId,
  type BtcPriceConsensus,
  startBtcExchangeStream,
} from "@/lib/btc/multiExchangeRealtime"
import type { RealtimeBtcTick } from "@/lib/btc/realtime"
import {
  buildBtcSocialNewsSnapshot,
  type BtcSocialNewsSnapshot,
} from "@/lib/sentiment/eventScoring"
import type { BtcSignalSuppressionSnapshot } from "@/lib/analysis/signalSuppression"

type SignalPerformanceWindow = BtcJournalWindow

export interface RealtimeBtcState {
  productId: string
  connectionState: BtcExchangeConnectionState
  reconnectAttempt: number
  isStale: boolean
  lastMessageAtMs: number | null
  lastHeartbeatAtMs: number | null
  error: string | null
  ticks: RealtimeBtcTick[]
  decision: BtcDecisionSnapshot
  latestTick: RealtimeBtcTick | null
  biasSnapshots: BtcJournalSnapshot[]
  breakoutHistory: BtcJournalSnapshot[]
  signalPerformance: BtcJournalRow[]
  watchEntries: BtcMarketWatchEntry[]
  catalystEntries: BtcCatalystHistoryEntry[]
  exchangeHealth: BtcExchangeFeedState[]
  priceConsensus: BtcPriceConsensus
  marketRegime: BtcMarketRegimeSnapshot
  regimeTransitions: BtcRegimeTransition[]
  regimeWarnings: string[]
  socialNews: BtcSocialNewsSnapshot | null
  signalSuppressionOverrideEnabled: boolean
  setSignalSuppressionOverrideEnabled: (enabled: boolean) => void
  clearCatalystHistory: () => void
  clearJournal: () => void
}

const MAX_TICK_AGE_MS = 30 * 60 * 1000
const MAX_TICKS = 2400
const MAX_BIAS_SNAPSHOTS = 18
const NEUTRAL_DIRECTIONAL_BAND_PCT = 0.08
const DECISION_PUBLISH_INTERVAL_MS = 3_000
const DECISION_PRICE_MOVE_THRESHOLD_PCT = 0.18
const INITIAL_EXCHANGE_FEEDS = buildInitialExchangeFeeds()
const INITIAL_PRICE_CONSENSUS: BtcPriceConsensus = {
  consolidatedPrice: null,
  bid: null,
  ask: null,
  spread: null,
  volume: null,
  exchangeTimestampMs: null,
  localTimestampMs: null,
  latencyMs: null,
  activeExchangeCount: 0,
  staleExchangeCount: 0,
  totalExchangeCount: BTC_EXCHANGE_CONFIGS.length,
  maxDeviationPct: null,
  medianDeviationPct: null,
  agreementScore: 0,
}

export function useMultiExchangeBtc(productId = "BTC-USD"): RealtimeBtcState {
  const [ticks, setTicks] = useState<RealtimeBtcTick[]>([])
  const [exchangeFeeds, setExchangeFeeds] = useState<Record<BtcExchangeId, BtcExchangeFeedState>>(
    () => INITIAL_EXCHANGE_FEEDS,
  )
  const [priceConsensus, setPriceConsensus] = useState<BtcPriceConsensus>(INITIAL_PRICE_CONSENSUS)
  const [error, setError] = useState<string | null>(null)
  const [biasSnapshots, setBiasSnapshots] = useState<BtcJournalSnapshot[]>(() =>
    readBtcJournalEntries().map(stripJournalSnapshot),
  )
  const [regimeTransitions, setRegimeTransitions] = useState<BtcRegimeTransition[]>([])
  const [regimeWarnings, setRegimeWarnings] = useState<string[]>([])
  const [watchEntries, setWatchEntries] = useState(() => readBtcWatchEntries())
  const [signalSuppressionOverrideEnabled, setSignalSuppressionOverrideEnabled] =
    useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [socialNews, setSocialNews] = useState<BtcSocialNewsSnapshot | null>(null)
  const [catalystEntries, setCatalystEntries] = useState(() => readBtcCatalystEntries())
  const [publishedDecision, setPublishedDecision] = useState<BtcDecisionSnapshot | null>(null)

  const exchangeFeedsRef = useRef(exchangeFeeds)
  const latestConsensusTickRef = useRef<RealtimeBtcTick | null>(null)
  const consensusSequenceRef = useRef(0)
  const decisionRef = useRef<BtcDecisionSnapshot | null>(null)
  const publishedDecisionAtMsRef = useRef<number | null>(null)
  const signalSuppressionOverrideRef = useRef(signalSuppressionOverrideEnabled)
  const watchMinuteBucketRef = useRef<number | null>(null)
  const catalystSnapshotRef = useRef<number | null>(null)

  useEffect(() => {
    exchangeFeedsRef.current = exchangeFeeds
  }, [exchangeFeeds])

  useEffect(() => {
    const cleanups = BTC_EXCHANGE_CONFIGS.map(({ exchange }) =>
      startBtcExchangeStream(exchange, {
        onTick: (tick) => {
          setError(null)
          const nextFeeds = updateFeedState(exchange, {
            connectionState: "open",
            error: null,
            stale: false,
            lastMessageAtMs: tick.localTimestamp,
            lastHeartbeatAtMs: tick.localTimestamp,
            exchangeTimestampMs: tick.exchangeTimestamp,
            localTimestampMs: tick.localTimestamp,
            latencyMs: tick.latencyMs,
            latestTick: tick,
          })
          recomputeConsensus(nextFeeds)
        },
        onStatus: (state) => {
          const nextFeeds = updateFeedState(exchange, state)
          recomputeConsensus(nextFeeds)
        },
        onError: (message) => setError(message),
      }),
    )

    const staleTimer = setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => {
      cleanups.forEach((cleanup) => cleanup())
      clearInterval(staleTimer)
    }
  }, [])

  const rawDecision = useMemo(
    () =>
      analyzeBtcPriceDecision(ticks, {
        staleThresholdMs: 20_000,
        exchangeConsensus: priceConsensus,
        socialNews,
      }),
    [priceConsensus, socialNews, ticks],
  )

  useEffect(() => {
    setPublishedDecision((current) => {
      if (current === null) {
        publishedDecisionAtMsRef.current = rawDecision.asOfMs
        return rawDecision
      }

      if (shouldAdoptDecision(current, rawDecision, publishedDecisionAtMsRef.current)) {
        publishedDecisionAtMsRef.current = rawDecision.asOfMs
        return rawDecision
      }

      return current
    })
  }, [rawDecision])

  const decision = publishedDecision ?? rawDecision

  useEffect(() => {
    decisionRef.current = decision
  }, [decision])

  useEffect(() => {
    signalSuppressionOverrideRef.current = signalSuppressionOverrideEnabled
  }, [signalSuppressionOverrideEnabled])

  useEffect(() => {
    let isMounted = true

    async function loadSocialNews() {
      try {
        const freeNews = await fetchFreeCryptoNewsItems({
          limit: 8,
        })

        const snapshot = buildBtcSocialNewsSnapshot({
          asOfMs: Date.now(),
          socialPosts: [],
          newsItems: freeNews.items,
          sourceStatus: {
            x: {
              enabled: false,
              warning: "X_BEARER_TOKEN is not configured.",
              itemCount: 0,
            },
            truthSocial: {
              enabled: false,
              warning:
                "TRUTH_SOCIAL_FEED_URL is not configured. Truth Social ingestion is disabled unless a manual or third-party feed is provided.",
              itemCount: 0,
            },
            news: freeNews.sourceStatus,
          },
        })

        if (isMounted) {
          setSocialNews(snapshot)
        }
      } catch {
        if (isMounted) {
          setSocialNews((current) => current)
        }
      }
    }

    void loadSocialNews()
    const interval = setInterval(() => {
      void loadSocialNews()
    }, 90_000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (!socialNews?.available || socialNews.topEvents.length === 0) {
      return
    }

    if (catalystSnapshotRef.current === socialNews.asOfMs) {
      return
    }

    catalystSnapshotRef.current = socialNews.asOfMs
    setCatalystEntries((current) =>
      appendBtcCatalystEvents(current, socialNews.topEvents),
    )
  }, [socialNews])

  const isStale = priceConsensus.activeExchangeCount === 0 || decision.dataQuality.stale

  useEffect(() => {
    if (
      decision.lastPrice === null ||
      decision.latestTickMs === null ||
      priceConsensus.activeExchangeCount === 0
    ) {
      return
    }

    const bucket = Math.floor(nowMs / 60_000)
    if (watchMinuteBucketRef.current === bucket) {
      return
    }

    watchMinuteBucketRef.current = bucket
    const nextWatchEntry = {
      id: `${decision.asOfMs}-${decision.latestTickMs}-${bucket}`,
      timestampMs: nowMs,
      price: decision.lastPrice,
      directionReadout: decision.marketQuality.directionalReadout,
      confidence: decision.confidenceScore,
      marketState: decision.marketState,
      marketQuality: decision.marketQuality,
      riskState: decision.riskState,
      observationWindow: decision.observationWindow,
      suppressionLevel: decision.signalSuppression.level,
      regime: decision.marketRegime,
      falseBreakout: decision.falseBreakout,
      topReason: decision.explanation.primaryReason,
      whatToWatchNext: decision.explanation.biasChangeCondition,
      activeExchangeCount: priceConsensus.activeExchangeCount,
      totalExchangeCount: priceConsensus.totalExchangeCount,
      isStale,
      latencyMs: priceConsensus.latencyMs,
      directionBias: decision.directionBias,
    } satisfies Parameters<typeof appendBtcWatchEntry>[0]

    setWatchEntries(appendBtcWatchEntry(nextWatchEntry))
  }, [
    decision,
    isStale,
    nowMs,
    priceConsensus.activeExchangeCount,
    priceConsensus.latencyMs,
    priceConsensus.totalExchangeCount,
  ])

  useEffect(() => {
    const regime = decision.marketRegime
    if (!regime) {
      return
    }

    const timer = setTimeout(() => {
      setRegimeTransitions((current) => {
        const lastTransition = current.at(-1) ?? null
        const previousRegime = lastTransition?.to ?? null

        if (previousRegime === regime.primaryRegime) {
          setRegimeWarnings(
            buildRegimeWarnings(current, regime, decision.asOfMs),
          )
          return current
        }

        const nextTransition: BtcRegimeTransition = {
          timestampMs: decision.asOfMs,
          from: previousRegime,
          to: regime.primaryRegime,
          confidence: regime.regimeConfidence,
          stabilityScore: regime.regimeStabilityScore,
          explanation: regime.explanation,
        }

        const next = [...current, nextTransition].slice(-16)
        setRegimeWarnings(buildRegimeWarnings(next, regime, decision.asOfMs))
        return next
      })
    }, 0)

    return () => clearTimeout(timer)
  }, [decision.asOfMs, decision.marketRegime])

  const latestTick = ticks.at(-1) ?? null

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
  const breakoutHistory = useMemo(
    () =>
      biasSnapshots.filter(
        (snapshot) =>
          snapshot.falseBreakout !== null &&
          snapshot.falseBreakout !== undefined &&
          snapshot.falseBreakout.breakoutDirection !== "none",
      ),
    [biasSnapshots],
  )

  useEffect(() => {
    writeBtcJournalEntries(signalPerformance)
  }, [signalPerformance])

  const exchangeFeedList = Object.values(exchangeFeeds)
  const connectionState = deriveOverallConnectionState(exchangeFeedList)
  const reconnectAttempt = Math.max(
    0,
    ...exchangeFeedList.map((feed) => feed.reconnectAttempt),
  )
  const lastMessageAtMs = maxTimestamp(exchangeFeedList.map((feed) => feed.lastMessageAtMs))
  const lastHeartbeatAtMs = maxTimestamp(exchangeFeedList.map((feed) => feed.lastHeartbeatAtMs))

  const terminalError = priceConsensus.activeExchangeCount > 0 ? null : error

  return {
    productId,
    connectionState,
    reconnectAttempt,
    isStale,
    lastMessageAtMs,
    lastHeartbeatAtMs,
    error: terminalError,
    ticks,
    decision,
    latestTick,
    biasSnapshots,
    breakoutHistory,
    signalPerformance,
    watchEntries,
    catalystEntries,
    exchangeHealth: exchangeFeedList,
    priceConsensus,
    marketRegime: decision.marketRegime,
    regimeTransitions,
    regimeWarnings,
    socialNews,
    signalSuppressionOverrideEnabled,
    setSignalSuppressionOverrideEnabled,
    clearCatalystHistory: () => {
      clearBtcCatalystEntries()
      setCatalystEntries([])
      catalystSnapshotRef.current = null
    },
    clearJournal: () => {
      clearBtcJournalEntries()
      clearBtcWatchEntries()
      setBiasSnapshots([])
      setWatchEntries([])
      setRegimeTransitions([])
      setRegimeWarnings([])
      setSignalSuppressionOverrideEnabled(false)
      watchMinuteBucketRef.current = null
    },
  }

  function updateFeedState(
    exchange: BtcExchangeId,
    patch: Partial<BtcExchangeFeedState>,
  ) {
    const nextFeeds = {
      ...exchangeFeedsRef.current,
      [exchange]: {
        ...exchangeFeedsRef.current[exchange],
        ...patch,
      },
    }

    exchangeFeedsRef.current = nextFeeds
    setExchangeFeeds(nextFeeds)
    return nextFeeds
  }

  function recomputeConsensus(nextFeeds: Record<BtcExchangeId, BtcExchangeFeedState>) {
    const nextConsensus = buildBtcPriceConsensus(Object.values(nextFeeds))
    setPriceConsensus(nextConsensus)

    const nextConsensusTick = buildConsensusTick(
      nextConsensus,
      consensusSequenceRef.current + 1,
    )
    if (!nextConsensusTick) {
      return
    }

    const lastTick = latestConsensusTickRef.current
    if (
      lastTick &&
      lastTick.price === nextConsensusTick.price &&
      lastTick.exchangeTimeMs === nextConsensusTick.exchangeTimeMs &&
      lastTick.bid === nextConsensusTick.bid &&
      lastTick.ask === nextConsensusTick.ask
    ) {
      return
    }

    consensusSequenceRef.current += 1
    latestConsensusTickRef.current = nextConsensusTick
    setTicks((current) => {
      const next = [...current, nextConsensusTick].filter(
        (tick) => tick.exchangeTimeMs >= Date.now() - MAX_TICK_AGE_MS,
      )

      if (next.length > MAX_TICKS) {
        return next.slice(-MAX_TICKS)
      }

      return next
    })

    const decisionSnapshot = decisionRef.current
    if (decisionSnapshot) {
      recordBiasSnapshot({
        decision: decisionSnapshot,
        receivedAtMs: nextConsensusTick.receivedAtMs,
        setBiasSnapshots,
        allowSuppressedSnapshots: signalSuppressionOverrideRef.current,
      })
    }
  }
}

function shouldAdoptDecision(
  current: BtcDecisionSnapshot,
  next: BtcDecisionSnapshot,
  lastPublishedAtMs: number | null,
) {
  if (lastPublishedAtMs === null) {
    return true
  }

  const elapsedMs = next.asOfMs - lastPublishedAtMs
  const priceMovePct = percentMove(current.lastPrice, next.lastPrice)
  const confidenceShift = Math.abs(next.confidenceScore - current.confidenceScore)

  const suppressionEscalated =
    signalSuppressionSeverity(next.signalSuppression.level) >
    signalSuppressionSeverity(current.signalSuppression.level)
  const suppressionResolved =
    signalSuppressionSeverity(next.signalSuppression.level) <
    signalSuppressionSeverity(current.signalSuppression.level)
  const hardDirectionFlip =
    current.directionBias !== next.directionBias &&
    next.directionBias !== "neutral" &&
    next.confidenceScore >= 55 &&
    next.marketQuality.signalQualityScore >= 58 &&
    next.marketQuality.signalQualityState !== "weak signal" &&
    next.marketState.interpretability !== "low" &&
    next.signalSuppression.level === "none"
  const hardRegimeShift =
    current.marketRegime.primaryRegime !== next.marketRegime.primaryRegime &&
    next.marketRegime.regimeConfidence >= 58 &&
    next.marketRegime.regimeStabilityScore >= 58
  const hardStateShift =
    current.marketState.state !== next.marketState.state &&
    (next.marketState.state === "unavailable" ||
      next.marketState.state === "unstable" ||
      next.marketState.signalInterpretabilityScore >= 60)
  const hardRiskShift = current.riskState !== next.riskState && next.riskState === "avoid"

  if (
    suppressionEscalated ||
    hardDirectionFlip ||
    hardRegimeShift ||
    hardStateShift ||
    hardRiskShift
  ) {
    return true
  }

  if (confidenceShift >= 14 || priceMovePct >= DECISION_PRICE_MOVE_THRESHOLD_PCT) {
    return true
  }

  if (suppressionResolved && elapsedMs >= DECISION_PUBLISH_INTERVAL_MS / 2) {
    return true
  }

  return elapsedMs >= DECISION_PUBLISH_INTERVAL_MS
}

function percentMove(previousPrice: number | null, nextPrice: number | null) {
  if (
    previousPrice === null ||
    nextPrice === null ||
    previousPrice === 0 ||
    Number.isNaN(previousPrice) ||
    Number.isNaN(nextPrice)
  ) {
    return 0
  }

  return Math.abs((nextPrice - previousPrice) / previousPrice) * 100
}

function signalSuppressionSeverity(level: BtcSignalSuppressionSnapshot["level"]) {
  if (level === "none") {
    return 0
  }

  if (level === "caution") {
    return 1
  }

  if (level === "suppress directional bias") {
    return 2
  }

  return 3
}

function buildInitialExchangeFeeds() {
  return BTC_EXCHANGE_CONFIGS.reduce(
    (accumulator, config) => {
      accumulator[config.exchange] = {
        exchange: config.exchange,
        label: config.label,
        symbol: config.symbol,
        connectionState: "connecting",
        reconnectAttempt: 0,
        lastMessageAtMs: null,
        lastHeartbeatAtMs: null,
        exchangeTimestampMs: null,
        localTimestampMs: null,
        latencyMs: null,
        stale: false,
        error: null,
        latestTick: null,
      }

      return accumulator
    },
    {} as Record<BtcExchangeId, BtcExchangeFeedState>,
  )
}

function deriveOverallConnectionState(feeds: BtcExchangeFeedState[]): BtcExchangeConnectionState {
  if (feeds.some((feed) => feed.connectionState === "open" && !feed.stale)) {
    return "open"
  }

  if (feeds.some((feed) => feed.connectionState === "reconnecting")) {
    return "reconnecting"
  }

  if (feeds.some((feed) => feed.connectionState === "connecting")) {
    return "connecting"
  }

  if (feeds.some((feed) => feed.connectionState === "error")) {
    return "error"
  }

  return "closed"
}

function maxTimestamp(values: Array<number | null>) {
  const filtered = values.filter((value): value is number => value !== null)
  return filtered.length > 0 ? Math.max(...filtered) : null
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
  const minutes = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "1h": 60,
  }[window]
  const targetAtMs = snapshot.timestampMs + minutes * 60 * 1000
  const pastTarget = nowMs >= targetAtMs
  const resolved = pastTarget && currentPrice !== null
  // Once the target timestamp has passed, freeze the reference price to the
  // resolution-time price (stored in snapshot.startingPrice as fallback) so
  // that subsequent live-price changes don't produce phantom PnL.  While
  // still inside the window, use currentPrice as a live preview and mark it.
  const isLive = !pastTarget && currentPrice !== null
  const referencePrice = pastTarget
    ? (currentPrice ?? snapshot.startingPrice)
    : (currentPrice ?? snapshot.startingPrice)
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
    isLive,
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
  allowSuppressedSnapshots,
}: {
  decision: BtcDecisionSnapshot | null
  receivedAtMs: number
  setBiasSnapshots: Dispatch<SetStateAction<BtcJournalSnapshot[]>>
  allowSuppressedSnapshots: boolean
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
  const suppression = decision.signalSuppression

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

    if (suppression.shouldSuppressSnapshot && !allowSuppressedSnapshots) {
      return current
    }

    const nextSnapshot: BtcJournalSnapshot = {
      id: `${sourceTickMs}-${decision.directionBias}-${current.length}`,
      timestampMs: receivedAtMs,
      startingPrice,
      bias: decision.directionBias,
      marketQuality: decision.marketQuality,
      marketState: decision.marketState,
      marketRegime: decision.marketRegime,
      falseBreakout: decision.falseBreakout,
      horizonForecast: decision.horizonForecast,
      socialNews: decision.socialNews,
      signalSuppression: suppression,
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

function buildRegimeWarnings(
  history: BtcRegimeTransition[],
  regime: BtcMarketRegimeSnapshot,
  nowMs: number,
) {
  const warnings = new Set<string>(regime.warnings)

  const recentTransitions = history.slice(-5)
  const lastTransition = recentTransitions.at(-1) ?? null
  if (
    regime.isTransitioning ||
    (lastTransition !== null && nowMs - lastTransition.timestampMs < 5 * 60 * 1000)
  ) {
    warnings.add("Regime transition in progress.")
  }

  if (regime.regimeConfidence < 55) {
    warnings.add("Low regime confidence.")
  }

  if (regime.regimeStabilityScore < 50) {
    warnings.add("Conditions unstable.")
  }

  if (detectRepeatedFalseBreakouts(history)) {
    warnings.add("Repeated false breakouts detected in recent regime history.")
  }

  return Array.from(warnings)
}

function detectRepeatedFalseBreakouts(history: BtcRegimeTransition[]) {
  if (history.length < 3) {
    return false
  }

  let falseBreakoutCount = 0
  for (let index = 1; index < history.length; index += 1) {
    const previous = history[index - 1]
    const current = history[index]

    const breakoutStarted =
      previous.to === "breakout conditions" &&
      (previous.from === "low-volatility compression" ||
        previous.from === "choppy / noisy")
    const breakoutFailed =
      breakoutStarted &&
      (current.to === "choppy / noisy" ||
        current.to === "mean-reverting" ||
        current.to === "exhaustion conditions")

    if (breakoutFailed) {
      falseBreakoutCount += 1
    }
  }

  return falseBreakoutCount >= 2
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
