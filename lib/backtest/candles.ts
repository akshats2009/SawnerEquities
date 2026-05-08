import type { HistoricalBtcReplayDataset } from "@/lib/btc/client"
import type { BacktestBtcDataset, BacktestDatasetSummary } from "@/lib/backtest/types"
import { BTCCandle, CandleInterval } from "@/types"

const INTERVAL_MINUTES: Record<CandleInterval, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
}

export function getIntervalMinutes(interval: CandleInterval) {
  return INTERVAL_MINUTES[interval]
}

export function normalizeCandleSeries(
  candles: BTCCandle[],
  interval: CandleInterval,
): BTCCandle[] {
  const deduped = new Map<string, BTCCandle>()

  candles.forEach((candle, index) => {
    if (!Number.isFinite(new Date(candle.timestamp).getTime())) {
      throw new TypeError(`candle[${index}] has an invalid timestamp.`)
    }

    const values = [
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
    ]
    if (!values.every((value) => Number.isFinite(value))) {
      throw new TypeError(`candle[${index}] contains non-finite OHLCV values.`)
    }

    deduped.set(candle.timestamp, {
      ...candle,
      interval,
    })
  })

  return Array.from(deduped.values()).sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  )
}

export function resampleCandles(
  candles: BTCCandle[],
  sourceInterval: CandleInterval,
  targetInterval: CandleInterval,
): BTCCandle[] {
  if (sourceInterval === targetInterval) {
    return normalizeCandleSeries(candles, targetInterval)
  }

  const sourceMinutes = getIntervalMinutes(sourceInterval)
  const targetMinutes = getIntervalMinutes(targetInterval)

  if (targetMinutes < sourceMinutes || targetMinutes % sourceMinutes !== 0) {
    throw new RangeError(
      `Cannot resample ${sourceInterval} candles into ${targetInterval}.`,
    )
  }

  const normalized = normalizeCandleSeries(candles, sourceInterval)
  const targetMs = targetMinutes * 60 * 1000
  const buckets = new Map<number, BTCCandle[]>()

  normalized.forEach((candle) => {
    const timestampMs = new Date(candle.timestamp).getTime()
    const bucketStartMs = Math.floor(timestampMs / targetMs) * targetMs
    const bucket = buckets.get(bucketStartMs) ?? []
    bucket.push(candle)
    buckets.set(bucketStartMs, bucket)
  })

  return Array.from(buckets.entries())
    .sort(([left], [right]) => left - right)
    .map(([bucketStartMs, bucket]) => ({
      interval: targetInterval,
      timestamp: new Date(bucketStartMs).toISOString(),
      open: bucket[0].open,
      high: Math.max(...bucket.map((candle) => candle.high)),
      low: Math.min(...bucket.map((candle) => candle.low)),
      close: bucket.at(-1)?.close ?? bucket[0].close,
      volume: bucket.reduce((sum, candle) => sum + candle.volume, 0),
    }))
}

export function buildHistoricalDatasetFromCandles(options: {
  source: string
  productId?: string
  candles: Partial<Record<CandleInterval, BTCCandle[]>>
}): HistoricalBtcReplayDataset {
  const providedIntervals = (Object.keys(options.candles) as CandleInterval[]).filter(
    (interval) => (options.candles[interval]?.length ?? 0) > 0,
  )

  if (providedIntervals.length === 0) {
    throw new Error("At least one candle series is required to build a dataset.")
  }

  const sortedIntervals = [...providedIntervals].sort(
    (left, right) => getIntervalMinutes(left) - getIntervalMinutes(right),
  )
  const anchorInterval = sortedIntervals[0]
  const anchorSeries = normalizeCandleSeries(
    options.candles[anchorInterval] ?? [],
    anchorInterval,
  )

  const candles: Record<CandleInterval, BTCCandle[]> = {
    "1m":
      options.candles["1m"]?.length
        ? normalizeCandleSeries(options.candles["1m"] ?? [], "1m")
        : anchorInterval === "1m"
          ? anchorSeries
          : [],
    "5m":
      options.candles["5m"]?.length
        ? normalizeCandleSeries(options.candles["5m"] ?? [], "5m")
        : [],
    "15m":
      options.candles["15m"]?.length
        ? normalizeCandleSeries(options.candles["15m"] ?? [], "15m")
        : [],
    "1h":
      options.candles["1h"]?.length
        ? normalizeCandleSeries(options.candles["1h"] ?? [], "1h")
        : [],
  }

  if (candles["5m"].length === 0 && getIntervalMinutes(anchorInterval) <= 5) {
    candles["5m"] = resampleCandles(anchorSeries, anchorInterval, "5m")
  }
  if (candles["15m"].length === 0 && getIntervalMinutes(anchorInterval) <= 15) {
    candles["15m"] = resampleCandles(anchorSeries, anchorInterval, "15m")
  }
  if (candles["1h"].length === 0 && getIntervalMinutes(anchorInterval) <= 60) {
    candles["1h"] = resampleCandles(anchorSeries, anchorInterval, "1h")
  }

  return {
    source: options.source,
    productId: options.productId ?? "custom",
    startTime: anchorSeries.at(0)?.timestamp ?? null,
    endTime: anchorSeries.at(-1)?.timestamp ?? null,
    candles,
  }
}

export function summarizeDataset(
  dataset: BacktestBtcDataset,
  interval: CandleInterval,
): BacktestDatasetSummary {
  return {
    source: dataset.source,
    productId: dataset.productId,
    interval,
    startTime: dataset.startTime,
    endTime: dataset.endTime,
    candleCounts: {
      "1m": dataset.candles["1m"].length,
      "5m": dataset.candles["5m"].length,
      "15m": dataset.candles["15m"].length,
      "1h": dataset.candles["1h"].length,
    },
  }
}

export function findLatestCandleAtOrBefore(
  candles: BTCCandle[],
  timestamp: string,
) {
  const target = new Date(timestamp).getTime()
  let candidate: BTCCandle | null = null

  for (const candle of candles) {
    const candleTime = new Date(candle.timestamp).getTime()
    if (candleTime > target) {
      break
    }
    candidate = candle
  }

  return candidate
}

export function findFirstCandleAtOrAfter(
  candles: BTCCandle[],
  timestamp: string,
) {
  const target = new Date(timestamp).getTime()
  for (const candle of candles) {
    const candleTime = new Date(candle.timestamp).getTime()
    if (candleTime >= target) {
      return candle
    }
  }
  return null
}

export function sliceCandlesThrough(
  candles: BTCCandle[],
  timestamp: string,
  maxCandles?: number,
) {
  const target = new Date(timestamp).getTime()
  const slice = candles.filter(
    (candle) => new Date(candle.timestamp).getTime() <= target,
  )

  if (!maxCandles || slice.length <= maxCandles) {
    return slice
  }

  return slice.slice(-maxCandles)
}
