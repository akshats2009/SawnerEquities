import { clamp } from "@/lib/utils"
import type {
  BtcExchangeConsensusMetrics,
  BtcMomentumStatus,
  BtcObservationWindow,
  BtcSpreadState,
  BtcVolatilityRegime,
  BtcWindowMetrics,
} from "@/lib/analysis/priceDecision"
import type { BtcFalseBreakoutSnapshot } from "@/lib/analysis/falseBreakout"
import type { BtcSocialNewsSnapshot } from "@/lib/sentiment/eventScoring"

export type BtcMarketRegime =
  | "trending up"
  | "trending down"
  | "mean-reverting"
  | "high-volatility expansion"
  | "low-volatility compression"
  | "choppy / noisy"
  | "breakout conditions"
  | "exhaustion conditions"

export type BtcRegimeClarity = "clear" | "mixed" | "ambiguous"

export interface BtcMarketRegimeSnapshot {
  primaryRegime: BtcMarketRegime
  secondaryRegime: BtcMarketRegime | null
  regimeConfidence: number
  regimeStabilityScore: number
  regimeClarity: BtcRegimeClarity
  explanation: string
  supportingSignals: string[]
  conflictingSignals: string[]
  warnings: string[]
  isTransitioning: boolean
}

export interface BtcRegimeTransition {
  timestampMs: number
  from: BtcMarketRegime | null
  to: BtcMarketRegime
  confidence: number
  stabilityScore: number
  explanation: string
}

export interface BtcRegimeInput {
  asOfMs: number
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
  fifteenMinuteReturn: number | null
  realizedVolatility: Record<BtcObservationWindow, number | null>
  spreadState: BtcSpreadState
  spreadBps: number | null
  spreadDeltaPct: number | null
  trendPersistenceScore: number
  momentumScore: number
  momentumStatus: BtcMomentumStatus
  tickVelocityPerMin: number | null
  volatilityRegime: BtcVolatilityRegime
  exchangeConsensus: BtcExchangeConsensusMetrics | null
  windowMetrics: BtcWindowMetrics[]
  stale: boolean
  falseBreakoutAnalysis?: BtcFalseBreakoutSnapshot | null
  socialNews?: BtcSocialNewsSnapshot | null
}

interface RegimeScore {
  regime: BtcMarketRegime
  score: number
}

export function analyzeBtcMarketRegime(
  input: BtcRegimeInput,
): BtcMarketRegimeSnapshot {
  const metrics = deriveRegimeMetrics(input)
  const scores = buildRegimeScores(metrics)
  const ranked = [...scores].sort((left, right) => right.score - left.score)
  const primary = ranked[0] ?? { regime: "choppy / noisy", score: 0 }
  const secondary = ranked[1] ?? null
  const confidence = calculateRegimeConfidence(primary.score, secondary?.score ?? 0)
  const stabilityScore = calculateRegimeStability(metrics, primary.score, secondary?.score ?? 0)
  const regimeClarity = classifyRegimeClarity(confidence, stabilityScore, primary.score, secondary?.score ?? 0)
  const explanation = buildRegimeExplanation(primary.regime, metrics, regimeClarity, secondary?.regime ?? null)
  const warnings = buildRegimeWarnings({
    metrics,
    regimeClarity,
    confidence,
    stabilityScore,
    primaryRegime: primary.regime,
    secondaryRegime: secondary?.regime ?? null,
    falseBreakoutAnalysis: input.falseBreakoutAnalysis ?? null,
  })

  return {
    primaryRegime: primary.regime,
    secondaryRegime: shouldExposeSecondaryRegime(primary.score, secondary?.score ?? 0)
      ? secondary?.regime ?? null
      : null,
    regimeConfidence: confidence,
    regimeStabilityScore: stabilityScore,
    regimeClarity,
    explanation,
    supportingSignals: buildSupportingSignals(primary.regime, metrics),
    conflictingSignals: buildConflictingSignals(primary.regime, metrics),
    warnings,
    isTransitioning:
      confidence < 55 ||
      stabilityScore < 50 ||
      regimeClarity === "ambiguous" ||
      (secondary !== null && primary.score - secondary.score < 0.08),
  }
}

function deriveRegimeMetrics(input: BtcRegimeInput) {
  const shortReturn = input.oneMinuteReturn ?? 0
  const midReturn = input.fiveMinuteReturn ?? 0
  const longReturn = input.fifteenMinuteReturn ?? 0
  const weightedReturn = shortReturn * 0.25 + midReturn * 0.4 + longReturn * 0.35
  const directionConsistency = computeDirectionalConsistency([
    input.oneMinuteReturn,
    input.fiveMinuteReturn,
    input.fifteenMinuteReturn,
  ])

  const rv1 = input.realizedVolatility["1m"] ?? null
  const rv5 = input.realizedVolatility["5m"] ?? null
  const rv15 = input.realizedVolatility["15m"] ?? null
  const rv60 = input.realizedVolatility["1h"] ?? null
  const volatilityLevel = clamp((rv15 ?? rv5 ?? rv1 ?? 0) / 120, 0, 1)
  const volatilitySlope = computeVolatilitySlope(rv1, rv5, rv15, rv60)
  const compressionScore = computeCompressionScore(input, volatilityLevel, rv1, rv5, rv15)
  const expansionScore = computeExpansionScore(input, volatilityLevel, volatilitySlope, rv1, rv5, rv15)

  const agreementScore = clamp((input.exchangeConsensus?.agreementScore ?? 50) / 100, 0, 1)
  const activeExchangeCount = input.exchangeConsensus?.activeExchangeCount ?? 0
  const activeCoverageScore = clamp(activeExchangeCount / 3, 0, 1)
  const spreadStress = computeSpreadStress(input.spreadState, input.spreadBps, input.spreadDeltaPct)
  const tickVelocityScore = clamp(normalizeTickVelocity(input.tickVelocityPerMin), 0, 1)
  const trendStrengthScore = clamp(input.trendPersistenceScore / 100, 0, 1)
  const momentumAlignment = computeMomentumAlignment(input.momentumStatus, input.momentumScore, weightedReturn)
  const directionalBias = Math.sign(weightedReturn)
  const breakoutConfidenceScore = clamp(
    (input.falseBreakoutAnalysis?.breakoutConfidence ?? 45) / 100,
    0,
    1,
  )
  const breakoutHealthScore = clamp(
    (input.falseBreakoutAnalysis?.breakoutHealthScore ?? 45) / 100,
    0,
    1,
  )
  const socialNewsSignal = computeSocialNewsSignal(input.socialNews ?? null, directionalBias)
  const socialNewsRiskScore = computeSocialNewsRiskScore(input.socialNews ?? null)
  const falseBreakoutRiskScore = clamp(
    (input.falseBreakoutAnalysis?.falseBreakoutRisk ?? 35) / 100,
    0,
    1,
  )
  const followThroughQualityScore = clamp(
    (input.falseBreakoutAnalysis?.followThroughQuality ?? 45) / 100,
    0,
    1,
  )
  const exhaustionScore = clamp(
    (input.falseBreakoutAnalysis?.exhaustionScore ?? 40) / 100,
    0,
    1,
  )

  return {
    shortReturn,
    midReturn,
    longReturn,
    weightedReturn,
    directionConsistency,
    rv1,
    rv5,
    rv15,
    rv60,
    volatilityLevel,
    volatilitySlope,
    compressionScore,
    expansionScore,
    agreementScore,
    activeCoverageScore,
    spreadStress,
    tickVelocityScore,
    trendStrengthScore,
    momentumAlignment,
    directionalBias,
    breakoutConfidenceScore,
    breakoutHealthScore,
    socialNewsSignal,
    socialNewsRiskScore,
    falseBreakoutRiskScore,
    followThroughQualityScore,
    exhaustionScore,
  }
}

function buildRegimeScores(metrics: ReturnType<typeof deriveRegimeMetrics>): RegimeScore[] {
  const trendUp = clamp(
    (metrics.weightedReturn > 0 ? clamp(metrics.weightedReturn / 0.35, 0, 1) * 0.3 : 0) +
      metrics.trendStrengthScore * 0.22 +
      metrics.momentumAlignment * 0.18 +
      metrics.directionConsistency * 0.12 +
      metrics.agreementScore * 0.08 +
      Math.max(metrics.socialNewsSignal, 0) * 0.08 +
      (metrics.spreadStress < 0.45 ? 0.08 : -0.05) +
      (metrics.volatilityLevel < 0.9 ? 0.02 : -0.05),
    0,
    1,
  )

  const trendDown = clamp(
    (metrics.weightedReturn < 0 ? clamp(Math.abs(metrics.weightedReturn) / 0.35, 0, 1) * 0.3 : 0) +
      metrics.trendStrengthScore * 0.22 +
      metrics.momentumAlignment * 0.18 +
      metrics.directionConsistency * 0.12 +
      metrics.agreementScore * 0.08 +
      Math.max(-metrics.socialNewsSignal, 0) * 0.08 +
      (metrics.spreadStress < 0.45 ? 0.08 : -0.05) +
      (metrics.volatilityLevel < 0.9 ? 0.02 : -0.05),
    0,
    1,
  )

  const meanReverting = clamp(
    (1 - metrics.trendStrengthScore) * 0.28 +
      oppositeDirectionScore(metrics.shortReturn, metrics.midReturn, metrics.longReturn) * 0.26 +
      (metrics.volatilityLevel >= 0.25 && metrics.volatilityLevel <= 0.8 ? 0.14 : 0.05) +
      (metrics.spreadStress < 0.5 ? 0.12 : 0.04) +
      clamp(1 - Math.abs(metrics.weightedReturn) / 0.28, 0, 1) * 0.16 +
      metrics.agreementScore * 0.08,
    0,
    1,
  )

  const highVolExpansion = clamp(
    metrics.expansionScore * 0.34 +
      metrics.volatilityLevel * 0.22 +
      metrics.spreadStress * 0.18 +
      metrics.tickVelocityScore * 0.16 +
      metrics.momentumAlignment * 0.1 -
      metrics.compressionScore * 0.1 +
      Math.abs(metrics.socialNewsSignal) * 0.06,
    0,
    1,
  )

  const lowVolCompression = clamp(
    metrics.compressionScore * 0.32 +
      (1 - metrics.volatilityLevel) * 0.28 +
      (1 - metrics.tickVelocityScore) * 0.12 +
      (metrics.spreadStress < 0.45 ? 0.18 : 0.04) +
      (metrics.agreementScore > 0.62 ? 0.1 : 0.03),
    0,
    1,
  )

  const choppy = clamp(
    (1 - metrics.directionConsistency) * 0.24 +
      (1 - metrics.trendStrengthScore) * 0.2 +
      metrics.spreadStress * 0.18 +
      (1 - metrics.agreementScore) * 0.18 +
      (metrics.volatilityLevel >= 0.3 ? 0.12 : 0.04) +
      metrics.falseBreakoutRiskScore * 0.12 +
      clamp(Math.abs(metrics.weightedReturn) < 0.06 ? 1 : 0, 0, 1) * 0.08 +
      metrics.socialNewsRiskScore * 0.1,
    0,
    1,
  )

  const breakout = clamp(
    metrics.compressionScore * 0.24 +
      metrics.expansionScore * 0.18 +
      metrics.tickVelocityScore * 0.18 +
      metrics.momentumAlignment * 0.16 +
      metrics.directionConsistency * 0.14 +
      (metrics.trendStrengthScore > 0.5 ? metrics.trendStrengthScore * 0.1 : 0.02) -
      (metrics.spreadStress > 0.7 ? 0.05 : 0) +
      metrics.breakoutConfidenceScore * 0.08 +
      metrics.breakoutHealthScore * 0.14 +
      (1 - metrics.falseBreakoutRiskScore) * 0.12 +
      metrics.followThroughQualityScore * 0.12 +
      Math.max(metrics.socialNewsSignal, 0) * 0.05 -
      metrics.exhaustionScore * 0.08,
    0,
    1,
  )

  const exhaustion = clamp(
    metrics.trendStrengthScore * 0.24 +
      oppositeDirectionScore(metrics.shortReturn, metrics.midReturn, metrics.longReturn) * 0.22 +
      metrics.volatilityLevel * 0.18 +
      metrics.spreadStress * 0.14 +
      (1 - metrics.momentumAlignment) * 0.12 +
      (1 - metrics.directionConsistency) * 0.1 +
      metrics.falseBreakoutRiskScore * 0.16 +
      metrics.exhaustionScore * 0.18 +
      (1 - metrics.followThroughQualityScore) * 0.08 +
      metrics.socialNewsRiskScore * 0.08,
    0,
    1,
  )

  return [
    { regime: "trending up", score: trendUp },
    { regime: "trending down", score: trendDown },
    { regime: "mean-reverting", score: meanReverting },
    { regime: "high-volatility expansion", score: highVolExpansion },
    { regime: "low-volatility compression", score: lowVolCompression },
    { regime: "choppy / noisy", score: choppy },
    { regime: "breakout conditions", score: breakout },
    { regime: "exhaustion conditions", score: exhaustion },
  ]
}

function calculateRegimeConfidence(topScore: number, secondScore: number) {
  const score = clamp(topScore, 0, 1)
  const gap = clamp(score - clamp(secondScore, 0, 1), 0, 1)
  return Math.round(clamp(score * 0.7 + gap * 0.3, 0, 1) * 100)
}

function calculateRegimeStability(
  metrics: ReturnType<typeof deriveRegimeMetrics>,
  topScore: number,
  secondScore: number,
) {
  const support = clamp(
    metrics.directionConsistency * 0.3 +
      metrics.trendStrengthScore * 0.25 +
      metrics.agreementScore * 0.2 +
      metrics.momentumAlignment * 0.15 +
      (1 - metrics.spreadStress) * 0.1,
    0,
    1,
  )
  const gap = clamp(topScore - secondScore, 0, 1)
  return Math.round(clamp(support * 0.55 + gap * 0.45, 0, 1) * 100)
}

function classifyRegimeClarity(
  confidence: number,
  stabilityScore: number,
  topScore: number,
  secondScore: number,
): BtcRegimeClarity {
  if (confidence < 55 || stabilityScore < 45 || topScore - secondScore < 0.08) {
    return "ambiguous"
  }

  if (confidence < 70 || stabilityScore < 60 || topScore - secondScore < 0.15) {
    return "mixed"
  }

  return "clear"
}

function buildRegimeExplanation(
  regime: BtcMarketRegime,
  metrics: ReturnType<typeof deriveRegimeMetrics>,
  clarity: BtcRegimeClarity,
  secondaryRegime: BtcMarketRegime | null,
) {
  const prefix =
    clarity === "ambiguous"
      ? "Ambiguous regime: signals are split."
      : clarity === "mixed"
        ? "Mixed regime: a primary structure is present, but competing signals remain."
        : "Regime is stable."

  const details = getRegimeDetail(regime, metrics)
  const tail =
    secondaryRegime !== null && secondaryRegime !== regime
      ? ` Secondary pressure is also visible in ${secondaryRegime}.`
      : ""

  return `${prefix} ${details}${tail}`.trim()
}

function buildSupportingSignals(
  regime: BtcMarketRegime,
  metrics: ReturnType<typeof deriveRegimeMetrics>,
) {
  const signals = getRegimeSignals(regime, metrics)
  return signals.supporting.slice(0, 4)
}

function buildConflictingSignals(
  regime: BtcMarketRegime,
  metrics: ReturnType<typeof deriveRegimeMetrics>,
) {
  const signals = getRegimeSignals(regime, metrics)
  return signals.conflicting.slice(0, 4)
}

function buildRegimeWarnings({
  metrics,
  regimeClarity,
  confidence,
  stabilityScore,
  primaryRegime,
  secondaryRegime,
  falseBreakoutAnalysis,
}: {
  metrics: ReturnType<typeof deriveRegimeMetrics>
  regimeClarity: BtcRegimeClarity
  confidence: number
  stabilityScore: number
  primaryRegime: BtcMarketRegime
  secondaryRegime: BtcMarketRegime | null
  falseBreakoutAnalysis: BtcFalseBreakoutSnapshot | null
}) {
  const warnings: string[] = []

  if (metrics.agreementScore < 0.55 || metrics.activeCoverageScore < 0.5) {
    warnings.push("Regime transition in progress.")
  }

  if (confidence < 55) {
    warnings.push("Low regime confidence.")
  }

  if (stabilityScore < 45 || regimeClarity === "ambiguous") {
    warnings.push("Conditions unstable.")
  }

  if (
    primaryRegime === "breakout conditions" &&
    (secondaryRegime === "choppy / noisy" || secondaryRegime === "mean-reverting")
  ) {
    warnings.push("Breakout conditions need confirmation; reversal risk remains elevated.")
  }

  if (primaryRegime === "high-volatility expansion" && metrics.spreadStress > 0.7) {
    warnings.push("Spread behavior is abnormal relative to the current regime.")
  }

  if (falseBreakoutAnalysis?.warning) {
    warnings.push(falseBreakoutAnalysis.warning)
  }

  if (falseBreakoutAnalysis?.breakoutStatus === "false breakout risk") {
    warnings.push("Breakout structure appears fragile and may fail.")
  }

  if (falseBreakoutAnalysis?.breakoutStatus === "ambiguous") {
    warnings.push("Breakout conditions are ambiguous.")
  }

  return warnings
}

function shouldExposeSecondaryRegime(primaryScore: number, secondaryScore: number | undefined) {
  if (secondaryScore === undefined) {
    return false
  }

  return secondaryScore >= 0.4 && primaryScore - secondaryScore < 0.2
}

function getRegimeDetail(regime: BtcMarketRegime, metrics: ReturnType<typeof deriveRegimeMetrics>) {
  const returnText = describeReturn(metrics.weightedReturn)
  const velocityText = describeVelocity(metrics.tickVelocityScore)
  const agreementText =
    metrics.agreementScore >= 0.7
      ? "exchange agreement is tight"
      : metrics.agreementScore <= 0.45
        ? "exchange agreement is weak"
        : "exchange agreement is mixed"

  switch (regime) {
    case "trending up":
      return `BTC is trading with upward persistence, ${returnText}, and ${agreementText}.`
    case "trending down":
      return `BTC is trading with downward persistence, ${returnText}, and ${agreementText}.`
    case "mean-reverting":
      return `Price is oscillating around balance rather than extending directionally, with short-window returns disagreeing and persistence fading.`
    case "high-volatility expansion":
      return `Volatility is expanding, spreads are under pressure, and ${velocityText}.`
    case "low-volatility compression":
      return `Volatility is compressed, spreads are tight, and ${velocityText}.`
    case "choppy / noisy":
      return `Direction, momentum, and exchange agreement are not lining up cleanly enough to define a stable short-term regime.`
    case "breakout conditions":
      return `Compression is giving way to faster ticks and widening range, which fits a breakout-style setup.`
    case "exhaustion conditions":
      return `A prior move is losing momentum while volatility remains active, which is consistent with exhaustion.`
    default:
      return "The BTC regime is not well defined."
  }
}

function getRegimeSignals(
  regime: BtcMarketRegime,
  metrics: ReturnType<typeof deriveRegimeMetrics>,
) {
  const supporting: string[] = []
  const conflicting: string[] = []

  const volatilityText =
    metrics.volatilityLevel >= 0.75
      ? "realized volatility is elevated"
      : metrics.volatilityLevel <= 0.25
        ? "realized volatility is compressed"
        : "realized volatility is moderate"

  const spreadText =
    metrics.spreadStress >= 0.7
      ? "spread behavior is stressed"
      : metrics.spreadStress <= 0.4
        ? "spread behavior is orderly"
        : "spread behavior is mixed"

  const consistencyText =
    metrics.directionConsistency >= 0.7
      ? "short-term directional consistency is high"
      : metrics.directionConsistency <= 0.45
        ? "short-term directional consistency is weak"
        : "short-term directional consistency is mixed"

  const momentumText =
    metrics.momentumAlignment >= 0.7
      ? "momentum is aligned"
      : metrics.momentumAlignment <= 0.45
        ? "momentum is not aligned"
        : "momentum alignment is mixed"

  const agreementText =
    metrics.agreementScore >= 0.7
      ? "exchanges are in strong agreement"
      : metrics.agreementScore <= 0.45
        ? "exchange agreement is weak"
        : "exchange agreement is mixed"

  switch (regime) {
    case "trending up":
      supporting.push(
        consistencyText,
        momentumText,
        agreementText,
        `trend persistence is ${metrics.trendStrengthScore >= 0.6 ? "firm" : "building"}`,
      )
      conflicting.push(
        metrics.spreadStress > 0.65 ? "spread stress is competing with continuation" : spreadText,
        metrics.directionConsistency < 0.55 ? "short-window returns are not fully aligned" : "one of the shorter windows is softening",
      )
      break
    case "trending down":
      supporting.push(
        consistencyText,
        momentumText,
        agreementText,
        `trend persistence is ${metrics.trendStrengthScore >= 0.6 ? "firm" : "building"}`,
      )
      conflicting.push(
        metrics.spreadStress > 0.65 ? "spread stress is competing with continuation" : spreadText,
        metrics.directionConsistency < 0.55 ? "short-window returns are not fully aligned" : "one of the shorter windows is softening",
      )
      break
    case "mean-reverting":
      supporting.push(
        "returns are oscillating across windows",
        "trend persistence is soft",
        spreadText,
        agreementText,
      )
      conflicting.push(
        momentumText,
        consistencyText,
      )
      break
    case "high-volatility expansion":
      supporting.push(
        volatilityText,
        "volatility is accelerating across windows",
        spreadText,
        `tick flow is ${metrics.tickVelocityScore >= 0.6 ? "active" : "uneven"}`,
      )
      conflicting.push(
        agreementText,
        consistencyText,
      )
      break
    case "low-volatility compression":
      supporting.push(
        volatilityText,
        spreadText,
        "tick flow is subdued",
        agreementText,
      )
      conflicting.push(
        metrics.momentumAlignment > 0.6 ? "momentum could still be building under the surface" : momentumText,
        metrics.directionConsistency < 0.5 ? "short-term direction is not yet settled" : "price is still not extending cleanly",
      )
      break
    case "choppy / noisy":
      supporting.push(
        "the market is not maintaining a clean direction",
        spreadText,
        agreementText,
        consistencyText,
      )
      conflicting.push(
        momentumText,
        `trend persistence is ${Math.round(metrics.trendStrengthScore * 100)}/100`,
      )
      break
    case "breakout conditions":
      supporting.push(
        "compression is releasing into wider movement",
        `tick velocity is ${metrics.tickVelocityScore >= 0.6 ? "rising" : "building"}`,
        "directional consistency is improving",
        agreementText,
      )
      conflicting.push(
        spreadText,
        metrics.volatilitySlope < 0 ? "volatility is not accelerating yet" : "volatility acceleration still needs confirmation",
      )
      break
    case "exhaustion conditions":
      supporting.push(
        "a prior move is showing fatigue",
        "momentum is fading relative to recent movement",
        spreadText,
        metrics.volatilityLevel >= 0.6 ? "volatility is still elevated" : "volatility has not fully reset",
      )
      conflicting.push(
        consistencyText,
        agreementText,
      )
      break
  }

  return { supporting, conflicting }
}

function computeDirectionalConsistency(values: Array<number | null>) {
  const signs = values
    .filter((value): value is number => value !== null && value !== 0)
    .map((value) => Math.sign(value))

  if (signs.length < 2) {
    return 0.5
  }

  let matches = 0
  let comparisons = 0
  for (let left = 0; left < signs.length; left += 1) {
    for (let right = left + 1; right < signs.length; right += 1) {
      matches += signs[left] === signs[right] ? 1 : 0
      comparisons += 1
    }
  }

  return comparisons > 0 ? matches / comparisons : 0.5
}

function oppositeDirectionScore(
  oneMinuteReturn: number | null,
  fiveMinuteReturn: number | null,
  fifteenMinuteReturn: number | null,
) {
  const returns = [oneMinuteReturn, fiveMinuteReturn, fifteenMinuteReturn].filter(
    (value): value is number => value !== null && value !== 0,
  )

  if (returns.length < 2) {
    return 0.5
  }

  const signs = returns.map((value) => Math.sign(value))
  const oppositePairs = signs.filter((sign, index) =>
    signs.some((other, otherIndex) => otherIndex !== index && other === -sign),
  ).length

  return clamp(oppositePairs / signs.length, 0, 1)
}

function computeVolatilitySlope(
  rv1: number | null,
  rv5: number | null,
  rv15: number | null,
  rv60: number | null,
) {
  const short = rv1 ?? rv5 ?? rv15 ?? rv60 ?? 0
  const long = rv60 ?? rv15 ?? rv5 ?? rv1 ?? 0
  return long === 0 ? 0 : (short - long) / Math.max(Math.abs(long), 1)
}

function computeCompressionScore(
  input: BtcRegimeInput,
  volatilityLevel: number,
  rv1: number | null,
  rv5: number | null,
  rv15: number | null,
) {
  const spreadScore =
    input.spreadState === "contracting"
      ? 1
      : input.spreadState === "stable"
        ? 0.72
        : 0.28
  const velocityScore = 1 - clamp(normalizeTickVelocity(input.tickVelocityPerMin), 0, 1)
  const rangeScore = clamp(
    1 -
      ((input.windowMetrics.find((metric) => metric.window === "1m")?.rangePct ??
        input.windowMetrics.find((metric) => metric.window === "5m")?.rangePct ??
        0) /
        0.4),
    0,
    1,
  )
  const volatilityCompression =
    clamp(1 - volatilityLevel, 0, 1) +
    clamp(1 - clamp((rv1 ?? rv5 ?? rv15 ?? 0) / 120, 0, 1), 0, 1) * 0.5

  return clamp(
    spreadScore * 0.35 + velocityScore * 0.2 + rangeScore * 0.2 + volatilityCompression * 0.25,
    0,
    1,
  )
}

function computeExpansionScore(
  input: BtcRegimeInput,
  volatilityLevel: number,
  volatilitySlope: number,
  rv1: number | null,
  rv5: number | null,
  rv15: number | null,
) {
  const spreadScore =
    input.spreadState === "expanding"
      ? 1
      : input.spreadState === "stable"
        ? 0.55
        : 0.35
  const velocityScore = clamp(normalizeTickVelocity(input.tickVelocityPerMin), 0, 1)
  const slopeScore = clamp((volatilitySlope + 0.35) / 0.7, 0, 1)
  const accelScore = clamp(
    (((rv1 ?? 0) - (rv15 ?? rv5 ?? rv1 ?? 0)) / 60 + 0.5),
    0,
    1,
  )

  return clamp(
    spreadScore * 0.3 + velocityScore * 0.2 + slopeScore * 0.25 + accelScore * 0.25 + volatilityLevel * 0.1,
    0,
    1,
  )
}

function computeSpreadStress(
  spreadState: BtcSpreadState,
  spreadBps: number | null,
  spreadDeltaPct: number | null,
) {
  const stateScore =
    spreadState === "expanding"
      ? 1
      : spreadState === "stable"
        ? 0.55
        : 0.25
  const levelScore = clamp((spreadBps ?? 0) / 10, 0, 1)
  const deltaScore = clamp(((spreadDeltaPct ?? 0) + 40) / 80, 0, 1)
  return clamp(stateScore * 0.5 + levelScore * 0.3 + deltaScore * 0.2, 0, 1)
}

function computeMomentumAlignment(
  momentumStatus: BtcMomentumStatus,
  momentumScore: number,
  weightedReturn: number,
) {
  const statusScore =
    momentumStatus === "strong bullish" || momentumStatus === "strong bearish"
      ? 1
      : momentumStatus === "bullish" || momentumStatus === "bearish"
        ? 0.74
        : 0.42
  const directionScore =
    weightedReturn === 0
      ? 0.45
      : Math.sign(weightedReturn) === Math.sign(momentumScore)
        ? 1
        : 0.3
  return clamp(statusScore * 0.55 + directionScore * 0.45, 0, 1)
}

function computeSocialNewsSignal(
  socialNews: BtcSocialNewsSnapshot | null,
  directionalBias: number,
) {
  if (!socialNews || !socialNews.available) {
    return 0
  }

  if (socialNews.eventRiskState === "unreliable/noisy") {
    return 0
  }

  const pressure = clamp(socialNews.pressureScore / 100, -1, 1)
  if (directionalBias === 0) {
    return pressure * 0.35
  }

  return pressure * Math.sign(directionalBias)
}

function computeSocialNewsRiskScore(socialNews: BtcSocialNewsSnapshot | null) {
  if (!socialNews || !socialNews.available) {
    return 0.25
  }

  if (socialNews.eventRiskState === "unreliable/noisy") {
    return 0.85
  }

  if (socialNews.eventRiskState === "active catalyst") {
    return 0.45
  }

  if (socialNews.eventRiskState === "elevated") {
    return 0.22
  }

  return 0.08
}

function normalizeTickVelocity(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return 0.5
  }

  return clamp(value / 14, 0, 1)
}

function describeReturn(value: number) {
  if (!Number.isFinite(value)) {
    return "directional pressure is unclear"
  }

  if (Math.abs(value) < 0.03) {
    return "directional pressure is muted"
  }

  return value > 0 ? "directional pressure is leaning higher" : "directional pressure is leaning lower"
}

function describeVelocity(value: number) {
  if (value >= 0.72) {
    return "tick flow is active"
  }

  if (value <= 0.38) {
    return "tick flow is subdued"
  }

  return "tick flow is mixed"
}
