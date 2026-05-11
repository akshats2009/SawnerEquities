import type { BtcDirectionBias } from "@/lib/analysis/priceDecision"
import type {
  BtcJournalOutcome,
  BtcJournalRow,
} from "@/lib/btc/journal-types"

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
  sampleSizeWarning: string | null
  summary: {
    hitRate: number | null
    averagePercentMove: number | null
    bullishHitRate: number | null
    bearishHitRate: number | null
  }
  buckets: ConfidenceBucketDiagnostics[]
  thresholds: ConfidenceThresholdDiagnostics[]
}

interface ConfidenceObservation {
  confidence: number
  bias: BtcDirectionBias
  percentChange: number
  directionallyCorrect: boolean
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
  const totalResolvedCount = observations.length
  const sampleSizeWarning =
    totalResolvedCount < MIN_SAMPLE_WARNING_COUNT
      ? `Sample size is small for ${selectedWindow} (${totalResolvedCount} resolved outcomes). Treat calibration and threshold results as directional only.`
      : null

  const buckets = CONFIDENCE_BUCKETS.map((bucket) =>
    buildBucketDiagnostics(
      bucket.label,
      bucket.minConfidence,
      bucket.maxConfidence,
      observations,
    ),
  )

  const thresholds = CONFIDENCE_THRESHOLDS.map((threshold) =>
    buildThresholdDiagnostics(threshold, observations),
  )

  return {
    selectedWindow,
    totalResolvedCount,
    sampleSizeWarning,
    summary: {
      hitRate: buildHitRate(observations),
      averagePercentMove: buildAveragePercentMove(observations),
      bullishHitRate: buildDirectionalHitRate(observations, "bullish"),
      bearishHitRate: buildDirectionalHitRate(observations, "bearish"),
    },
    buckets,
    thresholds,
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
        toObservation(row.confidence, row.bias, outcome),
      )
    }
  }

  return observations
}

function toObservation(
  confidence: number,
  bias: BtcDirectionBias,
  outcome: BtcJournalOutcome,
): ConfidenceObservation {
  return {
    confidence,
    bias,
    percentChange: outcome.percentChange,
    directionallyCorrect: outcome.directionallyCorrect ?? false,
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

function buildAveragePercentMove(observations: ConfidenceObservation[]) {
  if (observations.length === 0) {
    return null
  }

  return (
    observations.reduce((sum, observation) => sum + observation.percentChange, 0) /
    observations.length
  )
}
