export type CandleInterval = "1m" | "5m" | "15m" | "1h"
export type MarketDataSource = "kalshi" | "coinbase"
export type VolatilityRegime = "low" | "normal" | "elevated" | "extreme"
export type ProbabilityModelType = "normal" | "lognormal"
export type ConfidenceLabel = "low" | "moderate" | "high" | "very high"
export type SuggestedSide = "YES" | "NO"
export type Recommendation = "BUY YES" | "BUY NO" | "NO TRADE"
export type JournalResult = "open" | "win" | "loss" | "scratch"
export type MistakeTag =
  | "none"
  | "FOMO"
  | "chase"
  | "bad sizing"
  | "no edge"
  | "ignored model"

export class MarketDataError extends Error {
  readonly source: MarketDataSource
  readonly statusCode?: number
  readonly context?: Record<string, unknown>
  readonly cause?: unknown

  constructor(options: {
    message: string
    source: MarketDataSource
    statusCode?: number
    context?: Record<string, unknown>
    cause?: unknown
  }) {
    super(options.message)
    this.name = "MarketDataError"
    this.source = options.source
    this.statusCode = options.statusCode
    this.context = options.context
    this.cause = options.cause
  }
}

export interface BTCCandle {
  interval: CandleInterval
  timestamp: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type Candle = BTCCandle

export interface BTCSpotPrice {
  productId: string
  symbol: string
  price: number
  asOf: string
  source: string
}

export interface BtcSnapshot {
  source: string
  spot: BTCSpotPrice
  spotPrice: number
  candles: Record<CandleInterval, BTCCandle[]>
}

export interface KalshiEvent {
  eventTicker: string
  title: string
  subtitle: string
  status: string
  closeTime: string | null
  settlementTime: string | null
}

export interface KalshiMarket {
  ticker: string
  eventTicker: string
  title: string
  subtitle: string
  status: string
  yesBid: number | null
  yesAsk: number | null
  noBid: number | null
  noAsk: number | null
  lastPrice: number | null
  volume: number
  openInterest: number
  liquidity: number
  strikePrice: number | null
  closeTime: string | null
  settlementTime: string | null
}

export interface VolatilitySnapshot {
  rv15: number | null
  rv30: number | null
  rv60: number | null
  regime: VolatilityRegime
  regimeLabel: string
  warningFlags: VolatilityWarningFlags
  warnings: string[]
  elevatedRealizedVolatilityWarning: boolean
  largeRecentMoveWarning: boolean
  fatTailWarning: boolean
  largestAbsMove1m: number | null
  modelVol: number
}

export interface ExpectedMoveEstimate {
  expectedMoveDollars: number
  expectedMovePercent: number
}

export interface ProbabilityEstimate {
  probabilityAbove: number
  probabilityBelow: number
  zScore: number
  expectedMove: ExpectedMoveEstimate
  confidenceLabel: ConfidenceLabel
}

export interface EdgeCalculation {
  rawEdge: number
  percentageEdge: number
}

export interface VolatilityWarningFlags {
  elevatedRealizedVolatility: boolean
  unusuallyLargeRecentMove: boolean
  fatTailCondition: boolean
}

export interface PositionSizing {
  maxRiskPct: number
  maxRiskDollars: number
  entryPrice: number | null
  maxContracts: number
  estimatedCost: number
  safeToTrade: boolean
}

export interface RuleChecks {
  positiveEdge: boolean
  spreadOk: boolean
  liquidityOk: boolean
  volatilityOk: boolean
  bankrollOk: boolean
  confidenceOk: boolean
  timeOk: boolean
}

export interface MarketAnalysis {
  market: KalshiMarket
  distanceToStrikeDollars: number | null
  distanceToStrikePct: number | null
  minutesToSettlement: number | null
  fairProbabilityAbove: number | null
  fairProbabilityBelow: number | null
  impliedProbabilityYesBid: number | null
  impliedProbabilityYesAsk: number | null
  impliedProbabilityNoBid: number | null
  impliedProbabilityNoAsk: number | null
  marketImpliedMid: number | null
  bidAskSpread: number | null
  rawEdge: number | null
  spreadAdjustedEdge: number | null
  liquidityAdjustedEdge: number | null
  riskAdjustedScore: number
  confidenceScore: number
  suggestedSide: SuggestedSide
  actionPrice: number | null
  recommendation: Recommendation
  warnings: string[]
  ruleChecks: RuleChecks
  sizing: PositionSizing
}

export interface BacktestPreview {
  scenarioCount: number
  sampleCount: number
  winRate: number | null
  expectedValue: number | null
  maxDrawdown: number | null
  sharpeLike: number | null
  tradeFrequencyPerDay: number | null
  skippedTradeCount: number
  calibrationBrierScore: number | null
  note: string
}

export interface AnalysisSnapshot {
  requestedTicker: string
  resolvedEventTicker: string
  asOf: string
  bankroll: number
  maxRiskPct: number
  btc: {
    source: string
    spotPrice: number
    candleCounts: Record<CandleInterval, number>
  }
  volatility: VolatilitySnapshot
  markets: MarketAnalysis[]
  topOpportunities: MarketAnalysis[]
  defaultStance: string
  warnings: string[]
  exampleAnalysis: ExampleAnalysisOutput | null
  backtestPreview: BacktestPreview
  disclaimers: string[]
}

export interface ExampleAnalysisOutput {
  marketTicker: string
  spotPrice: number
  strikePrice: number
  impliedProbability: number
  modelProbability: number
  estimatedEdge: number
}

export interface JournalEntry {
  id: string
  createdAt: string
  marketTicker: string
  strike: number | null
  side: Recommendation
  entryPrice: number | null
  modelProbability: number | null
  thesis: string
  result: JournalResult
  mistakeTag: MistakeTag
}

export interface JournalBehaviorSummary {
  warnings: string[]
  recentLossStreak: number
  recentDisciplineHits: number
}
