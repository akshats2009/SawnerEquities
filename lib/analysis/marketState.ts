import { clamp } from "@/lib/utils"
import type {
  BtcExchangeConsensusMetrics,
  BtcMarketQualitySnapshot,
} from "@/lib/analysis/priceDecision"
import type { BtcFalseBreakoutSnapshot } from "@/lib/analysis/falseBreakout"
import type { BtcMarketRegimeSnapshot } from "@/lib/analysis/regimeDetection"
import type { BtcSignalSuppressionSnapshot } from "@/lib/analysis/signalSuppression"
import type { BtcSocialNewsSnapshot } from "@/lib/sentiment/eventScoring"

export type BtcMarketStateLabel =
  | "clean"
  | "mixed"
  | "noisy"
  | "unstable"
  | "unavailable"

export type BtcMarketInterpretability = "high" | "medium" | "low"

export interface BtcMarketStateSnapshot {
  state: BtcMarketStateLabel
  interpretability: BtcMarketInterpretability
  signalInterpretabilityScore: number
  informationQualityScore: number
  liquidityQualityScore: number
  adverseSelectionRiskScore: number
  exchangeConsensusScore: number
  volatilityStabilityScore: number
  trendPersistenceScore: number
  chopNoiseRiskScore: number
  breakoutHealthScore: number
  eventPressureScore: number
  eventRiskState: BtcSocialNewsSnapshot["eventRiskState"]
  socialNewsAvailable: boolean
  mainRisk: string
  primaryReason: string
  warning: string | null
}

export interface BtcMarketStateInput {
  stale: boolean
  marketQuality: BtcMarketQualitySnapshot
  marketRegime: BtcMarketRegimeSnapshot
  signalSuppression: BtcSignalSuppressionSnapshot
  falseBreakout: BtcFalseBreakoutSnapshot
  exchangeConsensus: BtcExchangeConsensusMetrics | null
  socialNews: BtcSocialNewsSnapshot | null
}

export function analyzeBtcMarketState(
  input: BtcMarketStateInput,
): BtcMarketStateSnapshot {
  const exchangeConsensusScore = input.exchangeConsensus?.agreementScore ?? 0
  const activeExchangeCount = input.exchangeConsensus?.activeExchangeCount ?? 0
  const staleExchangeCount = input.exchangeConsensus?.staleExchangeCount ?? 0
  const socialNews = input.socialNews
  const socialNewsAvailable = socialNews?.available ?? false
  const eventPressureScore = socialNews?.pressureScore ?? 0
  const eventRiskState = socialNews?.eventRiskState ?? "unreliable/noisy"
  const informationQualityScore = Math.round(
    clamp(
      input.marketQuality.signalQualityScore * 0.42 +
        input.marketQuality.tickConsistencyScore * 0.18 +
        exchangeConsensusScore * 0.18 +
        socialNewsInfoBonus(socialNews) +
        input.marketRegime.regimeConfidence * 0.12 +
        input.marketRegime.regimeStabilityScore * 0.1 -
        stalePenalty(input.stale, staleExchangeCount),
      0,
      100,
    ),
  )
  const liquidityQualityScore = Math.round(
    clamp(
      spreadQuality(input.marketQuality) * 0.42 +
        exchangeConsensusScore * 0.22 +
        input.marketRegime.regimeStabilityScore * 0.12 +
        input.falseBreakout.followThroughQuality * 0.08 +
        input.falseBreakout.breakoutHealthScore * 0.08 +
        (activeExchangeCount / 3) * 0.18,
      0,
      100,
    ),
  )
  const adverseSelectionRiskScore = Math.round(
    clamp(
      input.falseBreakout.falseBreakoutRisk * 0.34 +
        input.marketQuality.noiseLevel * 0.18 +
        spreadInstabilityScore(input.marketQuality) * 0.2 +
        regimeInstabilityScore(input.marketRegime) * 0.18 +
        disagreementRisk(exchangeConsensusScore, activeExchangeCount) * 0.16 +
        socialNewsRiskPenalty(
          socialNews,
          input.marketQuality.noiseLevel,
          input.marketRegime.isTransitioning,
        ) +
        stalePenalty(input.stale, staleExchangeCount),
      0,
      100,
    ),
  )
  const volatilityStabilityScore = Math.round(
    clamp(
      input.marketQuality.stabilityAssessment === "stable"
        ? 84
        : input.marketQuality.stabilityAssessment === "mixed"
          ? 58
          : 28,
      0,
      100,
    ) *
      0.54 +
      clamp(input.marketRegime.regimeStabilityScore, 0, 100) * 0.46,
  )
  const trendPersistenceScore = clamp(
    input.marketQuality.tickConsistencyScore * 0.45 +
      input.marketRegime.regimeStabilityScore * 0.35 +
      (input.marketRegime.primaryRegime === "trending up" ||
      input.marketRegime.primaryRegime === "trending down"
        ? 18
        : 0),
    0,
    100,
  )
  const chopNoiseRiskScore = Math.round(
    clamp(
      input.marketQuality.noiseLevel * 0.34 +
        (input.marketRegime.primaryRegime === "choppy / noisy" ? 28 : 0) +
        (input.marketRegime.regimeClarity === "ambiguous" ? 12 : 0) +
        (socialNews?.eventRiskState === "unreliable/noisy" ? 10 : 0) +
        input.signalSuppression.reasons.length * 4 +
        (input.marketRegime.isTransitioning ? 8 : 0),
      0,
      100,
    ),
  )
  const breakoutHealthScore = input.falseBreakout.breakoutHealthScore

  const signalInterpretabilityScore = Math.round(
    clamp(
      informationQualityScore * 0.28 +
        liquidityQualityScore * 0.2 +
        volatilityStabilityScore * 0.16 +
        trendPersistenceScore * 0.12 +
        breakoutHealthScore * 0.12 -
        adverseSelectionRiskScore * 0.12 -
        chopNoiseRiskScore * 0.1,
      0,
      100,
    ),
  )

  const state = classifyMarketState({
    stale: input.stale,
    activeExchangeCount,
    exchangeConsensusScore,
    signalInterpretabilityScore,
    adverseSelectionRiskScore,
    chopNoiseRiskScore,
    marketRegime: input.marketRegime,
    falseBreakout: input.falseBreakout,
  })
  const interpretability = classifyInterpretability(
    signalInterpretabilityScore,
    state,
  )
  const mainRisk = deriveMainRisk({
    stale: input.stale,
    activeExchangeCount,
    exchangeConsensusScore,
    marketRegime: input.marketRegime,
    falseBreakout: input.falseBreakout,
    chopNoiseRiskScore,
    socialNews,
    marketQualityNoiseLevel: input.marketQuality.noiseLevel,
  })
  const primaryReason = buildPrimaryReason({
    state,
    interpretability,
    signalInterpretabilityScore,
    mainRisk,
    socialNews,
  })
  const warning =
    state === "unavailable"
      ? "BTC market state is unavailable because the consolidated feed is stale or missing."
      : socialNews?.eventRiskState === "active catalyst"
        ? "A market-moving social/news catalyst is active. Interpret short-horizon BTC moves with extra caution."
        : state === "unstable" || interpretability === "low"
        ? "Conditions currently unsuitable for high-confidence directional interpretation."
        : null

  return {
    state,
    interpretability,
    signalInterpretabilityScore,
    informationQualityScore,
    liquidityQualityScore,
    adverseSelectionRiskScore,
    exchangeConsensusScore,
    volatilityStabilityScore: Math.round(volatilityStabilityScore),
    trendPersistenceScore: Math.round(clamp(trendPersistenceScore, 0, 100)),
    chopNoiseRiskScore,
    breakoutHealthScore,
    eventPressureScore,
    eventRiskState,
    socialNewsAvailable,
    mainRisk,
    primaryReason,
    warning,
  }
}

function stalePenalty(stale: boolean, staleExchangeCount: number) {
  return stale ? 18 + staleExchangeCount * 4 : staleExchangeCount * 3
}

function spreadQuality(marketQuality: BtcMarketQualitySnapshot) {
  return clamp(marketQuality.stabilityAssessment === "stable" ? 88 : marketQuality.stabilityAssessment === "mixed" ? 62 : 28, 0, 100)
}

function socialNewsInfoBonus(socialNews: BtcSocialNewsSnapshot | null) {
  if (!socialNews || !socialNews.available) {
    return 0
  }

  if (socialNews.eventRiskState === "active catalyst") {
    return 12
  }

  if (socialNews.eventRiskState === "elevated") {
    return 8
  }

  return 4
}

function socialNewsRiskPenalty(
  socialNews: BtcSocialNewsSnapshot | null,
  marketQualityNoiseLevel: number,
  isTransitioning: boolean,
) {
  if (!socialNews) {
    return marketQualityNoiseLevel >= 55 || isTransitioning ? 6 : 0
  }

  if (!socialNews.available) {
    return marketQualityNoiseLevel >= 55 || isTransitioning ? 12 : 0
  }

  if (socialNews.eventRiskState === "unreliable/noisy") {
    return 18
  }

  if (socialNews.eventRiskState === "active catalyst") {
    return 8
  }

  return 0
}

function spreadInstabilityScore(marketQuality: BtcMarketQualitySnapshot) {
  return clamp(100 - spreadQuality(marketQuality), 0, 100)
}

function regimeInstabilityScore(marketRegime: BtcMarketRegimeSnapshot) {
  return clamp(
    marketRegime.regimeClarity === "ambiguous"
      ? 82
      : marketRegime.isTransitioning
        ? 64
        : marketRegime.regimeConfidence < 55
          ? 48
          : 20,
    0,
    100,
  )
}

function disagreementRisk(
  exchangeConsensusScore: number,
  activeExchangeCount: number,
) {
  const agreementPenalty = 100 - clamp(exchangeConsensusScore, 0, 100)
  const coveragePenalty = activeExchangeCount <= 1 ? 42 : activeExchangeCount === 2 ? 18 : 0
  return clamp(agreementPenalty * 0.6 + coveragePenalty, 0, 100)
}

function classifyMarketState({
  stale,
  activeExchangeCount,
  exchangeConsensusScore,
  signalInterpretabilityScore,
  adverseSelectionRiskScore,
  chopNoiseRiskScore,
  marketRegime,
  falseBreakout,
}: {
  stale: boolean
  activeExchangeCount: number
  exchangeConsensusScore: number
  signalInterpretabilityScore: number
  adverseSelectionRiskScore: number
  chopNoiseRiskScore: number
  marketRegime: BtcMarketRegimeSnapshot
  falseBreakout: BtcFalseBreakoutSnapshot
}): BtcMarketStateLabel {
  if (stale || activeExchangeCount === 0 || exchangeConsensusScore <= 10) {
    return "unavailable"
  }

  if (
    marketRegime.isTransitioning ||
    marketRegime.regimeClarity === "ambiguous" ||
    adverseSelectionRiskScore >= 70
  ) {
    return "unstable"
  }

  if (
    chopNoiseRiskScore >= 65 ||
    signalInterpretabilityScore < 45 ||
    falseBreakout.falseBreakoutRisk >= 65 ||
    marketRegime.primaryRegime === "choppy / noisy"
  ) {
    return "noisy"
  }

  if (signalInterpretabilityScore >= 72 && adverseSelectionRiskScore < 35) {
    return "clean"
  }

  return "mixed"
}

function classifyInterpretability(
  signalInterpretabilityScore: number,
  state: BtcMarketStateLabel,
): BtcMarketInterpretability {
  if (state === "unavailable" || state === "unstable" || signalInterpretabilityScore < 45) {
    return "low"
  }

  if (signalInterpretabilityScore >= 72 && state === "clean") {
    return "high"
  }

  return "medium"
}

function deriveMainRisk({
  stale,
  activeExchangeCount,
  exchangeConsensusScore,
  marketRegime,
  falseBreakout,
  chopNoiseRiskScore,
  socialNews,
  marketQualityNoiseLevel,
}: {
  stale: boolean
  activeExchangeCount: number
  exchangeConsensusScore: number
  marketRegime: BtcMarketRegimeSnapshot
  falseBreakout: BtcFalseBreakoutSnapshot
  chopNoiseRiskScore: number
  socialNews: BtcSocialNewsSnapshot | null
  marketQualityNoiseLevel: number
}) {
  if (socialNews?.eventRiskState === "active catalyst") {
    return "social/news catalyst"
  }

  if (
    (!socialNews || !socialNews.available) &&
    (marketQualityNoiseLevel >= 55 || marketRegime.isTransitioning)
  ) {
    return "news visibility gap"
  }

  if (socialNews?.eventRiskState === "unreliable/noisy") {
    return "news noise"
  }

  if (stale) {
    return "stale data"
  }

  if (activeExchangeCount <= 1 || exchangeConsensusScore < 55) {
    return "exchange disagreement"
  }

  if (marketRegime.isTransitioning || marketRegime.regimeClarity === "ambiguous") {
    return "regime transition"
  }

  if (falseBreakout.falseBreakoutRisk >= 65) {
    return "breakout failure risk"
  }

  if (chopNoiseRiskScore >= 55) {
    return "high noise"
  }

  return "spread instability"
}

function buildPrimaryReason({
  state,
  interpretability,
  signalInterpretabilityScore,
  mainRisk,
  socialNews,
}: {
  state: BtcMarketStateLabel
  interpretability: BtcMarketInterpretability
  signalInterpretabilityScore: number
  mainRisk: string
  socialNews: BtcSocialNewsSnapshot | null
}) {
  if (state === "unavailable") {
    return "The consolidated BTC feed is stale or unavailable, so the market state cannot be trusted."
  }

  if (state === "unstable") {
    return `BTC is in a transition-heavy state with ${mainRisk} and limited directional certainty.`
  }

  if (state === "noisy") {
    return `BTC is hard to interpret because ${mainRisk} is dominating the short-window read.`
  }

  if (state === "clean") {
    if (socialNews?.eventRiskState === "active catalyst") {
      return `BTC is readable on price structure, but a social/news catalyst is active and may change the short-horizon read quickly.`
    }

    return `BTC is readable because exchange agreement, spread behavior, and regime stability are aligned.`
  }

  if (socialNews?.eventRiskState === "active catalyst") {
    return `BTC is partially readable, but a social/news catalyst is active and keeps interpretability at ${interpretability} (${signalInterpretabilityScore}/100).`
  }

  return `BTC is partially readable, but ${mainRisk} keeps interpretability at ${interpretability} (${signalInterpretabilityScore}/100).`
}
