import { runPlaceholderBacktest } from "@/lib/analysis/backtest"
import {
  buildVolatilityWarningFlags,
  calculateAnnualizedRealizedVolatility,
  calculateEdge,
  calculateImpliedProbability,
  calculateLargestAbsoluteMove,
  classifyVolatilityRegime,
  estimateProbabilityAboveStrike,
  summarizeVolatilityWarnings,
} from "@/lib/analysis/probability"
import { applyRiskFirewall, clampRiskPct } from "@/lib/risk/engine"
import { clamp } from "@/lib/utils"
import {
  AnalysisSnapshot,
  BtcSnapshot,
  ExampleAnalysisOutput,
  KalshiMarket,
  MarketAnalysis,
  ProbabilityModelType,
  VolatilitySnapshot,
} from "@/types"

const DEFAULT_MODEL_TYPE: ProbabilityModelType = "lognormal"
const DEFAULT_MODEL_VOLATILITY = 0.35

interface BuildSnapshotInput {
  requestedTicker: string
  resolvedEventTicker: string
  markets: KalshiMarket[]
  btc: BtcSnapshot
  bankroll: number
  maxRiskPct: number
}

export function buildAnalysisSnapshot({
  requestedTicker,
  resolvedEventTicker,
  markets,
  btc,
  bankroll,
  maxRiskPct,
}: BuildSnapshotInput): AnalysisSnapshot {
  const volatility = buildVolatilitySnapshot(btc)
  const safeRiskPct = clampRiskPct(maxRiskPct)

  const analyses = markets
    .map((market) =>
      analyzeSingleMarket({
        market,
        btc,
        bankroll,
        maxRiskPct: safeRiskPct,
        volatility,
      }),
    )
    .sort((left, right) => rankAnalysis(right) - rankAnalysis(left))

  const topOpportunities = analyses
    .filter((analysis) => analysis.recommendation !== "NO TRADE")
    .slice(0, 3)
  const activeCount = analyses.filter((analysis) =>
    ["active", "open", "initialized"].includes(analysis.market.status.toLowerCase()),
  ).length

  const warnings = uniqueStrings([
    activeCount === 0
      ? "All related Kalshi contracts for this ticker are currently closed."
      : null,
    ...volatility.warnings,
    topOpportunities.length === 0
      ? "No market cleared the no-trade firewall. Capital preservation takes priority."
      : `${topOpportunities.length} selective setup(s) cleared the firewall. Default stance remains NO TRADE unless quotes hold.`,
  ])

  return {
    requestedTicker,
    resolvedEventTicker,
    asOf: new Date().toISOString(),
    bankroll,
    maxRiskPct: safeRiskPct,
    btc: {
      source: btc.source,
      spotPrice: btc.spotPrice,
      candleCounts: {
        "1m": btc.candles["1m"].length,
        "5m": btc.candles["5m"].length,
        "15m": btc.candles["15m"].length,
        "1h": btc.candles["1h"].length,
      },
    },
    volatility,
    markets: analyses,
    topOpportunities,
    defaultStance:
      topOpportunities.length > 0
        ? "NO TRADE bias active. Only the flagged setups passed every rule."
        : "NO TRADE. Nothing currently clears the edge, liquidity, and risk filters.",
    warnings,
    exampleAnalysis: buildExampleAnalysisOutput(analyses, btc.spotPrice),
    backtestPreview: runPlaceholderBacktest(btc.candles["15m"], analyses),
    disclaimers: [
      "Analysis only. Sawner Equities does not place trades or route orders.",
      "Model probabilities estimate fair odds from recent realized volatility and do not guarantee outcomes.",
      "Prediction market quotes can move faster than public spot feeds. Verify live liquidity before acting.",
      "No output here implies guaranteed profit or suitability for your situation.",
    ],
  }
}

function analyzeSingleMarket({
  market,
  btc,
  bankroll,
  maxRiskPct,
  volatility,
}: {
  market: KalshiMarket
  btc: BtcSnapshot
  bankroll: number
  maxRiskPct: number
  volatility: VolatilitySnapshot
}): MarketAnalysis {
  const spotPrice = btc.spotPrice
  const settlementTime = market.closeTime ?? market.settlementTime
  const minutesToSettlement = settlementTime
    ? Math.max((new Date(settlementTime).getTime() - Date.now()) / 60000, 0)
    : null

  const distanceToStrikeDollars =
    market.strikePrice === null ? null : spotPrice - market.strikePrice
  const distanceToStrikePct =
    market.strikePrice === null || market.strikePrice === 0
      ? null
      : ((spotPrice - market.strikePrice) / market.strikePrice) * 100

  const probabilityEstimate =
    market.strikePrice === null || minutesToSettlement === null
      ? null
      : estimateProbabilityAboveStrike(
          spotPrice,
          market.strikePrice,
          minutesToSettlement,
          volatility.modelVol,
          DEFAULT_MODEL_TYPE,
        )

  const fairProbabilityAbove = probabilityEstimate?.probabilityAbove ?? null
  const fairProbabilityBelow = probabilityEstimate?.probabilityBelow ?? null

  const impliedProbabilityYesBid = toImpliedProbabilityFromDollarPrice(market.yesBid)
  const impliedProbabilityYesAsk = toImpliedProbabilityFromDollarPrice(market.yesAsk)
  const impliedProbabilityNoBid = toImpliedProbabilityFromDollarPrice(market.noBid)
  const impliedProbabilityNoAsk = toImpliedProbabilityFromDollarPrice(market.noAsk)

  const bidAskSpread =
    impliedProbabilityYesBid !== null && impliedProbabilityYesAsk !== null
      ? impliedProbabilityYesAsk - impliedProbabilityYesBid
      : null
  const marketImpliedMid = midpoint(
    impliedProbabilityYesBid,
    impliedProbabilityYesAsk,
  )

  const rawEdgeYes =
    fairProbabilityAbove !== null && impliedProbabilityYesAsk !== null
      ? calculateEdge(fairProbabilityAbove, impliedProbabilityYesAsk).rawEdge
      : null
  const rawEdgeNo =
    fairProbabilityBelow !== null && impliedProbabilityNoAsk !== null
      ? calculateEdge(fairProbabilityBelow, impliedProbabilityNoAsk).rawEdge
      : null

  const suggestedSide =
    (rawEdgeYes ?? Number.NEGATIVE_INFINITY) >=
    (rawEdgeNo ?? Number.NEGATIVE_INFINITY)
      ? "YES"
      : "NO"
  const actionPrice =
    suggestedSide === "YES" ? impliedProbabilityYesAsk : impliedProbabilityNoAsk
  const rawEdge = suggestedSide === "YES" ? rawEdgeYes : rawEdgeNo
  const spreadAdjustedEdge =
    rawEdge === null ? null : rawEdge - (bidAskSpread ?? 0) / 2

  const liquidityScore = clamp(
    (Math.log1p(market.volume + market.openInterest + market.liquidity) - 4) / 4,
    0,
    1,
  )
  const liquidityAdjustedEdge =
    spreadAdjustedEdge === null
      ? null
      : spreadAdjustedEdge * (0.45 + liquidityScore * 0.55)

  const confidenceScore = computeConfidenceScore({
    rawEdge,
    spread: bidAskSpread,
    liquidityScore,
    minutesToSettlement,
    volatility,
  })

  const riskAdjustedScore = Math.round(
    clamp(
      confidenceScore * 0.7 + ((liquidityAdjustedEdge ?? -0.02) / 0.08) * 30,
      0,
      100,
    ),
  )

  const firewall = applyRiskFirewall({
    bankroll,
    maxRiskPct,
    suggestedSide,
    actionPrice,
    rawEdge,
    bidAskSpread,
    liquidityScore,
    confidenceScore,
    minutesToSettlement,
    volatility,
  })

  const warnings = uniqueStrings([
    ...firewall.warnings,
    market.volume < 150 ? "thin traded volume" : null,
    market.openInterest < 150 ? "thin open interest" : null,
    bidAskSpread !== null && bidAskSpread >= 0.05 ? "wide two-sided quote" : null,
    probabilityEstimate?.confidenceLabel === "low"
      ? "model shows a near 50/50 distribution around this strike"
      : null,
    marketImpliedMid === null ? "incomplete market pricing" : null,
  ])

  return {
    market,
    distanceToStrikeDollars,
    distanceToStrikePct,
    minutesToSettlement,
    fairProbabilityAbove,
    fairProbabilityBelow,
    impliedProbabilityYesBid,
    impliedProbabilityYesAsk,
    impliedProbabilityNoBid,
    impliedProbabilityNoAsk,
    marketImpliedMid,
    bidAskSpread,
    rawEdge,
    spreadAdjustedEdge,
    liquidityAdjustedEdge,
    riskAdjustedScore,
    confidenceScore,
    suggestedSide,
    actionPrice,
    recommendation: firewall.recommendation,
    warnings,
    ruleChecks: firewall.ruleChecks,
    sizing: firewall.sizing,
  }
}

function rankAnalysis(analysis: MarketAnalysis) {
  const recommendationBoost = analysis.recommendation === "NO TRADE" ? 0 : 1000
  return (
    recommendationBoost +
    analysis.riskAdjustedScore +
    (analysis.liquidityAdjustedEdge ?? -0.2) * 1000 -
    (analysis.bidAskSpread ?? 0.2) * 100
  )
}

function buildVolatilitySnapshot(btc: BtcSnapshot): VolatilitySnapshot {
  const closes = btc.candles["1m"].map((candle) => candle.close)
  const rv15 = calculateAnnualizedRealizedVolatility(closes, 15)
  const rv30 = calculateAnnualizedRealizedVolatility(closes, 30)
  const rv60 = calculateAnnualizedRealizedVolatility(closes, 60)
  const largestAbsMove1m = calculateLargestAbsoluteMove(closes)
  const modelVol = rv30 ?? rv60 ?? rv15 ?? DEFAULT_MODEL_VOLATILITY
  const warningFlags = buildVolatilityWarningFlags(modelVol, largestAbsMove1m ?? 0)
  const regime = classifyVolatilityRegime(modelVol, largestAbsMove1m ?? 0)

  return {
    rv15,
    rv30,
    rv60,
    regime,
    regimeLabel: regime.toUpperCase(),
    warningFlags,
    warnings: summarizeVolatilityWarnings(warningFlags),
    elevatedRealizedVolatilityWarning: warningFlags.elevatedRealizedVolatility,
    largeRecentMoveWarning: warningFlags.unusuallyLargeRecentMove,
    fatTailWarning: warningFlags.fatTailCondition,
    largestAbsMove1m,
    modelVol,
  }
}

function buildExampleAnalysisOutput(
  analyses: MarketAnalysis[],
  spotPrice: number,
): ExampleAnalysisOutput | null {
  const example = analyses
    .filter(
      (analysis) =>
        analysis.market.strikePrice !== null &&
        analysis.marketImpliedMid !== null &&
        analysis.fairProbabilityAbove !== null,
    )
    .sort((left, right) => {
      const leftDistance = Math.abs((left.market.strikePrice ?? spotPrice) - spotPrice)
      const rightDistance = Math.abs((right.market.strikePrice ?? spotPrice) - spotPrice)
      return leftDistance - rightDistance
    })
    .at(0)

  if (
    !example ||
    example.market.strikePrice === null ||
    example.marketImpliedMid === null ||
    example.fairProbabilityAbove === null
  ) {
    return null
  }

  return {
    marketTicker: example.market.ticker,
    spotPrice,
    strikePrice: example.market.strikePrice,
    impliedProbability: example.marketImpliedMid,
    modelProbability: example.fairProbabilityAbove,
    estimatedEdge: calculateEdge(
      example.fairProbabilityAbove,
      example.marketImpliedMid,
    ).rawEdge,
  }
}

function computeConfidenceScore({
  rawEdge,
  spread,
  liquidityScore,
  minutesToSettlement,
  volatility,
}: {
  rawEdge: number | null
  spread: number | null
  liquidityScore: number
  minutesToSettlement: number | null
  volatility: VolatilitySnapshot
}) {
  const edgeScore = clamp((rawEdge ?? -0.02) / 0.08, 0, 1)
  const spreadScore = clamp(1 - (spread ?? 0.08) / 0.08, 0, 1)
  const timeScore =
    minutesToSettlement === null
      ? 0
      : clamp((minutesToSettlement - 5) / 120, 0, 1)

  const regimePenalty =
    volatility.regime === "extreme"
      ? 0.35
      : volatility.regime === "elevated"
        ? 0.72
        : volatility.regime === "normal"
          ? 0.88
          : 1

  return Math.round(
    clamp(
      (edgeScore * 0.38 + spreadScore * 0.18 + liquidityScore * 0.24 + timeScore * 0.2) *
        100 *
        regimePenalty,
      0,
      100,
    ),
  )
}

function midpoint(left: number | null, right: number | null) {
  if (left === null && right === null) return null
  if (left === null) return right
  if (right === null) return left
  return (left + right) / 2
}

function toImpliedProbabilityFromDollarPrice(price: number | null) {
  if (price === null || !Number.isFinite(price) || price < 0 || price > 1) {
    return null
  }

  return calculateImpliedProbability(price * 100)
}

function uniqueStrings(values: Array<string | null>) {
  return Array.from(new Set(values.filter(Boolean) as string[]))
}
