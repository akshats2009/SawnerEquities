import {
  BTCCandle,
  BTCSpotPrice,
  BtcSnapshot,
  CandleInterval,
  MarketDataError,
} from "@/types"

const COINBASE_BASE_URL = "https://api.exchange.coinbase.com"
const BTC_PRODUCT_ID = "BTC-USD"
const MAX_CANDLES_PER_REQUEST = 300

const CANDLE_CONFIG: Record<
  CandleInterval,
  { granularitySeconds: number; lookbackMinutes: number }
> = {
  "1m": { granularitySeconds: 60, lookbackMinutes: 90 },
  "5m": { granularitySeconds: 300, lookbackMinutes: 300 },
  "15m": { granularitySeconds: 900, lookbackMinutes: 720 },
  "1h": { granularitySeconds: 3600, lookbackMinutes: 72 * 60 },
}

export interface HistoricalBtcRangeRequest {
  interval: CandleInterval
  start: string | Date
  end: string | Date
  productId?: string
}

export interface HistoricalBtcReplayDataset {
  source: string
  productId: string
  startTime: string | null
  endTime: string | null
  candles: Record<CandleInterval, BTCCandle[]>
}

async function fetchCoinbaseJson<T>(
  path: string,
  params?: Record<string, string>,
) {
  const url = new URL(`${COINBASE_BASE_URL}${path}`)
  Object.entries(params ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "sawner-equities/1.0",
      },
      cache: "no-store",
    })
  } catch (error) {
    throw new MarketDataError({
      message: "Failed to reach the Coinbase market data API.",
      source: "coinbase",
      context: { path, params },
      cause: error,
    })
  }

  if (!response.ok) {
    throw new MarketDataError({
      message: `Coinbase API returned HTTP ${response.status}.`,
      source: "coinbase",
      statusCode: response.status,
      context: { path, params, url: url.toString() },
    })
  }

  try {
    return (await response.json()) as T
  } catch (error) {
    throw new MarketDataError({
      message: "Coinbase API returned invalid JSON.",
      source: "coinbase",
      context: { path, params, url: url.toString() },
      cause: error,
    })
  }
}

export async function fetchBtcSnapshot(
  productId = BTC_PRODUCT_ID,
): Promise<BtcSnapshot> {
  const [spot, candles1m, candles5m, candles15m, candles1h] =
    await Promise.all([
      fetchBtcSpotPrice(productId),
      fetchBtcCandles("1m", productId),
      fetchBtcCandles("5m", productId),
      fetchBtcCandles("15m", productId),
      fetchBtcCandles("1h", productId),
    ])

  return {
    source: spot.source,
    spot,
    spotPrice: spot.price,
    candles: {
      "1m": candles1m,
      "5m": candles5m,
      "15m": candles15m,
      "1h": candles1h,
    },
  }
}

export async function fetchBtcSpotPrice(
  productId = BTC_PRODUCT_ID,
): Promise<BTCSpotPrice> {
  const payload = await fetchCoinbaseJson<{ price?: string }>(
    `/products/${productId}/ticker`,
  )
  if (!payload.price) {
    throw new MarketDataError({
      message: "Coinbase spot response was missing the BTC/USD price.",
      source: "coinbase",
      context: { productId },
    })
  }

  const price = Number(payload.price)
  if (!Number.isFinite(price)) {
    throw new MarketDataError({
      message: "Coinbase spot response included a non-numeric BTC/USD price.",
      source: "coinbase",
      context: { productId, rawPrice: payload.price },
    })
  }

  return {
    productId,
    symbol: productId,
    price,
    asOf: new Date().toISOString(),
    source: "Coinbase Exchange",
  }
}

export async function fetchBtcCandles(
  interval: CandleInterval,
  productId = BTC_PRODUCT_ID,
): Promise<BTCCandle[]> {
  const config = CANDLE_CONFIG[interval]
  const end = new Date()
  const start = new Date(end.getTime() - config.lookbackMinutes * 60 * 1000)

  return fetchHistoricalBtcCandles({
    interval,
    productId,
    start,
    end,
  })
}

export async function fetchHistoricalBtcCandles({
  interval,
  start,
  end,
  productId = BTC_PRODUCT_ID,
}: HistoricalBtcRangeRequest): Promise<BTCCandle[]> {
  const normalizedStart = normalizeDate(start, "start")
  const normalizedEnd = normalizeDate(end, "end")

  if (normalizedEnd.getTime() <= normalizedStart.getTime()) {
    throw new MarketDataError({
      message: "Historical BTC requests require end to be after start.",
      source: "coinbase",
      context: {
        interval,
        productId,
        start: normalizedStart.toISOString(),
        end: normalizedEnd.toISOString(),
      },
    })
  }

  const config = CANDLE_CONFIG[interval]
  const stepMs =
    config.granularitySeconds * 1000 * (MAX_CANDLES_PER_REQUEST - 1)
  const nextChunkOffsetMs = config.granularitySeconds * 1000
  const candlesByTimestamp = new Map<string, BTCCandle>()

  for (
    let cursorMs = normalizedStart.getTime();
    cursorMs < normalizedEnd.getTime();
    cursorMs += stepMs + nextChunkOffsetMs
  ) {
    const chunkStart = new Date(cursorMs)
    const chunkEnd = new Date(
      Math.min(cursorMs + stepMs, normalizedEnd.getTime()),
    )

    const payload = await fetchCoinbaseJson<number[][]>(
      `/products/${productId}/candles`,
      {
        start: chunkStart.toISOString(),
        end: chunkEnd.toISOString(),
        granularity: String(config.granularitySeconds),
      },
    )

    if (!Array.isArray(payload)) {
      throw new MarketDataError({
        message: `Coinbase returned malformed ${interval} candle data.`,
        source: "coinbase",
        context: {
          interval,
          productId,
          start: chunkStart.toISOString(),
          end: chunkEnd.toISOString(),
        },
      })
    }

    for (const row of payload) {
      const candle = normalizeCoinbaseCandle(row, interval)
      candlesByTimestamp.set(candle.timestamp, candle)
    }
  }

  const candles = Array.from(candlesByTimestamp.values()).sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  )

  if (candles.length === 0) {
    throw new MarketDataError({
      message: `Coinbase returned no ${interval} BTC candles for the requested range.`,
      source: "coinbase",
      context: {
        productId,
        interval,
        start: normalizedStart.toISOString(),
        end: normalizedEnd.toISOString(),
      },
    })
  }

  return candles.filter(
    (candle) =>
      candle.timestamp >= normalizedStart.toISOString() &&
      candle.timestamp <= normalizedEnd.toISOString(),
  )
}

export async function fetchHistoricalBtcDataset(options: {
  start: string | Date
  end: string | Date
  intervals?: CandleInterval[]
  productId?: string
}): Promise<HistoricalBtcReplayDataset> {
  const intervals = ensureAllIntervals(options.intervals)
  const productId = options.productId ?? BTC_PRODUCT_ID

  const intervalResults = await Promise.all(
    intervals.map((interval) =>
      fetchHistoricalBtcCandles({
        interval,
        productId,
        start: options.start,
        end: options.end,
      }),
    ),
  )

  const candles = createEmptyCandleRecord()
  intervals.forEach((interval, index) => {
    candles[interval] = intervalResults[index]
  })

  const sortedIntervals = [...intervals].sort(
    (left, right) =>
      CANDLE_CONFIG[left].granularitySeconds -
      CANDLE_CONFIG[right].granularitySeconds,
  )
  const anchorSeries = candles[sortedIntervals[0]]

  return {
    source: "Coinbase Exchange",
    productId,
    startTime: anchorSeries.at(0)?.timestamp ?? null,
    endTime: anchorSeries.at(-1)?.timestamp ?? null,
    candles,
  }
}

export async function runBtcClientExample(productId = BTC_PRODUCT_ID) {
  const [spot, candles1m, candles5m, candles15m, candles1h] =
    await Promise.all([
      fetchBtcSpotPrice(productId),
      fetchBtcCandles("1m", productId),
      fetchBtcCandles("5m", productId),
      fetchBtcCandles("15m", productId),
      fetchBtcCandles("1h", productId),
    ])

  const preview = {
    spot,
    latest1m: candles1m.at(-1) ?? null,
    latest5m: candles5m.at(-1) ?? null,
    latest15m: candles15m.at(-1) ?? null,
    latest1h: candles1h.at(-1) ?? null,
  }

  console.log("[BTC Data Example]", preview)
  return preview
}

function createEmptyCandleRecord(): Record<CandleInterval, BTCCandle[]> {
  return {
    "1m": [],
    "5m": [],
    "15m": [],
    "1h": [],
  }
}

function ensureAllIntervals(intervals?: CandleInterval[]) {
  if (!intervals || intervals.length === 0) {
    return ["1m", "5m", "15m", "1h"] as CandleInterval[]
  }

  return Array.from(new Set(intervals))
}

function normalizeDate(value: string | Date, label: string) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new MarketDataError({
      message: `Historical BTC ${label} time is invalid.`,
      source: "coinbase",
      context: { value },
    })
  }
  return date
}

function normalizeCoinbaseCandle(
  row: number[],
  interval: CandleInterval,
): BTCCandle {
  if (row.length < 6) {
    throw new MarketDataError({
      message: "Coinbase candle payload row was incomplete.",
      source: "coinbase",
      context: { interval, row },
    })
  }

  const [timestamp, low, high, open, close, volume] = row
  const values = { timestamp, low, high, open, close, volume }
  const allNumeric = Object.values(values).every((value) => Number.isFinite(value))
  if (!allNumeric) {
    throw new MarketDataError({
      message: "Coinbase candle payload row contained non-numeric data.",
      source: "coinbase",
      context: { interval, row },
    })
  }

  return {
    interval,
    timestamp: new Date(timestamp * 1000).toISOString(),
    low,
    high,
    open,
    close,
    volume,
  }
}
