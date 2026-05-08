import { NextRequest, NextResponse } from "next/server"

import { buildAnalysisSnapshot } from "@/lib/analysis/engine"
import { fetchBtcSnapshot } from "@/lib/btc/client"
import { fetchKalshiEventMarkets } from "@/lib/kalshi/client"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker")?.trim()
  const bankrollValue = request.nextUrl.searchParams.get("bankroll")?.trim()
  const maxRiskPctValue = request.nextUrl.searchParams.get("maxRiskPct")?.trim()

  if (!ticker) {
    return NextResponse.json(
      { error: "A Kalshi market or event ticker is required." },
      { status: 400 },
    )
  }

  const bankroll = bankrollValue ? Number(bankrollValue) : 10000
  const maxRiskPct = maxRiskPctValue ? Number(maxRiskPctValue) : 0.015

  if (!Number.isFinite(bankroll) || bankroll <= 0) {
    return NextResponse.json(
      { error: "Bankroll must be a positive number." },
      { status: 400 },
    )
  }

  try {
    const [kalshiSnapshot, btcSnapshot] = await Promise.all([
      fetchKalshiEventMarkets(ticker),
      fetchBtcSnapshot(),
    ])

    const snapshot = buildAnalysisSnapshot({
      requestedTicker: ticker,
      resolvedEventTicker: kalshiSnapshot.eventTicker,
      markets: kalshiSnapshot.markets,
      btc: btcSnapshot,
      bankroll,
      maxRiskPct,
    })

    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected analysis failure."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
