import { NextRequest, NextResponse } from "next/server"

import {
  fetchHistoricalBtcDataset,
  HistoricalBtcReplayDataset,
} from "@/lib/btc/client"
import {
  buildHistoricalDatasetFromCandles,
  buildSyntheticKalshiStyleContracts,
  buildDemoBacktestReport,
  runBacktest,
} from "@/lib/backtest"
import type {
  BacktestConfigOverrides,
  KalshiStyleHistoricalContract,
  SyntheticContractRequest,
} from "@/lib/backtest/types"
import { BTCCandle, CandleInterval } from "@/types"

export const dynamic = "force-dynamic"

const DEFAULT_SYNTHETIC_REQUEST: SyntheticContractRequest = {
  interval: "15m",
  expiryMinutes: 60,
  strikeOffsetsPct: [-0.01, -0.005, 0, 0.005, 0.01],
  entryEveryCandles: 2,
  marketVolMultiplier: 1.08,
  marketProbabilityBias: 0.02,
  spreadWidth: 0.04,
  liquidityScore: 0.55,
}

interface PostBacktestBody {
  demo?: boolean
  fetch?: {
    start: string
    end: string
    intervals?: CandleInterval[]
  }
  dataset?: {
    source?: string
    productId?: string
    candles: Partial<Record<CandleInterval, BTCCandle[]>>
  }
  contracts?: KalshiStyleHistoricalContract[]
  synthetic?: boolean | Partial<SyntheticContractRequest>
  config?: BacktestConfigOverrides
}

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get("demo") === "true") {
      return NextResponse.json(buildDemoBacktestReport(), {
        headers: { "Cache-Control": "no-store" },
      })
    }

    const interval = parseInterval(
      request.nextUrl.searchParams.get("interval"),
      "15m",
    )
    const hours = parsePositiveNumber(
      request.nextUrl.searchParams.get("hours"),
      48,
    )
    const end = request.nextUrl.searchParams.get("end")
      ? new Date(request.nextUrl.searchParams.get("end")!)
      : new Date()
    const start = request.nextUrl.searchParams.get("start")
      ? new Date(request.nextUrl.searchParams.get("start")!)
      : new Date(end.getTime() - hours * 60 * 60 * 1000)
    const dataset = await fetchHistoricalBtcDataset({
      start,
      end,
    })

    const syntheticRequest = {
      ...DEFAULT_SYNTHETIC_REQUEST,
      interval,
      expiryMinutes: parsePositiveNumber(
        request.nextUrl.searchParams.get("expiryMinutes"),
        DEFAULT_SYNTHETIC_REQUEST.expiryMinutes,
      ),
      entryEveryCandles: parsePositiveNumber(
        request.nextUrl.searchParams.get("entryEveryCandles"),
        DEFAULT_SYNTHETIC_REQUEST.entryEveryCandles,
      ),
      strikeOffsetsPct:
        parseOffsets(request.nextUrl.searchParams.get("strikeOffsetsPct")) ??
        DEFAULT_SYNTHETIC_REQUEST.strikeOffsetsPct,
    }

    const report = runBacktest({
      dataset,
      contracts: buildSyntheticKalshiStyleContracts(dataset, syntheticRequest),
      config: {
        interval,
        risk: {
          initialBankroll: parsePositiveNumber(
            request.nextUrl.searchParams.get("bankroll"),
            10000,
          ),
          maxRiskPct: parsePositiveNumber(
            request.nextUrl.searchParams.get("maxRiskPct"),
            0.015,
          ),
        },
        research: {
          useSyntheticQuotes: true,
          assumptions: [
            "GET /api/backtest synthesizes Kalshi-style quotes from historical BTC candles unless you submit explicit contract history with POST.",
          ],
        },
      },
    })

    return NextResponse.json(report, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected backtest failure."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PostBacktestBody

    if (body.demo) {
      return NextResponse.json(buildDemoBacktestReport(), {
        headers: { "Cache-Control": "no-store" },
      })
    }

    const dataset = await resolveDataset(body)
    const contracts = resolveContracts(body, dataset)
    const report = runBacktest({
      dataset,
      contracts,
      config: body.config,
    })

    return NextResponse.json(report, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected backtest failure."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function resolveDataset(body: PostBacktestBody) {
  if (body.dataset?.candles) {
    return buildHistoricalDatasetFromCandles({
      source: body.dataset.source ?? "Custom historical candles",
      productId: body.dataset.productId ?? "custom",
      candles: body.dataset.candles,
    })
  }

  if (body.fetch) {
    return fetchHistoricalBtcDataset({
      start: body.fetch.start,
      end: body.fetch.end,
      intervals: body.fetch.intervals,
    })
  }

  throw new Error(
    "Provide either dataset.candles or fetch.{start,end} for a backtest run.",
  )
}

function resolveContracts(
  body: PostBacktestBody,
  dataset: HistoricalBtcReplayDataset,
) {
  if (body.contracts && body.contracts.length > 0) {
    return body.contracts
  }

  if (body.synthetic) {
    const syntheticRequest = {
      ...DEFAULT_SYNTHETIC_REQUEST,
      ...(typeof body.synthetic === "object" ? body.synthetic : {}),
    }
    return buildSyntheticKalshiStyleContracts(dataset, syntheticRequest)
  }

  throw new Error(
    "Provide contracts for historical quote replay or set synthetic to generate simulated Kalshi-style markets.",
  )
}

function parseInterval(
  value: string | null,
  fallback: CandleInterval,
): CandleInterval {
  if (value === "1m" || value === "5m" || value === "15m" || value === "1h") {
    return value
  }

  return fallback
}

function parsePositiveNumber(value: string | null, fallback: number) {
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseOffsets(value: string | null) {
  if (!value) {
    return null
  }

  const offsets = value
    .split(",")
    .map((token) => Number(token.trim()))
    .filter((token) => Number.isFinite(token))
    .map((token) => token / 100)

  return offsets.length > 0 ? offsets : null
}
