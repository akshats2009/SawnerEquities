import { clamp } from "@/lib/utils"
import type {
  BtcExchangeConsensusMetrics,
  BtcMomentumStatus,
  BtcRiskState,
  BtcSpreadState,
  BtcVolatilityRegime,
} from "@/lib/analysis/priceDecision"
import type { BtcMarketRegimeSnapshot } from "@/lib/analysis/regimeDetection"
import type { RealtimeBtcTick } from "@/lib/btc/realtime"

export type BtcBreakoutDirection = "up" | "down" | "none"
export type BtcBreakoutStatus =
  | "no breakout"
  | "breakout attempt"
  | "breakout developing"
  | "false breakout risk"
  | "ambiguous"
  | "confirmed breakout"

export interface BtcFalseBreakoutSnapshot {
  breakoutDirection: BtcBreakoutDirection
  breakoutStatus: BtcBreakoutStatus
  breakoutConfidence: number
  falseBreakoutRisk: number
  followThroughQuality: number
  breakoutHealthScore: number
  exhaustionScore: number
  warning: string | null
  explanation: string
  supportingSignals: string[]
  conflictingSignals: string[]
}

export interface BtcFalseBreakoutInput {
  ticks: RealtimeBtcTick[]
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
  fifteenMinuteReturn: number | null
  spreadState: BtcSpreadState
  spreadBps: number | null
  spreadDeltaPct: number | null
  trendPersistenceScore: number
  momentumScore: number
  momentumStatus: BtcMomentumStatus
  tickVelocityPerMin: number | null
  volatilityRegime: BtcVolatilityRegime
  exchangeConsensus: BtcExchangeConsensusMetrics | null
  marketRegime: BtcMarketRegimeSnapshot
  riskState: BtcRiskState
  priceAccelerationBpsPerMin2: number | null
}

export function analyzeBtcFalseBreakout(
  input: BtcFalseBreakoutInput,
): BtcFalseBreakoutSnapshot {
  const sortedTicks = [...input.ticks].sort(
    (left, right) => left.exchangeTimeMs - right.exchangeTimeMs,
  )
  const latest = sortedTicks.at(-1) ?? null
  const currentPrice = latest?.price ?? null
  const localStructure = buildLocalStructure(sortedTicks)
  const breakoutBufferPct = computeBreakoutBufferPct(
    input.volatilityRegime,
    input.spreadBps,
    input.exchangeConsensus?.agreementScore ?? 50,
  )

  const breakoutDirection = detectBreakoutDirection(
    currentPrice,
    localStructure,
    breakoutBufferPct,
  )
  const breakoutConfidence = calculateBreakoutConfidence({
    breakoutDirection,
    currentPrice,
    localStructure,
    breakoutBufferPct,
    oneMinuteReturn: input.oneMinuteReturn,
    fiveMinuteReturn: input.fiveMinuteReturn,
    fifteenMinuteReturn: input.fifteenMinuteReturn,
    momentumScore: input.momentumScore,
    momentumStatus: input.momentumStatus,
    tickVelocityPerMin: input.tickVelocityPerMin,
    spreadState: input.spreadState,
    spreadBps: input.spreadBps,
    exchangeConsensus: input.exchangeConsensus,
    trendPersistenceScore: input.trendPersistenceScore,
    volatilityRegime: input.volatilityRegime,
  })
  const followThroughQuality = calculateFollowThroughQuality({
    breakoutDirection,
    currentPrice,
    localStructure,
    breakoutBufferPct,
    oneMinuteReturn: input.oneMinuteReturn,
    fiveMinuteReturn: input.fiveMinuteReturn,
    momentumScore: input.momentumScore,
    tickVelocityPerMin: input.tickVelocityPerMin,
    spreadState: input.spreadState,
    spreadBps: input.spreadBps,
    exchangeConsensus: input.exchangeConsensus,
    trendPersistenceScore: input.trendPersistenceScore,
  })
  const exhaustionScore = calculateExhaustionScore({
    breakoutDirection,
    breakoutConfidence,
    followThroughQuality,
    oneMinuteReturn: input.oneMinuteReturn,
    fiveMinuteReturn: input.fiveMinuteReturn,
    trendPersistenceScore: input.trendPersistenceScore,
    momentumScore: input.momentumScore,
    priceAccelerationBpsPerMin2: input.priceAccelerationBpsPerMin2,
    spreadState: input.spreadState,
    spreadBps: input.spreadBps,
    exchangeConsensus: input.exchangeConsensus,
    marketRegime: input.marketRegime,
    volatilityRegime: input.volatilityRegime,
  })
  const falseBreakoutRisk = calculateFalseBreakoutRisk({
    breakoutDirection,
    breakoutConfidence,
    followThroughQuality,
    exhaustionScore,
    oneMinuteReturn: input.oneMinuteReturn,
    fiveMinuteReturn: input.fiveMinuteReturn,
    trendPersistenceScore: input.trendPersistenceScore,
    momentumScore: input.momentumScore,
    priceAccelerationBpsPerMin2: input.priceAccelerationBpsPerMin2,
    tickVelocityPerMin: input.tickVelocityPerMin,
    spreadState: input.spreadState,
    spreadBps: input.spreadBps,
    spreadDeltaPct: input.spreadDeltaPct,
    exchangeConsensus: input.exchangeConsensus,
    marketRegime: input.marketRegime,
    volatilityRegime: input.volatilityRegime,
    riskState: input.riskState,
  })
  const breakoutHealthScore = Math.round(
    clamp(
      breakoutConfidence * 0.35 +
        followThroughQuality * 0.35 +
        (100 - falseBreakoutRisk) * 0.2 +
        (100 - exhaustionScore) * 0.1,
      0,
      100,
    ),
  )
  const breakoutStatus = classifyBreakoutStatus({
    breakoutDirection,
    breakoutConfidence,
    falseBreakoutRisk,
    followThroughQuality,
    breakoutHealthScore,
    marketRegime: input.marketRegime,
  })
  const explanation = buildExplanation({
    breakoutDirection,
    breakoutStatus,
    breakoutConfidence,
    falseBreakoutRisk,
    followThroughQuality,
    breakoutHealthScore,
    exhaustionScore,
    localStructure,
    breakoutBufferPct,
  })
  const warning =
    breakoutStatus === "false breakout risk"
      ? "Breakout conditions are fragile and may fail without stronger follow-through."
      : breakoutStatus === "ambiguous"
        ? "Breakout conditions are ambiguous; the market has not confirmed follow-through."
        : breakoutStatus === "breakout attempt" && falseBreakoutRisk >= 60
          ? "Breakout attempt is present, but false-breakout risk is elevated."
          : breakoutDirection === "none"
            ? null
            : falseBreakoutRisk >= 75
              ? "Breakout failure risk is elevated."
              : null

  return {
    breakoutDirection,
    breakoutStatus,
    breakoutConfidence,
    falseBreakoutRisk,
    followThroughQuality,
    breakoutHealthScore,
    exhaustionScore,
    warning,
    explanation,
    supportingSignals: buildSupportingSignals({
      breakoutDirection,
      breakoutConfidence,
      followThroughQuality,
      exhaustionScore,
      localStructure,
      breakoutBufferPct,
      oneMinuteReturn: input.oneMinuteReturn,
      fiveMinuteReturn: input.fiveMinuteReturn,
      momentumStatus: input.momentumStatus,
      tickVelocityPerMin: input.tickVelocityPerMin,
      exchangeConsensus: input.exchangeConsensus,
      marketRegime: input.marketRegime,
    }),
    conflictingSignals: buildConflictingSignals({
      breakoutDirection,
      falseBreakoutRisk,
      followThroughQuality,
      exhaustionScore,
      oneMinuteReturn: input.oneMinuteReturn,
      fiveMinuteReturn: input.fiveMinuteReturn,
      momentumScore: input.momentumScore,
      priceAccelerationBpsPerMin2: input.priceAccelerationBpsPerMin2,
      spreadState: input.spreadState,
      spreadBps: input.spreadBps,
      spreadDeltaPct: input.spreadDeltaPct,
      exchangeConsensus: input.exchangeConsensus,
      marketRegime: input.marketRegime,
      volatilityRegime: input.volatilityRegime,
    }),
  }
}

function buildLocalStructure(ticks: RealtimeBtcTick[]) {
  const latest = ticks.at(-1) ?? null
  const nowMs = latest?.exchangeTimeMs ?? Date.now()
  const windows = [5, 15]
  const structure = windows.map((minutes) => {
    const sample = sliceTicksByMinutes(ticks, minutes, nowMs)
    const prices = sample.map((tick) => tick.price)
    return {
      minutes,
      sample,
      high: prices.length > 0 ? Math.max(...prices) : null,
      low: prices.length > 0 ? Math.min(...prices) : null,
      velocity: computeTickVelocity(sample),
      rangePct: computeRangePct(sample),
    }
  })

  return {
    latest,
    high5: structure[0]?.high ?? null,
    low5: structure[0]?.low ?? null,
    high15: structure[1]?.high ?? null,
    low15: structure[1]?.low ?? null,
    velocity5: structure[0]?.velocity ?? null,
    velocity15: structure[1]?.velocity ?? null,
    range5: structure[0]?.rangePct ?? null,
    range15: structure[1]?.rangePct ?? null,
  }
}

function detectBreakoutDirection(
  currentPrice: number | null,
  localStructure: ReturnType<typeof buildLocalStructure>,
  breakoutBufferPct: number,
): BtcBreakoutDirection {
  if (currentPrice === null) {
    return "none"
  }

  const upThreshold15 =
    localStructure.high15 !== null
      ? localStructure.high15 * (1 + breakoutBufferPct / 100)
      : null
  const downThreshold15 =
    localStructure.low15 !== null
      ? localStructure.low15 * (1 - breakoutBufferPct / 100)
      : null
  const upThreshold5 =
    localStructure.high5 !== null
      ? localStructure.high5 * (1 + breakoutBufferPct / 100)
      : null
  const downThreshold5 =
    localStructure.low5 !== null
      ? localStructure.low5 * (1 - breakoutBufferPct / 100)
      : null

  if (
    (upThreshold15 !== null && currentPrice >= upThreshold15) ||
    (upThreshold5 !== null && currentPrice >= upThreshold5)
  ) {
    return "up"
  }

  if (
    (downThreshold15 !== null && currentPrice <= downThreshold15) ||
    (downThreshold5 !== null && currentPrice <= downThreshold5)
  ) {
    return "down"
  }

  return "none"
}

function calculateBreakoutConfidence({
  breakoutDirection,
  currentPrice,
  localStructure,
  breakoutBufferPct,
  oneMinuteReturn,
  fiveMinuteReturn,
  fifteenMinuteReturn,
  momentumScore,
  momentumStatus,
  tickVelocityPerMin,
  spreadState,
  spreadBps,
  exchangeConsensus,
  trendPersistenceScore,
  volatilityRegime,
}: {
  breakoutDirection: BtcBreakoutDirection
  currentPrice: number | null
  localStructure: ReturnType<typeof buildLocalStructure>
  breakoutBufferPct: number
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
  fifteenMinuteReturn: number | null
  momentumScore: number
  momentumStatus: BtcMomentumStatus
  tickVelocityPerMin: number | null
  spreadState: BtcSpreadState
  spreadBps: number | null
  exchangeConsensus: BtcExchangeConsensusMetrics | null
  trendPersistenceScore: number
  volatilityRegime: BtcVolatilityRegime
}) {
  if (breakoutDirection === "none" || currentPrice === null) {
    return 0
  }

  const localExtreme =
    breakoutDirection === "up"
      ? localStructure.high15 ?? localStructure.high5 ?? currentPrice
      : localStructure.low15 ?? localStructure.low5 ?? currentPrice
  const extensionPct =
    localExtreme === 0 ? 0 : Math.abs(((currentPrice - localExtreme) / localExtreme) * 100)
  const extensionScore = clamp(extensionPct / Math.max(breakoutBufferPct * 2, 0.12), 0, 1)
  const momentumStrength = clamp(Math.abs(momentumScore) / 100, 0, 1)
  const momentumStatusScore =
    momentumStatus === "strong bullish" || momentumStatus === "strong bearish"
      ? 1
      : momentumStatus === "bullish" || momentumStatus === "bearish"
        ? 0.72
        : 0.42
  const directionalReturns =
    breakoutDirection === "up"
      ? clamp((((oneMinuteReturn ?? 0) + (fiveMinuteReturn ?? 0) + (fifteenMinuteReturn ?? 0)) / 3 + 0.5) / 1, 0, 1)
      : clamp((((Math.abs(oneMinuteReturn ?? 0) + Math.abs(fiveMinuteReturn ?? 0) + Math.abs(fifteenMinuteReturn ?? 0)) / 3) + 0.5) / 1, 0, 1)
  const velocityScore = clamp(normalizeTickVelocity(tickVelocityPerMin), 0, 1)
  const spreadScore =
    spreadState === "contracting"
      ? 1
      : spreadState === "stable"
        ? 0.72
        : 0.38
  const spreadLevelScore = clamp(1 - (spreadBps ?? 0) / 12, 0, 1)
  const agreementScore = clamp((exchangeConsensus?.agreementScore ?? 50) / 100, 0, 1)
  const persistenceScore = clamp(trendPersistenceScore / 100, 0, 1)
  const volatilityScore =
    volatilityRegime === "extreme"
      ? 0.92
      : volatilityRegime === "elevated"
        ? 0.75
        : volatilityRegime === "normal"
          ? 0.58
          : 0.42

  return Math.round(
      clamp(
        extensionScore * 0.24 +
          momentumStrength * 0.2 +
          momentumStatusScore * 0.08 +
          directionalReturns * 0.16 +
          velocityScore * 0.14 +
          spreadScore * 0.12 +
          spreadLevelScore * 0.06 +
          agreementScore * 0.08 +
          persistenceScore * 0.04 +
          volatilityScore * 0.02,
      0,
      1,
    ) * 100,
  )
}

function calculateFollowThroughQuality({
  breakoutDirection,
  currentPrice,
  localStructure,
  breakoutBufferPct,
  oneMinuteReturn,
  fiveMinuteReturn,
  momentumScore,
  tickVelocityPerMin,
  spreadState,
  spreadBps,
  exchangeConsensus,
  trendPersistenceScore,
}: {
  breakoutDirection: BtcBreakoutDirection
  currentPrice: number | null
  localStructure: ReturnType<typeof buildLocalStructure>
  breakoutBufferPct: number
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
  momentumScore: number
  tickVelocityPerMin: number | null
  spreadState: BtcSpreadState
  spreadBps: number | null
  exchangeConsensus: BtcExchangeConsensusMetrics | null
  trendPersistenceScore: number
}) {
  if (breakoutDirection === "none" || currentPrice === null) {
    return 0
  }

  const localExtreme =
    breakoutDirection === "up"
      ? localStructure.high15 ?? localStructure.high5 ?? currentPrice
      : localStructure.low15 ?? localStructure.low5 ?? currentPrice
  const extensionPct =
    localExtreme === 0 ? 0 : Math.abs(((currentPrice - localExtreme) / localExtreme) * 100)
  const followThroughDistance = clamp(extensionPct / Math.max(breakoutBufferPct * 2, 0.12), 0, 1)
  const velocityScore = clamp(normalizeTickVelocity(tickVelocityPerMin), 0, 1)
  const momentumAlignment =
    breakoutDirection === "up"
      ? clamp((Math.max(oneMinuteReturn ?? 0, 0) + Math.max(fiveMinuteReturn ?? 0, 0)) / 0.45, 0, 1)
      : clamp(
          (Math.abs(Math.min(oneMinuteReturn ?? 0, 0)) +
            Math.abs(Math.min(fiveMinuteReturn ?? 0, 0))) /
            0.45,
          0,
          1,
        )
  const spreadScore =
    spreadState === "contracting"
      ? 1
      : spreadState === "stable"
        ? 0.72
        : 0.3
  const spreadLevelScore = clamp(1 - (spreadBps ?? 0) / 12, 0, 1)
  const agreementScore = clamp((exchangeConsensus?.agreementScore ?? 50) / 100, 0, 1)
  const persistenceScore = clamp(trendPersistenceScore / 100, 0, 1)
  const momentumScoreValue = clamp(Math.abs(momentumScore) / 100, 0, 1)

  return Math.round(
    clamp(
      followThroughDistance * 0.28 +
        momentumAlignment * 0.24 +
        velocityScore * 0.16 +
        spreadScore * 0.12 +
        spreadLevelScore * 0.06 +
        agreementScore * 0.12 +
        persistenceScore * 0.08 +
        momentumScoreValue * 0.05,
      0,
      1,
    ) * 100,
  )
}

function calculateExhaustionScore({
  breakoutDirection,
  breakoutConfidence,
  followThroughQuality,
  oneMinuteReturn,
  fiveMinuteReturn,
  trendPersistenceScore,
  momentumScore,
  priceAccelerationBpsPerMin2,
  spreadState,
  spreadBps,
  exchangeConsensus,
  marketRegime,
  volatilityRegime,
}: {
  breakoutDirection: BtcBreakoutDirection
  breakoutConfidence: number
  followThroughQuality: number
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
  trendPersistenceScore: number
  momentumScore: number
  priceAccelerationBpsPerMin2: number | null
  spreadState: BtcSpreadState
  spreadBps: number | null
  exchangeConsensus: BtcExchangeConsensusMetrics | null
  marketRegime: BtcMarketRegimeSnapshot
  volatilityRegime: BtcVolatilityRegime
}) {
  if (breakoutDirection === "none") {
    return Math.round(
      clamp(
        (marketRegime.primaryRegime === "exhaustion conditions" ? 0.4 : 0.2) +
          (volatilityRegime === "extreme" ? 0.22 : 0.08) +
          (spreadState === "expanding" ? 0.14 : 0.06),
        0,
        1,
      ) * 100,
    )
  }

  const reversalPressure =
    breakoutDirection === "up"
      ? clamp((Math.abs(Math.min(oneMinuteReturn ?? 0, 0)) + Math.abs(Math.min(fiveMinuteReturn ?? 0, 0))) / 0.35, 0, 1)
      : clamp((Math.max(oneMinuteReturn ?? 0, 0) + Math.max(fiveMinuteReturn ?? 0, 0)) / 0.35, 0, 1)
  const accelerationOpposition =
    priceAccelerationBpsPerMin2 === null
      ? 0.45
      : breakoutDirection === "up"
        ? priceAccelerationBpsPerMin2 < 0
          ? clamp(Math.abs(priceAccelerationBpsPerMin2) / 24, 0, 1)
          : 0.15
        : priceAccelerationBpsPerMin2 > 0
          ? clamp(Math.abs(priceAccelerationBpsPerMin2) / 24, 0, 1)
          : 0.15
  const agreementStress = clamp(
    1 - (exchangeConsensus?.agreementScore ?? 50) / 100,
    0,
    1,
  )
  const spreadLevelScore = clamp(1 - (spreadBps ?? 0) / 12, 0, 1)
  const persistenceDecay = clamp(1 - trendPersistenceScore / 100, 0, 1)
  const spreadStress =
    spreadState === "expanding"
      ? 1
      : clamp((spreadBps ?? 0) / 12, 0, 1)
  const momentumDecay = clamp(1 - Math.abs(momentumScore) / 100, 0, 1)
  const regimePressure =
    marketRegime.isTransitioning ||
    marketRegime.regimeClarity === "ambiguous" ||
    marketRegime.regimeConfidence < 55
      ? 0.85
      : marketRegime.primaryRegime === "exhaustion conditions" ||
          marketRegime.primaryRegime === "choppy / noisy"
        ? 0.72
        : 0.35

  return Math.round(
    clamp(
      reversalPressure * 0.24 +
        accelerationOpposition * 0.2 +
        agreementStress * 0.16 +
        spreadLevelScore * 0.06 +
        spreadStress * 0.14 +
        persistenceDecay * 0.1 +
        momentumDecay * 0.08 +
        regimePressure * 0.08 +
        (breakoutConfidence < 50 ? 0.06 : 0) +
        (followThroughQuality < 50 ? 0.08 : 0),
      0,
      1,
    ) * 100,
  )
}

function calculateFalseBreakoutRisk({
  breakoutDirection,
  breakoutConfidence,
  followThroughQuality,
  exhaustionScore,
  oneMinuteReturn,
  fiveMinuteReturn,
  trendPersistenceScore,
  momentumScore,
  priceAccelerationBpsPerMin2,
  tickVelocityPerMin,
  spreadState,
  spreadBps,
  spreadDeltaPct,
  exchangeConsensus,
  marketRegime,
  volatilityRegime,
  riskState,
}: {
  breakoutDirection: BtcBreakoutDirection
  breakoutConfidence: number
  followThroughQuality: number
  exhaustionScore: number
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
  trendPersistenceScore: number
  momentumScore: number
  priceAccelerationBpsPerMin2: number | null
  tickVelocityPerMin: number | null
  spreadState: BtcSpreadState
  spreadBps: number | null
  spreadDeltaPct: number | null
  exchangeConsensus: BtcExchangeConsensusMetrics | null
  marketRegime: BtcMarketRegimeSnapshot
  volatilityRegime: BtcVolatilityRegime
  riskState: BtcRiskState
}) {
  if (breakoutDirection === "none") {
    return Math.round(
      clamp(
        (marketRegime.regimeClarity === "ambiguous" ? 0.45 : 0.2) +
          (volatilityRegime === "extreme" ? 0.15 : 0.05) +
          (spreadState === "expanding" ? 0.14 : 0.05),
        0,
        1,
      ) * 100,
    )
  }

  const decay =
    breakoutDirection === "up"
      ? clamp(
          (Math.max(fiveMinuteReturn ?? 0, 0) - Math.max(oneMinuteReturn ?? 0, 0)) /
            Math.max(Math.abs(fiveMinuteReturn ?? 0), 0.12),
          0,
          1,
        )
      : clamp(
          (Math.abs(Math.min(fiveMinuteReturn ?? 0, 0)) - Math.abs(Math.min(oneMinuteReturn ?? 0, 0))) /
            Math.max(Math.abs(fiveMinuteReturn ?? 0), 0.12),
          0,
          1,
        )
  const disagreement = clamp(
    1 - (exchangeConsensus?.agreementScore ?? 50) / 100,
    0,
    1,
  )
  const velocityWeakness = clamp(1 - normalizeTickVelocity(tickVelocityPerMin), 0, 1)
  const spreadInstability =
    spreadState === "expanding"
      ? 1
      : clamp(((spreadBps ?? 0) + Math.max(spreadDeltaPct ?? 0, 0) / 10) / 14, 0, 1)
  const lowFollowThrough = clamp(1 - followThroughQuality / 100, 0, 1)
  const breakoutConfidenceWeakness = clamp(1 - breakoutConfidence / 100, 0, 1)
  const regimeInstability =
    marketRegime.isTransitioning ||
    marketRegime.regimeClarity === "ambiguous" ||
    marketRegime.regimeConfidence < 55
      ? 1
      : marketRegime.regimeStabilityScore < 50
        ? 0.75
        : 0.28
  const reversalAcceleration =
    priceAccelerationBpsPerMin2 === null
      ? 0.45
      : breakoutDirection === "up"
        ? priceAccelerationBpsPerMin2 < 0
          ? clamp(Math.abs(priceAccelerationBpsPerMin2) / 22, 0, 1)
          : 0.08
        : priceAccelerationBpsPerMin2 > 0
          ? clamp(Math.abs(priceAccelerationBpsPerMin2) / 22, 0, 1)
          : 0.08
  const exhaustionPressure = clamp(exhaustionScore / 100, 0, 1)
  const persistenceDecay = clamp(1 - trendPersistenceScore / 100, 0, 1)
  const momentumDecay = clamp(1 - Math.abs(momentumScore) / 100, 0, 1)
  const riskPenalty = riskState === "avoid" ? 0.1 : riskState === "caution" ? 0.05 : 0

  return Math.round(
    clamp(
      decay * 0.2 +
        disagreement * 0.16 +
        spreadInstability * 0.14 +
        lowFollowThrough * 0.16 +
        velocityWeakness * 0.1 +
        regimeInstability * 0.12 +
        reversalAcceleration * 0.12 +
        exhaustionPressure * 0.1 +
        persistenceDecay * 0.04 +
        momentumDecay * 0.04 +
        breakoutConfidenceWeakness * 0.08 +
        riskPenalty,
      0,
      1,
    ) * 100,
  )
}

function classifyBreakoutStatus({
  breakoutDirection,
  breakoutConfidence,
  falseBreakoutRisk,
  followThroughQuality,
  breakoutHealthScore,
  marketRegime,
}: {
  breakoutDirection: BtcBreakoutDirection
  breakoutConfidence: number
  falseBreakoutRisk: number
  followThroughQuality: number
  breakoutHealthScore: number
  marketRegime: BtcMarketRegimeSnapshot
}): BtcBreakoutStatus {
  if (breakoutDirection === "none") {
    if (
      marketRegime.primaryRegime === "breakout conditions" ||
      marketRegime.primaryRegime === "exhaustion conditions"
    ) {
      return "ambiguous"
    }

    return "no breakout"
  }

  if (falseBreakoutRisk >= 75) {
    return "false breakout risk"
  }

  if (
    breakoutConfidence >= 65 &&
    followThroughQuality >= 60 &&
    breakoutHealthScore >= 65 &&
    falseBreakoutRisk < 45
  ) {
    return "confirmed breakout"
  }

  if (breakoutConfidence >= 50 && followThroughQuality >= 45) {
    return "breakout developing"
  }

  return "breakout attempt"
}

function buildExplanation({
  breakoutDirection,
  breakoutStatus,
  breakoutConfidence,
  falseBreakoutRisk,
  followThroughQuality,
  breakoutHealthScore,
  exhaustionScore,
  localStructure,
  breakoutBufferPct,
}: {
  breakoutDirection: BtcBreakoutDirection
  breakoutStatus: BtcBreakoutStatus
  breakoutConfidence: number
  falseBreakoutRisk: number
  followThroughQuality: number
  breakoutHealthScore: number
  exhaustionScore: number
  localStructure: ReturnType<typeof buildLocalStructure>
  breakoutBufferPct: number
}) {
  const directionLabel =
    breakoutDirection === "up"
      ? "upward"
      : breakoutDirection === "down"
        ? "downward"
        : "no"
  const highLowLabel =
    breakoutDirection === "up"
      ? `${formatPrice(localStructure.high15 ?? localStructure.high5)} local highs`
      : breakoutDirection === "down"
        ? `${formatPrice(localStructure.low15 ?? localStructure.low5)} local lows`
        : "local range boundaries"
  return `Breakout analysis sees a ${directionLabel} breakout ${breakoutDirection === "none" ? "candidate" : "attempt"} around ${highLowLabel} with a ${breakoutConfidence}/100 breakout confidence, ${followThroughQuality}/100 follow-through quality, ${falseBreakoutRisk}/100 false-breakout risk, and ${breakoutHealthScore}/100 breakout health. The breakout buffer is ${breakoutBufferPct.toFixed(2)}%. Exhaustion reads ${exhaustionScore}/100. Current status: ${breakoutStatus}.`
}

function buildSupportingSignals({
  breakoutDirection,
  breakoutConfidence,
  followThroughQuality,
  exhaustionScore,
  localStructure,
  breakoutBufferPct,
  oneMinuteReturn,
  fiveMinuteReturn,
  momentumStatus,
  tickVelocityPerMin,
  exchangeConsensus,
  marketRegime,
}: {
  breakoutDirection: BtcBreakoutDirection
  breakoutConfidence: number
  followThroughQuality: number
  exhaustionScore: number
  localStructure: ReturnType<typeof buildLocalStructure>
  breakoutBufferPct: number
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
  momentumStatus: BtcMomentumStatus
  tickVelocityPerMin: number | null
  exchangeConsensus: BtcExchangeConsensusMetrics | null
  marketRegime: BtcMarketRegimeSnapshot
}) {
  const supporting: string[] = []

  if (breakoutDirection !== "none") {
    supporting.push(
      breakoutDirection === "up"
        ? `Price is pushing above the recent ${formatPrice(localStructure.high15 ?? localStructure.high5)} high.`
        : `Price is pushing below the recent ${formatPrice(localStructure.low15 ?? localStructure.low5)} low.`,
    )
    supporting.push(`Breakout buffer is ${breakoutBufferPct.toFixed(2)}% above the local range.`)
  } else {
    supporting.push("Price has not cleanly cleared the recent local range.")
  }

  supporting.push(`Breakout confidence is ${breakoutConfidence}/100.`)
  supporting.push(`Follow-through quality is ${followThroughQuality}/100.`)
  supporting.push(`Momentum reads ${momentumStatus} and tick velocity is ${formatVelocity(tickVelocityPerMin)}.`)
  supporting.push(`Exchange agreement is ${exchangeConsensus?.agreementScore ?? 0}/100.`)
  supporting.push(`Regime reads ${marketRegime.primaryRegime} with ${marketRegime.regimeConfidence}/100 confidence.`)
  supporting.push(`1m return is ${formatSignedPercent(oneMinuteReturn)} and 5m return is ${formatSignedPercent(fiveMinuteReturn)}.`)

  if (exhaustionScore >= 55) {
    supporting.push("Exhaustion signatures are becoming more visible.")
  }

  return supporting
}

function buildConflictingSignals({
  breakoutDirection,
  falseBreakoutRisk,
  followThroughQuality,
  exhaustionScore,
  oneMinuteReturn,
  fiveMinuteReturn,
  momentumScore,
  priceAccelerationBpsPerMin2,
  spreadState,
  spreadBps,
  spreadDeltaPct,
  exchangeConsensus,
  marketRegime,
  volatilityRegime,
}: {
  breakoutDirection: BtcBreakoutDirection
  falseBreakoutRisk: number
  followThroughQuality: number
  exhaustionScore: number
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
  momentumScore: number
  priceAccelerationBpsPerMin2: number | null
  spreadState: BtcSpreadState
  spreadBps: number | null
  spreadDeltaPct: number | null
  exchangeConsensus: BtcExchangeConsensusMetrics | null
  marketRegime: BtcMarketRegimeSnapshot
  volatilityRegime: BtcVolatilityRegime
}) {
  const conflicting: string[] = []

  if (breakoutDirection !== "none") {
    if (falseBreakoutRisk >= 65) {
      conflicting.push("false-breakout risk is elevated.")
    }

    if (followThroughQuality < 50) {
      conflicting.push("follow-through is not strong enough yet.")
    }

    if (spreadState === "expanding" || (spreadBps ?? 0) >= 8 || Math.max(spreadDeltaPct ?? 0, 0) >= 15) {
      conflicting.push("spread behavior is unstable.")
    }

    if ((exchangeConsensus?.activeExchangeCount ?? 0) <= 1 || (exchangeConsensus?.agreementScore ?? 100) < 55) {
      conflicting.push("exchange agreement is too thin for confirmation.")
    }

    if (priceAccelerationBpsPerMin2 !== null) {
      if (
        (breakoutDirection === "up" && priceAccelerationBpsPerMin2 < 0) ||
        (breakoutDirection === "down" && priceAccelerationBpsPerMin2 > 0)
      ) {
        conflicting.push("price acceleration is turning back against the breakout.")
      }
    }
  }

  if (
    marketRegime.isTransitioning ||
    marketRegime.regimeClarity === "ambiguous" ||
    marketRegime.regimeConfidence < 55
  ) {
    conflicting.push("the regime is unstable enough to blur breakout interpretation.")
  }

  if (volatilityRegime === "extreme") {
    conflicting.push("volatility is extreme enough to distort follow-through.")
  }

  if (exhaustionScore >= 60) {
    conflicting.push("exhaustion signatures are building.")
  }

  if (
    oneMinuteReturn !== null &&
    fiveMinuteReturn !== null &&
    oneMinuteReturn !== 0 &&
    fiveMinuteReturn !== 0 &&
    Math.sign(oneMinuteReturn) !== Math.sign(fiveMinuteReturn)
  ) {
    conflicting.push("short-window direction is already diverging.")
  }

  if (momentumScore === 0) {
    conflicting.push("momentum is flat despite the range break.")
  }

  return conflicting
}

function computeBreakoutBufferPct(
  volatilityRegime: BtcVolatilityRegime,
  spreadBps: number | null,
  agreementScore: number,
) {
  const volatilityComponent =
    volatilityRegime === "extreme"
      ? 0.22
      : volatilityRegime === "elevated"
        ? 0.18
        : volatilityRegime === "normal"
          ? 0.12
          : 0.08
  const spreadComponent = clamp((spreadBps ?? 0) * 0.01, 0.02, 0.12)
  const agreementComponent = agreementScore >= 70 ? -0.02 : agreementScore <= 45 ? 0.03 : 0
  return clamp(volatilityComponent + spreadComponent + agreementComponent, 0.06, 0.3)
}

function sliceTicksByMinutes(ticks: RealtimeBtcTick[], minutes: number, nowMs: number) {
  const windowMs = minutes * 60 * 1000
  return ticks.filter((tick) => nowMs - tick.exchangeTimeMs <= windowMs)
}

function computeTickVelocity(ticks: RealtimeBtcTick[]) {
  if (ticks.length < 2) {
    return null
  }

  const elapsedMinutes =
    (ticks.at(-1)!.exchangeTimeMs - ticks[0].exchangeTimeMs) / 60000
  if (elapsedMinutes <= 0) {
    return null
  }

  return ticks.length / elapsedMinutes
}

function computeRangePct(ticks: RealtimeBtcTick[]) {
  if (ticks.length === 0) {
    return null
  }

  const prices = ticks.map((tick) => tick.price)
  const high = Math.max(...prices)
  const low = Math.min(...prices)
  const last = prices.at(-1) ?? null
  if (!last || last <= 0) {
    return null
  }

  return ((high - low) / last) * 100
}

function normalizeTickVelocity(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return 0.5
  }

  return clamp(value / 14, 0, 1)
}

function formatPrice(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "unknown"
  }

  return `$${Math.round(value).toLocaleString()}`
}

function formatSignedPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "n/a"
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function formatVelocity(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "n/a"
  }

  return `${value.toFixed(1)} ticks/min`
}
