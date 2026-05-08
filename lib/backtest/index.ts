export { buildHistoricalDatasetFromCandles, resampleCandles } from "@/lib/backtest/candles"
export {
  buildSyntheticKalshiStyleContracts,
  normalizeHistoricalContract,
} from "@/lib/backtest/contracts"
export {
  buildBacktestReportPreview,
  runBacktest,
  runPaperTradingReplay,
} from "@/lib/backtest/engine"
export { buildDemoBacktestReport } from "@/lib/backtest/demo"
export type {
  BacktestConfig,
  BacktestConfigOverrides,
  BacktestReport,
  KalshiStyleHistoricalContract,
  RunBacktestInput,
  SyntheticContractRequest,
} from "@/lib/backtest/types"
