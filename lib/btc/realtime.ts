export const BTC_PRODUCT_ID = "BTC-USD"
export const COINBASE_WS_URL = "wss://ws-feed.exchange.coinbase.com"

export type RealtimeBtcChannel = "ticker" | "heartbeat"

export interface CoinbaseTickerMessage {
  type: "ticker"
  sequence: number
  product_id: string
  price: string
  open_24h?: string
  volume_24h?: string
  low_24h?: string
  high_24h?: string
  volume_30d?: string
  best_bid?: string
  best_bid_size?: string
  best_ask?: string
  best_ask_size?: string
  side?: "buy" | "sell"
  time: string
  trade_id?: number
  last_size?: string
}

export interface CoinbaseHeartbeatMessage {
  type: "heartbeat"
  sequence: number
  last_trade_id: number
  product_id: string
  time: string
}

export interface CoinbaseSubscriptionMessage {
  type: "subscribe"
  product_ids: string[]
  channels: RealtimeBtcChannel[]
}

export interface RealtimeBtcTick {
  productId: string
  sequence: number
  price: number
  bid: number | null
  ask: number | null
  spread: number | null
  spreadBps: number | null
  volume24h: number | null
  lastSize: number | null
  tradeId: number | null
  side: "buy" | "sell" | null
  exchangeTimeMs: number
  receivedAtMs: number
}

export interface RealtimeBtcHeartbeat {
  productId: string
  sequence: number
  lastTradeId: number
  exchangeTimeMs: number
  receivedAtMs: number
}

export interface RealtimeBtcFeedEnvelope {
  kind: "tick" | "heartbeat" | "subscriptions" | "error" | "unknown"
  rawType?: string
  tick?: RealtimeBtcTick
  heartbeat?: RealtimeBtcHeartbeat
  error?: string
}

export function buildCoinbaseSubscription(
  productIds: string[] = [BTC_PRODUCT_ID],
): CoinbaseSubscriptionMessage {
  return {
    type: "subscribe",
    product_ids: productIds,
    channels: ["ticker", "heartbeat"],
  }
}

export function parseCoinbaseEnvelope(
  rawMessage: string,
  receivedAtMs = Date.now(),
): RealtimeBtcFeedEnvelope | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawMessage) as unknown
  } catch {
    return null
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return { kind: "unknown", rawType: undefined }
  }

  if (parsed.type === "ticker") {
    const tick = normalizeTickerMessage(parsed, receivedAtMs)
    if (!tick) {
      return { kind: "unknown", rawType: parsed.type }
    }

    return {
      kind: "tick",
      rawType: parsed.type,
      tick,
    }
  }

  if (parsed.type === "heartbeat") {
    const heartbeat = normalizeHeartbeatMessage(parsed, receivedAtMs)
    if (!heartbeat) {
      return { kind: "unknown", rawType: parsed.type }
    }

    return {
      kind: "heartbeat",
      rawType: parsed.type,
      heartbeat,
    }
  }

  if (parsed.type === "subscriptions") {
    return { kind: "subscriptions", rawType: parsed.type }
  }

  if (parsed.type === "error") {
    return {
      kind: "error",
      rawType: parsed.type,
      error: typeof parsed.message === "string" ? parsed.message : "Coinbase websocket error",
    }
  }

  return { kind: "unknown", rawType: parsed.type }
}

function normalizeTickerMessage(
  raw: Record<string, unknown>,
  receivedAtMs: number,
): RealtimeBtcTick | null {
  const productId = readString(raw.product_id)
  const price = readNumber(raw.price)
  const bid = readOptionalNumber(raw.best_bid)
  const ask = readOptionalNumber(raw.best_ask)
  const volume24h = readOptionalNumber(raw.volume_24h)
  const lastSize = readOptionalNumber(raw.last_size)
  const tradeId = readOptionalNumber(raw.trade_id)
  const exchangeTimeMs = readTimestampMs(raw.time)
  const sequence = readNumber(raw.sequence)

  if (
    !productId ||
    !Number.isFinite(price) ||
    !Number.isFinite(sequence) ||
    !Number.isFinite(exchangeTimeMs)
  ) {
    return null
  }

  const spread =
    bid !== null && ask !== null ? ask - bid : null
  const spreadBps =
    spread !== null && price > 0 ? (spread / price) * 10000 : null

  return {
    productId,
    sequence,
    price,
    bid,
    ask,
    spread,
    spreadBps,
    volume24h,
    lastSize: Number.isFinite(lastSize) ? lastSize : null,
    tradeId: Number.isFinite(tradeId) ? tradeId : null,
    side: raw.side === "buy" || raw.side === "sell" ? raw.side : null,
    exchangeTimeMs,
    receivedAtMs,
  }
}

function normalizeHeartbeatMessage(
  raw: Record<string, unknown>,
  receivedAtMs: number,
): RealtimeBtcHeartbeat | null {
  const productId = readString(raw.product_id)
  const lastTradeId = readNumber(raw.last_trade_id)
  const exchangeTimeMs = readTimestampMs(raw.time)
  const sequence = readNumber(raw.sequence)

  if (
    !productId ||
    !Number.isFinite(lastTradeId) ||
    !Number.isFinite(sequence) ||
    !Number.isFinite(exchangeTimeMs)
  ) {
    return null
  }

  return {
    productId,
    sequence,
    lastTradeId,
    exchangeTimeMs,
    receivedAtMs,
  }
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

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : Number.NaN
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
