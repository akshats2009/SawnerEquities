import { KalshiEvent, KalshiMarket, MarketDataError } from "@/types"

const KALSHI_BASE_URL = "https://external-api.kalshi.com/trade-api/v2"
export const EXAMPLE_KALSHI_EVENT_TICKER = "KXBTCD-26MAY0809"

interface JsonObject {
  [key: string]: unknown
}

interface FetchJsonOptions {
  allowNotFound?: boolean
}

async function fetchKalshiJson(
  path: string,
  params: Record<string, string | number> | undefined,
  options: { allowNotFound: true },
): Promise<JsonObject | null>
async function fetchKalshiJson(
  path: string,
  params?: Record<string, string | number>,
  options?: FetchJsonOptions,
): Promise<JsonObject>
async function fetchKalshiJson(
  path: string,
  params?: Record<string, string | number>,
  options: FetchJsonOptions = {},
): Promise<JsonObject | null> {
  const url = new URL(`${KALSHI_BASE_URL}${path}`)
  Object.entries(params ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, String(value))
  })

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
  } catch (error) {
    throw new MarketDataError({
      message: "Failed to reach the Kalshi API.",
      source: "kalshi",
      context: { path, params },
      cause: error,
    })
  }

  if (options.allowNotFound && response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new MarketDataError({
      message: `Kalshi API returned HTTP ${response.status}.`,
      source: "kalshi",
      statusCode: response.status,
      context: { path, params, url: url.toString() },
    })
  }

  try {
    return (await response.json()) as JsonObject
  } catch (error) {
    throw new MarketDataError({
      message: "Kalshi API returned invalid JSON.",
      source: "kalshi",
      context: { path, params, url: url.toString() },
      cause: error,
    })
  }
}

async function tryGetMarket(ticker: string): Promise<JsonObject | null> {
  const payload = (await fetchKalshiJson(`/markets/${ticker}`, undefined, {
    allowNotFound: true,
  })) as { market?: JsonObject } | null
  if (!payload) {
    return null
  }
  return payload.market ?? null
}

async function tryGetEvent(ticker: string): Promise<JsonObject | null> {
  const payload = (await fetchKalshiJson(`/events/${ticker}`, undefined, {
    allowNotFound: true,
  })) as { event?: JsonObject } | null
  if (!payload) {
    return null
  }
  return payload.event ?? null
}

export async function resolveKalshiEventTicker(inputTicker: string) {
  const market = await tryGetMarket(inputTicker)
  if (market?.event_ticker && typeof market.event_ticker === "string") {
    return market.event_ticker
  }

  const event = await tryGetEvent(inputTicker)
  if (event?.event_ticker && typeof event.event_ticker === "string") {
    return event.event_ticker
  }

  throw new MarketDataError({
    message: `Unable to resolve "${inputTicker}" to a Kalshi event ticker.`,
    source: "kalshi",
    context: { inputTicker },
  })
}

export async function fetchKalshiEventByTicker(inputTicker: string): Promise<KalshiEvent> {
  const directEvent = await tryGetEvent(inputTicker)
  if (directEvent) {
    return normalizeKalshiEvent(directEvent)
  }

  const market = await tryGetMarket(inputTicker)
  const eventTicker =
    market && typeof market.event_ticker === "string" ? market.event_ticker : null
  if (!eventTicker) {
    throw new MarketDataError({
      message: `Unable to fetch a Kalshi event for "${inputTicker}".`,
      source: "kalshi",
      context: { inputTicker },
    })
  }

  const payload = (await fetchKalshiJson(`/events/${eventTicker}`)) as {
    event?: JsonObject
  }
  if (!payload.event || typeof payload.event !== "object") {
    throw new MarketDataError({
      message: "Kalshi event payload was missing the event object.",
      source: "kalshi",
      context: { eventTicker },
    })
  }

  return normalizeKalshiEvent(payload.event as JsonObject)
}

export async function fetchKalshiEventMarkets(inputTicker: string) {
  const event = await fetchKalshiEventByTicker(inputTicker)
  const markets = await fetchRelatedBtcMarkets(event.eventTicker)
  return {
    eventTicker: event.eventTicker,
    event,
    markets,
  }
}

export async function fetchRelatedBtcMarkets(inputTicker: string): Promise<KalshiMarket[]> {
  const eventTicker = await resolveKalshiEventTicker(inputTicker)
  const event = await fetchKalshiEventByTicker(eventTicker)
  const markets: KalshiMarket[] = []
  let cursor: string | null = null

  while (true) {
    const payload: JsonObject = await fetchKalshiJson("/markets", {
      event_ticker: eventTicker,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    })

    const pageMarkets = Array.isArray(payload.markets) ? payload.markets : []
    for (const raw of pageMarkets) {
      markets.push(normalizeKalshiMarket(raw as JsonObject))
    }

    cursor =
      typeof payload.cursor === "string" && payload.cursor.length > 0
        ? payload.cursor
        : null
    if (!cursor) {
      break
    }
  }

  const relatedMarkets = markets
    .filter((market) => isRelatedBtcAboveBelowMarket(market, event))
    .sort((left, right) => {
      const leftStrike = left.strikePrice ?? Number.POSITIVE_INFINITY
      const rightStrike = right.strikePrice ?? Number.POSITIVE_INFINITY
      return leftStrike - rightStrike
    })

  if (relatedMarkets.length === 0) {
    throw new MarketDataError({
      message: `Kalshi returned no BTC above/below strike markets for "${eventTicker}".`,
      source: "kalshi",
      context: { eventTicker, marketCount: markets.length },
    })
  }

  return relatedMarkets
}

export async function runKalshiClientExample(
  exampleTicker = EXAMPLE_KALSHI_EVENT_TICKER,
) {
  const event = await fetchKalshiEventByTicker(exampleTicker)
  const markets = await fetchRelatedBtcMarkets(exampleTicker)
  const preview = markets.slice(0, 3).map((market) => ({
    ticker: market.ticker,
    strikePrice: market.strikePrice,
    yesBid: market.yesBid,
    yesAsk: market.yesAsk,
    noBid: market.noBid,
    noAsk: market.noAsk,
    closeTime: market.closeTime,
    settlementTime: market.settlementTime,
  }))

  console.log("[Kalshi Data Example]", {
    eventTicker: event.eventTicker,
    title: event.title,
    marketCount: markets.length,
    preview,
  })

  return { event, markets, preview }
}

function normalizeKalshiEvent(raw: JsonObject): KalshiEvent {
  const eventTicker = requiredString(raw.event_ticker ?? raw.ticker, "event_ticker")
  return {
    eventTicker,
    title: requiredString(raw.title, "title"),
    subtitle: asString(raw.subtitle),
    status: asString(raw.status),
    closeTime: toIso(raw.close_time),
    settlementTime: toIso(
      raw.expiration_time ??
        raw.expected_expiration_time ??
        raw.close_time ??
        raw.settlement_ts,
    ),
  }
}

function normalizeKalshiMarket(raw: JsonObject): KalshiMarket {
  return {
    ticker: requiredString(raw.ticker, "ticker"),
    eventTicker: requiredString(raw.event_ticker, "event_ticker"),
    title: requiredString(raw.title, "title"),
    subtitle: asString(raw.subtitle),
    status: asString(raw.status),
    yesBid: asNumber(raw.yes_bid_dollars),
    yesAsk: asNumber(raw.yes_ask_dollars),
    noBid: asNumber(raw.no_bid_dollars),
    noAsk: asNumber(raw.no_ask_dollars),
    lastPrice: asNumber(raw.last_price_dollars),
    volume: asNumber(raw.volume_fp) ?? 0,
    openInterest: asNumber(raw.open_interest_fp) ?? 0,
    liquidity: asNumber(raw.liquidity_dollars) ?? 0,
    strikePrice: extractStrike(raw),
    closeTime: toIso(raw.close_time),
    settlementTime: toIso(
      raw.expiration_time ??
        raw.expected_expiration_time ??
        raw.close_time ??
        raw.settlement_ts,
    ),
  }
}

function isRelatedBtcAboveBelowMarket(market: KalshiMarket, event: KalshiEvent) {
  const titleBlob = `${event.title} ${event.subtitle} ${market.title} ${market.subtitle}`.toLowerCase()
  return (
    market.eventTicker === event.eventTicker &&
    market.strikePrice !== null &&
    (titleBlob.includes("btc") || titleBlob.includes("bitcoin"))
  )
}

function extractStrike(raw: JsonObject) {
  const directFields = [
    raw.functional_strike,
    raw.strike_price,
    raw.settlement_value_dollars,
  ]

  for (const field of directFields) {
    const numeric = asNumber(field)
    if (numeric !== null && numeric > 1) {
      return numeric
    }
  }

  const floor = asNumber(raw.floor_strike)
  const cap = asNumber(raw.cap_strike)
  if (floor !== null && cap !== null) {
    return (floor + cap) / 2
  }
  if (floor !== null) {
    return floor
  }
  if (cap !== null) {
    return cap
  }

  const ticker = asString(raw.ticker)
  const strikeMatch = ticker.match(/-T(\d+(?:\.\d+)?)/)
  return strikeMatch ? Number(strikeMatch[1]) : null
}

function requiredString(value: unknown, fieldName: string) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value
  }

  throw new MarketDataError({
    message: `Kalshi payload was missing required field "${fieldName}".`,
    source: "kalshi",
    context: { fieldName },
  })
}

function asString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function asNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toIso(value: unknown) {
  if (typeof value === "number") {
    return new Date(value * 1000).toISOString()
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }
  return null
}
