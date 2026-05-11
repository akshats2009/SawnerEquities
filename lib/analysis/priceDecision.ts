import {
  BTC_PRODUCT_ID,
  type RealtimeBtcTick,
} from "@/lib/btc/realtime"
import { clamp } from "@/lib/utils"

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
  const confidenceScore = computeConfidenceScore({
    ticks: sortedTicks,
    stale,
    riskState,
    directionBias,
    volatilityRegime,
    spreadBps,
    trendPersistenceScore,
    momentumScore,
    oneMinuteReturn,
    fiveMinuteReturn,
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
  })

  const alerts = buildAlerts({
    stale,
    suddenMoveDetected,
    spreadState,
    spreadBps,
    volatilityRegime,
    riskState,
  })

  const explanation = buildDecisionExplanation({
    directionBias,
    momentumStatus,
    chopState,
    spreadState,
    volatilityRegime,
    trendPersistenceScore,
    oneMinuteReturn,
    fiveMinuteReturn,
    priceAccelerationBpsPerMin2,
    suddenMoveDetected,
  })

  const notes = buildNotes({
    directionBias,
    momentumStatus,
    chopState,
    trendPersistenceScore,
    observationWindow,
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
  const raw =
    sampleQuality * 0.18 +
    directionalStrength * 0.32 +
    persistence * 0.22 +
    spreadQuality * 0.12 +
    alignmentBonus -
    regimePenalty -
    riskPenalty -
    stalePenalty +
    0.16

  return Math.round(clamp(raw, 0, 1) * 100)
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
}: {
  riskState: BtcRiskState
  volatilityRegime: BtcVolatilityRegime
  trendPersistenceScore: number
  momentumStatus: BtcMomentumStatus
  suddenMoveDetected: boolean
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
  oneHourReturn: number | null
}): BtcObservationWindow {
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
}: {
  stale: boolean
  suddenMoveDetected: boolean
  spreadState: BtcSpreadState
  spreadBps: number | null
  volatilityRegime: BtcVolatilityRegime
  riskState: BtcRiskState
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
  ].filter(Boolean) as string[]
}

function buildNotes({
  directionBias,
  momentumStatus,
  chopState,
  trendPersistenceScore,
  observationWindow,
}: {
  directionBias: BtcDirectionBias
  momentumStatus: BtcMomentumStatus
  chopState: BtcChopState
  trendPersistenceScore: number
  observationWindow: BtcObservationWindow
}) {
  return [
    `Direction bias leans ${directionBias}.`,
    `Momentum reads ${momentumStatus}.`,
    `Market structure currently looks ${chopState}.`,
    `Trend persistence score is ${trendPersistenceScore}.`,
    `Suggested observation window: ${observationWindow}.`,
  ]
}

function buildDecisionExplanation({
  directionBias,
  momentumStatus,
  chopState,
  spreadState,
  volatilityRegime,
  trendPersistenceScore,
  oneMinuteReturn,
  fiveMinuteReturn,
  priceAccelerationBpsPerMin2,
  suddenMoveDetected,
}: {
  directionBias: BtcDirectionBias
  momentumStatus: BtcMomentumStatus
  chopState: BtcChopState
  spreadState: BtcSpreadState
  volatilityRegime: BtcVolatilityRegime
  trendPersistenceScore: number
  oneMinuteReturn: number | null
  fiveMinuteReturn: number | null
  priceAccelerationBpsPerMin2: number | null
  suddenMoveDetected: boolean
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

  if (directionBias === "bullish") {
    return {
      primaryReason: `1m momentum is strengthening while ${spreadContext}.`,
      supportingSignals: [
        `Tick velocity is ${velocityDirection(oneMinuteReturn)} and momentum reads ${momentumStatus}.`,
        `Trend persistence is ${persistenceLabel}, which supports continuation.`,
        `5m return remains constructive at ${formatSignedPercent(fiveMinuteReturn)}.`,
      ],
      conflictingSignals: [
        volatilityRegime === "elevated" || volatilityRegime === "extreme"
          ? `The regime is noisy because ${volatilityContext}.`
          : `Short-horizon structure is still mixed because ${chopState}.`,
        suddenMoveDetected
          ? "A sudden move was just detected, which can distort short-term continuation."
          : `Price acceleration is ${accelerationLabel}.`,
      ],
      invalidationCondition:
        "Price acceleration turns negative or spread expands sharply.",
      biasChangeCondition:
        "A sustained negative 1m/5m turn, weaker persistence, or spread breakout would shift the bias away from bullish.",
    }
  }

  if (directionBias === "bearish") {
    return {
      primaryReason: `1m momentum is weakening while ${spreadContext}.`,
      supportingSignals: [
        `Tick velocity is ${velocityDirection(oneMinuteReturn)} and momentum reads ${momentumStatus}.`,
        `Trend persistence is ${persistenceLabel}, which supports continuation to the downside.`,
        `5m return remains weak at ${formatSignedPercent(fiveMinuteReturn)}.`,
      ],
      conflictingSignals: [
        volatilityRegime === "elevated" || volatilityRegime === "extreme"
          ? `The regime is noisy because ${volatilityContext}.`
          : `Short-horizon structure is still mixed because ${chopState}.`,
        suddenMoveDetected
          ? "A sudden move was just detected, which can distort short-term continuation."
          : `Price acceleration is ${accelerationLabel}.`,
      ],
      invalidationCondition:
        "Price acceleration turns positive or spread compresses after the down move.",
      biasChangeCondition:
        "A sustained positive 1m/5m turn, stronger persistence, or spread compression would shift the bias away from bearish.",
    }
  }

  return {
    primaryReason:
      "Short-horizon signals are mixed and no persistent directional edge is dominant.",
    supportingSignals: [
      `Momentum is ${momentumStatus}.`,
      `Trend persistence sits at ${persistenceLabel}.`,
      `The structure is currently ${chopState}.`,
    ],
    conflictingSignals: [
      `The latest move is ${formatSignedPercent(oneMinuteReturn)} on 1m and ${formatSignedPercent(fiveMinuteReturn)} on 5m, so neither side is locked in.`,
      volatilityRegime === "elevated" || volatilityRegime === "extreme"
        ? `Volatility is elevated enough to blur direction because ${volatilityContext}.`
        : "Volatility is not forcing a directional read.",
    ],
    invalidationCondition:
      "A persistent move builds in one direction with improving persistence and acceleration.",
    biasChangeCondition:
      "Two aligned windows, stronger acceleration, and cleaner spread behavior would move the bias toward bullish or bearish.",
  }
}

function formatSignedPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "n/a"
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function formatSignedMetric(value: number | null, suffix: string) {
  if (value === null || Number.isNaN(value)) {
    return "n/a"
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} ${suffix}`
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
