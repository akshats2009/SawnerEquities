import { clamp } from "@/lib/utils"
import type {
  BtcDirectionBias,
  BtcExchangeConsensusMetrics,
  BtcMarketQualitySnapshot,
  BtcRiskState,
  BtcSpreadState,
} from "@/lib/analysis/priceDecision"
import type { BtcFalseBreakoutSnapshot } from "@/lib/analysis/falseBreakout"
import type { BtcMarketRegimeSnapshot } from "@/lib/analysis/regimeDetection"

export type BtcSignalSuppressionLevel =
  | "none"
  | "caution"
  | "suppress directional bias"
  | "unavailable"

export interface BtcSignalSuppressionSnapshot {
  level: BtcSignalSuppressionLevel
  reasons: string[]
  warning: string | null
  directionalReadout: string
  confidencePenalty: number
  shouldSuppressSnapshot: boolean
}

export interface BtcSignalSuppressionInput {
  directionBias: BtcDirectionBias
  marketQuality: BtcMarketQualitySnapshot
  marketRegime: BtcMarketRegimeSnapshot
  exchangeConsensus: BtcExchangeConsensusMetrics | null
  riskState: BtcRiskState
  stale: boolean
  spreadState: BtcSpreadState
  spreadBps: number | null
  spreadDeltaPct: number | null
  momentumScore: number
  priceAccelerationBpsPerMin2: number | null
  falseBreakoutAnalysis?: BtcFalseBreakoutSnapshot | null
}

export function analyzeBtcSignalSuppression(
  input: BtcSignalSuppressionInput,
): BtcSignalSuppressionSnapshot {
  const reasons: string[] = []
  let severity = 0

  const exchangeAgreement = input.exchangeConsensus?.agreementScore ?? 0
  const activeExchangeCount = input.exchangeConsensus?.activeExchangeCount ?? 0
  const staleExchangeCount = input.exchangeConsensus?.staleExchangeCount ?? 0
  const noiseLevel = input.marketQuality.noiseLevel
  const tickConsistencyScore = input.marketQuality.tickConsistencyScore
  const falseBreakoutRisk = input.falseBreakoutAnalysis?.falseBreakoutRisk ?? 0
  const breakoutStatus = input.falseBreakoutAnalysis?.breakoutStatus ?? "no breakout"

  if (staleExchangeCount > 0 || input.stale) {
    severity += 30
    reasons.push("stale feed risk")
  }

  if (exchangeAgreement < 55 || activeExchangeCount <= 1) {
    severity += 24
    reasons.push("low exchange agreement")
  }

  if (input.marketRegime.regimeConfidence < 55) {
    severity += 18
    reasons.push("low regime confidence")
  }

  if (input.marketRegime.isTransitioning || input.marketRegime.regimeClarity === "ambiguous") {
    severity += 20
    reasons.push("unstable regime transition")
  }

  if (noiseLevel >= 55) {
    severity += 18
    reasons.push("high noise level")
  }

  if (
    hasContradiction(input.directionBias, input.momentumScore, input.priceAccelerationBpsPerMin2)
  ) {
    severity += 15
    reasons.push("contradictory momentum/acceleration")
  }

  if (input.spreadState === "expanding" || (input.spreadBps ?? 0) >= 8 || Math.abs(input.spreadDeltaPct ?? 0) >= 20) {
    severity += 14
    reasons.push("spread instability")
  }

  if (tickConsistencyScore < 42) {
    severity += 16
    reasons.push("low tick consistency")
  }

  if (falseBreakoutRisk >= 65 || breakoutStatus === "false breakout risk") {
    severity += 18
    reasons.push("breakout failure risk")
  }

  if (breakoutStatus === "ambiguous") {
    severity += 10
    reasons.push("ambiguous breakout conditions")
  }

  if (input.riskState === "avoid") {
    severity += 12
  }

  const level = deriveSuppressionLevel(severity, input.marketRegime, exchangeAgreement)
  const directionalReadout = deriveDirectionalReadout(
    input.directionBias,
    level,
    input.marketQuality.directionalReadout,
  )
  const confidencePenalty = deriveConfidencePenalty(level, severity)
  const warning =
    level === "none"
      ? null
      : level === "caution"
        ? `Directional pressure is muted because ${summarizeReasons(reasons)}.`
        : level === "suppress directional bias"
          ? `Directional bias is suppressed because ${summarizeReasons(reasons)}.`
          : "Directional signal unavailable under current market conditions."

  return {
    level,
    reasons: uniqueReasons(reasons),
    warning,
    directionalReadout,
    confidencePenalty,
    shouldSuppressSnapshot: level === "suppress directional bias" || level === "unavailable",
  }
}

function deriveSuppressionLevel(
  severity: number,
  regime: BtcMarketRegimeSnapshot,
  exchangeAgreement: number,
): BtcSignalSuppressionLevel {
  if (
    regime.regimeConfidence < 30 ||
    exchangeAgreement < 25 ||
    (regime.regimeClarity === "ambiguous" && severity >= 35) ||
    severity >= 72
  ) {
    return "unavailable"
  }

  if (severity >= 45) {
    return "suppress directional bias"
  }

  if (severity >= 18) {
    return "caution"
  }

  return "none"
}

function deriveDirectionalReadout(
  directionBias: BtcDirectionBias,
  level: BtcSignalSuppressionLevel,
  baseReadout: string,
) {
  if (level === "unavailable") {
    return "unavailable"
  }

  if (level === "suppress directional bias") {
    return directionBias === "neutral"
      ? "unclear"
      : baseReadout === "unclear"
        ? "directional bias suppressed"
        : `suppressed ${baseReadout}`
  }

  if (level === "caution") {
    if (directionBias === "neutral") {
      return "unclear"
    }

    return `muted ${baseReadout}`
  }

  return baseReadout
}

function deriveConfidencePenalty(level: BtcSignalSuppressionLevel, severity: number) {
  if (level === "unavailable") {
    return 30
  }

  if (level === "suppress directional bias") {
    return 18
  }

  if (level === "caution") {
    return Math.round(clamp(severity * 0.35, 8, 12))
  }

  return 0
}

function summarizeReasons(reasons: string[]) {
  if (reasons.length === 0) {
    return "the current market state is not supportive of directional inference"
  }

  if (reasons.length === 1) {
    return reasons[0]
  }

  if (reasons.length === 2) {
    return `${reasons[0]} and ${reasons[1]}`
  }

  return `${reasons.slice(0, 2).join(", ")} and ${reasons.length - 2} other factor${reasons.length - 2 === 1 ? "" : "s"}`
}

function uniqueReasons(reasons: string[]) {
  return Array.from(new Set(reasons))
}

function hasContradiction(
  directionBias: BtcDirectionBias,
  momentumScore: number,
  acceleration: number | null,
) {
  if (directionBias === "neutral" || acceleration === null) {
    return false
  }

  const accelSign = Math.sign(acceleration)
  const momentumSign = Math.sign(momentumScore)

  if (accelSign === 0 || momentumSign === 0) {
    return false
  }

  return accelSign !== momentumSign
}
