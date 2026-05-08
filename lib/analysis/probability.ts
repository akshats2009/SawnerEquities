import { clamp } from "@/lib/utils"
import {
  ConfidenceLabel,
  EdgeCalculation,
  ExpectedMoveEstimate,
  ProbabilityEstimate,
  ProbabilityModelType,
  VolatilityRegime,
  VolatilityWarningFlags,
} from "@/types"

const MINUTES_PER_YEAR = 365 * 24 * 60
const LOW_REALIZED_VOL_THRESHOLD = 0.35
const ELEVATED_REALIZED_VOL_THRESHOLD = 0.8
const EXTREME_REALIZED_VOL_THRESHOLD = 1.2
const LOW_RECENT_MOVE_THRESHOLD = 0.0025
const ELEVATED_RECENT_MOVE_THRESHOLD = 0.006
const EXTREME_RECENT_MOVE_THRESHOLD = 0.009
const FAT_TAIL_RECENT_MOVE_THRESHOLD = 0.008
const MAX_DETERMINISTIC_Z_SCORE = 8

export function calculateExpectedMove(
  spotPrice: number,
  realizedVolatility: number,
  minutesToExpiry: number,
): ExpectedMoveEstimate {
  assertPositiveNumber(spotPrice, "spotPrice")
  assertNonNegativeNumber(realizedVolatility, "realizedVolatility")
  assertNonNegativeNumber(minutesToExpiry, "minutesToExpiry")

  const timeFraction = minutesToExpiry / MINUTES_PER_YEAR
  const expectedMoveFraction = realizedVolatility * Math.sqrt(timeFraction)

  return {
    expectedMoveDollars: spotPrice * expectedMoveFraction,
    // Returned as a percentage, not a decimal fraction. Example: 0.75 means 0.75%.
    expectedMovePercent: expectedMoveFraction * 100,
  }
}

export function estimateProbabilityAboveStrike(
  spotPrice: number,
  strikePrice: number,
  minutesToExpiry: number,
  realizedVolatility: number,
  modelType: ProbabilityModelType,
): ProbabilityEstimate {
  assertPositiveNumber(spotPrice, "spotPrice")
  assertPositiveNumber(strikePrice, "strikePrice")
  assertNonNegativeNumber(minutesToExpiry, "minutesToExpiry")
  assertNonNegativeNumber(realizedVolatility, "realizedVolatility")

  const expectedMove = calculateExpectedMove(
    spotPrice,
    realizedVolatility,
    minutesToExpiry,
  )
  const sigmaT = expectedMove.expectedMovePercent / 100

  if (
    minutesToExpiry === 0 ||
    realizedVolatility === 0 ||
    expectedMove.expectedMoveDollars === 0 ||
    sigmaT === 0
  ) {
    const probabilityAbove = spotPrice > strikePrice ? 1 : 0
    const zScore = getDeterministicZScore(spotPrice, strikePrice)
    return {
      probabilityAbove,
      probabilityBelow: 1 - probabilityAbove,
      zScore,
      expectedMove,
      confidenceLabel: classifyConfidenceLabel(Math.abs(zScore)),
    }
  }

  // Normal model assumes arithmetic price moves. Lognormal uses log-price diffusion.
  const zScore =
    modelType === "normal"
      ? (strikePrice - spotPrice) / expectedMove.expectedMoveDollars
      : Math.log(strikePrice / spotPrice) / sigmaT

  const probabilityAbove = clamp(1 - normalCdf(zScore), 0, 1)

  return {
    probabilityAbove,
    probabilityBelow: clamp(1 - probabilityAbove, 0, 1),
    zScore,
    expectedMove,
    confidenceLabel: classifyConfidenceLabel(Math.abs(zScore)),
  }
}

export function calculateImpliedProbability(priceCents: number) {
  assertNonNegativeNumber(priceCents, "priceCents")
  if (priceCents > 100) {
    throw new RangeError("priceCents must be less than or equal to 100.")
  }

  return clamp(priceCents / 100, 0, 1)
}

export function calculateEdge(
  modelProbability: number,
  impliedProbability: number,
): EdgeCalculation {
  assertProbability(modelProbability, "modelProbability")
  assertProbability(impliedProbability, "impliedProbability")

  const rawEdge = modelProbability - impliedProbability
  return {
    rawEdge,
    percentageEdge: rawEdge * 100,
  }
}

export function classifyVolatilityRegime(
  realizedVolatility: number,
  largestRecentMove = 0,
): VolatilityRegime {
  assertNonNegativeNumber(realizedVolatility, "realizedVolatility")
  assertNonNegativeNumber(largestRecentMove, "largestRecentMove")

  if (
    realizedVolatility >= EXTREME_REALIZED_VOL_THRESHOLD ||
    largestRecentMove >= EXTREME_RECENT_MOVE_THRESHOLD
  ) {
    return "extreme"
  }

  if (
    realizedVolatility >= ELEVATED_REALIZED_VOL_THRESHOLD ||
    largestRecentMove >= ELEVATED_RECENT_MOVE_THRESHOLD
  ) {
    return "elevated"
  }

  if (
    realizedVolatility >= LOW_REALIZED_VOL_THRESHOLD ||
    largestRecentMove >= LOW_RECENT_MOVE_THRESHOLD
  ) {
    return "normal"
  }

  return "low"
}

export function buildVolatilityWarningFlags(
  realizedVolatility: number,
  largestRecentMove = 0,
): VolatilityWarningFlags {
  assertNonNegativeNumber(realizedVolatility, "realizedVolatility")
  assertNonNegativeNumber(largestRecentMove, "largestRecentMove")

  return {
    elevatedRealizedVolatility:
      realizedVolatility >= ELEVATED_REALIZED_VOL_THRESHOLD,
    unusuallyLargeRecentMove: largestRecentMove >= ELEVATED_RECENT_MOVE_THRESHOLD,
    fatTailCondition:
      realizedVolatility >= EXTREME_REALIZED_VOL_THRESHOLD ||
      largestRecentMove >= FAT_TAIL_RECENT_MOVE_THRESHOLD,
  }
}

export function summarizeVolatilityWarnings(
  warningFlags: VolatilityWarningFlags,
) {
  return [
    warningFlags.elevatedRealizedVolatility
      ? "Elevated realized volatility."
      : null,
    warningFlags.unusuallyLargeRecentMove
      ? "Unusually large recent BTC moves detected."
      : null,
    warningFlags.fatTailCondition ? "Possible fat-tail conditions." : null,
  ].filter(Boolean) as string[]
}

export function calculateAnnualizedRealizedVolatility(
  closes: number[],
  windowMinutes: number,
  candleMinutes = 1,
) {
  assertWindowMinutes(windowMinutes)
  assertWindowMinutes(candleMinutes)

  const windowCandles = Math.ceil(windowMinutes / candleMinutes)
  if (closes.length < windowCandles + 1) {
    return null
  }

  const slice = closes.slice(-(windowCandles + 1))
  validatePositiveSeries(slice, "closes")

  const returns: number[] = []
  for (let index = 1; index < slice.length; index += 1) {
    returns.push(Math.log(slice[index] / slice[index - 1]))
  }

  if (returns.length < 2) {
    return null
  }

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (returns.length - 1)

  return Math.sqrt(variance) * Math.sqrt(MINUTES_PER_YEAR / candleMinutes)
}

export function calculateLargestAbsoluteMove(closes: number[]) {
  if (closes.length < 2) {
    return null
  }

  validatePositiveSeries(closes, "closes")

  let largest = 0
  for (let index = 1; index < closes.length; index += 1) {
    const move = Math.abs(closes[index] / closes[index - 1] - 1)
    if (move > largest) {
      largest = move
    }
  }

  return largest
}

function classifyConfidenceLabel(absoluteZScore: number): ConfidenceLabel {
  if (absoluteZScore < 0.35) {
    return "low"
  }
  if (absoluteZScore < 0.85) {
    return "moderate"
  }
  if (absoluteZScore < 1.5) {
    return "high"
  }
  return "very high"
}

function getDeterministicZScore(spotPrice: number, strikePrice: number) {
  if (spotPrice === strikePrice) {
    return 0
  }

  return spotPrice > strikePrice
    ? -MAX_DETERMINISTIC_Z_SCORE
    : MAX_DETERMINISTIC_Z_SCORE
}

function assertFiniteNumber(value: number, name: string) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`)
  }
}

function assertPositiveNumber(value: number, name: string) {
  assertFiniteNumber(value, name)
  if (value <= 0) {
    throw new RangeError(`${name} must be greater than 0.`)
  }
}

function assertNonNegativeNumber(value: number, name: string) {
  assertFiniteNumber(value, name)
  if (value < 0) {
    throw new RangeError(`${name} must be greater than or equal to 0.`)
  }
}

function assertProbability(value: number, name: string) {
  assertFiniteNumber(value, name)
  if (value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1.`)
  }
}

function assertWindowMinutes(windowMinutes: number) {
  assertFiniteNumber(windowMinutes, "windowMinutes")
  if (windowMinutes <= 0 || !Number.isInteger(windowMinutes)) {
    throw new RangeError("windowMinutes must be a positive integer.")
  }
}

function validatePositiveSeries(values: number[], name: string) {
  values.forEach((value, index) => {
    assertPositiveNumber(value, `${name}[${index}]`)
  })
}

function normalCdf(value: number) {
  return 0.5 * (1 + erf(value / Math.SQRT2))
}

function erf(value: number) {
  const sign = value >= 0 ? 1 : -1
  const absolute = Math.abs(value)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const t = 1 / (1 + p * absolute)
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-absolute * absolute)
  return sign * y
}
