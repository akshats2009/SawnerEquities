import { clamp } from "@/lib/utils"
import {
  BTC_PRODUCT_ID,
  buildCoinbaseSubscription,
  parseCoinbaseEnvelope,
  type RealtimeBtcTick,
} from "@/lib/btc/realtime"

export type BtcExchangeId = "coinbase" | "kraken" | "bitstamp"
export type BtcExchangeConnectionState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "error"

export interface BtcNormalizedExchangeTick {
  exchange: BtcExchangeId
  symbol: string
  price: number
  bid: number | null
  ask: number | null
  spread: number | null
  volume: number | null
  exchangeTimestamp: number
  localTimestamp: number
  latencyMs: number
}

export interface BtcExchangeFeedState {
  exchange: BtcExchangeId
  label: string
  symbol: string
  connectionState: BtcExchangeConnectionState
  reconnectAttempt: number
  lastMessageAtMs: number | null
  lastHeartbeatAtMs: number | null
  exchangeTimestampMs: number | null
  localTimestampMs: number | null
  latencyMs: number | null
  stale: boolean
  error: string | null
  latestTick: BtcNormalizedExchangeTick | null
}

export interface BtcPriceConsensus {
  consolidatedPrice: number | null
  bid: number | null
  ask: number | null
  spread: number | null
  volume: number | null
  exchangeTimestampMs: number | null
  localTimestampMs: number | null
  latencyMs: number | null
  activeExchangeCount: number
  staleExchangeCount: number
  totalExchangeCount: number
  maxDeviationPct: number | null
  medianDeviationPct: number | null
  agreementScore: number
}

export const BTC_EXCHANGE_CONFIGS: Array<{
  exchange: BtcExchangeId
  label: string
  symbol: string
}> = [
  { exchange: "coinbase", label: "Coinbase", symbol: "BTC-USD" },
  { exchange: "kraken", label: "Kraken", symbol: "BTC/USD" },
  { exchange: "bitstamp", label: "Bitstamp", symbol: "BTC/USD" },
]

const STALE_THRESHOLD_MS = 20_000
const RECONNECT_MAX_MS = 15_000

export function startBtcExchangeStream(
  exchange: BtcExchangeId,
  handlers: {
    onTick: (tick: BtcNormalizedExchangeTick) => void
    onStatus: (state: BtcExchangeFeedState) => void
    onError?: (message: string) => void
  },
) {
  const config = BTC_EXCHANGE_CONFIGS.find((item) => item.exchange === exchange)
  if (!config) {
    throw new Error(`Unsupported BTC exchange: ${exchange}`)
  }

  let socket: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let staleTimer: ReturnType<typeof setInterval> | null = null
  let closed = false
  let reconnectAttempt = 0
  let lastMessageAtMs: number | null = null
  let lastHeartbeatAtMs: number | null = null
  let latestTick: BtcNormalizedExchangeTick | null = null
  let connectionState: BtcExchangeConnectionState = "connecting"
  let stale = false
  let error: string | null = null

  const emitStatus = () => {
    handlers.onStatus({
      exchange,
      label: config.label,
      symbol: config.symbol,
      connectionState,
      reconnectAttempt,
      lastMessageAtMs,
      lastHeartbeatAtMs,
      exchangeTimestampMs: latestTick?.exchangeTimestamp ?? null,
      localTimestampMs: latestTick?.localTimestamp ?? null,
      latencyMs: latestTick?.latencyMs ?? null,
      stale,
      error,
      latestTick,
    })
  }

  const scheduleReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
    }

    const delay = Math.min(1000 * 2 ** reconnectAttempt, RECONNECT_MAX_MS)
    reconnectTimer = setTimeout(() => {
      if (closed) {
        return
      }

      reconnectAttempt += 1
      connectionState = "reconnecting"
      emitStatus()
      connect()
    }, delay)
  }

  const connect = () => {
    if (closed) {
      return
    }

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close()
    }

    connectionState = reconnectAttempt === 0 ? "connecting" : "reconnecting"
    error = null
    emitStatus()

    socket = new WebSocket(resolveExchangeUrl(exchange))

    socket.addEventListener("open", () => {
      if (closed || !socket) {
        return
      }

      subscribeExchange(socket, exchange, config.symbol)
      connectionState = "open"
      reconnectAttempt = 0
      emitStatus()
    })

    socket.addEventListener("message", (event) => {
      if (closed) {
        return
      }

      const receivedAtMs = Date.now()
      lastMessageAtMs = receivedAtMs
      stale = false

      const raw = typeof event.data === "string" ? event.data : ""
      if (exchange === "coinbase") {
        const envelope = parseCoinbaseEnvelope(raw, receivedAtMs)
        if (envelope?.kind === "heartbeat") {
          lastHeartbeatAtMs = receivedAtMs
          emitStatus()
          return
        }
      }

      const tick = parseExchangeEnvelope(exchange, raw, receivedAtMs)
      if (tick) {
        latestTick = tick
        error = null
        handlers.onTick(tick)
      }

      emitStatus()
    })

    socket.addEventListener("error", () => {
      if (closed) {
        return
      }

      connectionState = "error"
      error = `${config.label} websocket reported an error.`
      handlers.onError?.(error)
      emitStatus()
      socket?.close()
    })

    socket.addEventListener("close", () => {
      if (closed) {
        return
      }

      connectionState = "reconnecting"
      emitStatus()
      scheduleReconnect()
    })

    if (staleTimer) {
      clearInterval(staleTimer)
    }

    staleTimer = setInterval(() => {
      if (closed) {
        return
      }

      const now = Date.now()
      const lastObservedAtMs = Math.max(
        lastMessageAtMs ?? 0,
        lastHeartbeatAtMs ?? 0,
      )
      const nextStale =
        lastObservedAtMs > 0 ? now - lastObservedAtMs > STALE_THRESHOLD_MS : false

      if (nextStale !== stale) {
        stale = nextStale
        emitStatus()
      }

      if (
        nextStale &&
        socket &&
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close()
      }
    }, 1000)
  }

  connect()

  return () => {
    closed = true

    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
    }

    if (staleTimer) {
      clearInterval(staleTimer)
    }

    socket?.close()
  }
}

export function buildBtcPriceConsensus(
  feeds: BtcExchangeFeedState[],
): BtcPriceConsensus {
  const active = feeds.filter((feed) => feed.connectionState === "open" && !feed.stale && feed.latestTick)
  const staleExchangeCount = feeds.filter((feed) => feed.stale || feed.connectionState !== "open").length

  if (active.length === 0) {
    return {
      consolidatedPrice: null,
      bid: null,
      ask: null,
      spread: null,
      volume: null,
      exchangeTimestampMs: null,
      localTimestampMs: null,
      latencyMs: null,
      activeExchangeCount: 0,
      staleExchangeCount,
      totalExchangeCount: feeds.length,
      maxDeviationPct: null,
      medianDeviationPct: null,
      agreementScore: 0,
    }
  }

  const prices = active.map((feed) => feed.latestTick!.price).sort((left, right) => left - right)
  const consolidatedPrice = median(prices)
  const bidValues = active
    .map((feed) => feed.latestTick!.bid)
    .filter((value): value is number => value !== null && Number.isFinite(value))
  const askValues = active
    .map((feed) => feed.latestTick!.ask)
    .filter((value): value is number => value !== null && Number.isFinite(value))
  const volumeValues = active
    .map((feed) => feed.latestTick!.volume)
    .filter((value): value is number => value !== null && Number.isFinite(value))
  const exchangeTimestampValues = active.map((feed) => feed.latestTick!.exchangeTimestamp)
  const localTimestampValues = active.map((feed) => feed.latestTick!.localTimestamp)
  const latencyValues = active.map((feed) => feed.latestTick!.latencyMs)

  const deviations = prices.map((price) =>
    consolidatedPrice > 0 ? Math.abs((price - consolidatedPrice) / consolidatedPrice) * 100 : 0,
  )
  const maxDeviationPct = deviations.length > 0 ? Math.max(...deviations) : null
  const medianDeviationPct = deviations.length > 0 ? median(deviations) : null
  const agreementScore = computeAgreementScore({
    activeCount: active.length,
    staleCount: staleExchangeCount,
    maxDeviationPct,
    medianDeviationPct,
  })

  return {
    consolidatedPrice,
    bid: bidValues.length > 0 ? median(bidValues) : null,
    ask: askValues.length > 0 ? median(askValues) : null,
    spread:
      bidValues.length > 0 && askValues.length > 0
        ? median(askValues) - median(bidValues)
        : null,
    volume: volumeValues.length > 0 ? median(volumeValues) : null,
    exchangeTimestampMs: median(exchangeTimestampValues),
    localTimestampMs: median(localTimestampValues),
    latencyMs: median(latencyValues),
    activeExchangeCount: active.length,
    staleExchangeCount,
    totalExchangeCount: feeds.length,
    maxDeviationPct,
    medianDeviationPct,
    agreementScore,
  }
}

export function buildConsensusTick(
  consensus: BtcPriceConsensus,
  sequence: number,
): RealtimeBtcTick | null {
  if (consensus.consolidatedPrice === null) {
    return null
  }

  const exchangeTimeMs = consensus.exchangeTimestampMs ?? consensus.localTimestampMs ?? Date.now()
  const receivedAtMs = consensus.localTimestampMs ?? Date.now()
  const spread = consensus.spread
  const price = consensus.consolidatedPrice

  return {
    productId: BTC_PRODUCT_ID,
    sequence,
    price,
    bid: consensus.bid,
    ask: consensus.ask,
    spread,
    spreadBps:
      spread !== null && price > 0 ? (spread / price) * 10000 : null,
    volume24h: consensus.volume,
    lastSize: null,
    tradeId: null,
    side: null,
    exchangeTimeMs,
    receivedAtMs,
  }
}

export function parseExchangeEnvelope(
  exchange: BtcExchangeId,
  rawMessage: string,
  receivedAtMs: number,
): BtcNormalizedExchangeTick | null {
  if (exchange === "coinbase") {
    const envelope = parseCoinbaseEnvelope(rawMessage, receivedAtMs)
    if (envelope?.kind === "tick" && envelope.tick) {
      return normalizeCoinbaseTick(envelope.tick, receivedAtMs)
    }

    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawMessage) as unknown
  } catch {
    return null
  }

  if (exchange === "kraken") {
    return normalizeKrakenMessage(parsed, receivedAtMs)
  }

  return normalizeBitstampMessage(parsed, receivedAtMs)
}

function normalizeCoinbaseTick(
  tick: RealtimeBtcTick,
  receivedAtMs: number,
): BtcNormalizedExchangeTick {
  return {
    exchange: "coinbase",
    symbol: tick.productId,
    price: tick.price,
    bid: tick.bid,
    ask: tick.ask,
    spread: tick.spread,
    volume: tick.volume24h,
    exchangeTimestamp: tick.exchangeTimeMs,
    localTimestamp: receivedAtMs,
    latencyMs: Math.max(0, receivedAtMs - tick.exchangeTimeMs),
  }
}

function normalizeKrakenMessage(
  parsed: unknown,
  receivedAtMs: number,
): BtcNormalizedExchangeTick | null {
  if (!isRecord(parsed) || parsed.channel !== "ticker" || !Array.isArray(parsed.data)) {
    return null
  }

  const raw = parsed.data[0]
  if (!isRecord(raw)) {
    return null
  }

  const symbol = readString(raw.symbol) ?? "BTC/USD"
  const price = readNumber(raw.last ?? raw.ask ?? raw.bid)
  const bid = readOptionalNumber(raw.bid)
  const ask = readOptionalNumber(raw.ask)
  const volume = readOptionalNumber(raw.volume)
  const exchangeTimestamp = readTimestampMs(raw.timestamp ?? raw.time)

  if (!Number.isFinite(price)) {
    return null
  }

  const effectiveExchangeTimestamp = Number.isFinite(exchangeTimestamp)
    ? exchangeTimestamp
    : receivedAtMs

  return {
    exchange: "kraken",
    symbol,
    price,
    bid,
    ask,
    spread:
      bid !== null && ask !== null ? ask - bid : null,
    volume,
    exchangeTimestamp: effectiveExchangeTimestamp,
    localTimestamp: receivedAtMs,
    latencyMs: Math.max(0, receivedAtMs - effectiveExchangeTimestamp),
  }
}

function normalizeBitstampMessage(
  parsed: unknown,
  receivedAtMs: number,
): BtcNormalizedExchangeTick | null {
  if (!isRecord(parsed) || typeof parsed.channel !== "string") {
    return null
  }

  if (!isRecord(parsed.data)) {
    return null
  }

  const channel = parsed.channel
  const raw = parsed.data

  if (
    channel === "ticker_btcusd" ||
    channel === "ticker_btcusd_perp" ||
    channel.startsWith("ticker_")
  ) {
    const bid = readOptionalNumber(raw.bid)
    const ask = readOptionalNumber(raw.ask)
    const last = readOptionalNumber(raw.last ?? raw.price)
    const volume = readOptionalNumber(raw.volume ?? raw.volume24h)
    const exchangeTimestamp = readBitstampTimestamp(
      raw.timestamp ?? raw.microtimestamp ?? raw.datetime,
    )

    const price = Number.isFinite(last)
      ? (last as number)
      : bid !== null && ask !== null
        ? (bid + ask) / 2
        : Number.NaN

    if (!Number.isFinite(price)) {
      return null
    }

    const effectiveExchangeTimestamp = Number.isFinite(exchangeTimestamp)
      ? exchangeTimestamp
      : receivedAtMs

    return {
      exchange: "bitstamp",
      symbol: "BTC/USD",
      price,
      bid,
      ask,
      spread:
        bid !== null && ask !== null ? ask - bid : null,
      volume,
      exchangeTimestamp: effectiveExchangeTimestamp,
      localTimestamp: receivedAtMs,
      latencyMs: Math.max(0, receivedAtMs - effectiveExchangeTimestamp),
    }
  }

  if (channel === "live_trades_btcusd") {
    const price = readOptionalNumber(raw.price ?? raw.last)
    const volume = readOptionalNumber(raw.amount ?? raw.volume)
    const exchangeTimestamp = readBitstampTimestamp(
      raw.microtimestamp ?? raw.timestamp ?? raw.datetime,
    )

    if (price === null) {
      return null
    }

    const effectiveExchangeTimestamp = Number.isFinite(exchangeTimestamp)
      ? exchangeTimestamp
      : receivedAtMs

    return {
      exchange: "bitstamp",
      symbol: "BTC/USD",
      price,
      bid: null,
      ask: null,
      spread: null,
      volume,
      exchangeTimestamp: effectiveExchangeTimestamp,
      localTimestamp: receivedAtMs,
      latencyMs: Math.max(0, receivedAtMs - effectiveExchangeTimestamp),
    }
  }

  if (channel === "order_book_btcusd") {
    const bid = firstOrderBookPrice(raw.bids)
    const ask = firstOrderBookPrice(raw.asks)
    const exchangeTimestamp = readBitstampTimestamp(
      raw.timestamp ?? raw.microtimestamp ?? raw.datetime,
    )
    const price =
      bid !== null && ask !== null ? (bid + ask) / 2 : bid ?? ask ?? Number.NaN

    if (!Number.isFinite(price)) {
      return null
    }

    const effectiveExchangeTimestamp = Number.isFinite(exchangeTimestamp)
      ? exchangeTimestamp
      : receivedAtMs

    return {
      exchange: "bitstamp",
      symbol: "BTC/USD",
      price,
      bid,
      ask,
      spread:
        bid !== null && ask !== null ? ask - bid : null,
      volume: null,
      exchangeTimestamp: effectiveExchangeTimestamp,
      localTimestamp: receivedAtMs,
      latencyMs: Math.max(0, receivedAtMs - effectiveExchangeTimestamp),
    }
  }

  return null
}

function subscribeExchange(
  socket: WebSocket,
  exchange: BtcExchangeId,
  symbol: string,
) {
  if (exchange === "coinbase") {
    socket.send(JSON.stringify(buildCoinbaseSubscription([symbol])))
    return
  }

  if (exchange === "kraken") {
    socket.send(
      JSON.stringify({
        method: "subscribe",
        params: {
          channel: "ticker",
          symbol: [symbol],
          event_trigger: "bbo",
          snapshot: true,
        },
      }),
    )
    return
  }

  socket.send(
    JSON.stringify({
      event: "bts:subscribe",
      data: {
        channel: "ticker_btcusd",
      },
    }),
  )
  socket.send(
    JSON.stringify({
      event: "bts:subscribe",
      data: {
        channel: "live_trades_btcusd",
      },
    }),
  )
  socket.send(
    JSON.stringify({
      event: "bts:subscribe",
      data: {
        channel: "order_book_btcusd",
      },
    }),
  )
}

function resolveExchangeUrl(exchange: BtcExchangeId) {
  if (exchange === "coinbase") {
    return "wss://ws-feed.exchange.coinbase.com"
  }

  if (exchange === "kraken") {
    return "wss://ws.kraken.com/v2"
  }

  return "wss://ws.bitstamp.net"
}

function computeAgreementScore({
  activeCount,
  staleCount,
  maxDeviationPct,
  medianDeviationPct,
}: {
  activeCount: number
  staleCount: number
  maxDeviationPct: number | null
  medianDeviationPct: number | null
}) {
  const activePenalty = activeCount <= 1 ? 35 : activeCount === 2 ? 18 : 0
  const stalePenalty = staleCount * 12
  const maxDeviationPenalty = clamp((maxDeviationPct ?? 0) * 7, 0, 40)
  const medianDeviationPenalty = clamp((medianDeviationPct ?? 0) * 4, 0, 18)

  return Math.round(
    clamp(
      100 -
        activePenalty -
        stalePenalty -
        maxDeviationPenalty -
        medianDeviationPenalty,
      0,
      100,
    ),
  )
}

function firstOrderBookPrice(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    return null
  }

  const first = value[0]
  if (!Array.isArray(first) || first.length === 0) {
    return null
  }

  const parsed = readOptionalNumber(first[0])
  return parsed
}

function median(values: number[]) {
  if (values.length === 0) {
    return Number.NaN
  }

  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2
  }

  return sorted[middle]
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null
}

function readNumber(value: unknown) {
  if (typeof value === "number") {
    return value
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }

  return Number.NaN
}

function readOptionalNumber(value: unknown) {
  const parsed = readNumber(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readTimestampMs(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    return Number.NaN
  }

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function readBitstampTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value / 1000 : value * 1000
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed > 1e12 ? parsed / 1000 : parsed * 1000
    }

    const parsedDate = Date.parse(value)
    return Number.isFinite(parsedDate) ? parsedDate : Number.NaN
  }

  return Number.NaN
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
