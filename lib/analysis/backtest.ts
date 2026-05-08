import {
  buildHistoricalDatasetFromCandles,
  buildSyntheticKalshiStyleContracts,
  buildBacktestReportPreview,
  runBacktest,
} from "@/lib/backtest"
import { Candle, MarketAnalysis, BacktestPreview } from "@/types"

const DEFAULT_STRIKE_OFFSETS = [-0.01, -0.005, 0, 0.005, 0.01]

export function runPlaceholderBacktest(
  candles: Candle[],
  analyses: MarketAnalysis[],
): BacktestPreview {
  const normalizedCandles = candles
    .map((candle) => ({ ...candle, interval: "15m" as const }))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))

  if (normalizedCandles.length < 12) {
    return {
      scenarioCount: 0,
      sampleCount: 0,
      winRate: null,
      expectedValue: null,
      maxDrawdown: null,
      sharpeLike: null,
      tradeFrequencyPerDay: null,
      skippedTradeCount: 0,
      calibrationBrierScore: null,
      note: "Historical preview needs more BTC candles before the replay engine can produce a statistically useful sample.",
    }
  }

  const dataset = buildHistoricalDatasetFromCandles({
    source: "Live snapshot preview",
    productId: "BTC-USD-PREVIEW",
    candles: {
      "15m": normalizedCandles,
    },
  })

  const strikeOffsetsPct = deriveStrikeOffsets(normalizedCandles, analyses)
  const contracts = buildSyntheticKalshiStyleContracts(dataset, {
    interval: "15m",
    expiryMinutes: 60,
    strikeOffsetsPct,
    entryEveryCandles: 1,
    marketVolMultiplier: 1.05,
    marketProbabilityBias: 0.015,
    spreadWidth: 0.04,
    liquidityScore: 0.52,
  })

  const report = runBacktest({
    dataset,
    contracts,
    config: {
      interval: "15m",
      research: {
        useSyntheticQuotes: true,
        assumptions: [
          "Preview prices are simulated from live strike spacing rather than replayed from historical Kalshi quotes.",
        ],
      },
    },
  })

  return buildBacktestReportPreview({
    ...report,
    note:
      "Preview replay uses recent 15m BTC candles and synthetic Kalshi-style prices anchored to the current strike grid. Use /backtest or /api/backtest for full research runs.",
  })
}

function deriveStrikeOffsets(
  candles: Candle[],
  analyses: MarketAnalysis[],
) {
  const latestSpot = candles.at(-1)?.close ?? null
  if (!latestSpot || latestSpot <= 0) {
    return DEFAULT_STRIKE_OFFSETS
  }

  const offsets = analyses
    .map((analysis) => analysis.market.strikePrice)
    .filter((strike): strike is number => strike !== null && strike > 0)
    .map((strike) => (strike - latestSpot) / latestSpot)
    .filter((offset) => Number.isFinite(offset) && Math.abs(offset) <= 0.03)

  if (offsets.length === 0) {
    return DEFAULT_STRIKE_OFFSETS
  }

  return Array.from(new Set(offsets.map((offset) => roundTo(offset, 4))))
    .sort((left, right) => left - right)
    .slice(0, 7)
}

function roundTo(value: number, decimals: number) {
  const scale = 10 ** decimals
  return Math.round(value * scale) / scale
}
