import { buildHistoricalDatasetFromCandles } from "@/lib/backtest/candles"
import { buildSyntheticKalshiStyleContracts } from "@/lib/backtest/contracts"
import { runBacktest } from "@/lib/backtest/engine"
import { SyntheticContractRequest } from "@/lib/backtest/types"
import { BTCCandle } from "@/types"

const DEMO_START = "2026-03-12T00:00:00.000Z"

export function buildDemoBacktestReport() {
  const dataset = buildHistoricalDatasetFromCandles({
    source: "Deterministic demo BTC replay",
    productId: "BTC-USD-DEMO",
    candles: {
      "1m": buildDemoCandles(),
    },
  })

  const syntheticRequest: SyntheticContractRequest = {
    interval: "15m",
    expiryMinutes: 60,
    strikeOffsetsPct: [-0.01, -0.005, 0, 0.005, 0.01],
    entryEveryCandles: 2,
    marketVolMultiplier: 1.08,
    marketProbabilityBias: 0.02,
    spreadWidth: 0.04,
    liquidityScore: 0.56,
  }

  const contracts = buildSyntheticKalshiStyleContracts(dataset, syntheticRequest)

  return runBacktest({
    dataset,
    contracts,
    config: {
      interval: "15m",
      research: {
        useSyntheticQuotes: true,
        assumptions: [
          "Demo dataset uses deterministic synthetic BTC candles rather than live exchange history.",
        ],
      },
      macroEvents: [
        {
          label: "US CPI window",
          start: "2026-03-12T09:00:00.000Z",
          end: "2026-03-12T10:30:00.000Z",
        },
        {
          label: "Fed speaker window",
          start: "2026-03-12T15:00:00.000Z",
          end: "2026-03-12T16:00:00.000Z",
        },
      ],
    },
  })
}

function buildDemoCandles() {
  const startMs = new Date(DEMO_START).getTime()
  const candles: BTCCandle[] = []
  let price = 64000

  for (let index = 0; index < 24 * 60; index += 1) {
    const timestamp = new Date(startMs + index * 60 * 1000).toISOString()
    const open = price
    const drift =
      index < 360
        ? 0.00004
        : index < 720
          ? -0.00002
          : index < 960
            ? 0.000055
            : -0.000018
    const seasonal =
      Math.sin(index / 18) * 0.00035 + Math.sin(index / 77) * 0.00022
    const macroShock =
      index >= 540 && index <= 600
        ? 0.0005
        : index >= 900 && index <= 930
          ? -0.00065
          : 0

    const close = Math.max(
      1000,
      open * (1 + drift + seasonal + macroShock),
    )
    const wick = Math.abs(Math.sin(index / 9)) * open * 0.0008
    const high = Math.max(open, close) + wick
    const low = Math.min(open, close) - wick * 0.85
    const volume =
      12 + Math.abs(Math.sin(index / 13)) * 7 + Math.abs(macroShock) * 18000

    candles.push({
      interval: "1m",
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    })

    price = close
  }

  return candles
}
