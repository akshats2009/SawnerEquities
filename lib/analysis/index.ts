/**
 * Quantitative analysis: probability, expected move, implieds, edges, volatility regime.
 * Trade execution and UI live elsewhere.
 */
export {
  buildVolatilityWarningFlags,
  calculateAnnualizedRealizedVolatility,
  calculateEdge,
  calculateExpectedMove,
  calculateImpliedProbability,
  calculateLargestAbsoluteMove,
  classifyVolatilityRegime,
  estimateProbabilityAboveStrike,
  summarizeVolatilityWarnings,
} from "@/lib/analysis/probability"

export { buildAnalysisSnapshot } from "@/lib/analysis/engine"
export { runPlaceholderBacktest } from "@/lib/analysis/backtest"
