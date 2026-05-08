import type { HistoricalBtcReplayDataset } from "@/lib/btc/client"
import {
  CandleInterval,
  SuggestedSide,
  VolatilityRegime,
} from "@/types"

export type BacktestMode = "historical" | "paper"
export type ContractDataSource = "historical-market" | "synthetic-market"
export type TrendRegime = "trending" | "sideways"
export type OpportunityDecision = "TRADE" | "SKIP"
export type QuoteConstruction = "provided-two-sided" | "derived-from-implied"
export type TradeResult = "win" | "loss"
export type BacktestEventType = "start" | "entry" | "settlement" | "end"

export type BacktestBtcDataset = HistoricalBtcReplayDataset

export interface MacroEventWindow {
  label: string
  start: string
  end: string
}

export interface KalshiStyleHistoricalContract {
  id: string
  ticker?: string
  listedTime: string
  expiryTime: string
  strikePrice: number
  spotPrice?: number | null
  marketImpliedProbability: number
  yesPrice?: number | null
  noPrice?: number | null
  bidAskSpread?: number | null
  liquidityScore?: number | null
  volume?: number | null
  openInterest?: number | null
  source: ContractDataSource
  tags?: string[]
  metadata?: Record<string, string | number | boolean | null>
}

export interface SyntheticContractRequest {
  interval: CandleInterval
  expiryMinutes: number
  strikeOffsetsPct: number[]
  entryEveryCandles: number
  marketVolMultiplier: number
  marketProbabilityBias: number
  spreadWidth: number
  liquidityScore: number
}

export interface BacktestStrategyRules {
  sidePreference: "best-edge" | "yes-only" | "no-only"
  minEdge: number
  minConfidenceScore: number
  cooldownMinutes: number
  maxConcurrentPositions: number
  requirePositiveEdge: boolean
  perTradeCost: number
}

export interface BacktestVolatilityFilters {
  allowedRegimes: VolatilityRegime[]
  minMinutesToExpiry: number
  trendLookbackCandles: number
  trendingThreshold: number
  maxAbsoluteMove1m: number | null
}

export interface BacktestRiskConfig {
  initialBankroll: number
  maxRiskPct: number
  maxOpenRiskPct: number
  maxSpread: number
  minLiquidityScore: number
  markOpenPositionsToCost: boolean
}

export interface BacktestResearchConfig {
  parameterSweepCount: number
  useSyntheticQuotes: boolean
  assumptions: string[]
}

export interface BacktestConfig {
  interval: CandleInterval
  mode: BacktestMode
  strategy: BacktestStrategyRules
  volatility: BacktestVolatilityFilters
  risk: BacktestRiskConfig
  research: BacktestResearchConfig
  macroEvents: MacroEventWindow[]
}

export interface BacktestConfigOverrides {
  interval?: CandleInterval
  mode?: BacktestMode
  strategy?: Partial<BacktestStrategyRules>
  volatility?: Partial<BacktestVolatilityFilters>
  risk?: Partial<BacktestRiskConfig>
  research?: Partial<BacktestResearchConfig>
  macroEvents?: MacroEventWindow[]
}

export interface BacktestDatasetSummary {
  source: string
  productId: string
  interval: CandleInterval
  startTime: string | null
  endTime: string | null
  candleCounts: Record<CandleInterval, number>
}

export interface BacktestOpportunityEvaluation {
  contractId: string
  ticker: string | null
  entryTime: string
  expiryTime: string
  minutesToExpiry: number
  spotPrice: number
  strikePrice: number
  settlementPrice: number | null
  outcomeAboveStrike: boolean | null
  modelProbabilityAbove: number | null
  modelProbabilityBelow: number | null
  marketProbabilityYes: number
  yesPrice: number
  noPrice: number
  edgeYes: number | null
  edgeNo: number | null
  selectedSide: SuggestedSide
  selectedEdge: number | null
  confidenceScore: number
  decision: OpportunityDecision
  quantity: number
  costBasis: number
  skipReasons: string[]
  volatilityRegime: VolatilityRegime
  trendRegime: TrendRegime
  macroEventLabel: string | null
  quoteConstruction: QuoteConstruction
  dataSource: ContractDataSource
}

export interface BacktestTradeLogEntry {
  contractId: string
  ticker: string | null
  entryTime: string
  expiryTime: string
  settledTime: string
  side: SuggestedSide
  quantity: number
  entryPrice: number
  marketProbabilityYes: number
  modelProbability: number
  edge: number
  confidenceScore: number
  payout: number
  fees: number
  costBasis: number
  pnl: number
  returnOnRisk: number
  bankrollBefore: number
  bankrollAfter: number
  settlementPrice: number
  outcomeAboveStrike: boolean
  result: TradeResult
  volatilityRegime: VolatilityRegime
  trendRegime: TrendRegime
  macroEventLabel: string | null
  dataSource: ContractDataSource
}

export interface EquityCurvePoint {
  timestamp: string
  eventType: BacktestEventType
  cash: number
  equity: number
  openRisk: number
  openPositions: number
  realizedPnL: number
}

export interface DrawdownPoint {
  timestamp: string
  drawdown: number
  drawdownPct: number
}

export interface CalibrationBin {
  label: string
  bucketStart: number
  bucketEnd: number
  predictedProbability: number | null
  actualFrequency: number | null
  count: number
}

export interface CalibrationReport {
  sampleCount: number
  brierScore: number | null
  logLoss: number | null
  meanPredictedProbability: number | null
  meanOutcome: number | null
  bins: CalibrationBin[]
}

export interface EdgeQualityReport {
  tradedCount: number
  averageModelEdge: number | null
  averageRealizedEdge: number | null
  edgeCaptureRatio: number | null
  positiveEdgeOpportunityRate: number | null
  falsePositiveRate: number | null
}

export interface RegimePerformanceSummary {
  regime: string
  tradeCount: number
  winRate: number | null
  expectedValue: number | null
  averageEdge: number | null
  netPnl: number
  sharpeLike: number | null
}

export interface BacktestPerformanceSummary {
  opportunityCount: number
  tradeCount: number
  skippedTradeCount: number
  settledTradeCount: number
  unresolvedTradeCount: number
  winRate: number | null
  averageEdge: number | null
  expectedValue: number | null
  netPnl: number
  maxDrawdown: number | null
  maxDrawdownPct: number | null
  sharpeLike: number | null
  tradeFrequencyPerDay: number | null
  avgHoldMinutes: number | null
  bankrollStart: number
  bankrollEnd: number
  bankrollReturnPct: number | null
}

export interface OverfittingWarning {
  level: "info" | "warn" | "critical"
  code: string
  message: string
}

export interface PaperReplayFrame {
  timestamp: string
  cash: number
  equity: number
  openRisk: number
  openPositions: number
  settledTrades: number
  skippedTrades: number
  lastEvent: string
}

export interface BacktestReport {
  generatedAt: string
  dataset: BacktestDatasetSummary
  config: BacktestConfig
  summary: BacktestPerformanceSummary
  calibration: CalibrationReport
  edgeQuality: EdgeQualityReport
  regimeAnalysis: RegimePerformanceSummary[]
  warnings: OverfittingWarning[]
  assumptions: string[]
  opportunityLog: BacktestOpportunityEvaluation[]
  tradeLog: BacktestTradeLogEntry[]
  equityCurve: EquityCurvePoint[]
  drawdownCurve: DrawdownPoint[]
  paperReplay: PaperReplayFrame[]
  note: string
}

export interface RunBacktestInput {
  dataset: BacktestBtcDataset
  contracts: KalshiStyleHistoricalContract[]
  config?: BacktestConfigOverrides
}
