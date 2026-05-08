import { mapVolatilityRegimeGroup } from "@/lib/backtest/regimes"
import {
  BacktestPerformanceSummary,
  BacktestTradeLogEntry,
  CalibrationBin,
  CalibrationReport,
  DrawdownPoint,
  EdgeQualityReport,
  OverfittingWarning,
  RegimePerformanceSummary,
  BacktestOpportunityEvaluation,
} from "@/lib/backtest/types"
import { BacktestPreview } from "@/types"

const CALIBRATION_BIN_COUNT = 10

export function buildDrawdownCurve(
  equityCurve: Array<{ timestamp: string; equity: number }>,
): DrawdownPoint[] {
  let peak = Number.NEGATIVE_INFINITY

  return equityCurve.map((point) => {
    peak = Math.max(peak, point.equity)
    const drawdown = point.equity - peak
    return {
      timestamp: point.timestamp,
      drawdown,
      drawdownPct: peak > 0 ? drawdown / peak : 0,
    }
  })
}

export function buildPerformanceSummary(options: {
  opportunities: BacktestOpportunityEvaluation[]
  trades: BacktestTradeLogEntry[]
  drawdownCurve: DrawdownPoint[]
  bankrollStart: number
  bankrollEnd: number
  coverageDays: number
}): BacktestPerformanceSummary {
  const settledTradeCount = options.trades.length
  const skippedTradeCount = options.opportunities.filter(
    (opportunity) => opportunity.decision === "SKIP",
  ).length
  const unresolvedTradeCount = options.opportunities.filter(
    (opportunity) =>
      opportunity.decision === "TRADE" && opportunity.settlementPrice === null,
  ).length
  const pnlSeries = options.trades.map((trade) => trade.pnl)
  const returnSeries = options.trades.map((trade) => trade.returnOnRisk)
  const winners = options.trades.filter((trade) => trade.result === "win").length
  const totalHoldMinutes = options.trades.reduce(
    (sum, trade) =>
      sum +
      Math.max(
        (new Date(trade.expiryTime).getTime() -
          new Date(trade.entryTime).getTime()) /
          60000,
        0,
      ),
    0,
  )

  const maxDrawdown =
    options.drawdownCurve.length > 0
      ? Math.abs(
          Math.min(...options.drawdownCurve.map((point) => point.drawdown)),
        )
      : null
  const maxDrawdownPct =
    options.drawdownCurve.length > 0
      ? Math.abs(
          Math.min(...options.drawdownCurve.map((point) => point.drawdownPct)),
        )
      : null

  return {
    opportunityCount: options.opportunities.length,
    tradeCount: options.opportunities.filter(
      (opportunity) => opportunity.decision === "TRADE",
    ).length,
    skippedTradeCount,
    settledTradeCount,
    unresolvedTradeCount,
    winRate: settledTradeCount > 0 ? winners / settledTradeCount : null,
    averageEdge: average(options.trades.map((trade) => trade.edge)),
    expectedValue: average(pnlSeries),
    netPnl: sum(pnlSeries),
    maxDrawdown,
    maxDrawdownPct,
    sharpeLike: calculateSharpeLike(returnSeries),
    tradeFrequencyPerDay:
      options.coverageDays > 0
        ? settledTradeCount / options.coverageDays
        : null,
    avgHoldMinutes:
      settledTradeCount > 0 ? totalHoldMinutes / settledTradeCount : null,
    bankrollStart: options.bankrollStart,
    bankrollEnd: options.bankrollEnd,
    bankrollReturnPct:
      options.bankrollStart > 0
        ? (options.bankrollEnd - options.bankrollStart) /
          options.bankrollStart
        : null,
  }
}

export function buildCalibrationReport(
  opportunities: BacktestOpportunityEvaluation[],
): CalibrationReport {
  const evaluable = opportunities.filter(
    (opportunity) =>
      opportunity.modelProbabilityAbove !== null &&
      opportunity.outcomeAboveStrike !== null,
  )

  if (evaluable.length === 0) {
    return {
      sampleCount: 0,
      brierScore: null,
      logLoss: null,
      meanPredictedProbability: null,
      meanOutcome: null,
      bins: buildEmptyCalibrationBins(),
    }
  }

  const bins = buildEmptyCalibrationBins()
  const probabilities = evaluable.map(
    (opportunity) => opportunity.modelProbabilityAbove ?? 0,
  )
  const outcomes = evaluable.map((opportunity) =>
    opportunity.outcomeAboveStrike ? 1 : 0,
  )

  evaluable.forEach((opportunity) => {
    const probability = opportunity.modelProbabilityAbove ?? 0
    const outcome = opportunity.outcomeAboveStrike ? 1 : 0
    const binIndex = Math.min(
      Math.floor(probability * CALIBRATION_BIN_COUNT),
      CALIBRATION_BIN_COUNT - 1,
    )
    const bin = bins[binIndex]
    const nextCount = bin.count + 1
    bin.predictedProbability =
      ((bin.predictedProbability ?? 0) * bin.count + probability) / nextCount
    bin.actualFrequency =
      ((bin.actualFrequency ?? 0) * bin.count + outcome) / nextCount
    bin.count = nextCount
  })

  const epsilon = 1e-6
  const brierScore = average(
    evaluable.map((opportunity) => {
      const probability = opportunity.modelProbabilityAbove ?? 0
      const outcome = opportunity.outcomeAboveStrike ? 1 : 0
      return (probability - outcome) ** 2
    }),
  )
  const logLoss = average(
    evaluable.map((opportunity) => {
      const probability = clampProbability(
        opportunity.modelProbabilityAbove ?? 0,
        epsilon,
      )
      const outcome = opportunity.outcomeAboveStrike ? 1 : 0
      return -(
        outcome * Math.log(probability) +
        (1 - outcome) * Math.log(1 - probability)
      )
    }),
  )

  return {
    sampleCount: evaluable.length,
    brierScore,
    logLoss,
    meanPredictedProbability: average(probabilities),
    meanOutcome: average(outcomes),
    bins,
  }
}

export function buildEdgeQualityReport(
  opportunities: BacktestOpportunityEvaluation[],
  trades: BacktestTradeLogEntry[],
): EdgeQualityReport {
  const positiveEdgeOpportunities = opportunities.filter(
    (opportunity) => (opportunity.selectedEdge ?? Number.NEGATIVE_INFINITY) > 0,
  )
  const losses = trades.filter((trade) => trade.result === "loss").length

  const averageModelEdge = average(trades.map((trade) => trade.edge))
  const averageRealizedEdge = average(
    trades.map((trade) =>
      (trade.result === "win" ? 1 : 0) - trade.entryPrice,
    ),
  )

  return {
    tradedCount: trades.length,
    averageModelEdge,
    averageRealizedEdge,
    edgeCaptureRatio:
      averageModelEdge && averageModelEdge !== 0
        ? averageRealizedEdge !== null
          ? averageRealizedEdge / averageModelEdge
          : null
        : null,
    positiveEdgeOpportunityRate:
      opportunities.length > 0
        ? positiveEdgeOpportunities.length / opportunities.length
        : null,
    falsePositiveRate: trades.length > 0 ? losses / trades.length : null,
  }
}

export function buildRegimeAnalysis(
  trades: BacktestTradeLogEntry[],
): RegimePerformanceSummary[] {
  const groups = new Map<string, BacktestTradeLogEntry[]>()

  trades.forEach((trade) => {
    const groupNames = [
      mapVolatilityRegimeGroup(trade.volatilityRegime),
      trade.trendRegime,
      trade.macroEventLabel ? "macro-event" : null,
    ].filter(Boolean) as string[]

    groupNames.forEach((groupName) => {
      const group = groups.get(groupName) ?? []
      group.push(trade)
      groups.set(groupName, group)
    })
  })

  return Array.from(groups.entries())
    .map(([regime, groupTrades]) =>
      buildRegimeSummary(regime, groupTrades),
    )
    .sort((left, right) => right.tradeCount - left.tradeCount)
}

export function buildOverfittingWarnings(options: {
  summary: BacktestPerformanceSummary
  calibration: CalibrationReport
  regimeAnalysis: RegimePerformanceSummary[]
  dataUsesSyntheticQuotes: boolean
  parameterSweepCount: number
  assumptions: string[]
}): OverfittingWarning[] {
  const warnings: OverfittingWarning[] = []

  if (options.summary.tradeCount < 30 || options.calibration.sampleCount < 100) {
    warnings.push({
      level: "warn",
      code: "small-sample",
      message:
        "Sample size is limited. Treat any edge estimate as provisional until it survives a larger historical window.",
    })
  }

  if (options.dataUsesSyntheticQuotes) {
    warnings.push({
      level: "critical",
      code: "synthetic-market-prices",
      message:
        "Contract prices were synthetic, not replayed from a historical Kalshi tape. Use these results for framework validation, not for profit claims.",
    })
  }

  if (options.parameterSweepCount > 20) {
    warnings.push({
      level: "warn",
      code: "parameter-sweep",
      message:
        "Many parameter combinations were tested. Performance may reflect tuning to noise rather than durable edge.",
    })
  }

  const meaningfulRegimes = options.regimeAnalysis.filter(
    (regime) => regime.tradeCount >= 5 && regime.expectedValue !== null,
  )
  if (meaningfulRegimes.length >= 2) {
    const expectedValues = meaningfulRegimes
      .map((regime) => regime.expectedValue ?? 0)
      .sort((left, right) => left - right)
    if (
      expectedValues[0] < 0 &&
      expectedValues[expectedValues.length - 1] > 0
    ) {
      warnings.push({
        level: "warn",
        code: "regime-instability",
        message:
          "Performance changed sign across regimes. The strategy may not generalize outside the conditions where it happened to work.",
      })
    }
  }

  if (
    (options.summary.tradeFrequencyPerDay ?? 0) > 12 &&
    (options.summary.averageEdge ?? 0) < 0.03
  ) {
    warnings.push({
      level: "info",
      code: "overtrading-risk",
      message:
        "Trade frequency is high relative to average edge. Friction and quote slippage may erase paper profits.",
    })
  }

  if (
    options.assumptions.some((assumption) =>
      assumption.toLowerCase().includes("settlement candle"),
    )
  ) {
    warnings.push({
      level: "info",
      code: "settlement-approximation",
      message:
        "Settlement used candle closes rather than tick-level index prints. This is deterministic but still an approximation.",
    })
  }

  return warnings
}

export function buildBacktestPreview(
  summary: BacktestPerformanceSummary,
  calibration: CalibrationReport,
  note: string,
): BacktestPreview {
  return {
    scenarioCount: summary.opportunityCount,
    sampleCount: summary.settledTradeCount,
    winRate: summary.winRate,
    expectedValue: summary.expectedValue,
    maxDrawdown: summary.maxDrawdown,
    sharpeLike: summary.sharpeLike,
    tradeFrequencyPerDay: summary.tradeFrequencyPerDay,
    skippedTradeCount: summary.skippedTradeCount,
    calibrationBrierScore: calibration.brierScore,
    note,
  }
}

function buildRegimeSummary(
  regime: string,
  trades: BacktestTradeLogEntry[],
): RegimePerformanceSummary {
  return {
    regime,
    tradeCount: trades.length,
    winRate:
      trades.length > 0
        ? trades.filter((trade) => trade.result === "win").length / trades.length
        : null,
    expectedValue: average(trades.map((trade) => trade.pnl)),
    averageEdge: average(trades.map((trade) => trade.edge)),
    netPnl: sum(trades.map((trade) => trade.pnl)),
    sharpeLike: calculateSharpeLike(trades.map((trade) => trade.returnOnRisk)),
  }
}

function buildEmptyCalibrationBins(): CalibrationBin[] {
  return Array.from({ length: CALIBRATION_BIN_COUNT }, (_, index) => {
    const bucketStart = index / CALIBRATION_BIN_COUNT
    const bucketEnd = (index + 1) / CALIBRATION_BIN_COUNT
    return {
      label: `${Math.round(bucketStart * 100)}-${Math.round(bucketEnd * 100)}%`,
      bucketStart,
      bucketEnd,
      predictedProbability: null,
      actualFrequency: null,
      count: 0,
    }
  })
}

function calculateSharpeLike(returns: number[]) {
  if (returns.length < 2) {
    return null
  }

  const mean = average(returns)
  const deviation = sampleStandardDeviation(returns)
  if (mean === null || deviation === null || deviation === 0) {
    return null
  }

  return (mean / deviation) * Math.sqrt(returns.length)
}

function clampProbability(value: number, epsilon: number) {
  return Math.min(Math.max(value, epsilon), 1 - epsilon)
}

function average(values: number[]) {
  if (values.length === 0) {
    return null
  }

  return sum(values) / values.length
}

function sampleStandardDeviation(values: number[]) {
  if (values.length < 2) {
    return null
  }

  const mean = average(values)
  if (mean === null) {
    return null
  }

  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    (values.length - 1)
  return Math.sqrt(variance)
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}
