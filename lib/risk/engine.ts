import { clamp } from "@/lib/utils"
import {
  PositionSizing,
  Recommendation,
  RuleChecks,
  SuggestedSide,
  VolatilityRegime,
  VolatilitySnapshot,
} from "@/types"
import {
  DEFAULT_MAX_RISK_PCT,
  EPSILON,
  EXTREME_REALIZED_VOLATILITY,
  HARD_MAX_RISK_PCT,
  HIGH_CONFIDENCE_OVERSIZE_THRESHOLD,
  MAX_ACCEPTABLE_SPREAD,
  MIN_CONFIDENCE_SCORE,
  MIN_EDGE_QUALITY_FOR_OVERSIZE,
  MIN_EDGE_TO_SPREAD_RATIO,
  MIN_LIQUIDITY_QUALITY,
  MIN_PERCENTAGE_EDGE,
  MIN_RAW_EDGE,
  MIN_TIME_REMAINING_MINUTES,
} from "@/lib/risk/constants"
import {
  BankrollSizingDecision,
  RiskVolatilityRegime,
  TradeEvaluation,
  TradeOpportunityInput,
  TradeRecommendation,
} from "@/lib/risk/types"

interface FirewallInput {
  bankroll: number
  maxRiskPct: number
  suggestedSide: SuggestedSide
  actionPrice: number | null
  rawEdge: number | null
  bidAskSpread: number | null
  liquidityScore: number
  confidenceScore: number
  minutesToSettlement: number | null
  volatility: VolatilitySnapshot
}

type NormalizedTradeOpportunity = Omit<
  TradeOpportunityInput,
  | "distanceFromStrikePct"
  | "timeRemainingMinutes"
  | "maxRiskPct"
  | "precomputedConfidenceScore"
  | "volatilityRegime"
> & {
  distanceFromStrikePct: number | null
  timeRemainingMinutes: number | null
  maxRiskPct: number | null
  precomputedConfidenceScore: number | null
  volatilityRegime: VolatilityRegime
}

export function clampRiskPct(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return DEFAULT_MAX_RISK_PCT
  }

  if (value <= 0) {
    return DEFAULT_MAX_RISK_PCT
  }

  return clamp(value, EPSILON, HARD_MAX_RISK_PCT)
}

export function computeBankrollSizing(input: {
  bankroll: number
  proposedPositionSize: number
  maxRiskPct?: number | null
}): BankrollSizingDecision {
  const bankroll = Math.max(input.bankroll, 0)
  const proposedPositionSize = Math.max(input.proposedPositionSize, 0)
  const configuredMaxRiskPct = clampRiskPct(input.maxRiskPct)
  const recommendedMaxRiskPct = Math.min(DEFAULT_MAX_RISK_PCT, configuredMaxRiskPct)

  const defaultMaxRiskDollars = bankroll * DEFAULT_MAX_RISK_PCT
  const configuredMaxRiskDollars = bankroll * configuredMaxRiskPct
  const recommendedMaxRiskDollars = bankroll * recommendedMaxRiskPct
  const hardCapRiskDollars = bankroll * HARD_MAX_RISK_PCT

  return {
    bankroll,
    proposedPositionSize,
    defaultMaxRiskPct: DEFAULT_MAX_RISK_PCT,
    configuredMaxRiskPct,
    recommendedMaxRiskPct,
    hardCapRiskPct: HARD_MAX_RISK_PCT,
    defaultMaxRiskDollars,
    configuredMaxRiskDollars,
    recommendedMaxRiskDollars,
    hardCapRiskDollars,
    cappedPositionSize: Math.min(proposedPositionSize, recommendedMaxRiskDollars),
    remainingRiskBudgetDollars: Math.max(recommendedMaxRiskDollars - proposedPositionSize, 0),
    withinRecommendedRisk: proposedPositionSize <= recommendedMaxRiskDollars + EPSILON,
    withinConfiguredRisk: proposedPositionSize <= configuredMaxRiskDollars + EPSILON,
    withinHardCap: proposedPositionSize <= hardCapRiskDollars + EPSILON,
    isOversized: proposedPositionSize > recommendedMaxRiskDollars + EPSILON,
    isAllIn: bankroll > 0 && proposedPositionSize >= bankroll * 0.5,
  }
}

export function computePositionSizing(
  bankroll: number,
  maxRiskPct: number,
  actionPrice: number | null,
): PositionSizing {
  const safeRiskPct = clampRiskPct(maxRiskPct)
  const maxRiskDollars = bankroll * safeRiskPct

  if (actionPrice === null || actionPrice <= 0) {
    return {
      maxRiskPct: safeRiskPct,
      maxRiskDollars,
      entryPrice: actionPrice,
      maxContracts: 0,
      estimatedCost: 0,
      safeToTrade: false,
    }
  }

  const maxContracts = Math.max(Math.floor(maxRiskDollars / actionPrice), 0)
  return {
    maxRiskPct: safeRiskPct,
    maxRiskDollars,
    entryPrice: actionPrice,
    maxContracts,
    estimatedCost: maxContracts * actionPrice,
    safeToTrade: maxContracts >= 1,
  }
}

export function evaluateTradeOpportunity(input: TradeOpportunityInput): TradeEvaluation {
  const normalized = normalizeTradeOpportunity(input)
  const sizing = computeBankrollSizing({
    bankroll: normalized.bankroll,
    proposedPositionSize: normalized.proposedPositionSize,
    maxRiskPct: normalized.maxRiskPct,
  })

  const side = determineSuggestedSide(normalized)
  const edgeQuality = scoreEdgeQuality(normalized.rawEdge, normalized.percentageEdge)
  const spreadQuality = scoreSpreadQuality(normalized.bidAskSpread)
  const liquidityQuality = scoreLiquidityQuality(normalized.liquidity)
  const volatilityQuality = scoreVolatilityQuality(
    normalized.realizedVolatility,
    normalized.volatilityRegime,
  )
  const distanceQuality = scoreDistanceQuality(normalized.distanceFromStrikePct)
  const timeQuality = scoreTimeQuality(normalized.timeRemainingMinutes)
  const riskRewardRatio = normalized.rawEdge / Math.max(normalized.bidAskSpread, 0.005)

  const confidenceScore = computeConfidenceScore({
    ...normalized,
    edgeQuality,
    spreadQuality,
    liquidityQuality,
    volatilityQuality,
    distanceQuality,
    timeQuality,
  })

  // Oversize entries are only allowed when a caller explicitly raises the cap
  // and the setup is unusually strong. Weak trades should resolve to NO_TRADE.
  const canAllowConfiguredOversize =
    sizing.withinConfiguredRisk &&
    sizing.withinHardCap &&
    !sizing.isAllIn &&
    confidenceScore >= HIGH_CONFIDENCE_OVERSIZE_THRESHOLD &&
    edgeQuality >= MIN_EDGE_QUALITY_FOR_OVERSIZE &&
    normalized.volatilityRegime !== "elevated" &&
    normalized.volatilityRegime !== "extreme"

  // A trade must clear every rule. Borderline setups should fail closed.
  const checks = {
    edgeOk:
      normalized.rawEdge >= MIN_RAW_EDGE &&
      normalized.percentageEdge >= MIN_PERCENTAGE_EDGE,
    spreadOk: normalized.bidAskSpread <= MAX_ACCEPTABLE_SPREAD,
    liquidityOk: liquidityQuality >= MIN_LIQUIDITY_QUALITY,
    volatilityOk:
      normalized.volatilityRegime !== "extreme" &&
      normalized.realizedVolatility < EXTREME_REALIZED_VOLATILITY,
    confidenceOk: confidenceScore >= MIN_CONFIDENCE_SCORE,
    positionSizeOk:
      (sizing.withinRecommendedRisk || canAllowConfiguredOversize) &&
      !sizing.isAllIn,
    riskRewardOk: riskRewardRatio >= MIN_EDGE_TO_SPREAD_RATIO,
    timeOk:
      normalized.timeRemainingMinutes === null ||
      normalized.timeRemainingMinutes >= MIN_TIME_REMAINING_MINUTES,
  }

  const rejectionReasons = buildRejectionReasons({
    ...normalized,
    checks,
    confidenceScore,
    sizing,
    liquidityQuality,
    riskRewardRatio,
  })

  const recommendation: TradeRecommendation =
    Object.values(checks).every(Boolean)
      ? side === "YES"
        ? "BUY_YES"
        : "BUY_NO"
      : "NO_TRADE"

  const reasons =
    recommendation === "NO_TRADE"
      ? [
          "Defaulted to NO_TRADE because the setup did not clear every risk filter.",
          ...rejectionReasons,
        ]
      : buildApprovalReasons({
          side,
          rawEdge: normalized.rawEdge,
          percentageEdge: normalized.percentageEdge,
          confidenceScore,
          sizing,
          volatilityRegime: normalized.volatilityRegime,
        })

  const warnings = buildBehavioralWarnings({
    ...normalized,
    checks,
    confidenceScore,
    sizing,
    riskRewardRatio,
  })

  return {
    recommendation,
    confidenceScore,
    warnings,
    reasons,
    checks,
    sizing,
  }
}

export function applyRiskFirewall(input: FirewallInput): {
  recommendation: Recommendation
  ruleChecks: RuleChecks
  warnings: string[]
  sizing: PositionSizing
} {
  const marketPrice = input.actionPrice ?? 0
  const modelProbability = clamp(marketPrice + (input.rawEdge ?? 0), 0, 1)
  const percentageEdge =
    marketPrice > 0 ? (Math.abs(input.rawEdge ?? 0) / marketPrice) * 100 : 0
  const evaluation = evaluateTradeOpportunity({
    modelProbability,
    impliedProbability: marketPrice,
    rawEdge: input.rawEdge ?? 0,
    percentageEdge,
    bidAskSpread: input.bidAskSpread ?? 1,
    liquidity: input.liquidityScore,
    realizedVolatility: input.volatility.rv30 ?? input.volatility.modelVol,
    volatilityRegime: input.volatility.regime,
    bankroll: input.bankroll,
    proposedPositionSize: marketPrice,
    timeRemainingMinutes: input.minutesToSettlement,
    maxRiskPct: input.maxRiskPct,
    preferredSide: input.suggestedSide,
    precomputedConfidenceScore: input.confidenceScore,
  })
  const sizing = computePositionSizing(input.bankroll, input.maxRiskPct, input.actionPrice)

  const ruleChecks: RuleChecks = {
    positiveEdge: evaluation.checks.edgeOk,
    spreadOk: evaluation.checks.spreadOk,
    liquidityOk: evaluation.checks.liquidityOk,
    volatilityOk: evaluation.checks.volatilityOk,
    bankrollOk: evaluation.checks.positionSizeOk && sizing.safeToTrade,
    confidenceOk: evaluation.checks.confidenceOk,
    timeOk: evaluation.checks.timeOk,
  }
  const warnings = uniqueStrings([
    ...evaluation.warnings,
    input.volatility.fatTailWarning ? "elevated volatility" : null,
  ])

  const recommendation = toLegacyRecommendation(
    ruleChecks.bankrollOk ? evaluation.recommendation : "NO_TRADE",
  )

  return {
    recommendation,
    ruleChecks,
    warnings,
    sizing,
  }
}

export function computeConfidenceScore(
  input: TradeOpportunityInput & {
    edgeQuality?: number
    spreadQuality?: number
    liquidityQuality?: number
    volatilityQuality?: number
    distanceQuality?: number
    timeQuality?: number
  },
) {
  const normalized = normalizeTradeOpportunity(input)
  const edgeQuality =
    input.edgeQuality ?? scoreEdgeQuality(normalized.rawEdge, normalized.percentageEdge)
  const spreadQuality = input.spreadQuality ?? scoreSpreadQuality(normalized.bidAskSpread)
  const liquidityQuality =
    input.liquidityQuality ?? scoreLiquidityQuality(normalized.liquidity)
  const volatilityQuality =
    input.volatilityQuality ??
    scoreVolatilityQuality(normalized.realizedVolatility, normalized.volatilityRegime)
  const distanceQuality =
    input.distanceQuality ?? scoreDistanceQuality(normalized.distanceFromStrikePct)
  const timeQuality = input.timeQuality ?? scoreTimeQuality(normalized.timeRemainingMinutes)

  // Confidence blends edge quality with the conditions that determine whether
  // that edge is likely to survive execution and near-term volatility.
  let confidence =
    edgeQuality * 0.32 +
    volatilityQuality * 0.18 +
    spreadQuality * 0.16 +
    liquidityQuality * 0.16 +
    distanceQuality * 0.09 +
    timeQuality * 0.09

  if (normalized.rawEdge < MIN_RAW_EDGE * 1.15 || normalized.percentageEdge < 8) {
    confidence *= 0.9
  }
  if (normalized.bidAskSpread > MAX_ACCEPTABLE_SPREAD * 0.75) {
    confidence *= 0.88
  }
  if (liquidityQuality < 0.55) {
    confidence *= 0.9
  }
  if (normalized.volatilityRegime === "elevated") {
    confidence *= 0.85
  }
  if (normalized.volatilityRegime === "extreme") {
    confidence *= 0.55
  }
  if (
    normalized.timeRemainingMinutes !== null &&
    normalized.timeRemainingMinutes < MIN_TIME_REMAINING_MINUTES * 2
  ) {
    confidence *= 0.82
  }

  let score = Math.round(clamp(confidence * 100, 0, 100))
  if (normalized.precomputedConfidenceScore !== null) {
    score = Math.min(score, normalized.precomputedConfidenceScore)
  }
  return score
}

function normalizeTradeOpportunity(
  input: TradeOpportunityInput,
): NormalizedTradeOpportunity {
  const impliedProbability = normalizeProbability(input.impliedProbability)
  const rawEdge =
    normalizeProbabilityMagnitude(input.rawEdge) ||
    Math.abs(normalizeProbability(input.modelProbability) - impliedProbability)

  return {
    ...input,
    modelProbability: normalizeProbability(input.modelProbability),
    impliedProbability,
    rawEdge,
    percentageEdge: normalizePercentageEdge(input.percentageEdge, rawEdge, impliedProbability),
    bidAskSpread: normalizeProbabilityMagnitude(input.bidAskSpread),
    liquidity: normalizePositiveNumber(input.liquidity),
    realizedVolatility: normalizeVolatility(input.realizedVolatility),
    volatilityRegime: normalizeVolatilityRegime(input.volatilityRegime),
    bankroll: normalizePositiveNumber(input.bankroll),
    proposedPositionSize: normalizePositiveNumber(input.proposedPositionSize),
    distanceFromStrikePct: normalizeOptionalNumber(input.distanceFromStrikePct),
    timeRemainingMinutes: normalizeOptionalNumber(input.timeRemainingMinutes),
    maxRiskPct: input.maxRiskPct ?? null,
    precomputedConfidenceScore: normalizeOptionalConfidence(input.precomputedConfidenceScore),
  }
}

function determineSuggestedSide(input: NormalizedTradeOpportunity) {
  if (input.preferredSide) {
    return input.preferredSide
  }

  return input.modelProbability >= input.impliedProbability ? "YES" : "NO"
}

function scoreEdgeQuality(rawEdge: number, percentageEdge: number) {
  const rawScore = clamp(rawEdge / 0.06, 0, 1)
  const pctScore = clamp(percentageEdge / 15, 0, 1)
  return rawScore * 0.65 + pctScore * 0.35
}

function scoreSpreadQuality(spread: number) {
  return clamp(1 - spread / 0.05, 0, 1)
}

function scoreLiquidityQuality(liquidity: number) {
  if (liquidity <= 1) {
    return clamp(liquidity, 0, 1)
  }

  return clamp((Math.log10(liquidity + 1) - 1.5) / 1.2, 0, 1)
}

function scoreVolatilityQuality(
  realizedVolatility: number,
  volatilityRegime: VolatilityRegime,
) {
  const regimeScores: Record<VolatilityRegime, number> = {
    low: 1,
    normal: 0.82,
    elevated: 0.58,
    extreme: 0.15,
  }
  const regimeScore = regimeScores[volatilityRegime]

  const realizedScore =
    realizedVolatility <= 0.45
      ? 1
      : realizedVolatility <= 0.7
        ? 0.82
        : realizedVolatility <= 1
          ? 0.58
          : realizedVolatility <= EXTREME_REALIZED_VOLATILITY
            ? 0.3
            : 0.1

  return regimeScore * 0.6 + realizedScore * 0.4
}

function scoreDistanceQuality(distanceFromStrikePct: number | null | undefined) {
  if (distanceFromStrikePct === null || distanceFromStrikePct === undefined) {
    return 0.4
  }

  return clamp(Math.abs(distanceFromStrikePct) / 1.5, 0, 1)
}

function scoreTimeQuality(timeRemainingMinutes: number | null | undefined) {
  if (timeRemainingMinutes === null || timeRemainingMinutes === undefined) {
    return 0.35
  }

  return clamp((timeRemainingMinutes - MIN_TIME_REMAINING_MINUTES) / 230, 0, 1)
}

function buildBehavioralWarnings(input: {
  rawEdge: number
  bidAskSpread: number
  volatilityRegime: VolatilityRegime
  confidenceScore: number
  sizing: BankrollSizingDecision
  checks: { edgeOk: boolean; liquidityOk: boolean; riskRewardOk: boolean }
  riskRewardRatio: number
}) {
  const warnings = [
    input.sizing.isOversized ? "oversized exposure" : null,
    !input.checks.liquidityOk ? "low-liquidity contract" : null,
    input.volatilityRegime === "elevated" || input.volatilityRegime === "extreme"
      ? "elevated volatility"
      : null,
    !input.checks.edgeOk ? "insufficient edge" : null,
    !input.checks.riskRewardOk || input.rawEdge <= input.bidAskSpread
      ? "poor risk/reward"
      : null,
    input.sizing.isOversized && (input.confidenceScore < MIN_CONFIDENCE_SCORE || !input.checks.edgeOk)
      ? "revenge trade risk"
      : null,
    input.sizing.isAllIn ? "oversized exposure" : null,
    input.riskRewardRatio < 1 ? "poor risk/reward" : null,
  ]

  return uniqueStrings(warnings)
}

function buildRejectionReasons(input: {
  rawEdge: number
  percentageEdge: number
  bidAskSpread: number
  realizedVolatility: number
  timeRemainingMinutes?: number | null
  confidenceScore: number
  liquidityQuality: number
  riskRewardRatio: number
  sizing: BankrollSizingDecision
  checks: {
    edgeOk: boolean
    spreadOk: boolean
    liquidityOk: boolean
    volatilityOk: boolean
    confidenceOk: boolean
    positionSizeOk: boolean
    riskRewardOk: boolean
    timeOk: boolean
  }
}) {
  const reasons: string[] = []

  if (!input.checks.edgeOk) {
    reasons.push(
      `Edge is ${formatPoints(input.rawEdge)} with a ${input.percentageEdge.toFixed(1)}% percentage edge, below the minimum quality bar.`,
    )
  }
  if (!input.checks.spreadOk) {
    reasons.push(
      `Bid/ask spread is ${formatPoints(input.bidAskSpread)}, wider than the ${formatPoints(MAX_ACCEPTABLE_SPREAD)} ceiling.`,
    )
  }
  if (!input.checks.liquidityOk) {
    reasons.push(
      `Liquidity quality scored ${(input.liquidityQuality * 100).toFixed(0)}/100, below the minimum threshold.`,
    )
  }
  if (!input.checks.volatilityOk) {
    reasons.push(
      `Realized volatility is ${(input.realizedVolatility * 100).toFixed(1)}% annualized or the regime is extreme.`,
    )
  }
  if (!input.checks.confidenceOk) {
    reasons.push(
      `Confidence scored ${input.confidenceScore}/100, which is too low for a capital-preservation-first entry.`,
    )
  }
  if (!input.checks.positionSizeOk) {
    reasons.push(
      `Proposed size of ${formatDollars(input.sizing.proposedPositionSize)} exceeds the recommended risk budget of ${formatDollars(input.sizing.recommendedMaxRiskDollars)}.`,
    )
  }
  if (!input.checks.riskRewardOk) {
    reasons.push(
      `Edge-to-spread ratio is ${input.riskRewardRatio.toFixed(2)}, which does not compensate enough for execution friction.`,
    )
  }
  if (!input.checks.timeOk) {
    reasons.push(
      `Only ${Math.max(input.timeRemainingMinutes ?? 0, 0).toFixed(0)} minutes remain, leaving too little buffer for a fresh entry.`,
    )
  }

  return reasons
}

function buildApprovalReasons(input: {
  side: SuggestedSide
  rawEdge: number
  percentageEdge: number
  confidenceScore: number
  sizing: BankrollSizingDecision
  volatilityRegime: VolatilityRegime
}) {
  return [
    `${
      input.side === "YES" ? "YES" : "NO"
    } side carries ${formatPoints(input.rawEdge)} of directional edge with a ${input.percentageEdge.toFixed(1)}% percentage edge.`,
    `Confidence scored ${input.confidenceScore}/100 after edge, spread, liquidity, volatility, strike-distance, and time checks.`,
    `Proposed size of ${formatDollars(input.sizing.proposedPositionSize)} stays within the recommended risk budget of ${formatDollars(input.sizing.recommendedMaxRiskDollars)}.`,
    `Volatility regime is ${input.volatilityRegime} and the setup cleared the no-trade filters.`,
  ]
}

function normalizeProbability(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }

  const scaled = Math.abs(value) > 1 ? value / 100 : value
  return clamp(scaled, 0, 1)
}

function normalizeProbabilityMagnitude(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }

  const scaled = Math.abs(value) > 1 ? value / 100 : value
  return Math.max(Math.abs(scaled), 0)
}

function normalizePercentageEdge(
  value: number,
  rawEdge: number,
  impliedProbability: number,
) {
  if (Number.isFinite(value)) {
    const magnitude = Math.abs(value)
    return magnitude <= 1 ? magnitude * 100 : magnitude
  }

  if (impliedProbability <= 0) {
    return rawEdge * 100
  }

  return (rawEdge / impliedProbability) * 100
}

function normalizeVolatility(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }

  const scaled = Math.abs(value) > 3 ? value / 100 : value
  return Math.max(scaled, 0)
}

function normalizeVolatilityRegime(regime: RiskVolatilityRegime): VolatilityRegime {
  if (regime === "calm") {
    return "low"
  }
  if (regime === "active") {
    return "normal"
  }
  return regime
}

function normalizePositiveNumber(value: number) {
  return Number.isFinite(value) ? Math.max(value, 0) : 0
}

function normalizeOptionalNumber(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value
}

function normalizeOptionalConfidence(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null
  }

  const scaled = Math.abs(value) > 1 ? value : value * 100
  return clamp(Math.round(scaled), 0, 100)
}

function toLegacyRecommendation(recommendation: TradeRecommendation): Recommendation {
  if (recommendation === "BUY_YES") {
    return "BUY YES"
  }
  if (recommendation === "BUY_NO") {
    return "BUY NO"
  }
  return "NO TRADE"
}

function formatPoints(value: number) {
  return `${(value * 100).toFixed(1)} pts`
}

function formatDollars(value: number) {
  return `$${value.toFixed(2)}`
}

function uniqueStrings(values: Array<string | null>) {
  return Array.from(new Set(values.filter(Boolean) as string[]))
}
