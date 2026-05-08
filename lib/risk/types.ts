import { SuggestedSide, VolatilityRegime } from "@/types"

export type TradeRecommendation = "BUY_YES" | "BUY_NO" | "NO_TRADE"
export type RiskVolatilityRegime = VolatilityRegime | "calm" | "active"

export interface TradeOpportunityInput {
  modelProbability: number
  impliedProbability: number
  rawEdge: number
  percentageEdge: number
  bidAskSpread: number
  liquidity: number
  realizedVolatility: number
  volatilityRegime: RiskVolatilityRegime
  bankroll: number
  proposedPositionSize: number
  distanceFromStrikePct?: number | null
  timeRemainingMinutes?: number | null
  maxRiskPct?: number | null
  preferredSide?: SuggestedSide
  precomputedConfidenceScore?: number | null
}

export interface BankrollSizingDecision {
  bankroll: number
  proposedPositionSize: number
  defaultMaxRiskPct: number
  configuredMaxRiskPct: number
  recommendedMaxRiskPct: number
  hardCapRiskPct: number
  defaultMaxRiskDollars: number
  configuredMaxRiskDollars: number
  recommendedMaxRiskDollars: number
  hardCapRiskDollars: number
  cappedPositionSize: number
  remainingRiskBudgetDollars: number
  withinRecommendedRisk: boolean
  withinConfiguredRisk: boolean
  withinHardCap: boolean
  isOversized: boolean
  isAllIn: boolean
}

export interface TradeDecisionChecks {
  edgeOk: boolean
  spreadOk: boolean
  liquidityOk: boolean
  volatilityOk: boolean
  confidenceOk: boolean
  positionSizeOk: boolean
  riskRewardOk: boolean
  timeOk: boolean
}

export interface TradeEvaluation {
  recommendation: TradeRecommendation
  confidenceScore: number
  warnings: string[]
  reasons: string[]
  checks: TradeDecisionChecks
  sizing: BankrollSizingDecision
}
