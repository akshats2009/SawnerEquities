import type { BtcDirectionBias } from "@/lib/analysis/priceDecision"
import type {
  BtcJournalOutcome,
  BtcJournalRow,
} from "@/lib/btc/journal-types"
import type { BtcSignalSuppressionLevel } from "@/lib/analysis/signalSuppression"
import type {
  BtcMarketInterpretability,
  BtcMarketStateLabel,
} from "@/lib/analysis/marketState"
import type { BtcEventRiskState } from "@/lib/sentiment/eventScoring"

export type ConfidenceBucketLabel =
  | "0-40%"
  | "40-55%"
  | "55-70%"
  | "70-85%"
  | "85-100%"

export type ConfidenceReliabilityWindow = "all" | "1m" | "5m" | "15m" | "1h"

export interface ConfidenceBucketDiagnostics {
  label: ConfidenceBucketLabel
  minConfidence: number
  maxConfidence: number
  resolvedCount: number
  hitRate: number | null
  averagePercentMove: number | null
  bullishHitRate: number | null
  bearishHitRate: number | null
}

export interface ConfidenceThresholdDiagnostics {
  threshold: number
  resolvedCount: number
  hitRate: number | null
}

export interface ConfidenceReliabilityDiagnostics {
  selectedWindow: ConfidenceReliabilityWindow
  totalResolvedCount: number
  qualifiedResolvedCount: number
  regimeQualifiedResolvedCount: number
  marketStateQualifiedResolvedCount: number
  suppressionQualifiedResolvedCount: number
  excludedLowQualityCount: number
  excludedLowRegimeCount: number
  excludedLowStateCount: number
  excludedSuppressedCount: number
  socialNewsQualifiedResolvedCount: number
  excludedSocialNewsNoisyCount: number
  forecastQualityAverage: number | null
  forecastStabilityAverage: number | null
  sampleSizeWarning: string | null
  summary: {
    hitRate: number | null
    averagePercentMove: number | null
    bullishHitRate: number | null
    bearishHitRate: number | null
  }
  buckets: ConfidenceBucketDiagnostics[]
  thresholds: ConfidenceThresholdDiagnostics[]
  breakout: BreakoutReliabilityDiagnostics
}

export interface BreakoutReliabilityDiagnostics {
  breakoutResolvedCount: number
  breakoutHitRate: number | null
  nonBreakoutResolvedCount: number
  nonBreakoutHitRate: number | null
  falseBreakoutWarningCount: number
  falseBreakoutWarningReversalRate: number | null
  repeatedFakeoutCount: number
}

interface ConfidenceObservation {
  confidence: number
  bias: BtcDirectionBias
  percentChange: number
  directionallyCorrect: boolean
  signalQualityScore: number
  regimeConfidenceScore: number
  regimeStabilityScore: number
  marketStateInterpretabilityScore: number
  marketStateLabel: BtcMarketStateLabel
  marketStateInterpretability: BtcMarketInterpretability
  suppressionLevel: BtcSignalSuppressionLevel
  breakoutDirection: "up" | "down" | "none"
  breakoutStatus: string
  falseBreakoutRisk: number
  socialNewsRiskState: BtcEventRiskState
  socialNewsPressureScore: number
  socialNewsAvailable: boolean
}

interface ForecastObservation {
  forecastQuality: number
  forecastStability: number
}

const CONFIDENCE_BUCKETS: Array<{
  label: ConfidenceBucketLabel
  minConfidence: number
  maxConfidence: number
}> = [
  { label: "0-40%", minConfidence: 0, maxConfidence: 40 },
  { label: "40-55%", minConfidence: 40, maxConfidence: 55 },
  { label: "55-70%", minConfidence: 55, maxConfidence: 70 },
  { label: "70-85%", minConfidence: 70, maxConfidence: 85 },
  { label: "85-100%", minConfidence: 85, maxConfidence: 101 },
]

const CONFIDENCE_THRESHOLDS = [55, 65, 75, 85]
const MIN_SAMPLE_WARNING_COUNT = 24
const WINDOW_ORDER: Exclude<ConfidenceReliabilityWindow, "all">[] = [
  "1m",
  "5m",
  "15m",
  "1h",
]

export function buildConfidenceReliabilityDiagnostics(
  signalPerformance: BtcJournalRow[],
  selectedWindow: ConfidenceReliabilityWindow,
): ConfidenceReliabilityDiagnostics {
  const observations = flattenResolvedObservations(signalPerformance, selectedWindow)
  const forecastObservations = flattenForecastObservations(signalPerformance, selectedWindow)
  const totalResolvedCount = observations.length
  const qualifiedObservations = observations.filter(
    (observation) => observation.signalQualityScore >= 55,
  )
  const regimeQualifiedObservations = observations.filter(
    (observation) =>
      observation.regimeConfidenceScore >= 55 &&
      observation.regimeStabilityScore >= 45,
  )
  const marketStateQualifiedObservations = observations.filter(
    (observation) =>
      observation.marketStateLabel !== "unavailable" &&
      observation.marketStateInterpretabilityScore >= 55,
  )
  const socialNewsQualifiedObservations = observations.filter(
    (observation) =>
      observation.socialNewsAvailable &&
      observation.socialNewsRiskState !== "unreliable/noisy",
  )
  const suppressionQualifiedObservations = observations.filter(
    (observation) =>
      observation.suppressionLevel === "none" ||
      observation.suppressionLevel === "caution",
  )
  const effectiveObservations =
    suppressionQualifiedObservations.length > 0
      ? suppressionQualifiedObservations
      : regimeQualifiedObservations.length > 0
      ? regimeQualifiedObservations
      : marketStateQualifiedObservations.length > 0
      ? marketStateQualifiedObservations
      : qualifiedObservations.length > 0
        ? qualifiedObservations
        : observations
  const qualifiedResolvedCount = qualifiedObservations.length
  const regimeQualifiedResolvedCount = regimeQualifiedObservations.length
  const marketStateQualifiedResolvedCount = marketStateQualifiedObservations.length
  const suppressionQualifiedResolvedCount = suppressionQualifiedObservations.length
  const socialNewsQualifiedResolvedCount = socialNewsQualifiedObservations.length
  const excludedLowQualityCount = totalResolvedCount - qualifiedResolvedCount
  const excludedLowRegimeCount = totalResolvedCount - regimeQualifiedResolvedCount
  const excludedLowStateCount = totalResolvedCount - marketStateQualifiedResolvedCount
  const excludedSuppressedCount = totalResolvedCount - suppressionQualifiedResolvedCount
  const excludedSocialNewsNoisyCount = totalResolvedCount - socialNewsQualifiedResolvedCount
  const forecastQualityAverage = buildAverageForecastQuality(forecastObservations)
  const forecastStabilityAverage = buildAverageForecastStability(forecastObservations)
  const sampleSizeWarning =
    marketStateQualifiedResolvedCount < MIN_SAMPLE_WARNING_COUNT ||
    socialNewsQualifiedResolvedCount < MIN_SAMPLE_WARNING_COUNT
      ? `Sample size is small for ${selectedWindow} (${marketStateQualifiedResolvedCount} market-state-qualified, ${socialNewsQualifiedResolvedCount} social/news-qualified, ${suppressionQualifiedResolvedCount} suppression-qualified, ${regimeQualifiedResolvedCount} regime-qualified, ${qualifiedResolvedCount} signal-quality-qualified). Treat calibration and threshold results as directional only.`
      : null

  const buckets = CONFIDENCE_BUCKETS.map((bucket) =>
    buildBucketDiagnostics(
      bucket.label,
      bucket.minConfidence,
      bucket.maxConfidence,
      effectiveObservations,
    ),
  )

  const thresholds = CONFIDENCE_THRESHOLDS.map((threshold) =>
    buildThresholdDiagnostics(threshold, effectiveObservations),
  )
  const breakout = buildBreakoutReliabilityDiagnostics(observations)

  return {
    selectedWindow,
    totalResolvedCount,
    qualifiedResolvedCount,
    regimeQualifiedResolvedCount,
    marketStateQualifiedResolvedCount,
    suppressionQualifiedResolvedCount,
    socialNewsQualifiedResolvedCount,
    excludedLowQualityCount,
    excludedLowRegimeCount,
    excludedLowStateCount,
    excludedSuppressedCount,
    excludedSocialNewsNoisyCount,
    forecastQualityAverage,
    forecastStabilityAverage,
    sampleSizeWarning,
    summary: {
      hitRate: buildHitRate(effectiveObservations),
      averagePercentMove: buildAveragePercentMove(effectiveObservations),
      bullishHitRate: buildDirectionalHitRate(effectiveObservations, "bullish"),
      bearishHitRate: buildDirectionalHitRate(effectiveObservations, "bearish"),
    },
    buckets,
    thresholds,
    breakout,
  }
}

function flattenResolvedObservations(
  signalPerformance: BtcJournalRow[],
  selectedWindow: ConfidenceReliabilityWindow,
): ConfidenceObservation[] {
  const observations: ConfidenceObservation[] = []
  const windows = selectedWindow === "all" ? WINDOW_ORDER : [selectedWindow]

  for (const row of signalPerformance) {
    for (const window of windows) {
      const outcome = row.outcomes[window]
      if (!outcome || !outcome.resolved || outcome.directionallyCorrect === null) {
        continue
      }

      observations.push(
        toObservation(
          row.confidence,
          row.bias,
          outcome,
          row.marketQuality?.signalQualityScore ?? row.confidence,
          row.marketRegime?.regimeConfidence ?? row.confidence,
          row.marketRegime?.regimeStabilityScore ?? row.confidence,
          row.marketState?.signalInterpretabilityScore ?? row.marketQuality?.signalQualityScore ?? row.confidence,
          row.marketState?.state ?? "mixed",
          row.marketState?.interpretability ?? "medium",
          row.signalSuppression?.level ?? "none",
          row.falseBreakout?.breakoutDirection ?? "none",
          row.falseBreakout?.breakoutStatus ?? "no breakout",
          row.falseBreakout?.falseBreakoutRisk ?? 0,
          row.socialNews?.eventRiskState ?? "unreliable/noisy",
          row.socialNews?.pressureScore ?? 0,
          row.socialNews?.available ?? false,
        ),
      )
    }
  }

  return observations
}

function flattenForecastObservations(
  signalPerformance: BtcJournalRow[],
  selectedWindow: ConfidenceReliabilityWindow,
): ForecastObservation[] {
  const observations: ForecastObservation[] = []

  for (const row of signalPerformance) {
    if (selectedWindow !== "all" && !row.outcomes[selectedWindow].resolved) {
      continue
    }

    if (!row.horizonForecast) {
      continue
    }

    for (const horizon of ["15m", "30m", "1h"] as const) {
      const forecast = row.horizonForecast.forecasts[horizon]
      observations.push({
        forecastQuality: forecast.forecastQuality,
        forecastStability: forecast.forecastStability,
      })
    }
  }

  return observations
}

function toObservation(
  confidence: number,
  bias: BtcDirectionBias,
  outcome: BtcJournalOutcome,
  signalQualityScore: number,
  regimeConfidenceScore: number,
  regimeStabilityScore: number,
  marketStateInterpretabilityScore: number,
  marketStateLabel: BtcMarketStateLabel,
  marketStateInterpretability: BtcMarketInterpretability,
  suppressionLevel: BtcSignalSuppressionLevel,
  breakoutDirection: "up" | "down" | "none",
  breakoutStatus: string,
  falseBreakoutRisk: number,
  socialNewsRiskState: BtcEventRiskState,
  socialNewsPressureScore: number,
  socialNewsAvailable: boolean,
): ConfidenceObservation {
  return {
    confidence,
    bias,
    percentChange: outcome.percentChange,
    directionallyCorrect: outcome.directionallyCorrect ?? false,
    signalQualityScore,
    regimeConfidenceScore,
    regimeStabilityScore,
    marketStateInterpretabilityScore,
    marketStateLabel,
    marketStateInterpretability,
    suppressionLevel,
    breakoutDirection,
    breakoutStatus,
    falseBreakoutRisk,
    socialNewsRiskState,
    socialNewsPressureScore,
    socialNewsAvailable,
  }
}

function buildBucketDiagnostics(
  label: ConfidenceBucketLabel,
  minConfidence: number,
  maxConfidence: number,
  observations: ConfidenceObservation[],
): ConfidenceBucketDiagnostics {
  const bucketObservations = observations.filter(
    (observation) =>
      observation.confidence >= minConfidence &&
      observation.confidence < maxConfidence,
  )

  return {
    label,
    minConfidence,
    maxConfidence,
    resolvedCount: bucketObservations.length,
    hitRate: buildHitRate(bucketObservations),
    averagePercentMove: buildAveragePercentMove(bucketObservations),
    bullishHitRate: buildDirectionalHitRate(bucketObservations, "bullish"),
    bearishHitRate: buildDirectionalHitRate(bucketObservations, "bearish"),
  }
}

function buildThresholdDiagnostics(
  threshold: number,
  observations: ConfidenceObservation[],
): ConfidenceThresholdDiagnostics {
  const filtered = observations.filter((observation) => observation.confidence >= threshold)

  return {
    threshold,
    resolvedCount: filtered.length,
    hitRate: buildHitRate(filtered),
  }
}

function buildBreakoutReliabilityDiagnostics(
  observations: ConfidenceObservation[],
): BreakoutReliabilityDiagnostics {
  const breakoutObservations = observations.filter(
    (observation) => observation.breakoutDirection !== "none",
  )
  const nonBreakoutObservations = observations.filter(
    (observation) => observation.breakoutDirection === "none",
  )
  const falseBreakoutWarningObservations = breakoutObservations.filter(
    (observation) =>
      observation.falseBreakoutRisk >= 70 ||
      observation.breakoutStatus === "false breakout risk",
  )

  return {
    breakoutResolvedCount: breakoutObservations.length,
    breakoutHitRate: buildHitRate(breakoutObservations),
    nonBreakoutResolvedCount: nonBreakoutObservations.length,
    nonBreakoutHitRate: buildHitRate(nonBreakoutObservations),
    falseBreakoutWarningCount: falseBreakoutWarningObservations.length,
    falseBreakoutWarningReversalRate: buildFalseBreakoutWarningReversalRate(
      falseBreakoutWarningObservations,
    ),
    repeatedFakeoutCount: Math.max(0, falseBreakoutWarningObservations.length - 1),
  }
}

function buildHitRate(observations: ConfidenceObservation[]) {
  if (observations.length === 0) {
    return null
  }

  const correct = observations.filter((observation) => observation.directionallyCorrect)
    .length
  return correct / observations.length
}

function buildDirectionalHitRate(
  observations: ConfidenceObservation[],
  bias: BtcDirectionBias,
) {
  const filtered = observations.filter((observation) => observation.bias === bias)
  if (filtered.length === 0) {
    return null
  }

  const correct = filtered.filter((observation) => observation.directionallyCorrect)
    .length
  return correct / filtered.length
}

function buildFalseBreakoutWarningReversalRate(
  observations: ConfidenceObservation[],
) {
  if (observations.length === 0) {
    return null
  }

  const reversals = observations.filter((observation) =>
    didReverseBreakout(observation.breakoutDirection, observation.percentChange),
  ).length

  return reversals / observations.length
}

function didReverseBreakout(
  breakoutDirection: "up" | "down" | "none",
  percentChange: number,
) {
  if (breakoutDirection === "none" || percentChange === 0) {
    return false
  }

  return breakoutDirection === "up" ? percentChange < 0 : percentChange > 0
}

function buildAveragePercentMove(observations: ConfidenceObservation[]) {
  if (observations.length === 0) {
    return null
  }

  return (
    observations.reduce((sum, observation) => sum + observation.percentChange, 0) /
    observations.length
  )
}

function buildAverageForecastQuality(observations: ForecastObservation[]) {
  if (observations.length === 0) {
    return null
  }

  return (
    observations.reduce((sum, observation) => sum + observation.forecastQuality, 0) /
    observations.length
  )
}

function buildAverageForecastStability(observations: ForecastObservation[]) {
  if (observations.length === 0) {
    return null
  }

  return (
    observations.reduce((sum, observation) => sum + observation.forecastStability, 0) /
    observations.length
  )
}
