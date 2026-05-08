import {
  calculateAnnualizedRealizedVolatility,
  estimateProbabilityAboveStrike,
} from "@/lib/analysis/probability"
import {
  findFirstCandleAtOrAfter,
  getIntervalMinutes,
  sliceCandlesThrough,
} from "@/lib/backtest/candles"
import { classifyTrendRegime } from "@/lib/backtest/regimes"
import {
  BacktestBtcDataset,
  KalshiStyleHistoricalContract,
  QuoteConstruction,
  SyntheticContractRequest,
} from "@/lib/backtest/types"
import { clamp } from "@/lib/utils"

export interface NormalizedKalshiStyleContract
  extends KalshiStyleHistoricalContract {
  yesPrice: number
  noPrice: number
  bidAskSpread: number
  liquidityScore: number
  quoteConstruction: QuoteConstruction
}

export function normalizeHistoricalContract(
  contract: KalshiStyleHistoricalContract,
): NormalizedKalshiStyleContract {
  const marketImpliedProbability = clamp(contract.marketImpliedProbability, 0.01, 0.99)
  const hasTwoSidedPrices =
    Number.isFinite(contract.yesPrice) && Number.isFinite(contract.noPrice)

  const yesPrice = hasTwoSidedPrices
    ? clamp(contract.yesPrice ?? marketImpliedProbability, 0.01, 0.99)
    : marketImpliedProbability
  const noPrice = hasTwoSidedPrices
    ? clamp(contract.noPrice ?? 1 - marketImpliedProbability, 0.01, 0.99)
    : clamp(1 - marketImpliedProbability, 0.01, 0.99)

  return {
    ...contract,
    marketImpliedProbability,
    yesPrice,
    noPrice,
    bidAskSpread: clamp(
      contract.bidAskSpread ?? Math.max(yesPrice + noPrice - 1, 0),
      0,
      1,
    ),
    liquidityScore: clamp(contract.liquidityScore ?? 0.5, 0, 1),
    quoteConstruction: hasTwoSidedPrices
      ? "provided-two-sided"
      : "derived-from-implied",
  }
}

export function buildSyntheticKalshiStyleContracts(
  dataset: BacktestBtcDataset,
  request: SyntheticContractRequest,
) {
  const entrySeries = dataset.candles[request.interval]
  const volatilitySeries =
    dataset.candles["1m"].length > 0
      ? dataset.candles["1m"]
      : entrySeries
  const settlementSeries =
    dataset.candles["1m"].length > 0
      ? dataset.candles["1m"]
      : entrySeries
  const candleMinutes =
    dataset.candles["1m"].length > 0 ? 1 : getIntervalMinutes(request.interval)

  const contracts: KalshiStyleHistoricalContract[] = []
  const minLookbackCandles = Math.max(12, request.entryEveryCandles)

  for (
    let index = minLookbackCandles;
    index < entrySeries.length;
    index += Math.max(request.entryEveryCandles, 1)
  ) {
    const entryCandle = entrySeries[index]
    const expiryTime = new Date(
      new Date(entryCandle.timestamp).getTime() + request.expiryMinutes * 60 * 1000,
    ).toISOString()

    if (!findFirstCandleAtOrAfter(settlementSeries, expiryTime)) {
      continue
    }

    const recentVolatilitySlice = sliceCandlesThrough(
      volatilitySeries,
      entryCandle.timestamp,
      Math.max(120 / candleMinutes, 12),
    )
    const volatilityCloses = recentVolatilitySlice.map((candle) => candle.close)
    const marketVol =
      (calculateAnnualizedRealizedVolatility(
        volatilityCloses,
        60,
        candleMinutes,
      ) ?? 0.45) * request.marketVolMultiplier

    const recentTrendSlice = sliceCandlesThrough(entrySeries, entryCandle.timestamp, 12)
    const trendRegime = classifyTrendRegime(recentTrendSlice, 12, 0.62)
    const trendDirection =
      recentTrendSlice.length >= 2
        ? Math.sign(
            recentTrendSlice.at(-1)!.close - recentTrendSlice[0].close,
          )
        : 0

    request.strikeOffsetsPct.forEach((offsetPct, offsetIndex) => {
      const strikePrice = entryCandle.close * (1 + offsetPct)
      const probability = estimateProbabilityAboveStrike(
        entryCandle.close,
        strikePrice,
        request.expiryMinutes,
        marketVol,
        "lognormal",
      ).probabilityAbove

      const directionalBias =
        trendRegime === "trending"
          ? trendDirection *
            (strikePrice >= entryCandle.close
              ? request.marketProbabilityBias
              : -request.marketProbabilityBias)
          : 0
      const deterministicBias =
        Math.sin((index + 1) * (offsetIndex + 1)) *
        (request.marketProbabilityBias / 2)

      const impliedMid = clamp(
        probability + directionalBias + deterministicBias,
        0.01,
        0.99,
      )
      const yesPrice = clamp(impliedMid + request.spreadWidth / 2, 0.01, 0.99)
      const noPrice = clamp(
        1 - impliedMid + request.spreadWidth / 2,
        0.01,
        0.99,
      )

      contracts.push({
        id: `syn-${request.interval}-${index}-${offsetIndex}`,
        ticker: `SYN-${request.interval.toUpperCase()}-${index}-${offsetIndex}`,
        listedTime: entryCandle.timestamp,
        expiryTime,
        strikePrice,
        spotPrice: entryCandle.close,
        marketImpliedProbability: impliedMid,
        yesPrice,
        noPrice,
        bidAskSpread: request.spreadWidth,
        liquidityScore: request.liquidityScore,
        source: "synthetic-market",
        tags: [`trend:${trendRegime}`],
        metadata: {
          offsetPct,
          marketVol,
        },
      })
    })
  }

  return contracts
}
