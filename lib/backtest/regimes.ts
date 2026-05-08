import { MacroEventWindow, TrendRegime } from "@/lib/backtest/types"
import { BTCCandle, VolatilityRegime } from "@/types"

export function classifyTrendRegime(
  candles: BTCCandle[],
  lookbackCandles: number,
  trendingThreshold: number,
): TrendRegime {
  if (candles.length < 2) {
    return "sideways"
  }

  const slice =
    candles.length <= lookbackCandles
      ? candles
      : candles.slice(-lookbackCandles)

  if (slice.length < 2) {
    return "sideways"
  }

  const direction = Math.abs(slice.at(-1)!.close - slice[0].close)
  const pathLength = slice
    .slice(1)
    .reduce(
      (sum, candle, index) =>
        sum + Math.abs(candle.close - slice[index].close),
      0,
    )

  if (pathLength === 0) {
    return "sideways"
  }

  const efficiencyRatio = direction / pathLength
  return efficiencyRatio >= trendingThreshold ? "trending" : "sideways"
}

export function resolveMacroEventLabel(
  timestamp: string,
  windows: MacroEventWindow[],
) {
  const target = new Date(timestamp).getTime()
  for (const window of windows) {
    const start = new Date(window.start).getTime()
    const end = new Date(window.end).getTime()
    if (target >= start && target <= end) {
      return window.label
    }
  }
  return null
}

export function mapVolatilityRegimeGroup(regime: VolatilityRegime) {
  return regime === "elevated" || regime === "extreme"
    ? "elevated-volatility"
    : "low-volatility"
}
