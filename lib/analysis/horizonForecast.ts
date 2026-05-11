import { clamp } from "@/lib/utils"
import type {
  BtcDirectionBias,
  BtcExchangeConsensusMetrics,
  BtcMomentumStatus,
  BtcObservationWindow,
  BtcRiskState,
  BtcSpreadState,
  BtcVolatilityRegime,
  BtcWindowMetrics,
  BtcMarketQualitySnapshot,
} from "@/lib/analysis/priceDecision"
import type { BtcMarketStateSnapshot } from "@/lib/analysis/marketState"
import type { BtcMarketRegimeSnapshot } from "@/lib/analysis/regimeDetection"
import type { BtcFalseBreakoutSnapshot } from "@/lib/analysis/falseBreakout"
import type { BtcSignalSuppressionSnapshot } from "@/lib/analysis/signalSuppression"
import type { BtcSocialNewsSnapshot } from "@/lib/sentiment/eventScoring"

export type BtcForecastHorizon = "15m" | "30m" | "1h"
export type BtcForecastOutlook = "bullish" | "bearish" | "neutral" | "unclear"
export type BtcForecastVolatility = "low" | "moderate" | "elevated" | "extreme"
export type BtcForecastStability = "stable" | "mixed" | "unstable"

export interface BtcHorizonForecast {
  horizon: BtcForecastHorizon
  directionalOutlook: BtcForecastOutlook
  confidence: number
  expectedVolatility: BtcForecastVolatility
  expectedStability: BtcForecastStability
  breakoutContinuationProbability: number
  reversalProbability: number
  suppressionRisk: number
  forecastQuality: number
  forecastStability: number
  mainSupportingFactors: string[]
  mainInvalidationCondition: string
  explanation: string
}

export interface BtcHorizonForecastSnapshot {
  asOfMs: number
  forecasts: Record<BtcForecastHorizon, BtcHorizonForecast>
  forecastQuality: number
  forecastStability: number
  summary: string
  warning: string | null
}

export interface BtcHorizonForecastContext {
  asOfMs: number
  directionBias: BtcDirectionBias
  marketQuality: BtcMarketQualitySnapshot
  marketState: BtcMarketStateSnapshot
  marketRegime: BtcMarketRegimeSnapshot
  signalSuppression: BtcSignalSuppressionSnapshot
  falseBreakout: BtcFalseBreakoutSnapshot
  socialNews: BtcSocialNewsSnapshot | null
  volatilityRegime: BtcVolatilityRegime
  trendPersistenceScore: number
  momentumStatus: BtcMomentumStatus
  momentumScore: number
  spreadState: BtcSpreadState
  spreadBps: number | null
  spreadDeltaPct: number | null
  tickVelocityPerMin: number | null
  rollingReturns: Record<BtcObservationWindow, number | null>
  realizedVolatility: Record<BtcObservationWindow, number | null>
  windowMetrics: BtcWindowMetrics[]
  riskState: BtcRiskState
  exchangeConsensus: BtcExchangeConsensusMetrics | null
  suddenMoveDetected: boolean
}

const HORIZON_CONFIG: Record<
  BtcForecastHorizon,
  {
    trendWeight: number
    momentumWeight: number
    regimeWeight: number
    breakoutWeight: number
    agreementWeight: number
    consistencyWeight: number
    suppressionWeight: number
    noiseWeight: number
    volatilityWeight: number
  }
> = {
  "15m": {
    trendWeight: 0.2,
    momentumWeight: 0.3,
    regimeWeight: 0.14,
    breakoutWeight: 0.2,
    agreementWeight: 0.1,
    consistencyWeight: 0.12,
    suppressionWeight: 0.22,
    noiseWeight: 0.14,
    volatilityWeight: 0.12,
  },
  "30m": {
    trendWeight: 0.28,
    momentumWeight: 0.2,
    regimeWeight: 0.22,
    breakoutWeight: 0.14,
    agreementWeight: 0.12,
    consistencyWeight: 0.12,
    suppressionWeight: 0.18,
    noiseWeight: 0.16,
    volatilityWeight: 0.12,
  },
  "1h": {
    trendWeight: 0.32,
    momentumWeight: 0.12,
    regimeWeight: 0.28,
    breakoutWeight: 0.1,
    agreementWeight: 0.14,
    consistencyWeight: 0.12,
    suppressionWeight: 0.16,
    noiseWeight: 0.18,
    volatilityWeight: 0.14,
  },
}

const FORECAST_ORDER: BtcForecastHorizon[] = ["15m", "30m", "1h"]

export function analyzeBtcHorizonForecast(
  context: BtcHorizonForecastContext,
): BtcHorizonForecastSnapshot {
  const forecasts = {
    "15m": buildHorizonForecast("15m", context),
    "30m": buildHorizonForecast("30m", context),
    "1h": buildHorizonForecast("1h", context),
  } satisfies Record<BtcForecastHorizon, BtcHorizonForecast>

  const forecastQuality =
    FORECAST_ORDER.reduce((sum, horizon) => sum + forecasts[horizon].forecastQuality, 0) /
    FORECAST_ORDER.length
  const forecastStability =
    FORECAST_ORDER.reduce((sum, horizon) => sum + forecasts[horizon].forecastStability, 0) /
    FORECAST_ORDER.length

  const warning =
    context.marketRegime.regimeConfidence < 55 ||
    context.marketRegime.regimeStabilityScore < 50 ||
    context.marketState.state === "noisy" ||
    context.marketState.state === "unstable" ||
    context.signalSuppression.level !== "none" ||
    context.marketQuality.exchangeAgreementScore < 55 ||
    context.socialNews === null ||
    !context.socialNews.available ||
    context.socialNews.eventRiskState === "unreliable/noisy"
      ? "Forecast certainty is suppressed because regime stability, market noise, exchange agreement, or social/news visibility is weak."
      : null

  return {
    asOfMs: context.asOfMs,
    forecasts,
    forecastQuality: Math.round(forecastQuality),
    forecastStability: Math.round(forecastStability),
    summary: buildForecastSummary(forecasts),
    warning,
  }
}

function buildHorizonForecast(
  horizon: BtcForecastHorizon,
  context: BtcHorizonForecastContext,
): BtcHorizonForecast {
  const config = HORIZON_CONFIG[horizon]
  const trend = normalizeScore(context.trendPersistenceScore)
  const momentum = normalizeScore(context.momentumScore)
  const agreement = normalizeScore(context.marketQuality.exchangeAgreementScore)
  const consistency = normalizeDirectionalConsistency(context.rollingReturns, context.directionBias)
  const regimeSignal = computeRegimeSignal(context, horizon)
  const breakoutSignal = computeBreakoutSignal(context, horizon)
  const volatilitySignal = computeVolatilitySignal(context, horizon)
  const suppressionPenalty = computeSuppressionPenalty(context)
  const noisePenalty = normalizeScore(context.marketQuality.noiseLevel)
  const stabilityPenalty = normalizeStabilityPenalty(context)
  const directionBiasSignal = computeScaledDirectionBiasSignal(
    context.directionBias,
    context.momentumScore,
    context.marketRegime.regimeConfidence,
  )
  const eventSignal = computeEventSignal(context.socialNews)
  const eventRiskPenalty = computeEventRiskPenalty(context.socialNews)
  const eventNoisePenalty = computeEventNoisePenalty(context.socialNews)
  const eventAvailabilityPenalty = computeEventAvailabilityPenalty(context.socialNews)

  const directionScore =
    directionBiasSignal * 0.22 +
    trend * config.trendWeight +
    momentum * config.momentumWeight +
    regimeSignal * config.regimeWeight +
    breakoutSignal * config.breakoutWeight +
    agreement * config.agreementWeight +
    consistency * config.consistencyWeight -
    suppressionPenalty * config.suppressionWeight -
    noisePenalty * config.noiseWeight -
    volatilitySignal * config.volatilityWeight -
    stabilityPenalty * 0.12 +
    eventSignal * 0.18 -
    eventRiskPenalty * 0.14 -
    eventNoisePenalty * 0.12 -
    eventAvailabilityPenalty * 0.08

  // Quality is fully earned — no base offset. Unclear markets get low quality.
  const forecastQuality = clamp(
    Math.abs(directionScore) * 35 +
      agreement * 18 +
      trend * 14 +
      consistency * 10 +
      regimeSignal * 12 -
      suppressionPenalty * 18 -
      noisePenalty * 14 -
      eventRiskPenalty * 10 -
      eventNoisePenalty * 12 -
      eventAvailabilityPenalty * 8,
    0,
    100,
  )
  const forecastStability = clamp(
    100 -
      suppressionPenalty * 30 -
      noisePenalty * 18 -
      volatilitySignal * 20 -
      stabilityPenalty * 16 -
      context.falseBreakout.falseBreakoutRisk * 0.12 -
      eventNoisePenalty * 10 -
      eventAvailabilityPenalty * 8,
    0,
    100,
  )
  const rawConfidence = clamp(
    forecastQuality * 0.5 +
      forecastStability * 0.3 +
      Math.abs(directionScore) * 18 -
      suppressionPenalty * 8 -
      eventAvailabilityPenalty * 10 -
      eventNoisePenalty * 6,
    0,
    100,
  )

  // Hard caps: suppression, regime weakness, and noisy/unstable market state each
  // independently limit how confident the forecast can be.
  const suppressionCap =
    context.signalSuppression.level === "unavailable"
      ? 20
      : context.signalSuppression.level === "suppress directional bias"
        ? 38
        : context.signalSuppression.level === "caution"
          ? 62
          : 100

  const regimeCap =
    context.marketRegime.regimeConfidence < 35
      ? 25
      : context.marketRegime.regimeConfidence < 50
        ? 42
        : context.marketRegime.regimeConfidence < 65
          ? 60
          : 100

  const marketStateCap =
    context.marketState.state === "unavailable"
      ? 20
      : context.marketState.state === "noisy" || context.marketState.state === "unstable"
        ? 40
        : 100

  // 30m and 1h require stronger confirmation before reaching high confidence.
  const horizonCap =
    horizon === "1h"
      ? 78
      : horizon === "30m"
        ? 86
        : 100

  const confidence = clamp(
    Math.min(rawConfidence, suppressionCap, regimeCap, marketStateCap, horizonCap),
    0,
    100,
  )

  const directionalOutlook = deriveOutlook(
    directionScore,
    confidence,
    suppressionPenalty,
    noisePenalty,
    context,
  )
  const expectedVolatility = deriveExpectedVolatility(context, horizon, volatilitySignal)
  const expectedStability = deriveExpectedStability(forecastStability)
  const breakoutContinuationProbability = clamp(
    40 +
      Math.max(directionScore, 0) * 24 +
      context.falseBreakout.breakoutHealthScore * 0.25 +
      trend * 10 +
      consistency * 8 -
      context.falseBreakout.falseBreakoutRisk * 0.18 -
      suppressionPenalty * 0.18 -
      eventRiskPenalty * 0.12 -
      eventNoisePenalty * 0.08 -
      eventAvailabilityPenalty * 0.08,
    0,
    100,
  )
  const reversalProbability = clamp(
    35 +
      Math.max(-directionScore, 0) * 24 +
      context.falseBreakout.falseBreakoutRisk * 0.3 +
      context.falseBreakout.exhaustionScore * 0.22 +
      suppressionPenalty * 0.14 +
      noisePenalty * 0.12 +
      volatilitySignal * 0.1 +
      eventRiskPenalty * 0.14 +
      eventNoisePenalty * 0.08 +
      eventAvailabilityPenalty * 0.08,
    0,
    100,
  )
  const suppressionRisk = clamp(
    suppressionPenalty * 0.6 +
      noisePenalty * 0.25 +
      (100 - agreement * 100) * 0.05 +
      (context.signalSuppression.level === "suppress directional bias" ? 8 : 0) +
      (context.signalSuppression.level === "unavailable" ? 14 : 0) +
      eventNoisePenalty * 22 +
      eventAvailabilityPenalty * 14,
    0,
    100,
  )

  const mainSupportingFactors = pickSupportingFactors({
    horizon,
    trend,
    momentum,
    agreement,
    consistency,
    regimeSignal,
    breakoutSignal,
    suppressionPenalty,
    noisePenalty,
    volatilitySignal,
    eventSignal,
    directionBias: context.directionBias,
    eventRiskPenalty,
    eventNoisePenalty,
    eventAvailabilityPenalty,
  })
  const mainInvalidationCondition = buildInvalidationCondition({
    horizon,
    context,
    suppressionRisk,
    volatilitySignal,
  })
  const explanation = buildForecastExplanation({
    horizon,
    directionalOutlook,
    confidence,
    expectedVolatility,
    expectedStability,
    breakoutContinuationProbability,
    reversalProbability,
    suppressionRisk,
    mainSupportingFactors,
    mainInvalidationCondition,
  })

  return {
    horizon,
    directionalOutlook,
    confidence: Math.round(confidence),
    expectedVolatility,
    expectedStability,
    breakoutContinuationProbability: Math.round(breakoutContinuationProbability),
    reversalProbability: Math.round(reversalProbability),
    suppressionRisk: Math.round(suppressionRisk),
    forecastQuality: Math.round(forecastQuality),
    forecastStability: Math.round(forecastStability),
    mainSupportingFactors,
    mainInvalidationCondition,
    explanation,
  }
}

function normalizeScore(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 0.5
  }

  return clamp(value / 100, 0, 1)
}

// Returns a scaled direction signal in [-1, 1] using momentum strength and regime confidence
// instead of a binary ±1 flip whenever directionBias changes.
function computeScaledDirectionBiasSignal(
  directionBias: BtcDirectionBias,
  momentumScore: number,
  regimeConfidence: number,
): number {
  if (directionBias === "neutral") {
    return 0
  }

  const sign = directionBias === "bullish" ? 1 : -1
  // Scale by momentum magnitude (0–1) and regime confidence (0–1), so a
  // marginal flip near the threshold contributes much less than a strong read.
  const momentumStrength = clamp(Math.abs(momentumScore) / 100, 0, 1)
  const regimeWeight = clamp(regimeConfidence / 100, 0, 1)
  return sign * clamp(momentumStrength * 0.7 + regimeWeight * 0.3, 0, 1)
}

function normalizeDirectionalConsistency(
  rollingReturns: Record<BtcObservationWindow, number | null>,
  directionBias: BtcDirectionBias,
) {
  const returns = [rollingReturns["1m"], rollingReturns["5m"], rollingReturns["15m"]].filter(
    (value): value is number => value !== null && Number.isFinite(value) && Math.abs(value) > 0.0001,
  )

  if (returns.length === 0 || directionBias === "neutral") {
    return 0.5
  }

  const biasSign = directionBias === "bullish" ? 1 : -1
  const aligned = returns.filter((value) => Math.sign(value) === biasSign).length
  return clamp(aligned / returns.length, 0, 1)
}


function computeRegimeSignal(
  context: BtcHorizonForecastContext,
  horizon: BtcForecastHorizon,
) {
  const biasSignal = context.directionBias === "bullish" ? 1 : context.directionBias === "bearish" ? -1 : 0
  const regime = context.marketRegime.primaryRegime
  let signal = 0

  if (regime === "trending up") {
    signal = biasSignal >= 0 ? 1 : -1
  } else if (regime === "trending down") {
    signal = biasSignal <= 0 ? 1 : -1
  } else if (regime === "breakout conditions") {
    signal =
      context.falseBreakout.breakoutDirection === "up"
        ? 1
        : context.falseBreakout.breakoutDirection === "down"
          ? -1
          : biasSignal
  } else if (regime === "mean-reverting") {
    signal = biasSignal === 0 ? 0.2 : -0.35 * biasSignal
  } else if (regime === "high-volatility expansion") {
    signal = biasSignal === 0 ? 0 : 0.15 * biasSignal
  } else if (regime === "low-volatility compression") {
    signal = biasSignal === 0 ? 0.2 : 0.25 * biasSignal
  } else if (regime === "exhaustion conditions") {
    signal = biasSignal === 0 ? -0.2 : -0.45 * biasSignal
  } else {
    signal = -0.45
  }

  if (context.marketRegime.isTransitioning) {
    signal *= horizon === "15m" ? 0.7 : 0.8
  }

  return clamp((signal + 1) / 2, 0, 1)
}

function computeBreakoutSignal(
  context: BtcHorizonForecastContext,
  horizon: BtcForecastHorizon,
) {
  const health = normalizeScore(context.falseBreakout.breakoutHealthScore)
  const continuation = normalizeScore(context.falseBreakout.followThroughQuality)
  const reversalRisk = normalizeScore(context.falseBreakout.falseBreakoutRisk)
  const exhaustion = normalizeScore(context.falseBreakout.exhaustionScore)
  const breakoutDirection = context.falseBreakout.breakoutDirection

  const directionSupport =
    breakoutDirection === "up" && context.directionBias !== "bearish"
      ? 1
      : breakoutDirection === "down" && context.directionBias !== "bullish"
        ? 1
        : breakoutDirection === "none"
          ? 0.45
          : 0.2

  const horizonPenalty = horizon === "1h" ? 0.85 : horizon === "30m" ? 0.95 : 1
  return clamp(
    ((health * 0.45 + continuation * 0.35 + directionSupport * 0.2) -
      (reversalRisk * 0.35 + exhaustion * 0.2)) *
      horizonPenalty,
    0,
    1,
  )
}

function computeVolatilitySignal(
  context: BtcHorizonForecastContext,
  horizon: BtcForecastHorizon,
) {
  const volatilityRegime = context.volatilityRegime
  const base =
    volatilityRegime === "extreme"
      ? 1
      : volatilityRegime === "elevated"
        ? 0.75
        : volatilityRegime === "normal"
          ? 0.5
          : 0.25

  const spread = context.spreadBps ?? 0
  const spreadSignal = clamp(spread / 12, 0, 1)
  const velocityPenalty =
    context.tickVelocityPerMin === null
      ? 0.5
      : clamp(1 - clamp(context.tickVelocityPerMin / 6, 0, 1), 0, 1)
  const horizonBoost = horizon === "1h" ? 0.95 : horizon === "30m" ? 1 : 1.05
  return clamp(base * 0.65 + spreadSignal * 0.2 * horizonBoost + velocityPenalty * 0.15, 0, 1)
}

function computeSuppressionPenalty(context: BtcHorizonForecastContext) {
  const levelPenalty =
    context.signalSuppression.level === "none"
      ? 0
      : context.signalSuppression.level === "caution"
        ? 0.35
        : context.signalSuppression.level === "suppress directional bias"
          ? 0.7
          : 1

  const qualityPenalty = 1 - normalizeScore(context.marketQuality.signalQualityScore)
  const spreadPenalty = computeSpreadDeltaPenalty(context.spreadDeltaPct)
  return clamp(levelPenalty * 0.6 + qualityPenalty * 0.25 + spreadPenalty * 0.15, 0, 1)
}

function computeEventSignal(socialNews: BtcSocialNewsSnapshot | null) {
  if (!socialNews || !socialNews.available) {
    return 0
  }

  return clamp(socialNews.pressureScore / 100, -1, 1)
}

function computeEventRiskPenalty(socialNews: BtcSocialNewsSnapshot | null) {
  if (!socialNews || !socialNews.available) {
    return 0.55
  }

  if (socialNews.eventRiskState === "active catalyst") {
    return 0.42
  }

  if (socialNews.eventRiskState === "elevated") {
    return 0.24
  }

  if (socialNews.eventRiskState === "unreliable/noisy") {
    return 0.66
  }

  return 0.08
}

function computeEventNoisePenalty(socialNews: BtcSocialNewsSnapshot | null) {
  if (!socialNews || !socialNews.available) {
    return 0.6
  }

  if (socialNews.eventRiskState === "unreliable/noisy") {
    return 0.85
  }

  if (socialNews.eventRiskState === "active catalyst") {
    return 0.22
  }

  return 0.08
}

function computeEventAvailabilityPenalty(socialNews: BtcSocialNewsSnapshot | null) {
  if (!socialNews || !socialNews.available) {
    return 1
  }

  if (socialNews.topEvents.length < 2) {
    return 0.35
  }

  return 0
}

function normalizeStabilityPenalty(context: BtcHorizonForecastContext) {
  const regimePenalty = 1 - clamp(context.marketRegime.regimeStabilityScore / 100, 0, 1)
  const marketPenalty = 1 - clamp(context.marketQuality.signalQualityScore / 100, 0, 1)
  return clamp((regimePenalty + marketPenalty) / 2, 0, 1)
}

function deriveOutlook(
  directionScore: number,
  confidence: number,
  suppressionPenalty: number,
  noisePenalty: number,
  context: BtcHorizonForecastContext,
): BtcForecastOutlook {
  if (
    suppressionPenalty >= 0.7 ||
    noisePenalty >= 0.7 ||
    context.marketRegime.regimeConfidence < 50 ||
    context.marketRegime.regimeStabilityScore < 45 ||
    context.marketState.state === "unavailable" ||
    context.riskState === "avoid"
  ) {
    return "unclear"
  }

  if (confidence < 40) {
    return "unclear"
  }

  if (directionScore >= 0.18) {
    return "bullish"
  }

  if (directionScore <= -0.18) {
    return "bearish"
  }

  return "neutral"
}

function deriveExpectedVolatility(
  context: BtcHorizonForecastContext,
  horizon: BtcForecastHorizon,
  volatilitySignal: number,
): BtcForecastVolatility {
  const horizonShift = horizon === "1h" ? -0.05 : horizon === "30m" ? 0 : 0.05
  const score = clamp(volatilitySignal + horizonShift, 0, 1)

  if (context.marketState.state === "noisy" || score >= 0.8) {
    return "extreme"
  }

  if (score >= 0.6) {
    return "elevated"
  }

  if (score >= 0.35) {
    return "moderate"
  }

  return "low"
}

function deriveExpectedStability(forecastStability: number): BtcForecastStability {
  if (forecastStability >= 66) {
    return "stable"
  }

  if (forecastStability >= 40) {
    return "mixed"
  }

  return "unstable"
}

function pickSupportingFactors({
  horizon,
  trend,
  momentum,
  agreement,
  consistency,
  regimeSignal,
  breakoutSignal,
  suppressionPenalty,
  noisePenalty,
  volatilitySignal,
  eventSignal,
  directionBias,
  eventRiskPenalty,
  eventNoisePenalty,
  eventAvailabilityPenalty,
}: {
  horizon: BtcForecastHorizon
  trend: number
  momentum: number
  agreement: number
  consistency: number
  regimeSignal: number
  breakoutSignal: number
  suppressionPenalty: number
  noisePenalty: number
  volatilitySignal: number
  eventSignal: number
  directionBias: BtcDirectionBias
  eventRiskPenalty: number
  eventNoisePenalty: number
  eventAvailabilityPenalty: number
}) {
  const eventAligned =
    (directionBias === "bullish" && eventSignal > 0) ||
    (directionBias === "bearish" && eventSignal < 0)
  const factors = [
    {
      score: trend * 24,
      label: "trend persistence remains elevated",
    },
    {
      score: momentum * 22,
      label: "momentum still aligns with the live read",
    },
    {
      score: agreement * 20,
      label: "exchange agreement remains acceptable",
    },
    {
      score: consistency * 18,
      label: "recent directional consistency is intact",
    },
    {
      score: regimeSignal * 16,
      label: horizon === "1h" ? "the higher-timeframe regime still supports the read" : "the current regime still supports the read",
    },
    {
      score: breakoutSignal * 16,
      label: "breakout structure still has follow-through support",
    },
    {
      score: 1 - suppressionPenalty,
      label: "suppression is not dominating the read",
    },
    {
      score: 1 - noisePenalty,
      label: "noise pressure is still manageable",
    },
    {
      score: 1 - volatilitySignal,
      label: "volatility is not yet overpowering the signal",
    },
    {
      score: eventAligned ? Math.abs(eventSignal) : 0,
      label:
        eventSignal > 0
          ? "social/news pressure supports bullish continuation"
          : "social/news pressure supports bearish continuation",
    },
    {
      score: 1 - eventRiskPenalty,
      label: "social/news risk is not overwhelming the forecast",
    },
    {
      score: 1 - eventNoisePenalty,
      label: "news flow is not overly noisy",
    },
    {
      score: 1 - eventAvailabilityPenalty,
      label: "event pressure is available enough to trust the read",
    },
  ]

  return factors
    .sort((left, right) => right.score - left.score)
    .filter((factor) => factor.score > 0.15)
    .slice(0, 3)
    .map((factor) => factor.label)
}

function buildInvalidationCondition({
  horizon,
  context,
  suppressionRisk,
  volatilitySignal,
}: {
  horizon: BtcForecastHorizon
  context: BtcHorizonForecastContext
  suppressionRisk: number
  volatilitySignal: number
}) {
  if (context.marketRegime.isTransitioning) {
    return "If the regime transition deepens, the forecast loses clarity."
  }

  if (context.riskState === "avoid") {
    return "If the market remains in avoid state, the forecast should be treated as unclear."
  }

  if (context.socialNews === null || !context.socialNews.available) {
    return "If event pressure stays unavailable during a volatile move, the forecast loses confidence."
  }

  if (context.socialNews.eventRiskState === "unreliable/noisy") {
    return "If social/news flow remains noisy, the forecast should be downgraded."
  }

  if (context.socialNews.eventRiskState === "active catalyst") {
    return "If the catalyst flips direction or fades, the forecast should be reassessed."
  }

  if (context.exchangeConsensus?.agreementScore !== null && context.exchangeConsensus?.agreementScore !== undefined) {
    if (context.exchangeConsensus.agreementScore < 55) {
      return "If exchange agreement drops again, the outlook loses structure."
    }
  }

  if (suppressionRisk >= 60) {
    return "If suppression rises further, directional interpretation becomes unreliable."
  }

  if (context.falseBreakout.falseBreakoutRisk >= 65) {
    return "If false-breakout risk keeps rising, follow-through likely fails."
  }

  if (volatilitySignal >= 0.75) {
    return horizon === "1h"
      ? "If volatility expansion keeps accelerating, the one-hour forecast becomes unstable."
      : "If volatility expansion keeps accelerating, the forecast loses stability."
  }

  if (context.spreadDeltaPct !== null && Math.abs(context.spreadDeltaPct) >= 20) {
    return "If spread behavior keeps widening, directional interpretation becomes less reliable."
  }

  if (context.tickVelocityPerMin !== null && context.tickVelocityPerMin < 1.5) {
    return "If tick velocity fades further, the forecast loses short-horizon structure."
  }

  if (context.marketState.state === "noisy" || context.marketState.state === "unstable") {
    return "If market noise remains elevated, the forecast should be treated as unclear."
  }

  return "If momentum decays or spread widens materially, the outlook should be downgraded."
}

function buildForecastExplanation({
  horizon,
  directionalOutlook,
  confidence,
  expectedVolatility,
  expectedStability,
  breakoutContinuationProbability,
  reversalProbability,
  suppressionRisk,
  mainSupportingFactors,
  mainInvalidationCondition,
}: {
  horizon: BtcForecastHorizon
  directionalOutlook: BtcForecastOutlook
  confidence: number
  expectedVolatility: BtcForecastVolatility
  expectedStability: BtcForecastStability
  breakoutContinuationProbability: number
  reversalProbability: number
  suppressionRisk: number
  mainSupportingFactors: string[]
  mainInvalidationCondition: string
}) {
  const supportText =
    mainSupportingFactors.length > 0
      ? mainSupportingFactors.join(", ")
      : "the signal is not strong enough to isolate supportive factors"

  return `${horizon}: ${directionalOutlook} outlook with ${Math.round(confidence)}/100 confidence. Expected volatility is ${expectedVolatility} and expected stability is ${expectedStability}. Breakout continuation sits near ${Math.round(breakoutContinuationProbability)}%, reversal risk near ${Math.round(reversalProbability)}%, and suppression risk near ${Math.round(suppressionRisk)}%. Support comes from ${supportText}. Invalidation: ${mainInvalidationCondition}`
}

function buildForecastSummary(forecasts: Record<BtcForecastHorizon, BtcHorizonForecast>) {
  const ordered = FORECAST_ORDER.map((horizon) => forecasts[horizon])
  const best = ordered.sort((left, right) => right.confidence - left.confidence)[0]
  const outlooks = new Set(ordered.map((forecast) => forecast.directionalOutlook))

  if (!best) {
    return "Forward outlook is unavailable."
  }

  if (outlooks.size === 1 && outlooks.has("unclear")) {
    return "All short-horizon forecasts are unclear, so the engine is explicitly withholding certainty."
  }

  return `The clearest short-horizon read is ${best.horizon} with a ${best.directionalOutlook} outlook and ${best.confidence}/100 confidence.`
}

function computeSpreadDeltaPenalty(spreadDeltaPct: number | null) {
  if (spreadDeltaPct === null || Number.isNaN(spreadDeltaPct)) {
    return 0.5
  }

  return clamp(Math.abs(spreadDeltaPct) / 35, 0, 1)
}
