import {
  buildVolatilityWarningFlags,
  calculateAnnualizedRealizedVolatility,
  calculateEdge,
  calculateLargestAbsoluteMove,
  classifyVolatilityRegime,
  estimateProbabilityAboveStrike,
  summarizeVolatilityWarnings,
} from "@/lib/analysis/probability"
import {
  findFirstCandleAtOrAfter,
  findLatestCandleAtOrBefore,
  getIntervalMinutes,
  sliceCandlesThrough,
  summarizeDataset,
} from "@/lib/backtest/candles"
import { normalizeHistoricalContract } from "@/lib/backtest/contracts"
import {
  classifyTrendRegime,
  resolveMacroEventLabel,
} from "@/lib/backtest/regimes"
import {
  buildBacktestPreview,
  buildCalibrationReport,
  buildDrawdownCurve,
  buildEdgeQualityReport,
  buildOverfittingWarnings,
  buildPerformanceSummary,
  buildRegimeAnalysis,
} from "@/lib/backtest/reporting"
import {
  BacktestConfig,
  BacktestConfigOverrides,
  BacktestReport,
  BacktestTradeLogEntry,
  BacktestOpportunityEvaluation,
  PaperReplayFrame,
  RunBacktestInput,
} from "@/lib/backtest/types"
import { computePositionSizing } from "@/lib/risk/engine"
import { clamp } from "@/lib/utils"
import { BacktestPreview, SuggestedSide, VolatilityRegime } from "@/types"

const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  interval: "15m",
  mode: "historical",
  strategy: {
    sidePreference: "best-edge",
    minEdge: 0.025,
    minConfidenceScore: 58,
    cooldownMinutes: 15,
    maxConcurrentPositions: 2,
    requirePositiveEdge: true,
    perTradeCost: 1,
  },
  volatility: {
    allowedRegimes: ["low", "normal", "elevated"],
    minMinutesToExpiry: 30,
    trendLookbackCandles: 12,
    trendingThreshold: 0.62,
    maxAbsoluteMove1m: null,
  },
  risk: {
    initialBankroll: 10000,
    maxRiskPct: 0.015,
    maxOpenRiskPct: 0.03,
    maxSpread: 0.06,
    minLiquidityScore: 0.3,
    markOpenPositionsToCost: true,
  },
  research: {
    parameterSweepCount: 1,
    useSyntheticQuotes: false,
    assumptions: [],
  },
  macroEvents: [],
}

interface OpenPosition {
  contractId: string
  ticker: string | null
  entryTime: string
  expiryTime: string
  side: SuggestedSide
  strikePrice: number
  quantity: number
  entryPrice: number
  marketProbabilityYes: number
  modelProbability: number
  edge: number
  confidenceScore: number
  costBasis: number
  fees: number
  volatilityRegime: VolatilityRegime
  trendRegime: "trending" | "sideways"
  macroEventLabel: string | null
  dataSource: "historical-market" | "synthetic-market"
}

interface VolatilityContext {
  regime: VolatilityRegime
  fatTailWarning: boolean
  largestAbsMove: number | null
  warnings: string[]
  modelVol: number
}

export function runBacktest(input: RunBacktestInput): BacktestReport {
  const config = mergeBacktestConfig(input.config)
  const interval = resolveInterval(input.dataset, config.interval)
  const entrySeries = input.dataset.candles[interval]
  const settlementSeries =
    input.dataset.candles["1m"].length > 0
      ? input.dataset.candles["1m"]
      : entrySeries
  const volatilitySeries =
    input.dataset.candles["1m"].length > 0
      ? input.dataset.candles["1m"]
      : entrySeries
  const volatilityCandleMinutes =
    input.dataset.candles["1m"].length > 0 ? 1 : getIntervalMinutes(interval)

  if (entrySeries.length === 0 || settlementSeries.length === 0) {
    throw new Error("Backtest requires historical BTC candles for replay.")
  }

  const contracts = input.contracts
    .map((contract) => normalizeHistoricalContract(contract))
    .sort((left, right) => left.listedTime.localeCompare(right.listedTime))

  let cash = config.risk.initialBankroll
  let realizedPnL = 0
  let settledTrades = 0
  let skippedTrades = 0
  let lastTradeEntryTime: string | null = null
  const openPositions: OpenPosition[] = []
  const tradeLog: BacktestTradeLogEntry[] = []
  const opportunityLog: BacktestOpportunityEvaluation[] = []
  const equityCurve: BacktestReport["equityCurve"] = []
  const paperReplay: PaperReplayFrame[] = []

  recordState(
    input.dataset.startTime ?? entrySeries[0].timestamp,
    "start",
    "Replay started.",
  )

  for (const contract of contracts) {
    settleOpenPositions(contract.listedTime)

    const entryCandle = findLatestCandleAtOrBefore(entrySeries, contract.listedTime)
    const settlementCandle = findFirstCandleAtOrAfter(
      settlementSeries,
      contract.expiryTime,
    )

    const skipReasons: string[] = []
    if (!entryCandle) {
      skipReasons.push("missing entry BTC candle")
    }

    const spotPrice = contract.spotPrice ?? entryCandle?.close ?? NaN
    const minutesToExpiry = Math.max(
      (new Date(contract.expiryTime).getTime() -
        new Date(contract.listedTime).getTime()) /
        60000,
      0,
    )

    const volatilitySlice = sliceCandlesThrough(
      volatilitySeries,
      contract.listedTime,
      Math.max(180 / volatilityCandleMinutes, 24),
    )
    const volatility = buildVolatilityContext(
      volatilitySlice.map((candle) => candle.close),
      volatilityCandleMinutes,
    )

    const trendSlice = sliceCandlesThrough(
      entrySeries,
      contract.listedTime,
      config.volatility.trendLookbackCandles,
    )
    const trendRegime = classifyTrendRegime(
      trendSlice,
      config.volatility.trendLookbackCandles,
      config.volatility.trendingThreshold,
    )
    const macroEventLabel = resolveMacroEventLabel(
      contract.listedTime,
      config.macroEvents,
    )

    const probabilityEstimate =
      Number.isFinite(spotPrice) && contract.strikePrice > 0
        ? estimateProbabilityAboveStrike(
            spotPrice,
            contract.strikePrice,
            minutesToExpiry,
            volatility.modelVol,
            "lognormal",
          )
        : null

    const modelProbabilityAbove = probabilityEstimate?.probabilityAbove ?? null
    const modelProbabilityBelow = probabilityEstimate?.probabilityBelow ?? null
    const edgeYes =
      modelProbabilityAbove !== null
        ? calculateEdge(modelProbabilityAbove, contract.yesPrice).rawEdge
        : null
    const edgeNo =
      modelProbabilityBelow !== null
        ? calculateEdge(modelProbabilityBelow, contract.noPrice).rawEdge
        : null

    const selectedSide = selectTradeSide(
      config.strategy.sidePreference,
      edgeYes,
      edgeNo,
    )
    const selectedEdge = selectedSide === "YES" ? edgeYes : edgeNo
    const selectedPrice =
      selectedSide === "YES" ? contract.yesPrice : contract.noPrice
    const modelProbability =
      selectedSide === "YES" ? modelProbabilityAbove : modelProbabilityBelow

    const confidenceScore = computeConfidenceScore({
      rawEdge: selectedEdge,
      spread: contract.bidAskSpread,
      liquidityScore: contract.liquidityScore,
      minutesToSettlement: minutesToExpiry,
      regime: volatility.regime,
    })

    if (modelProbability === null) skipReasons.push("model probability unavailable")
    if (selectedEdge === null) skipReasons.push("edge unavailable")
    if (
      config.strategy.requirePositiveEdge &&
      (selectedEdge ?? Number.NEGATIVE_INFINITY) < config.strategy.minEdge
    ) {
      skipReasons.push("edge below threshold")
    }
    if (confidenceScore < config.strategy.minConfidenceScore) {
      skipReasons.push("confidence below threshold")
    }
    if (minutesToExpiry < config.volatility.minMinutesToExpiry) {
      skipReasons.push("expiry too close")
    }
    if (!config.volatility.allowedRegimes.includes(volatility.regime)) {
      skipReasons.push("volatility regime blocked")
    }
    if (
      config.volatility.maxAbsoluteMove1m !== null &&
      (volatility.largestAbsMove ?? 0) > config.volatility.maxAbsoluteMove1m
    ) {
      skipReasons.push("recent move exceeded volatility filter")
    }
    if (contract.bidAskSpread > config.risk.maxSpread) {
      skipReasons.push("spread too wide")
    }
    if (contract.liquidityScore < config.risk.minLiquidityScore) {
      skipReasons.push("liquidity below threshold")
    }
    if (!settlementCandle) {
      skipReasons.push("missing settlement candle")
    }
    if (
      lastTradeEntryTime &&
      minutesBetween(lastTradeEntryTime, contract.listedTime) <
        config.strategy.cooldownMinutes
    ) {
      skipReasons.push("cooldown active")
    }
    if (openPositions.length >= config.strategy.maxConcurrentPositions) {
      skipReasons.push("max concurrent positions reached")
    }

    const currentOpenRisk = sum(openPositions.map((position) => position.costBasis))
    const currentEquity = cash + currentOpenRisk
    const positionSizing = computePositionSizing(
      currentEquity,
      config.risk.maxRiskPct,
      selectedPrice,
    )
    const maxContractsByCash =
      selectedPrice > 0
        ? Math.max(
            Math.floor(
              Math.max(cash - config.strategy.perTradeCost, 0) / selectedPrice,
            ),
            0,
          )
        : 0
    const maxContractsByOpenRisk =
      selectedPrice > 0
        ? Math.max(
            Math.floor(
              Math.max(
                currentEquity * config.risk.maxOpenRiskPct - currentOpenRisk,
                0,
              ) / selectedPrice,
            ),
            0,
          )
        : 0
    const quantity = Math.max(
      Math.min(
        positionSizing.maxContracts,
        maxContractsByCash,
        maxContractsByOpenRisk,
      ),
      0,
    )
    const costBasis = quantity * selectedPrice

    if (quantity < 1) {
      skipReasons.push("insufficient risk budget")
    }

    const decision = skipReasons.length === 0 ? "TRADE" : "SKIP"
    const outcomeAboveStrike = settlementCandle
      ? settlementCandle.close > contract.strikePrice
      : null

    opportunityLog.push({
      contractId: contract.id,
      ticker: contract.ticker ?? null,
      entryTime: contract.listedTime,
      expiryTime: contract.expiryTime,
      minutesToExpiry,
      spotPrice,
      strikePrice: contract.strikePrice,
      settlementPrice: settlementCandle?.close ?? null,
      outcomeAboveStrike,
      modelProbabilityAbove,
      modelProbabilityBelow,
      marketProbabilityYes: contract.marketImpliedProbability,
      yesPrice: contract.yesPrice,
      noPrice: contract.noPrice,
      edgeYes,
      edgeNo,
      selectedSide,
      selectedEdge,
      confidenceScore,
      decision,
      quantity,
      costBasis,
      skipReasons,
      volatilityRegime: volatility.regime,
      trendRegime,
      macroEventLabel,
      quoteConstruction: contract.quoteConstruction,
      dataSource: contract.source,
    })

    if (decision === "SKIP") {
      skippedTrades += 1
      continue
    }

    cash -= costBasis + config.strategy.perTradeCost
    openPositions.push({
      contractId: contract.id,
      ticker: contract.ticker ?? null,
      entryTime: contract.listedTime,
      expiryTime: contract.expiryTime,
      side: selectedSide,
      strikePrice: contract.strikePrice,
      quantity,
      entryPrice: selectedPrice,
      marketProbabilityYes: contract.marketImpliedProbability,
      modelProbability: modelProbability ?? 0,
      edge: selectedEdge ?? 0,
      confidenceScore,
      costBasis,
      fees: config.strategy.perTradeCost,
      volatilityRegime: volatility.regime,
      trendRegime,
      macroEventLabel,
      dataSource: contract.source,
    })
    lastTradeEntryTime = contract.listedTime

    recordState(
      contract.listedTime,
      "entry",
      `Entered ${selectedSide} on ${contract.ticker ?? contract.id}.`,
    )
  }

  settleOpenPositions(input.dataset.endTime ?? entrySeries.at(-1)?.timestamp ?? new Date().toISOString())

  recordState(
    input.dataset.endTime ?? entrySeries.at(-1)?.timestamp ?? new Date().toISOString(),
    "end",
    "Replay completed.",
  )

  const drawdownCurve = buildDrawdownCurve(equityCurve)
  const coverageDays = calculateCoverageDays(
    input.dataset.startTime,
    input.dataset.endTime,
  )
  const summary = buildPerformanceSummary({
    opportunities: opportunityLog,
    trades: tradeLog,
    drawdownCurve,
    bankrollStart: config.risk.initialBankroll,
    bankrollEnd: currentEquity(),
    coverageDays,
  })
  const calibration = buildCalibrationReport(opportunityLog)
  const edgeQuality = buildEdgeQualityReport(opportunityLog, tradeLog)
  const regimeAnalysis = buildRegimeAnalysis(tradeLog)
  const assumptions = uniqueStrings([
    "Contract settlement uses the first candle close at or after expiry.",
    "YES settles true only when BTC closes strictly above the strike; NO includes equal-or-below outcomes.",
    config.risk.markOpenPositionsToCost
      ? "Open positions are marked to cost basis until settlement."
      : null,
    "No execution slippage is modeled beyond the quoted spread and the fixed per-trade cost.",
    ...config.research.assumptions,
  ])
  const warnings = buildOverfittingWarnings({
    summary,
    calibration,
    regimeAnalysis,
    dataUsesSyntheticQuotes:
      config.research.useSyntheticQuotes ||
      contracts.some((contract) => contract.source === "synthetic-market"),
    parameterSweepCount: config.research.parameterSweepCount,
    assumptions,
  })

  return {
    generatedAt: new Date().toISOString(),
    dataset: summarizeDataset(input.dataset, interval),
    config,
    summary,
    calibration,
    edgeQuality,
    regimeAnalysis,
    warnings,
    assumptions,
    opportunityLog,
    tradeLog,
    equityCurve,
    drawdownCurve,
    paperReplay,
    note:
      contracts.some((contract) => contract.source === "synthetic-market")
        ? "Backtest used real BTC candles with simulated Kalshi-style contract prices."
        : "Backtest used supplied contract prices with deterministic candle-based settlement.",
  }

  function settleOpenPositions(cutoffTime: string) {
    openPositions.sort((left, right) => left.expiryTime.localeCompare(right.expiryTime))

    while (openPositions.length > 0) {
      const nextPosition = openPositions[0]
      if (nextPosition.expiryTime > cutoffTime) {
        break
      }

      const settlementCandle = findFirstCandleAtOrAfter(
        settlementSeries,
        nextPosition.expiryTime,
      )
      if (!settlementCandle) {
        break
      }

      const openRiskBefore = sum(
        openPositions.map((position) => position.costBasis),
      )
      const equityBefore = cash + openRiskBefore
      openPositions.shift()

      const outcomeAboveStrike =
        settlementCandle.close > nextPosition.strikePrice
      const result =
        nextPosition.side === "YES"
          ? outcomeAboveStrike
            ? "win"
            : "loss"
          : outcomeAboveStrike
            ? "loss"
            : "win"
      const payout = result === "win" ? nextPosition.quantity : 0
      cash += payout
      const pnl = payout - nextPosition.costBasis - nextPosition.fees
      realizedPnL += pnl
      settledTrades += 1

      tradeLog.push({
        contractId: nextPosition.contractId,
        ticker: nextPosition.ticker,
        entryTime: nextPosition.entryTime,
        expiryTime: nextPosition.expiryTime,
        settledTime: settlementCandle.timestamp,
        side: nextPosition.side,
        quantity: nextPosition.quantity,
        entryPrice: nextPosition.entryPrice,
        marketProbabilityYes: nextPosition.marketProbabilityYes,
        modelProbability: nextPosition.modelProbability,
        edge: nextPosition.edge,
        confidenceScore: nextPosition.confidenceScore,
        payout,
        fees: nextPosition.fees,
        costBasis: nextPosition.costBasis,
        pnl,
        returnOnRisk:
          nextPosition.costBasis > 0 ? pnl / nextPosition.costBasis : 0,
        bankrollBefore: equityBefore,
        bankrollAfter: currentEquity(),
        settlementPrice: settlementCandle.close,
        outcomeAboveStrike,
        result,
        volatilityRegime: nextPosition.volatilityRegime,
        trendRegime: nextPosition.trendRegime,
        macroEventLabel: nextPosition.macroEventLabel,
        dataSource: nextPosition.dataSource,
      })

      recordState(
        settlementCandle.timestamp,
        "settlement",
        `Settled ${nextPosition.ticker ?? nextPosition.contractId} as ${result}.`,
      )
    }
  }

  function recordState(timestamp: string, eventType: BacktestReport["equityCurve"][number]["eventType"], lastEvent: string) {
    const openRisk = sum(openPositions.map((position) => position.costBasis))
    const equity = config.risk.markOpenPositionsToCost ? cash + openRisk : cash

    equityCurve.push({
      timestamp,
      eventType,
      cash,
      equity,
      openRisk,
      openPositions: openPositions.length,
      realizedPnL,
    })

    paperReplay.push({
      timestamp,
      cash,
      equity,
      openRisk,
      openPositions: openPositions.length,
      settledTrades,
      skippedTrades,
      lastEvent,
    })
  }

  function currentEquity() {
    const openRisk = sum(openPositions.map((position) => position.costBasis))
    return config.risk.markOpenPositionsToCost ? cash + openRisk : cash
  }
}

export function buildBacktestReportPreview(report: BacktestReport): BacktestPreview {
  return buildBacktestPreview(report.summary, report.calibration, report.note)
}

export function runPaperTradingReplay(input: RunBacktestInput) {
  return runBacktest({
    ...input,
    config: {
      ...input.config,
      mode: "paper",
    },
  })
}

function resolveInterval(
  dataset: RunBacktestInput["dataset"],
  requestedInterval: BacktestConfig["interval"],
) {
  if (dataset.candles[requestedInterval].length > 0) {
    return requestedInterval
  }

  const fallback = (["15m", "5m", "1h", "1m"] as BacktestConfig["interval"][]).find(
    (interval) => dataset.candles[interval].length > 0,
  )
  if (!fallback) {
    throw new Error("No BTC candles available for backtest replay.")
  }

  return fallback
}

function buildVolatilityContext(
  closes: number[],
  candleMinutes: number,
): VolatilityContext {
  const rv30 = calculateAnnualizedRealizedVolatility(closes, 30, candleMinutes)
  const rv60 = calculateAnnualizedRealizedVolatility(closes, 60, candleMinutes)
  const rv15 = calculateAnnualizedRealizedVolatility(closes, 15, candleMinutes)
  const modelVol = rv30 ?? rv60 ?? rv15 ?? 0.35
  const largestAbsMove = calculateLargestAbsoluteMove(closes)
  const warningFlags = buildVolatilityWarningFlags(modelVol, largestAbsMove ?? 0)

  return {
    regime: classifyVolatilityRegime(modelVol, largestAbsMove ?? 0),
    fatTailWarning: warningFlags.fatTailCondition,
    largestAbsMove,
    warnings: summarizeVolatilityWarnings(warningFlags),
    modelVol,
  }
}

function computeConfidenceScore(options: {
  rawEdge: number | null
  spread: number | null
  liquidityScore: number
  minutesToSettlement: number
  regime: VolatilityRegime
}) {
  const edgeScore = clamp((options.rawEdge ?? -0.02) / 0.08, 0, 1)
  const spreadScore = clamp(1 - (options.spread ?? 0.08) / 0.08, 0, 1)
  const timeScore = clamp((options.minutesToSettlement - 5) / 120, 0, 1)

  const regimePenalty =
    options.regime === "extreme"
      ? 0.35
      : options.regime === "elevated"
        ? 0.72
        : options.regime === "normal"
          ? 0.88
          : 1

  return Math.round(
    clamp(
      (edgeScore * 0.38 +
        spreadScore * 0.18 +
        options.liquidityScore * 0.24 +
        timeScore * 0.2) *
        100 *
        regimePenalty,
      0,
      100,
    ),
  )
}

function selectTradeSide(
  sidePreference: BacktestConfig["strategy"]["sidePreference"],
  edgeYes: number | null,
  edgeNo: number | null,
): SuggestedSide {
  if (sidePreference === "yes-only") {
    return "YES"
  }
  if (sidePreference === "no-only") {
    return "NO"
  }

  return (edgeYes ?? Number.NEGATIVE_INFINITY) >=
    (edgeNo ?? Number.NEGATIVE_INFINITY)
    ? "YES"
    : "NO"
}

function mergeBacktestConfig(
  overrides?: BacktestConfigOverrides,
): BacktestConfig {
  return {
    interval: overrides?.interval ?? DEFAULT_BACKTEST_CONFIG.interval,
    mode: overrides?.mode ?? DEFAULT_BACKTEST_CONFIG.mode,
    strategy: {
      ...DEFAULT_BACKTEST_CONFIG.strategy,
      ...overrides?.strategy,
    },
    volatility: {
      ...DEFAULT_BACKTEST_CONFIG.volatility,
      ...overrides?.volatility,
    },
    risk: {
      ...DEFAULT_BACKTEST_CONFIG.risk,
      ...overrides?.risk,
    },
    research: {
      ...DEFAULT_BACKTEST_CONFIG.research,
      ...overrides?.research,
    },
    macroEvents:
      overrides?.macroEvents ?? DEFAULT_BACKTEST_CONFIG.macroEvents,
  }
}

function minutesBetween(left: string, right: string) {
  return Math.abs(
    (new Date(right).getTime() - new Date(left).getTime()) / 60000,
  )
}

function calculateCoverageDays(startTime: string | null, endTime: string | null) {
  if (!startTime || !endTime) {
    return 0
  }

  const diffMs = new Date(endTime).getTime() - new Date(startTime).getTime()
  return diffMs > 0 ? diffMs / (24 * 60 * 60 * 1000) : 0
}

function uniqueStrings(values: Array<string | null>) {
  return Array.from(new Set(values.filter(Boolean) as string[]))
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}
