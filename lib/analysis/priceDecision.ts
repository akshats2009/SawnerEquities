import {
  BTC_PRODUCT_ID,
  type RealtimeBtcTick,
} from "@/lib/btc/realtime"
import { clamp } from "@/lib/utils"
import {
  analyzeBtcMarketRegime,
  type BtcMarketRegimeSnapshot,
} from "@/lib/analysis/regimeDetection"
import {
  analyzeBtcFalseBreakout,
  type BtcFalseBreakoutSnapshot,
} from "@/lib/analysis/falseBreakout"
import {
  analyzeBtcSignalSuppression,
  type BtcSignalSuppressionSnapshot,
} from "@/lib/analysis/signalSuppression"
import {
  analyzeBtcMarketState,
  type BtcMarketStateSnapshot,
} from "@/lib/analysis/marketState"
import {
  analyzeBtcHorizonForecast,
  type BtcHorizonForecastSnapshot,
} from "@/lib/analysis/horizonForecast"
import type { BtcSocialNewsSnapshot } from "@/lib/sentiment/eventScoring"

export type BtcDirectionBias = "bullish" | "bearish" | "neutral"
export type BtcMomentumStatus =
  | "strong bullish"
  | "bullish"
  | "flat"
  | "bearish"
  | "strong bearish"
export type BtcRiskState = "clean" | "caution" | "avoid"
export type BtcObservationWindow = "1m" | "5m" | "15m" | "1h"
export type BtcSpreadState = "expanding" | "contracting" | "stable"
export type BtcVolatilityRegime = "low" | "normal" | "elevated" | "extreme"
export type BtcChopState = "trending" | "mixed" | "range-bound"
export type BtcSignalQualityState =
  | "strong signal"
  | "moderate signal"
  | "weak signal"
  | "noisy / avoid"
export type BtcDirectionalClarity = "clear" | "muted" | "unclear"
export type BtcStabilityAssessment = "stable" | "mixed" | "unstable"

export interface BtcMarketQualitySnapshot {
  signalQualityScore: number
  signalQualityState: BtcSignalQualityState
  noiseLevel: number
  directionalClarity: BtcDirectionalClarity
  stabilityAssessment: BtcStabilityAssessment
  tickConsistencyScore: number
  conflictingSignalCount: number
  exchangeAgreementScore: number
  activeExchangeCount: number
  staleExchangeCount: number
  totalExchangeCount: number
  maxDeviationPct: number | null
  medianDeviationPct: number | null
  warning: string | null
  directionalReadout: string
}

export interface BtcExchangeConsensusMetrics {
  activeExchangeCount: number
  staleExchangeCount: number
  totalExchangeCount: number
  agreementScore: number
  maxDeviationPct: number | null
  medianDeviationPct: number | null
}

export interface BtcWindowMetrics {
  window: BtcObservationWindow
  sampleCount: number
  returnPct: number | null
  realizedVolPct: number | null
  velocityTicksPerMin: number | null
  rangePct: number | null
  averageSpreadBps: number | null
  latestSpreadBps: number | null
}

export interface BtcDecisionExplanation {
  primaryReason: string
  supportingSignals: string[]
  conflictingSignals: string[]
  invalidationCondition: string
  biasChangeCondition: string
}

export interface BtcDecisionSnapshot {
  productId: string
  asOfMs: number
  latestTickMs: number | null
  lastPrice: number | null
  bid: number | null
  ask: number | null
  spread: number | null
  spreadBps: number | null
  volume24h: number | null
  tickVelocityPerMin: number | null
  rollingReturns: Record<BtcObservationWindow, number | null>
  realizedVolatility: Record<BtcObservationWindow, number | null>
  priceAccelerationBpsPerMin2: number | null
  momentumScore: number
  momentumStatus: BtcMomentumStatus
  spreadState: BtcSpreadState
  spreadDeltaPct: number | null
  suddenMoveDetected: boolean
  chopState: BtcChopState
  trendPersistenceScore: number
  directionBias: BtcDirectionBias
  falseBreakout: BtcFalseBreakoutSnapshot
  marketQuality: BtcMarketQualitySnapshot
  marketState: BtcMarketStateSnapshot
  marketRegime: BtcMarketRegimeSnapshot
  signalSuppression: BtcSignalSuppressionSnapshot
  socialNews: BtcSocialNewsSnapshot | null
  horizonForecast: BtcHorizonForecastSnapshot
  confidenceScore: number
  volatilityRegime: BtcVolatilityRegime
  riskState: BtcRiskState
  observationWindow: BtcObservationWindow
  explanation: BtcDecisionExplanation
  alerts: string[]
  notes: string[]
  windowMetrics: BtcWindowMetrics[]
  dataQuality: {
    tickCount: number
    coverageMinutes: number | null
    stale: boolean
  }
}

const WINDOW_MINUTES: Record<BtcObservationWindow, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
}

const PRICE_DECISION_TIME_WINDOWS: BtcObservationWindow[] = [
  "1m",
  "5m",
  "15m",
  "1h",
]

const MIN_TICK_SAMPLE = 3
const STALE_THRESHOLD_MS = 20_000

export function analyzeBtcPriceDecision(
  ticks: RealtimeBtcTick[],
  options?: {
    staleThresholdMs?: number
    asOfMs?: number
    exchangeConsensus?: BtcExchangeConsensusMetrics
    socialNews?: BtcSocialNewsSnapshot | null
  },
): BtcDecisionSnapshot {
  const asOfMs = options?.asOfMs ?? Date.now()
  const staleThresholdMs = options?.staleThresholdMs ?? STALE_THRESHOLD_MS
  const sortedTicks = [...ticks].sort(
    (left, right) => left.exchangeTimeMs - right.exchangeTimeMs,
  )
  const latestTick = sortedTicks.at(-1) ?? null
  const latestTickMs = latestTick?.exchangeTimeMs ?? null
  const stale =
    latestTickMs === null ? true : asOfMs - latestTickMs > staleThresholdMs

  const lastPrice = latestTick?.price ?? null
  const bid = latestTick?.bid ?? null
  const ask = latestTick?.ask ?? null
  const spread = latestTick?.spread ?? null
  const spreadBps = latestTick?.spreadBps ?? null
  const volume24h = latestTick?.volume24h ?? null
  const coverageMinutes = getCoverageMinutes(sortedTicks)
  const socialNews = options?.socialNews ?? null

  const windowMetrics = PRICE_DECISION_TIME_WINDOWS.map((window) =>
    computeWindowMetrics(sortedTicks, window),
  )
  const rollingReturns = buildWindowValueMap(windowMetrics, "returnPct")
  const realizedVolatility = buildWindowValueMap(
    windowMetrics,
    "realizedVolPct",
  )

  const tickVelocityPerMin = computeTickVelocity(sortedTicks, "1m")
  const oneMinuteReturn = rollingReturns["1m"]
  const fiveMinuteReturn = rollingReturns["5m"]
  const fifteenMinuteReturn = rollingReturns["15m"]
  const oneHourReturn = rollingReturns["1h"]

  const priceAccelerationBpsPerMin2 =
    oneMinuteReturn === null || fiveMinuteReturn === null
      ? null
      : ((oneMinuteReturn - fiveMinuteReturn / 5) / 1) * 100

  const volatilityRegime = classifyVolatilityRegime(
    realizedVolatility["15m"] ?? realizedVolatility["5m"] ?? 0,
    Math.abs(oneMinuteReturn ?? 0),
    spreadBps ?? 0,
  )
  const spreadState = classifySpreadState(windowMetrics)
  const trendPersistenceScore = calculateTrendPersistenceScore(sortedTicks)
  const chopState = classifyChopState({
    oneMinuteReturn,
    fiveMinuteReturn,
    fifteenMinuteReturn,
    trendPersistenceScore,
    volatilityRegime,
  })
  const suddenMoveDetected = detectSuddenMove(sortedTicks, volatilityRegime)
  const momentumScore = computeMomentumScore({
    oneMinuteReturn,
    fiveMinuteReturn,
    fifteenMinuteReturn,
    priceAccelerationBpsPerMin2,
    trendPersistenceScore,
    spreadState,
  })
  const momentumStatus = classifyMomentumStatus(momentumScore, chopState)
  const directionBias = classifyDirectionBias({
    momentumScore,
    momentumStatus,
    trendPersistenceScore,
    oneMinuteReturn,
    fiveMinuteReturn,
    volatilityRegime,
    suddenMoveDetected,
  })
  const riskState = classifyRiskState({
    stale,
    volatilityRegime,
    spreadBps,
    suddenMoveDetected,
    trendPersistenceScore,
    momentumStatus,
  })
  const preliminaryMarketRegime = analyzeBtcMarketRegime({
    asOfMs,
    oneMinuteReturn,
    fiveMinuteReturn,
    fifteenMinuteReturn,
    realizedVolatility,
    spreadState,
    spreadBps,
    spreadDeltaPct: computeSpreadDeltaPct(windowMetrics),
    trendPersistenceScore,
    momentumScore,
    momentumStatus,
    tickVelocityPerMin,
    volatilityRegime,
    exchangeConsensus: options?.exchangeConsensus ?? null,
    windowMetrics,
    stale,
    socialNews,
  })
  const falseBreakout = analyzeBtcFalseBreakout({
    ticks: sortedTicks,
    oneMinuteReturn,
    fiveMinuteReturn,
    fifteenMinuteReturn,
    spreadState,
    spreadBps,
    spreadDeltaPct: computeSpreadDeltaPct(windowMetrics),
    trendPersistenceScore,
    momentumScore,
    momentumStatus,
    tickVelocityPerMin,
    volatilityRegime,
    exchangeConsensus: options?.exchangeConsensus ?? null,
    marketRegime: preliminaryMarketRegime,
    riskState,
    priceAccelerationBpsPerMin2,
  })
  const marketRegime = analyzeBtcMarketRegime({
    asOfMs,
    oneMinuteReturn,
    fiveMinuteReturn,
    fifteenMinuteReturn,
    realizedVolatility,
    spreadState,
    spreadBps,
    spreadDeltaPct: computeSpreadDeltaPct(windowMetrics),
    trendPersistenceScore,
    momentumScore,
    momentumStatus,
    tickVelocityPerMin,
    volatilityRegime,
    exchangeConsensus: options?.exchangeConsensus ?? null,
    windowMetrics,
    stale,
    falseBreakoutAnalysis: falseBreakout,
    socialNews,
  })
  const marketQuality = assessMarketQuality({
    stale,
    riskState,
    directionBias,
    momentumStatus,
    momentumScore,
    trendPersistenceScore,
    volatilityRegime,
    spreadState,
    spreadBps,
    oneMinuteReturn,
    fiveMinuteReturn,
    suddenMoveDetected,
    ticks: sortedTicks,
    exchangeConsensus: options?.exchangeConsensus ?? null,
    marketRegime,
    falseBreakout,
    socialNews,
  })
  const signalSuppression = analyzeBtcSignalSuppression({
    directionBias,
    marketQuality,
    marketRegime,
    exchangeConsensus: options?.exchangeConsensus ?? null,
    riskState,
    stale,
    spreadState,
    spreadBps,
    spreadDeltaPct: computeSpreadDeltaPct(windowMetrics),
    momentumScore,
    priceAccelerationBpsPerMin2,
    falseBreakoutAnalysis: falseBreakout,
    socialNews,
  })
  const marketState = analyzeBtcMarketState({
    stale,
    marketQuality,
    marketRegime,
    signalSuppression,
    falseBreakout,
    exchangeConsensus: options?.exchangeConsensus ?? null,
    socialNews,
  })
  const resolvedMarketQuality = {
    ...marketQuality,
    directionalReadout: signalSuppression.directionalReadout,
    directionalClarity:
      signalSuppression.level === "none"
        ? marketQuality.directionalClarity
        : signalSuppression.level === "caution"
          ? "muted"
          : "unclear",
    warning:
      signalSuppression.warning ?? marketQuality.warning,
  }
  const confidenceScore = computeConfidenceScore({
    ticks: sortedTicks,
    stale,
    riskState,
    directionBias,
    signalQualityScore: resolvedMarketQuality.signalQualityScore,
    marketState,
    volatilityRegime,
    spreadBps,
    trendPersistenceScore,
    momentumScore,
    oneMinuteReturn,
    fiveMinuteReturn,
    marketRegime,
    signalSuppression,
    falseBreakout,
    socialNews,
  })
  const observationWindow = suggestObservationWindow({
    riskState,
    volatilityRegime,
    trendPersistenceScore,
    momentumStatus,
    suddenMoveDetected,
    oneMinuteReturn,
    fiveMinuteReturn,
    oneHourReturn,
    marketRegime,
    signalSuppression,
    falseBreakout,
    socialNews,
  })

  const alerts = buildAlerts({
    stale,
    suddenMoveDetected,
    spreadState,
    spreadBps,
    volatilityRegime,
    riskState,
    marketQuality,
    marketState,
    marketRegime,
    signalSuppression,
    falseBreakout,
    socialNews,
  })

  const explanation = buildDecisionExplanation({
    directionBias,
    momentumStatus,
    chopState,
    marketQuality: resolvedMarketQuality,
    marketState,
    marketRegime,
    signalSuppression,
    spreadState,
    volatilityRegime,
    trendPersistenceScore,
    oneMinuteReturn,
    fiveMinuteReturn,
    priceAccelerationBpsPerMin2,
    suddenMoveDetected,
    falseBreakout,
    socialNews,
  })

  const notes = buildNotes({
    momentumStatus,
    chopState,
    trendPersistenceScore,
    observationWindow,
    marketQuality: resolvedMarketQuality,
    marketState,
    marketRegime,
    signalSuppression,
    falseBreakout,
    socialNews,
  })
  const horizonForecast = analyzeBtcHorizonForecast({
    asOfMs,
    directionBias,
    marketQuality: resolvedMarketQuality,
    marketState,
    marketRegime,
    signalSuppression,
    falseBreakout,
    socialNews,
    volatilityRegime,
    trendPersistenceScore,
    momentumStatus,
    momentumScore,
    spreadState,
    spreadBps,
    spreadDeltaPct: computeSpreadDeltaPct(windowMetrics),
    tickVelocityPerMin,
    rollingReturns,
    realizedVolatility,
    windowMetrics,
    riskState,
    exchangeConsensus: options?.exchangeConsensus ?? null,
    suddenMoveDetected,
  })

  return {
    productId: latestTick?.productId ?? BTC_PRODUCT_ID,
    asOfMs,
    latestTickMs,
    lastPrice,
    bid,
    ask,
    spread,
    spreadBps,
    volume24h,
    tickVelocityPerMin,
    rollingReturns,
    realizedVolatility,
    priceAccelerationBpsPerMin2,
    momentumScore,
    momentumStatus,
    spreadState,
    spreadDeltaPct: computeSpreadDeltaPct(windowMetrics),
    suddenMoveDetected,
    chopState,
    trendPersistenceScore,
    directionBias,
    falseBreakout,
    marketQuality: resolvedMarketQuality,
    marketState,
    marketRegime,
    signalSuppression,
    socialNews,
    horizonForecast,
    confidenceScore,
    volatilityRegime,
    riskState,
    observationWindow,
    explanation,
    alerts,
    notes,
    windowMetrics,
    dataQuality: {
      tickCount: sortedTicks.length,
      coverageMinutes,
      stale,
    },
  }
}

function computeWindowMetrics(
  ticks: RealtimeBtcTick[],
  window: BtcObservationWindow,
): BtcWindowMetrics {
  const windowTicks = sliceWindowTicks(ticks, WINDOW_MINUTES[window])
  const sampleCount = windowTicks.length
  const start = windowTicks[0]
  const end = windowTicks.at(-1)

  if (!start || !end || sampleCount < MIN_TICK_SAMPLE) {
    return {
      window,
      sampleCount,
      returnPct: null,
      realizedVolPct: null,
      velocityTicksPerMin: sampleCount > 1 ? sampleCount / WINDOW_MINUTES[window] : null,
      rangePct: null,
      averageSpreadBps: null,
      latestSpreadBps: null,
    }
  }

  const returnPct = pctChange(start.price, end.price)
  const realizedVolPct = computeRealizedVolatility(windowTicks)
  const velocityTicksPerMin = computeTickVelocity(windowTicks, window)
  const rangePct = computeRangePct(windowTicks)
  const averageSpreadBps = computeAverageSpreadBps(windowTicks)
  const latestSpreadBps = windowTicks.at(-1)?.spreadBps ?? null

  return {
    window,
    sampleCount,
    returnPct,
    realizedVolPct,
    velocityTicksPerMin,
    rangePct,
    averageSpreadBps,
    latestSpreadBps,
  }
}

function buildWindowValueMap(
  windowMetrics: BtcWindowMetrics[],
  key: "returnPct" | "realizedVolPct",
) {
  return PRICE_DECISION_TIME_WINDOWS.reduce(
    (accumulator, window) => {
      accumulator[window] = windowMetrics.find((metric) => metric.window === window)?.[
        key
      ] ?? null
      return accumulator
    },
    {} as Record<BtcObservationWindow, number | null>,
  )
}

function computeTickVelocity(
  ticks: RealtimeBtcTick[],
  window: BtcObservationWindow | number,
) {
  if (ticks.length < 2) {
    return null
  }

  const windowMinutes = typeof window === "number" ? window : WINDOW_MINUTES[window]
  const sliced = typeof window === "number" ? ticks : sliceWindowTicks(ticks, windowMinutes)
  if (sliced.length < 2) {
    return null
  }

  const elapsedMinutes =
    (sliced.at(-1)!.exchangeTimeMs - sliced[0].exchangeTimeMs) / 60000
  if (elapsedMinutes <= 0) {
    return null
  }

  return sliced.length / elapsedMinutes
}

function computeRealizedVolatility(ticks: RealtimeBtcTick[]) {
  if (ticks.length < 3) {
    return null
  }

  const logReturns: number[] = []
  for (let index = 1; index < ticks.length; index += 1) {
    const previous = ticks[index - 1]
    const current = ticks[index]
    if (previous.price <= 0 || current.price <= 0) {
      continue
    }
    logReturns.push(Math.log(current.price / previous.price))
  }

  if (logReturns.length < 2) {
    return null
  }

  const mean = logReturns.reduce((sum, value) => sum + value, 0) / logReturns.length
  const variance =
    logReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (logReturns.length - 1)

  return Math.sqrt(variance) * Math.sqrt(365 * 24 * 60) * 100
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

function computeAverageSpreadBps(ticks: RealtimeBtcTick[]) {
  const spreads = ticks
    .map((tick) => tick.spreadBps)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))

  if (spreads.length === 0) {
    return null
  }

  return spreads.reduce((sum, value) => sum + value, 0) / spreads.length
}

function classifyVolatilityRegime(
  realizedVolPct: number,
  recentReturnPct: number,
  spreadBps: number,
): BtcVolatilityRegime {
  if (realizedVolPct >= 120 || recentReturnPct >= 0.9 || spreadBps >= 12) {
    return "extreme"
  }

  if (realizedVolPct >= 80 || recentReturnPct >= 0.55 || spreadBps >= 8) {
    return "elevated"
  }

  if (realizedVolPct >= 35 || recentReturnPct >= 0.25 || spreadBps >= 4) {
    return "normal"
  }

  return "low"
}

function classifySpreadState(windowMetrics: BtcWindowMetrics[]): BtcSpreadState {
  const currentMetric = findWindowMetric(windowMetrics, "1m")
  const midMetric = findWindowMetric(windowMetrics, "5m")
  const longMetric = findWindowMetric(windowMetrics, "15m")
  const currentSpread = currentMetric?.latestSpreadBps ?? null
  const midSpread = midMetric?.averageSpreadBps ?? null
  const longSpread = longMetric?.averageSpreadBps ?? null

  if (currentSpread === null || midSpread === null || longSpread === null) {
    return "stable"
  }

  if (currentSpread > midSpread * 1.15 && midSpread > longSpread * 1.05) {
    return "expanding"
  }

  if (currentSpread < midSpread * 0.9 && midSpread < longSpread * 0.95) {
    return "contracting"
  }

  return "stable"
}

function computeSpreadDeltaPct(windowMetrics: BtcWindowMetrics[]) {
  const oneMinute = findWindowMetric(windowMetrics, "1m")
  const fiveMinute = findWindowMetric(windowMetrics, "5m")
  if (!oneMinute || !fiveMinute) {
    return null
  }
  if (
    oneMinute.latestSpreadBps === null ||
    fiveMinute.averageSpreadBps === null ||
    fiveMinute.averageSpreadBps === 0
  ) {
    return null
  }

  return (
    ((oneMinute.latestSpreadBps - fiveMinute.averageSpreadBps) /
      fiveMinute.averageSpreadBps) *
    100
  )
}

function detectSuddenMove(ticks: RealtimeBtcTick[], volatilityRegime: BtcVolatilityRegime) {
  if (ticks.length < 2) {
    return false
  }

  const latest = ticks.at(-1)!
  const previous = ticks.at(-2)!
  const lastMovePct = Math.abs(pctChange(previous.price, latest.price))
  const threshold =
    volatilityRegime === "extreme"
      ? 0.45
      : volatilityRegime === "elevated"
        ? 0.3
        : 0.18

  return lastMovePct >= threshold
}

function calculateTrendPersistenceScore(ticks: RealtimeBtcTick[]) {
  const sample = sliceWindowTicks(ticks, 15)
  if (sample.length < 3) {
    return 50
  }

  const directionSigns: number[] = []
  for (let index = 1; index < sample.length; index += 1) {
    const previous = sample[index - 1]
    const current = sample[index]
    const move = current.price - previous.price
    if (move === 0) {
      continue
    }
    directionSigns.push(Math.sign(move))
  }

  if (directionSigns.length === 0) {
    return 50
  }

  let sameDirectionRuns = 0
  for (let index = 1; index < directionSigns.length; index += 1) {
    if (directionSigns[index] === directionSigns[index - 1]) {
      sameDirectionRuns += 1
    }
  }

  const consistency = sameDirectionRuns / Math.max(directionSigns.length - 1, 1)
  const netMove = sample.at(-1)!.price / sample[0].price - 1
  const range = computeRangePct(sample) ?? 0
  const stability = clamp(1 - range / 0.8, 0, 1)
  const directionalBias = clamp(Math.abs(netMove) / 0.4, 0, 1)
  const score = clamp(
    consistency * 0.45 + stability * 0.35 + directionalBias * 0.2,
    0,
    1,
  )

  return Math.round(score * 100)
}

function classifyChopState({
  oneMinuteReturn,
  fiveMinuteReturn,
  fifteenMinuteReturn,
  trendPersistenceScore,
  volatilityRegime,
}: {
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
  fifteenMinuteReturn: number | null
  trendPersistenceScore: number
  volatilityRegime: BtcVolatilityRegime
}): BtcChopState {
  const shortMove = Math.abs(oneMinuteReturn ?? 0)
  const mediumMove = Math.abs(fiveMinuteReturn ?? 0)
  const longerMove = Math.abs(fifteenMinuteReturn ?? 0)

  if (
    trendPersistenceScore >= 62 &&
    longerMove >= mediumMove * 0.8 &&
    mediumMove >= shortMove * 0.8 &&
    volatilityRegime !== "extreme"
  ) {
    return "trending"
  }

  if (trendPersistenceScore <= 40 || shortMove < 0.04 || mediumMove < 0.08) {
    return "range-bound"
  }

  return "mixed"
}

function computeMomentumScore({
  oneMinuteReturn,
  fiveMinuteReturn,
  fifteenMinuteReturn,
  priceAccelerationBpsPerMin2,
  trendPersistenceScore,
  spreadState,
}: {
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
  fifteenMinuteReturn: number | null
  priceAccelerationBpsPerMin2: number | null
  trendPersistenceScore: number
  spreadState: BtcSpreadState
}) {
  const short = clamp((oneMinuteReturn ?? 0) / 0.15, -1, 1)
  const medium = clamp((fiveMinuteReturn ?? 0) / 0.35, -1, 1)
  const long = clamp((fifteenMinuteReturn ?? 0) / 0.7, -1, 1)
  const acceleration = clamp((priceAccelerationBpsPerMin2 ?? 0) / 25, -1, 1)
  const persistence = trendPersistenceScore / 100
  const spreadPenalty = spreadState === "expanding" ? 0.12 : 0

  const score =
    short * 0.32 +
    medium * 0.28 +
    long * 0.18 +
    acceleration * 0.12 +
    persistence * 0.1 -
    spreadPenalty

  return Math.round(clamp(score, -1, 1) * 100)
}

function classifyMomentumStatus(
  momentumScore: number,
  chopState: BtcChopState,
): BtcMomentumStatus {
  if (chopState === "range-bound" && Math.abs(momentumScore) < 18) {
    return "flat"
  }

  if (momentumScore >= 55) {
    return "strong bullish"
  }

  if (momentumScore >= 18) {
    return "bullish"
  }

  if (momentumScore <= -55) {
    return "strong bearish"
  }

  if (momentumScore <= -18) {
    return "bearish"
  }

  return "flat"
}

function classifyDirectionBias({
  momentumScore,
  momentumStatus,
  trendPersistenceScore,
  oneMinuteReturn,
  fiveMinuteReturn,
  volatilityRegime,
  suddenMoveDetected,
}: {
  momentumScore: number
  momentumStatus: BtcMomentumStatus
  trendPersistenceScore: number
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
  volatilityRegime: BtcVolatilityRegime
  suddenMoveDetected: boolean
}): BtcDirectionBias {
  if (suddenMoveDetected && Math.abs(momentumScore) < 25) {
    return "neutral"
  }

  const short = oneMinuteReturn ?? 0
  const medium = fiveMinuteReturn ?? 0
  const combined = short * 0.6 + medium * 0.4

  if (
    momentumStatus === "strong bullish" ||
    (combined > 0.08 && trendPersistenceScore >= 55 && volatilityRegime !== "extreme")
  ) {
    return "bullish"
  }

  if (
    momentumStatus === "strong bearish" ||
    (combined < -0.08 && trendPersistenceScore >= 55 && volatilityRegime !== "extreme")
  ) {
    return "bearish"
  }

  return "neutral"
}

function classifyRiskState({
  stale,
  volatilityRegime,
  spreadBps,
  suddenMoveDetected,
  trendPersistenceScore,
  momentumStatus,
}: {
  stale: boolean
  volatilityRegime: BtcVolatilityRegime
  spreadBps: number | null
  suddenMoveDetected: boolean
  trendPersistenceScore: number
  momentumStatus: BtcMomentumStatus
}): BtcRiskState {
  if (stale || volatilityRegime === "extreme" || suddenMoveDetected) {
    return "avoid"
  }

  if (
    volatilityRegime === "elevated" ||
    (spreadBps !== null && spreadBps >= 8) ||
    trendPersistenceScore < 42 ||
    momentumStatus === "flat"
  ) {
    return "caution"
  }

  return "clean"
}

function computeConfidenceScore({
  ticks,
  stale,
  riskState,
  directionBias,
  signalQualityScore,
  marketState,
  marketRegime,
  signalSuppression,
  falseBreakout,
  socialNews,
  volatilityRegime,
  spreadBps,
  trendPersistenceScore,
  momentumScore,
  oneMinuteReturn,
  fiveMinuteReturn,
}: {
  ticks: RealtimeBtcTick[]
  stale: boolean
  riskState: BtcRiskState
  directionBias: BtcDirectionBias
  signalQualityScore: number
  marketState: BtcMarketStateSnapshot
  marketRegime: BtcMarketRegimeSnapshot
  signalSuppression: BtcSignalSuppressionSnapshot
  falseBreakout: BtcFalseBreakoutSnapshot
  socialNews: BtcSocialNewsSnapshot | null
  volatilityRegime: BtcVolatilityRegime
  spreadBps: number | null
  trendPersistenceScore: number
  momentumScore: number
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
}) {
  const sampleQuality = clamp(ticks.length / 25, 0, 1)
  const directionalStrength = clamp(Math.abs(momentumScore) / 100, 0, 1)
  const persistence = trendPersistenceScore / 100
  const signalQuality = clamp(signalQualityScore / 100, 0, 1)
  const spreadQuality = clamp(1 - (spreadBps ?? 0) / 12, 0, 1)
  const regimePenalty =
    volatilityRegime === "extreme" ? 0.3 : volatilityRegime === "elevated" ? 0.15 : 0
  const alignmentBonus =
    directionBias === "neutral"
      ? 0
      : Math.sign(oneMinuteReturn ?? 0) === Math.sign(fiveMinuteReturn ?? 0)
      ? 0.08
      : -0.05
  const riskPenalty = riskState === "avoid" ? 0.35 : riskState === "caution" ? 0.15 : 0
  const stalePenalty = stale ? 0.28 : 0
  const regimeSupport = clamp(marketRegime.regimeConfidence / 100, 0, 1)
  const regimeStability = clamp(marketRegime.regimeStabilityScore / 100, 0, 1)
  const regimeAlignment = computeRegimeAlignment(directionBias, marketRegime)
  const breakoutSupport = clamp(falseBreakout.breakoutHealthScore / 100, 0, 1)
  const breakoutRiskPenalty = clamp(falseBreakout.falseBreakoutRisk / 100, 0, 0.3)
  const breakoutExhaustionPenalty = clamp(falseBreakout.exhaustionScore / 100, 0, 0.18)
  const breakoutFollowThrough = clamp(falseBreakout.followThroughQuality / 100, 0, 1)
  const marketStateQuality = clamp(marketState.signalInterpretabilityScore / 100, 0, 1)
  const socialNewsPenalty = computeSocialNewsPenalty({
    socialNews,
    volatilityRegime,
    stale,
    riskState,
  })
  const socialNewsSupport = computeSocialNewsSupport(socialNews)
  const marketStatePenalty =
    marketState.state === "unavailable"
      ? 0.22
      : marketState.state === "unstable"
        ? 0.12
        : marketState.state === "noisy"
          ? 0.08
          : marketState.state === "mixed"
            ? 0.03
            : 0
  const regimeUncertaintyPenalty =
    marketRegime.regimeClarity === "ambiguous" ? 0.08 : marketRegime.isTransitioning ? 0.05 : 0
  const suppressionPenalty = clamp(signalSuppression.confidencePenalty / 100, 0, 0.3)
  const raw =
    sampleQuality * 0.18 +
    directionalStrength * 0.32 +
    persistence * 0.22 +
    spreadQuality * 0.1 +
    signalQuality * 0.14 +
    marketStateQuality * 0.1 +
    regimeSupport * 0.08 +
    regimeStability * 0.06 +
    regimeAlignment * 0.08 +
    breakoutSupport * 0.08 +
    breakoutFollowThrough * 0.05 -
    breakoutRiskPenalty -
    breakoutExhaustionPenalty -
    alignmentBonus -
    suppressionPenalty -
    regimeUncertaintyPenalty -
    marketStatePenalty -
    regimePenalty -
    riskPenalty -
    stalePenalty +
    socialNewsSupport -
    socialNewsPenalty +
    0.14

  return Math.round(clamp(raw, 0, 1) * 100)
}

function computeSocialNewsPenalty({
  socialNews,
  volatilityRegime,
  stale,
  riskState,
}: {
  socialNews: BtcSocialNewsSnapshot | null
  volatilityRegime: BtcVolatilityRegime
  stale: boolean
  riskState: BtcRiskState
}) {
  if (!socialNews) {
    return volatilityRegime === "elevated" || volatilityRegime === "extreme" || stale || riskState === "avoid"
      ? 0.08
      : 0.03
  }

  if (!socialNews.available) {
    return volatilityRegime === "elevated" || volatilityRegime === "extreme" ? 0.12 : 0.06
  }

  if (socialNews.eventRiskState === "unreliable/noisy") {
    return 0.14
  }

  if (socialNews.eventRiskState === "active catalyst") {
    return 0.06
  }

  return 0
}

function computeSocialNewsSupport(socialNews: BtcSocialNewsSnapshot | null) {
  if (!socialNews || !socialNews.available) {
    return 0
  }

  if (socialNews.eventRiskState === "active catalyst") {
    return 0.03
  }

  if (socialNews.eventRiskState === "elevated") {
    return 0.02
  }

  return 0.01
}

function socialNewsQualityPenalty(socialNews: BtcSocialNewsSnapshot | null) {
  if (!socialNews) {
    return 0.04
  }

  if (!socialNews.available) {
    return 0.1
  }

  if (socialNews.eventRiskState === "unreliable/noisy") {
    return 0.16
  }

  if (socialNews.eventRiskState === "active catalyst") {
    return 0.06
  }

  return 0
}

function suggestObservationWindow({
  riskState,
  volatilityRegime,
  trendPersistenceScore,
  momentumStatus,
  suddenMoveDetected,
  oneMinuteReturn,
  fiveMinuteReturn,
  oneHourReturn,
  marketRegime,
  signalSuppression,
  falseBreakout,
  socialNews,
}: {
  riskState: BtcRiskState
  volatilityRegime: BtcVolatilityRegime
  trendPersistenceScore: number
  momentumStatus: BtcMomentumStatus
  suddenMoveDetected: boolean
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
  oneHourReturn: number | null
  marketRegime: BtcMarketRegimeSnapshot
  signalSuppression: BtcSignalSuppressionSnapshot
  falseBreakout: BtcFalseBreakoutSnapshot
  socialNews: BtcSocialNewsSnapshot | null
}): BtcObservationWindow {
  if (socialNews?.eventRiskState === "active catalyst" && volatilityRegime !== "extreme") {
    return trendPersistenceScore >= 62 ? "5m" : "15m"
  }

  if (signalSuppression.level === "unavailable") {
    return "1h"
  }

  if (riskState === "avoid") {
    return "1h"
  }

  if (suddenMoveDetected || volatilityRegime === "extreme") {
    return "1m"
  }

  if (
    momentumStatus === "strong bullish" ||
    momentumStatus === "strong bearish" ||
    (Math.abs(oneMinuteReturn ?? 0) > 0.22 && Math.abs(fiveMinuteReturn ?? 0) > 0.28)
  ) {
    return trendPersistenceScore >= 68 ? "1m" : "5m"
  }

  if (volatilityRegime === "elevated") {
    return trendPersistenceScore >= 58 ? "5m" : "15m"
  }

  if (
    marketRegime.primaryRegime === "breakout conditions" ||
    marketRegime.primaryRegime === "high-volatility expansion"
  ) {
    if (falseBreakout.falseBreakoutRisk >= 65 || falseBreakout.breakoutStatus === "false breakout risk") {
      return "5m"
    }

    return trendPersistenceScore >= 62 ? "1m" : "5m"
  }

  if (
    marketRegime.primaryRegime === "mean-reverting" ||
    marketRegime.primaryRegime === "choppy / noisy" ||
    marketRegime.primaryRegime === "exhaustion conditions"
  ) {
    return "15m"
  }

  if (momentumStatus === "flat" || trendPersistenceScore < 45) {
    return oneHourReturn !== null && Math.abs(oneHourReturn) < 0.45 ? "15m" : "1h"
  }

  return trendPersistenceScore >= 55 ? "5m" : "15m"
}

function buildAlerts({
  stale,
  suddenMoveDetected,
  spreadState,
  spreadBps,
  volatilityRegime,
  riskState,
  marketQuality,
  marketState,
  marketRegime,
  signalSuppression,
  falseBreakout,
  socialNews,
}: {
  stale: boolean
  suddenMoveDetected: boolean
  spreadState: BtcSpreadState
  spreadBps: number | null
  volatilityRegime: BtcVolatilityRegime
  riskState: BtcRiskState
  marketQuality: BtcMarketQualitySnapshot
  marketState: BtcMarketStateSnapshot
  marketRegime: BtcMarketRegimeSnapshot
  signalSuppression: BtcSignalSuppressionSnapshot
  falseBreakout: BtcFalseBreakoutSnapshot
  socialNews: BtcSocialNewsSnapshot | null
}) {
  return [
    stale ? "Feed is stale. No fresh tick or heartbeat has arrived within the timeout window." : null,
    suddenMoveDetected
      ? "Sudden move detected in the latest print. Re-evaluate the short-term setup."
      : null,
    spreadState === "expanding"
      ? "Spread is expanding relative to the recent window."
      : null,
    spreadBps !== null && spreadBps >= 8 ? "Bid-ask spread is wide for short-horizon reading." : null,
    volatilityRegime === "extreme" ? "BTC is in an extreme volatility regime." : null,
    riskState === "avoid" ? "Risk state is avoid until the feed and regime normalize." : null,
    marketQuality.warning,
    marketState.warning,
    signalSuppression.warning,
    falseBreakout.warning,
    socialNews?.warning,
    socialNews?.eventRiskState === "active catalyst"
      ? `Major catalyst detected: ${socialNews.summary}`
      : null,
    ...marketRegime.warnings,
  ].filter(Boolean) as string[]
}

function buildNotes({
  momentumStatus,
  chopState,
  trendPersistenceScore,
  observationWindow,
  marketQuality,
  marketState,
  marketRegime,
  signalSuppression,
  falseBreakout,
  socialNews,
}: {
  momentumStatus: BtcMomentumStatus
  chopState: BtcChopState
  trendPersistenceScore: number
  observationWindow: BtcObservationWindow
  marketQuality: BtcMarketQualitySnapshot
  marketState: BtcMarketStateSnapshot
  marketRegime: BtcMarketRegimeSnapshot
  signalSuppression: BtcSignalSuppressionSnapshot
  falseBreakout: BtcFalseBreakoutSnapshot
  socialNews: BtcSocialNewsSnapshot | null
}) {
  return [
    `Direction bias reads ${marketQuality.directionalReadout}.`,
    `Market state is ${marketState.state} with ${marketState.interpretability} interpretability (${marketState.signalInterpretabilityScore}/100).`,
    `Momentum reads ${momentumStatus}.`,
    `Market structure currently looks ${chopState}.`,
    `Trend persistence score is ${trendPersistenceScore}.`,
    `Signal quality is ${marketQuality.signalQualityState} (${marketQuality.signalQualityScore}/100).`,
    `Regime reads ${marketRegime.primaryRegime} (${marketRegime.regimeConfidence}/100 confidence).`,
    `Signal suppression is ${signalSuppression.level}.`,
    `Breakout intelligence reads ${falseBreakout.breakoutStatus} (${falseBreakout.falseBreakoutRisk}/100 false-breakout risk).`,
    socialNews
      ? `Social/news event risk is ${socialNews.eventRiskState} with ${socialNews.pressureScore > 0 ? "bullish" : socialNews.pressureScore < 0 ? "bearish" : "neutral"} pressure ${formatSignedMetric(
          socialNews.pressureScore,
          "score",
        )}.`
      : "Social/news event pressure is unavailable.",
    `Suggested observation window: ${observationWindow}.`,
  ]
}

function buildDecisionExplanation({
  directionBias,
  momentumStatus,
  chopState,
  marketQuality,
  marketState,
  marketRegime,
  signalSuppression,
  spreadState,
  volatilityRegime,
  trendPersistenceScore,
  oneMinuteReturn,
  fiveMinuteReturn,
  priceAccelerationBpsPerMin2,
  suddenMoveDetected,
  falseBreakout,
  socialNews,
}: {
  directionBias: BtcDirectionBias
  momentumStatus: BtcMomentumStatus
  chopState: BtcChopState
  marketQuality: BtcMarketQualitySnapshot
  marketState: BtcMarketStateSnapshot
  marketRegime: BtcMarketRegimeSnapshot
  signalSuppression: BtcSignalSuppressionSnapshot
  spreadState: BtcSpreadState
  volatilityRegime: BtcVolatilityRegime
  trendPersistenceScore: number
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
  priceAccelerationBpsPerMin2: number | null
  suddenMoveDetected: boolean
  falseBreakout: BtcFalseBreakoutSnapshot
  socialNews: BtcSocialNewsSnapshot | null
}): BtcDecisionExplanation {
  const spreadContext =
    spreadState === "stable"
      ? "spread remains stable"
      : spreadState === "contracting"
        ? "spread is contracting"
        : "spread is expanding"

  const volatilityContext = `volatility is ${volatilityRegime}`
  const persistenceLabel = `${trendPersistenceScore}/100 trend persistence`
  const accelerationLabel = formatSignedMetric(
    priceAccelerationBpsPerMin2,
    "bps/min^2",
  )
  const directionalPressure = marketQuality.directionalReadout
  const weakPressure = marketQuality.signalQualityState === "weak signal"
  const noisyState = marketQuality.signalQualityState === "noisy / avoid"
  const regimePhrase =
    marketRegime.regimeClarity === "ambiguous"
      ? "the regime is ambiguous"
      : `the regime reads ${marketRegime.primaryRegime}`
  const suppressionActive = signalSuppression.level !== "none"
  const breakoutActive = falseBreakout.breakoutDirection !== "none"
  const eventContext =
    socialNews === null
      ? "social/news pressure is unavailable"
      : !socialNews.available
        ? "social/news pressure is unavailable"
        : socialNews.eventRiskState === "active catalyst"
          ? `social/news flow is acting as an active catalyst (${socialNews.summary})`
          : socialNews.eventRiskState === "unreliable/noisy"
            ? "social/news flow is noisy"
            : socialNews.eventRiskState === "elevated"
              ? "social/news pressure is elevated"
              : "social/news flow is calm"
  const suppressionText =
    signalSuppression.level === "unavailable"
      ? "Directional pressure is unavailable."
      : signalSuppression.level === "suppress directional bias"
        ? "Directional bias is suppressed."
        : suppressionActive
          ? "Directional pressure is muted."
          : null
  const breakoutText =
    breakoutActive && falseBreakout.falseBreakoutRisk >= 65
      ? "Breakout conditions are fragile and may fail."
      : breakoutActive && falseBreakout.breakoutStatus === "ambiguous"
        ? "Breakout conditions are ambiguous."
        : falseBreakout.breakoutStatus === "confirmed breakout"
          ? "Breakout follow-through is holding."
          : null

  if (directionBias === "bullish") {
    return {
      primaryReason: suppressionText ??
        breakoutText ??
        (noisyState
        ? `Directional pressure is unclear while ${spreadContext} and ${eventContext}.`
        : weakPressure
          ? `Weak bullish pressure is building while ${spreadContext}, ${regimePhrase}, and ${eventContext}.`
          : `1m momentum is strengthening while ${spreadContext} and ${eventContext}.`),
      supportingSignals: [
        `Tick velocity is ${velocityDirection(oneMinuteReturn)} and momentum reads ${momentumStatus}.`,
        breakoutActive
          ? `Breakout intelligence reads ${falseBreakout.breakoutStatus} with ${falseBreakout.breakoutHealthScore}/100 health.`
          : `Breakout intelligence reads ${falseBreakout.breakoutStatus}.`,
        suppressionActive
          ? `Suppression reasons: ${signalSuppression.reasons.join(", ")}.`
          : weakPressure || noisyState
          ? `Trend persistence is ${persistenceLabel}, but signal quality is ${marketQuality.signalQualityState}.`
          : `Trend persistence is ${persistenceLabel}, which supports continuation.`,
        suppressionActive
          ? `The display readout is ${signalSuppression.directionalReadout}.`
          : weakPressure || noisyState
          ? `5m return is ${formatSignedPercent(fiveMinuteReturn)} and the directional readout is ${directionalPressure}.`
          : `5m return remains constructive at ${formatSignedPercent(fiveMinuteReturn)}.`,
        `Social/news context: ${eventContext}.`,
        `Directional readout is ${directionalPressure}.`,
        `Market state is ${marketState.state} (${marketState.interpretability} interpretability).`,
        `Regime: ${marketRegime.primaryRegime} (${marketRegime.regimeConfidence}/100 confidence).`,
      ],
      conflictingSignals: [
        volatilityRegime === "elevated" || volatilityRegime === "extreme"
          ? `The regime is noisy because ${volatilityContext}.`
          : `Short-horizon structure is still mixed because ${chopState}.`,
        breakoutActive && falseBreakout.falseBreakoutRisk >= 65
          ? "Breakout failure risk is elevated."
          : breakoutActive && falseBreakout.exhaustionScore >= 60
            ? "Breakout exhaustion is starting to build."
            : null,
        suddenMoveDetected
          ? "A sudden move was just detected, which can distort short-term continuation."
          : `Price acceleration is ${accelerationLabel}.`,
        ...marketRegime.conflictingSignals,
      ].filter(Boolean) as string[],
      invalidationCondition:
        "Price acceleration turns negative, the regime becomes ambiguous, or spread expands sharply.",
      biasChangeCondition:
        "A sustained negative 1m/5m turn, weaker persistence, regime reversal, or spread breakout would shift the bias away from bullish.",
    }
  }

  if (directionBias === "bearish") {
    return {
      primaryReason: suppressionText ??
        breakoutText ??
        (noisyState
        ? `Directional pressure is unclear while ${spreadContext} and ${eventContext}.`
        : weakPressure
          ? `Weak bearish pressure is building while ${spreadContext}, ${regimePhrase}, and ${eventContext}.`
          : `1m momentum is weakening while ${spreadContext} and ${eventContext}.`),
      supportingSignals: [
        `Tick velocity is ${velocityDirection(oneMinuteReturn)} and momentum reads ${momentumStatus}.`,
        breakoutActive
          ? `Breakout intelligence reads ${falseBreakout.breakoutStatus} with ${falseBreakout.breakoutHealthScore}/100 health.`
          : `Breakout intelligence reads ${falseBreakout.breakoutStatus}.`,
        suppressionActive
          ? `Suppression reasons: ${signalSuppression.reasons.join(", ")}.`
          : weakPressure || noisyState
          ? `Trend persistence is ${persistenceLabel}, but signal quality is ${marketQuality.signalQualityState}.`
          : `Trend persistence is ${persistenceLabel}, which supports continuation to the downside.`,
        suppressionActive
          ? `The display readout is ${signalSuppression.directionalReadout}.`
          : weakPressure || noisyState
          ? `5m return is ${formatSignedPercent(fiveMinuteReturn)} and the directional readout is ${directionalPressure}.`
          : `5m return remains weak at ${formatSignedPercent(fiveMinuteReturn)}.`,
        `Social/news context: ${eventContext}.`,
        `Directional readout is ${directionalPressure}.`,
        `Market state is ${marketState.state} (${marketState.interpretability} interpretability).`,
        `Regime: ${marketRegime.primaryRegime} (${marketRegime.regimeConfidence}/100 confidence).`,
      ],
      conflictingSignals: [
        volatilityRegime === "elevated" || volatilityRegime === "extreme"
          ? `The regime is noisy because ${volatilityContext}.`
          : `Short-horizon structure is still mixed because ${chopState}.`,
        breakoutActive && falseBreakout.falseBreakoutRisk >= 65
          ? "Breakout failure risk is elevated."
          : breakoutActive && falseBreakout.exhaustionScore >= 60
            ? "Breakout exhaustion is starting to build."
            : null,
        suddenMoveDetected
          ? "A sudden move was just detected, which can distort short-term continuation."
          : `Price acceleration is ${accelerationLabel}.`,
        ...marketRegime.conflictingSignals,
      ].filter(Boolean) as string[],
      invalidationCondition:
        "Price acceleration turns positive, the regime becomes ambiguous, or spread compresses after the down move.",
      biasChangeCondition:
        "A sustained positive 1m/5m turn, stronger persistence, regime reversal, or spread compression would shift the bias away from bearish.",
    }
  }

  return {
    primaryReason: suppressionText ??
      breakoutText ??
      (noisyState
      ? `Conditions are noisy enough that directional pressure is unclear while ${eventContext}.`
      : `Short-horizon signals are mixed and no persistent directional edge is dominant, with ${eventContext}.`),
    supportingSignals: [
      `Momentum is ${momentumStatus}.`,
      `Trend persistence sits at ${persistenceLabel}.`,
      `The structure is currently ${chopState}.`,
      `Directional readout is ${directionalPressure}.`,
      `Market state is ${marketState.state} (${marketState.interpretability} interpretability).`,
      `Breakout intelligence reads ${falseBreakout.breakoutStatus} (${falseBreakout.breakoutHealthScore}/100 health).`,
      `Social/news context is ${eventContext}.`,
      ...(suppressionActive
        ? [`Suppression reasons: ${signalSuppression.reasons.join(", ")}.`]
        : []),
      `Regime: ${marketRegime.primaryRegime} (${marketRegime.regimeConfidence}/100 confidence).`,
    ],
    conflictingSignals: [
      `The latest move is ${formatSignedPercent(oneMinuteReturn)} on 1m and ${formatSignedPercent(fiveMinuteReturn)} on 5m, so neither side is locked in.`,
      volatilityRegime === "elevated" || volatilityRegime === "extreme"
        ? `Volatility is elevated enough to blur direction because ${volatilityContext}.`
        : "Volatility is not forcing a directional read.",
      breakoutActive && falseBreakout.falseBreakoutRisk >= 65
        ? "Breakout failure risk is elevated."
        : breakoutActive && falseBreakout.exhaustionScore >= 60
          ? "Breakout exhaustion is starting to build."
          : null,
      ...marketRegime.conflictingSignals,
    ].filter(Boolean) as string[],
    invalidationCondition:
      "A persistent move builds in one direction with improving persistence, acceleration, and a clearer regime.",
    biasChangeCondition:
      "Two aligned windows, stronger acceleration, cleaner spread behavior, and a clearer regime would move the bias toward bullish or bearish.",
  }
}

function assessMarketQuality({
  stale,
  riskState,
  directionBias,
  momentumStatus,
  momentumScore,
  trendPersistenceScore,
  volatilityRegime,
  spreadState,
  spreadBps,
  oneMinuteReturn,
  fiveMinuteReturn,
  suddenMoveDetected,
  ticks,
  exchangeConsensus,
  marketRegime,
  falseBreakout,
  socialNews,
}: {
  stale: boolean
  riskState: BtcRiskState
  directionBias: BtcDirectionBias
  momentumStatus: BtcMomentumStatus
  momentumScore: number
  trendPersistenceScore: number
  volatilityRegime: BtcVolatilityRegime
  spreadState: BtcSpreadState
  spreadBps: number | null
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
  suddenMoveDetected: boolean
  ticks: RealtimeBtcTick[]
  exchangeConsensus: BtcExchangeConsensusMetrics | null
  marketRegime: BtcMarketRegimeSnapshot
  falseBreakout: BtcFalseBreakoutSnapshot
  socialNews: BtcSocialNewsSnapshot | null
}): BtcMarketQualitySnapshot {
  const tickConsistencyScore = computeTickConsistencyScore(ticks)
  const volatilityStabilityScore = computeVolatilityStabilityScore(
    volatilityRegime,
    trendPersistenceScore,
    spreadBps,
  )
  const spreadBehaviorScore = computeSpreadBehaviorScore(
    spreadState,
    spreadBps,
  )
  const momentumAlignmentScore = computeMomentumAlignmentScore({
    directionBias,
    momentumStatus,
    momentumScore,
    oneMinuteReturn,
    fiveMinuteReturn,
  })
  const conflictingSignalCount = countConflictingSignals({
    volatilityRegime,
    spreadState,
    spreadBps,
    momentumStatus,
    trendPersistenceScore,
    suddenMoveDetected,
    oneMinuteReturn,
    fiveMinuteReturn,
    exchangeConsensus,
    marketRegime,
    falseBreakout,
    socialNews,
  })

  const exchangeAgreementScore = exchangeConsensus?.agreementScore ?? 0
  const activeExchangeCount = exchangeConsensus?.activeExchangeCount ?? 0
  const staleExchangeCount = exchangeConsensus?.staleExchangeCount ?? 0
  const totalExchangeCount = exchangeConsensus?.totalExchangeCount ?? 0
  const maxDeviationPct = exchangeConsensus?.maxDeviationPct ?? null
  const medianDeviationPct = exchangeConsensus?.medianDeviationPct ?? null

  const qualityScore = clamp(
    tickConsistencyScore * 0.24 +
      volatilityStabilityScore * 0.22 +
      spreadBehaviorScore * 0.2 +
      momentumAlignmentScore * 0.14 +
      clamp(exchangeAgreementScore / 100, 0, 1) * 0.18 +
      clamp(marketRegime.regimeConfidence / 100, 0, 1) * 0.08 +
      clamp(marketRegime.regimeStabilityScore / 100, 0, 1) * 0.08 +
      (computeRegimeAlignment(directionBias, marketRegime) - 0.5) * 0.12 +
      (trendPersistenceScore / 100) * 0.16 -
      clamp(falseBreakout.falseBreakoutRisk / 100, 0, 0.22) +
      clamp(falseBreakout.breakoutHealthScore / 100, 0, 0.12) +
      clamp(falseBreakout.followThroughQuality / 100, 0, 0.1) -
      socialNewsQualityPenalty(socialNews) +
      conflictingSignalCount * 0.06 -
      (stale ? 0.12 : 0) -
      (riskState === "avoid" ? 0.18 : riskState === "caution" ? 0.08 : 0),
    0,
    1,
  )

  const signalQualityScore = Math.round(qualityScore * 100)
  const signalQualityState = classifySignalQualityState(
    signalQualityScore,
    riskState,
    stale,
  )
  const noiseLevel = 100 - signalQualityScore
  const directionalClarity = classifyDirectionalClarity(
    directionBias,
    signalQualityState,
    activeExchangeCount,
    marketRegime,
    falseBreakout,
  )
  const stabilityAssessment = classifyStabilityAssessment(
    volatilityStabilityScore,
    spreadBehaviorScore,
    signalQualityState,
  )

  return {
    signalQualityScore,
    signalQualityState,
    noiseLevel,
    directionalClarity,
    stabilityAssessment,
    tickConsistencyScore,
    conflictingSignalCount,
    exchangeAgreementScore,
    activeExchangeCount,
    staleExchangeCount,
    totalExchangeCount,
    maxDeviationPct,
    medianDeviationPct,
    warning:
      signalQualityState === "weak signal" ||
      signalQualityState === "noisy / avoid" ||
      marketRegime.regimeClarity === "ambiguous" ||
      socialNews?.eventRiskState === "unreliable/noisy" ||
      falseBreakout.falseBreakoutRisk >= 70 ||
      falseBreakout.breakoutStatus === "false breakout risk"
        ? "Conditions currently unsuitable for high-confidence directional interpretation."
        : null,
    directionalReadout: formatDirectionalReadout(
      directionBias,
      signalQualityState,
      marketRegime,
    ),
  }
}

function computeTickConsistencyScore(ticks: RealtimeBtcTick[]) {
  const sample = sliceWindowTicks(ticks, 15)
  if (sample.length < 3) {
    return 50
  }

  const directionSigns: number[] = []
  for (let index = 1; index < sample.length; index += 1) {
    const previous = sample[index - 1]
    const current = sample[index]
    const move = current.price - previous.price
    if (move !== 0) {
      directionSigns.push(Math.sign(move))
    }
  }

  if (directionSigns.length < 2) {
    return 55
  }

  let sameDirectionRuns = 0
  for (let index = 1; index < directionSigns.length; index += 1) {
    if (directionSigns[index] === directionSigns[index - 1]) {
      sameDirectionRuns += 1
    }
  }

  const consistency = sameDirectionRuns / Math.max(directionSigns.length - 1, 1)
  return Math.round(clamp(consistency, 0, 1) * 100)
}

function computeVolatilityStabilityScore(
  volatilityRegime: BtcVolatilityRegime,
  trendPersistenceScore: number,
  spreadBps: number | null,
) {
  const regimeScore =
    volatilityRegime === "low"
      ? 1
      : volatilityRegime === "normal"
        ? 0.82
        : volatilityRegime === "elevated"
          ? 0.52
          : 0.2
  const persistenceScore = clamp(trendPersistenceScore / 100, 0, 1)
  const spreadScore = clamp(1 - (spreadBps ?? 0) / 12, 0, 1)
  return clamp(regimeScore * 0.55 + persistenceScore * 0.2 + spreadScore * 0.25, 0, 1)
}

function computeSpreadBehaviorScore(
  spreadState: BtcSpreadState,
  spreadBps: number | null,
) {
  const stateScore =
    spreadState === "contracting"
      ? 1
      : spreadState === "stable"
        ? 0.72
        : 0.32
  const levelScore = clamp(1 - (spreadBps ?? 0) / 14, 0, 1)
  return clamp(stateScore * 0.7 + levelScore * 0.3, 0, 1)
}

function computeMomentumAlignmentScore({
  directionBias,
  momentumStatus,
  momentumScore,
  oneMinuteReturn,
  fiveMinuteReturn,
}: {
  directionBias: BtcDirectionBias
  momentumStatus: BtcMomentumStatus
  momentumScore: number
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
}) {
  const statusScore =
    momentumStatus === "strong bullish" || momentumStatus === "strong bearish"
      ? 1
      : momentumStatus === "bullish" || momentumStatus === "bearish"
        ? 0.72
        : 0.4
  const directionScore =
    directionBias === "neutral"
      ? 0.45
      : Math.sign(oneMinuteReturn ?? 0) === Math.sign(fiveMinuteReturn ?? 0) &&
          Math.sign(oneMinuteReturn ?? 0) === Math.sign(momentumScore)
        ? 1
        : 0.35
  return clamp(statusScore * 0.5 + directionScore * 0.5, 0, 1)
}

function countConflictingSignals({
  volatilityRegime,
  spreadState,
  spreadBps,
  momentumStatus,
  trendPersistenceScore,
  suddenMoveDetected,
  oneMinuteReturn,
  fiveMinuteReturn,
  exchangeConsensus,
  marketRegime,
  falseBreakout,
  socialNews,
}: {
  volatilityRegime: BtcVolatilityRegime
  spreadState: BtcSpreadState
  spreadBps: number | null
  momentumStatus: BtcMomentumStatus
  trendPersistenceScore: number
  suddenMoveDetected: boolean
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
  exchangeConsensus: BtcExchangeConsensusMetrics | null
  marketRegime: BtcMarketRegimeSnapshot
  falseBreakout: BtcFalseBreakoutSnapshot
  socialNews: BtcSocialNewsSnapshot | null
}) {
  return [
    volatilityRegime === "elevated" || volatilityRegime === "extreme",
    spreadState === "expanding",
    spreadBps !== null && spreadBps >= 8,
    momentumStatus === "flat",
    trendPersistenceScore < 45,
    suddenMoveDetected,
    oneMinuteReturn !== null &&
      fiveMinuteReturn !== null &&
      oneMinuteReturn !== 0 &&
      fiveMinuteReturn !== 0 &&
      Math.sign(oneMinuteReturn) !== Math.sign(fiveMinuteReturn),
    exchangeConsensus !== null && exchangeConsensus.activeExchangeCount <= 1,
    exchangeConsensus !== null &&
      exchangeConsensus.maxDeviationPct !== null &&
      exchangeConsensus.maxDeviationPct >= 0.12,
    socialNews !== null && !socialNews.available,
    socialNews !== null && socialNews.eventRiskState === "unreliable/noisy",
    socialNews !== null && socialNews.eventRiskState === "active catalyst" && socialNews.confidenceImpact >= 65,
    marketRegime.regimeClarity === "ambiguous" ||
      marketRegime.regimeConfidence < 55 ||
      marketRegime.regimeStabilityScore < 45,
    falseBreakout.falseBreakoutRisk >= 65,
    falseBreakout.breakoutStatus === "false breakout risk",
  ].filter(Boolean).length
}

function classifySignalQualityState(
  signalQualityScore: number,
  riskState: BtcRiskState,
  stale: boolean,
): BtcSignalQualityState {
  if (stale || riskState === "avoid" || signalQualityScore < 35) {
    return "noisy / avoid"
  }

  if (signalQualityScore >= 75) {
    return "strong signal"
  }

  if (signalQualityScore >= 55) {
    return "moderate signal"
  }

  return "weak signal"
}

function classifyDirectionalClarity(
  directionBias: BtcDirectionBias,
  signalQualityState: BtcSignalQualityState,
  activeExchangeCount: number,
  marketRegime: BtcMarketRegimeSnapshot,
  falseBreakout: BtcFalseBreakoutSnapshot,
): BtcDirectionalClarity {
  if (
    directionBias === "neutral" ||
    signalQualityState === "noisy / avoid" ||
    activeExchangeCount <= 1 ||
    marketRegime.regimeClarity === "ambiguous" ||
    falseBreakout.falseBreakoutRisk >= 70 ||
    falseBreakout.breakoutStatus === "false breakout risk"
  ) {
    return "unclear"
  }

  if (signalQualityState === "strong signal") {
    return "clear"
  }

  return "muted"
}

function classifyStabilityAssessment(
  volatilityStabilityScore: number,
  spreadBehaviorScore: number,
  signalQualityState: BtcSignalQualityState,
): BtcStabilityAssessment {
  if (signalQualityState === "noisy / avoid") {
    return "unstable"
  }

  if (volatilityStabilityScore >= 0.7 && spreadBehaviorScore >= 0.65) {
    return "stable"
  }

  if (volatilityStabilityScore >= 0.45 && spreadBehaviorScore >= 0.45) {
    return "mixed"
  }

  return "unstable"
}

function formatDirectionalReadout(
  directionBias: BtcDirectionBias,
  signalQualityState: BtcSignalQualityState,
  marketRegime: BtcMarketRegimeSnapshot,
) {
  if (
    signalQualityState === "noisy / avoid" ||
    directionBias === "neutral" ||
    marketRegime.regimeClarity === "ambiguous"
  ) {
    return "unclear"
  }

  if (
    signalQualityState === "weak signal" ||
    marketRegime.primaryRegime === "mean-reverting" ||
    marketRegime.primaryRegime === "choppy / noisy" ||
    marketRegime.primaryRegime === "exhaustion conditions"
  ) {
    return `weak ${directionBias} pressure`
  }

  if (
    signalQualityState === "moderate signal" &&
    (marketRegime.primaryRegime === "trending up" ||
      marketRegime.primaryRegime === "trending down" ||
      marketRegime.primaryRegime === "breakout conditions")
  ) {
    return `${directionBias} pressure`
  }

  if (marketRegime.primaryRegime === "low-volatility compression") {
    return `developing ${directionBias} pressure`
  }

  return directionBias
}

function computeRegimeAlignment(
  directionBias: BtcDirectionBias,
  regime: BtcMarketRegimeSnapshot,
) {
  if (directionBias === "neutral") {
    return regime.primaryRegime === "mean-reverting" ||
      regime.primaryRegime === "low-volatility compression"
      ? 0.7
      : 0.5
  }

  const aligned =
    (directionBias === "bullish" &&
      (regime.primaryRegime === "trending up" ||
        regime.primaryRegime === "breakout conditions")) ||
    (directionBias === "bearish" &&
      (regime.primaryRegime === "trending down" ||
        regime.primaryRegime === "breakout conditions"))

  if (aligned) {
    return regime.regimeClarity === "clear" ? 1 : 0.82
  }

  if (regime.regimeClarity === "ambiguous") {
    return 0.25
  }

  if (regime.primaryRegime === "mean-reverting" || regime.primaryRegime === "choppy / noisy") {
    return 0.35
  }

  return 0.5
}

function formatSignedPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "n/a"
  }

  const digits = Math.abs(value) < 1 ? 4 : 2
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`
}

function formatSignedMetric(value: number | null, suffix: string) {
  if (value === null || Number.isNaN(value)) {
    return "n/a"
  }

  const digits = Math.abs(value) < 1 ? 4 : 2
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)} ${suffix}`
}

function velocityDirection(oneMinuteReturn: number | null) {
  if (oneMinuteReturn === null || Number.isNaN(oneMinuteReturn)) {
    return "is unavailable"
  }

  if (oneMinuteReturn > 0) {
    return "is rising"
  }

  if (oneMinuteReturn < 0) {
    return "is falling"
  }

  return "is flat"
}

function sliceWindowTicks(ticks: RealtimeBtcTick[], windowMinutes: number) {
  if (ticks.length === 0) {
    return []
  }

  const endMs = ticks.at(-1)!.exchangeTimeMs
  const startMs = endMs - windowMinutes * 60 * 1000
  return ticks.filter((tick) => tick.exchangeTimeMs >= startMs)
}

function getCoverageMinutes(ticks: RealtimeBtcTick[]) {
  if (ticks.length < 2) {
    return null
  }

  const first = ticks[0]
  const last = ticks.at(-1)
  if (!first || !last) {
    return null
  }

  return (last.exchangeTimeMs - first.exchangeTimeMs) / 60000
}

function findWindowMetric(
  metrics: BtcWindowMetrics[],
  window: BtcObservationWindow,
) {
  return metrics.find((metric) => metric.window === window)
}

function pctChange(start: number, end: number) {
  if (start <= 0) {
    return 0
  }

  return ((end - start) / start) * 100
}
