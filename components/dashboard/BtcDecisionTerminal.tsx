"use client"

import {
  AlertTriangle,
  LineChart,
  RefreshCw,
  Satellite,
} from "lucide-react"
import { useMemo, useState, type ReactNode } from "react"

import { useRealtimeBtc } from "@/hooks/useRealtimeBtc"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfidenceReliabilityPanel } from "@/components/dashboard/ConfidenceReliabilityPanel"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { clamp, cn, formatCompactNumber, formatCurrency, formatPercent } from "@/lib/utils"
import type {
  BtcMarketRegimeSnapshot,
  BtcRegimeTransition,
} from "@/lib/analysis/regimeDetection"
import { type RealtimeBtcTick } from "@/lib/btc/realtime"
import {
  exportBtcJournalAsCsv,
  exportBtcJournalAsJson,
} from "@/lib/btc/journal"
import { BtcCandlestickChart } from "@/components/dashboard/BtcCandlestickChart"
import type { BtcJournalRow, BtcJournalOutcome } from "@/lib/btc/journal-types"

export function BtcDecisionTerminal() {
  const {
    connectionState,
    reconnectAttempt,
    isStale,
    lastMessageAtMs,
    lastHeartbeatAtMs,
    error,
    ticks,
    decision,
    latestTick,
    signalPerformance,
    exchangeHealth,
    priceConsensus,
    marketRegime,
    regimeTransitions,
    regimeWarnings,
    breakoutHistory,
    signalSuppressionOverrideEnabled,
    setSignalSuppressionOverrideEnabled,
    clearJournal,
  } = useRealtimeBtc()
  const [clearDialogOpen, setClearDialogOpen] = useState(false)

  const price = priceConsensus.consolidatedPrice
  const priceMove = calculatePriceMove(ticks)
  const priceDirectionClass =
    priceMove === null
      ? "text-foreground"
      : priceMove >= 0
        ? "text-emerald-300"
        : "text-rose-300"
  const connectionTone =
    connectionState === "open" && !isStale
      ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/20"
      : connectionState === "reconnecting" || connectionState === "connecting"
        ? "bg-amber-500/15 text-amber-200 border-amber-500/20"
        : "bg-rose-500/15 text-rose-200 border-rose-500/20"

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.10),transparent_24%),radial-gradient(circle_at_80%_0%,rgba(45,212,191,0.10),transparent_20%),radial-gradient(circle_at_bottom,rgba(255,255,255,0.04),transparent_38%)]" />
      <div className="relative mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
        <header className="grid gap-4 rounded-3xl border border-white/10 bg-[#08111f]/88 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur md:grid-cols-[1.5fr_0.9fr] md:p-6">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn("border", connectionTone)} variant="outline">
                {connectionState === "open" && !isStale ? "Live feed" : "Feed watch"}
              </Badge>
              <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-slate-300">
                BTC Decision Engine
              </Badge>
              <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-slate-300">
                Multi-exchange WebSocket
              </Badge>
              <span className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                {priceConsensus.consolidatedPrice !== null && latestTick
                  ? `Last consensus tick ${formatWallClock(latestTick.exchangeTimeMs)}`
                  : "Consensus unavailable"}
              </span>
            </div>

            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">
                Sawner Equities
              </p>
              <h1 className="max-w-3xl font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
                Real-time BTC price intelligence for short-horizon direction reads.
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                Live BTC-USD ticks, microstructure context, and short-term analytics are
                folded into a decision view for research and monitoring only.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="gap-2 border-white/10 bg-white/[0.03]">
                <RefreshCw className="size-4" />
                Auto-reconnect
              </Button>
              <Button variant="outline" size="sm" className="gap-2 border-white/10 bg-white/[0.03]">
                <Satellite className="size-4" />
                Stale feed detection
              </Button>
              <Button variant="outline" size="sm" className="gap-2 border-white/10 bg-white/[0.03]">
                <LineChart className="size-4" />
                Rolling analytics
              </Button>
            </div>
          </div>

          <Card className="border-white/10 bg-[#0c1628]/90">
            <CardContent className="space-y-4 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
                    BTC Terminal Snapshot
                  </div>
                  <div className={cn("font-mono text-4xl font-semibold tabular-nums sm:text-5xl", priceDirectionClass)}>
                    {formatCurrency(price, 2)}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    <span>{priceMove === null ? "No move yet" : formatSignedPercentValue(priceMove)}</span>
                    <span className="opacity-50">|</span>
                    <span>{decision.spread !== null ? `Spread ${formatCurrency(decision.spread, 2)}` : "Spread n/a"}</span>
                    <span className="opacity-50">|</span>
                    <span>{formatTradeSize(decision.volume24h)}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <StatusToken tone={marketStateTone(decision.marketState.state)}>
                    STATE: {decision.marketState.state}
                  </StatusToken>
                  <StatusToken tone={suppressionTone(decision.signalSuppression.level)}>
                    SUPPRESSION: {decision.signalSuppression.level}
                  </StatusToken>
                  <StatusToken tone={regimeTone(marketRegime.primaryRegime)}>
                    REGIME: {marketRegime.primaryRegime}
                  </StatusToken>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <TerminalToken label="READ" value={decision.marketQuality.directionalReadout} />
                <TerminalToken label="CONF" value={`${decision.confidenceScore}/100`} />
                <TerminalToken label="RISK" value={decision.riskState} />
                <TerminalToken label="WIN" value={decision.observationWindow} />
                <TerminalToken label="MKT" value={decision.marketState.interpretability} />
                <TerminalToken label="SPD" value={decision.marketQuality.stabilityAssessment} />
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm leading-6 text-muted-foreground">
                <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  What to watch next
                </span>
                <div className="mt-1 text-foreground">{decision.explanation.biasChangeCondition}</div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <MiniStat label="Bid" value={formatCurrency(decision.bid, 2)} />
                <MiniStat label="Ask" value={formatCurrency(decision.ask, 2)} />
                <MiniStat label="Consensus" value={formatCurrency(priceConsensus.consolidatedPrice, 2)} />
              </div>
            </CardContent>
          </Card>
        </header>

        <Card className="border-white/10 bg-[#0c1628]/88">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>BTC Candlestick</CardTitle>
                <CardDescription>
                  Consolidated multi-exchange price action, aggregated into live OHLC candles.
                </CardDescription>
              </div>
              <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-slate-300">
                {priceConsensus.activeExchangeCount}/{priceConsensus.totalExchangeCount} active
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <BtcCandlestickChart ticks={ticks} />
          </CardContent>
        </Card>

        <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <Card className="border-white/10 bg-[#0c1628]/88">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Live BTC State</CardTitle>
                    <CardDescription>
                      Consolidated multi-exchange price and live candlestick view.
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-slate-300">
                    {priceConsensus.activeExchangeCount}/{priceConsensus.totalExchangeCount} exchanges
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
                  <MiniStat label="Consensus price" value={formatCurrency(price, 2)} />
                  <MiniStat
                    label="Consensus spread"
                    value={priceConsensus.spread === null ? "n/a" : formatCurrency(priceConsensus.spread, 2)}
                  />
                  <MiniStat
                    label="Active feeds"
                    value={`${priceConsensus.activeExchangeCount}/${priceConsensus.totalExchangeCount}`}
                  />
                  <MiniStat label="Max deviation" value={formatPercentOrNA(priceConsensus.maxDeviationPct, 2)} />
                  <MiniStat label="Latency" value={formatLatency(priceConsensus.latencyMs)} />
                  <MiniStat label="Volume" value={formatTradeSize(decision.volume24h)} />
                </div>

                <BtcCandlestickChart ticks={ticks} />
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="border-white/10 bg-[#0c1628]/88">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Decision Snapshot</CardTitle>
                    <CardDescription>
                      High-level readout for short-horizon BTC interpretation.
                    </CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "border-white/10",
                      decision.riskState === "clean"
                        ? "bg-emerald-500/10 text-emerald-200"
                        : decision.riskState === "caution"
                          ? "bg-amber-500/10 text-amber-200"
                          : "bg-rose-500/10 text-rose-200",
                    )}
                  >
                    {decision.riskState}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <MiniStat label="Directional read" value={decision.marketQuality.directionalReadout} />
                  <MiniStat label="Confidence" value={`${decision.confidenceScore}/100`} />
                  <MiniStat label="Observation window" value={decision.observationWindow} />
                  <MiniStat label="Market state" value={decision.marketState.state} />
                </div>
                <ExplanationBlock label="Primary reason" value={decision.explanation.primaryReason} />
                <ExplanationBlock
                  label="What to watch next"
                  value={decision.explanation.biasChangeCondition}
                />
                {decision.marketState.warning || decision.signalSuppression.warning ? (
                  <AlertRow
                    tone="warning"
                    text={decision.marketState.warning ?? decision.signalSuppression.warning ?? ""}
                  />
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-[#0c1628]/88">
              <CardHeader className="pb-3">
                <CardTitle>Market State Summary</CardTitle>
                <CardDescription>
                  Public HFT-inspired read on interpretability and market cleanliness.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <MiniStat label="State" value={decision.marketState.state} />
                  <MiniStat label="Interpretability" value={decision.marketState.interpretability} />
                  <MiniStat label="Main risk" value={decision.marketState.mainRisk} />
                  <MiniStat
                    label="Score"
                    value={`${decision.marketState.signalInterpretabilityScore}/100`}
                  />
                </div>
                <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-3">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    Primary reason
                  </div>
                  <div className="text-sm leading-6 text-foreground">
                    {decision.marketState.primaryReason}
                  </div>
                </div>
                {decision.marketState.warning ? (
                  <AlertRow tone="warning" text={decision.marketState.warning} />
                ) : null}
              </CardContent>
            </Card>
          </div>
        </section>

        <div className="space-y-4">
          <CollapsibleSection
            title="Exchange diagnostics"
            description="Live exchange health, price consensus, and raw tick stream."
          >
            <div className="space-y-4">
              <Card className="border-white/10 bg-[#0c1628]/88">
                <CardHeader className="pb-3">
                  <CardTitle>Price Consensus</CardTitle>
                  <CardDescription>
                    Consolidated price from active exchange feeds.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  <MiniStat
                    label="Consensus price"
                    value={
                      priceConsensus.consolidatedPrice === null
                        ? "stale / unavailable"
                        : formatCurrency(priceConsensus.consolidatedPrice, 2)
                    }
                  />
                  <MiniStat
                    label="Active exchanges"
                    value={`${priceConsensus.activeExchangeCount}/${priceConsensus.totalExchangeCount}`}
                  />
                  <MiniStat
                    label="Max deviation"
                    value={formatPercentOrNA(priceConsensus.maxDeviationPct, 2)}
                  />
                  <MiniStat
                    label="Agreement score"
                    value={`${priceConsensus.agreementScore}/100`}
                  />
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-[#0c1628]/88">
                <CardHeader className="pb-3">
                  <CardTitle>Exchange Health</CardTitle>
                  <CardDescription>
                    Live status and latest quote context per exchange.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {exchangeHealth.map((feed) => (
                    <ExchangeHealthRow key={feed.exchange} feed={feed} />
                  ))}
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-[#0c1628]/88">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle>Alerts</CardTitle>
                      <CardDescription>
                        Feed issues, sudden moves, and regime warnings.
                      </CardDescription>
                    </div>
                    {decision.alerts.length > 0 ? (
                      <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-amber-200">
                        {decision.alerts.length}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/10 text-emerald-200">
                        clear
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {error ? <AlertRow tone="danger" text={error} /> : null}
                  {isStale ? (
                    <AlertRow
                      tone="danger"
                      text="The live feed has gone stale. Reconnect logic is active."
                    />
                  ) : null}
                  {decision.alerts.length > 0 ? (
                    decision.alerts.map((alert) => (
                      <AlertRow key={alert} tone="warning" text={alert} />
                    ))
                  ) : (
                    <AlertRow
                      tone="neutral"
                      text="No active alerts. Feed health and short-term structure are within normal bounds."
                    />
                  )}
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-[#0c1628]/88">
                <CardHeader className="pb-3">
                  <CardTitle>Tick Stream</CardTitle>
                  <CardDescription>
                    Most recent consensus ticks with millisecond timestamps.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="max-h-[24rem] overflow-auto rounded-2xl border border-white/10">
                    <table className="min-w-full text-left text-xs">
                      <thead className="sticky top-0 bg-[#08111f] text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Time</th>
                          <th className="px-3 py-2">Price</th>
                          <th className="px-3 py-2">Bid</th>
                          <th className="px-3 py-2">Ask</th>
                          <th className="px-3 py-2">Spread</th>
                          <th className="px-3 py-2">Size</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {ticks.length > 0 ? (
                          [...ticks]
                            .slice(-24)
                            .reverse()
                            .map((tick, index, reversed) => (
                              <TickRow
                                key={`${tick.sequence}-${tick.receivedAtMs}`}
                                tick={tick}
                                previous={reversed[index + 1] ?? null}
                              />
                            ))
                        ) : (
                          <tr>
                            <td
                              colSpan={6}
                              className="px-3 py-8 text-center text-sm text-muted-foreground"
                            >
                              Waiting for the first live consensus tick.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="Market regime"
            description="Regime classification, confidence, stability, and recent shifts."
          >
            <Card className="border-white/10 bg-[#0c1628]/88">
              <CardHeader className="pb-3">
                <CardTitle>Market Regime</CardTitle>
                <CardDescription>
                  Classifies whether BTC is trending, reverting, compressing, or destabilizing.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MiniStat label="Primary regime" value={marketRegime.primaryRegime} />
                  <MiniStat label="Confidence" value={`${marketRegime.regimeConfidence}/100`} />
                  <MiniStat label="Stability" value={`${marketRegime.regimeStabilityScore}/100`} />
                  <MiniStat label="Clarity" value={marketRegime.regimeClarity} />
                </div>

                <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-3">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    Explanation
                  </div>
                  <div className="text-sm leading-6 text-foreground">
                    {marketRegime.explanation}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "border-white/10",
                      marketRegime.isTransitioning
                        ? "bg-amber-500/10 text-amber-200"
                        : marketRegime.regimeClarity === "clear"
                          ? "bg-emerald-500/10 text-emerald-200"
                          : marketRegime.regimeClarity === "mixed"
                            ? "bg-sky-500/10 text-sky-200"
                            : "bg-rose-500/10 text-rose-200",
                    )}
                  >
                    {marketRegime.isTransitioning ? "transitioning" : marketRegime.regimeClarity}
                  </Badge>
                  {marketRegime.secondaryRegime ? (
                    <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-slate-300">
                      secondary: {marketRegime.secondaryRegime}
                    </Badge>
                  ) : null}
                </div>

                {regimeWarnings.length > 0 || marketRegime.warnings.length > 0 ? (
                  <div className="space-y-2">
                    {Array.from(new Set([...marketRegime.warnings, ...regimeWarnings])).map((warning) => (
                      <AlertRow key={warning} tone="warning" text={warning} />
                    ))}
                  </div>
                ) : null}

                <MarketRegimeTimeline
                  asOfMs={decision.asOfMs}
                  currentRegime={marketRegime}
                  transitions={regimeTransitions}
                  warnings={Array.from(new Set([...marketRegime.warnings, ...regimeWarnings]))}
                />
              </CardContent>
            </Card>
          </CollapsibleSection>

          <CollapsibleSection
            title="Signal suppression"
            description="Guardrail for weak, stale, contradictory, or unstable conditions."
          >
            <Card className="border-white/10 bg-[#0c1628]/88">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>Signal Suppression</CardTitle>
                    <CardDescription>
                      Compact guardrail for weak, stale, contradictory, or unstable conditions.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-2 font-mono text-[11px] uppercase tracking-[0.22em] text-slate-200">
                    <span
                      className={cn(
                        "rounded border px-2 py-1",
                        decision.signalSuppression.level === "none"
                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                          : decision.signalSuppression.level === "caution"
                            ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
                            : decision.signalSuppression.level === "suppress directional bias"
                              ? "border-rose-500/20 bg-rose-500/10 text-rose-200"
                              : "border-slate-500/20 bg-slate-500/10 text-slate-200",
                      )}
                    >
                      SUPPRESSION: {decision.signalSuppression.level}
                    </span>
                    <span className="text-white/30">|</span>
                    <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1">
                      REASON: {decision.signalSuppression.reasons[0] ?? "NONE"}
                    </span>
                    <span className="text-white/30">|</span>
                    <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1">
                      CONF Δ: -{decision.signalSuppression.confidencePenalty}%
                    </span>
                    <span className="text-white/30">|</span>
                    <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1">
                      OVERRIDE: {signalSuppressionOverrideEnabled ? "ON" : "OFF"}
                    </span>
                    <span className="text-white/30">|</span>
                    <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1">
                      GUARD: {decision.signalSuppression.shouldSuppressSnapshot ? "BLOCKED" : "OPEN"}
                    </span>
                  </div>

                  <details className="mt-3">
                    <summary className="cursor-pointer list-none text-xs uppercase tracking-[0.22em] text-muted-foreground outline-none transition-colors hover:text-slate-200 focus-visible:text-slate-200 focus-visible:outline-none">
                      Expand suppression details
                    </summary>
                    <div className="mt-3 space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <MiniStat label="Display readout" value={decision.signalSuppression.directionalReadout} />
                        <MiniStat label="Confidence penalty" value={`-${decision.signalSuppression.confidencePenalty}`} />
                        <MiniStat
                          label="Snapshot guard"
                          value={decision.signalSuppression.shouldSuppressSnapshot ? "blocked" : "open"}
                        />
                        <MiniStat
                          label="Override"
                          value={signalSuppressionOverrideEnabled ? "enabled" : "disabled"}
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {decision.signalSuppression.reasons.map((reason) => (
                          <Badge
                            key={reason}
                            variant="outline"
                            className="border-white/10 bg-white/[0.03] text-slate-300"
                          >
                            {reason}
                          </Badge>
                        ))}
                      </div>

                      {decision.signalSuppression.warning ? (
                        <div className="flex gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-3 text-sm text-rose-100">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                          <div>{decision.signalSuppression.warning}</div>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-3 text-sm text-muted-foreground">
                          No suppression is active. Directional language is allowed by the current market state.
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={signalSuppressionOverrideEnabled ? "destructive" : "outline"}
                          className="border-white/10"
                          onClick={() =>
                            setSignalSuppressionOverrideEnabled(!signalSuppressionOverrideEnabled)
                          }
                          disabled={!decision.signalSuppression.shouldSuppressSnapshot && !signalSuppressionOverrideEnabled}
                        >
                          {signalSuppressionOverrideEnabled ? "Disable suppressed snapshot override" : "Allow suppressed snapshots"}
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          Override is local only and should be used only when you want to record suppressed states for research.
                        </span>
                      </div>

                      {decision.signalSuppression.shouldSuppressSnapshot ? (
                        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
                          Suppressed snapshots are blocked unless override is enabled. Enable the override only if you want to preserve this weak or contradictory state for research.
                        </div>
                      ) : null}
                    </div>
                  </details>
                </div>
              </CardContent>
            </Card>
          </CollapsibleSection>

          <CollapsibleSection
            title="Breakout intelligence"
            description="Breakout direction, follow-through quality, and false-breakout risk."
          >
            <Card className="border-white/10 bg-[#0c1628]/88">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>Breakout Intelligence</CardTitle>
                    <CardDescription>
                      Checks whether a breakout is actually building follow-through or starting to fail.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-2 font-mono text-[11px] uppercase tracking-[0.22em] text-slate-200">
                    <span
                      className={cn(
                        "rounded border px-2 py-1",
                        breakoutStatusTone(decision.falseBreakout.breakoutStatus),
                      )}
                    >
                      STATUS: {decision.falseBreakout.breakoutStatus}
                    </span>
                    <span className="text-white/30">|</span>
                    <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1">
                      DIR: {breakoutDirectionReadout(decision.falseBreakout.breakoutDirection)}
                    </span>
                    <span className="text-white/30">|</span>
                    <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1">
                      RISK: {decision.falseBreakout.falseBreakoutRisk}/100
                    </span>
                    <span className="text-white/30">|</span>
                    <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1">
                      FOLLOW: {decision.falseBreakout.followThroughQuality}/100
                    </span>
                    <span className="text-white/30">|</span>
                    <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1">
                      HEALTH: {decision.falseBreakout.breakoutHealthScore}/100
                    </span>
                    <span className="text-white/30">|</span>
                    <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1">
                      EXH: {decision.falseBreakout.exhaustionScore}/100
                    </span>
                    <span className="text-white/30">|</span>
                    <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-1">
                      HISTORY: {breakoutHistory.length}
                    </span>
                  </div>

                  <details className="mt-3">
                    <summary className="cursor-pointer list-none text-xs uppercase tracking-[0.22em] text-muted-foreground outline-none transition-colors hover:text-slate-200 focus-visible:text-slate-200 focus-visible:outline-none">
                      Expand breakout details
                    </summary>
                    <div className="mt-3 space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <MiniStat label="Direction" value={breakoutDirectionReadout(decision.falseBreakout.breakoutDirection)} />
                        <MiniStat label="Confidence" value={`${decision.falseBreakout.breakoutConfidence}/100`} />
                        <MiniStat label="Risk" value={`${decision.falseBreakout.falseBreakoutRisk}/100`} />
                        <MiniStat label="Health" value={`${decision.falseBreakout.breakoutHealthScore}/100`} />
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <MiniStat label="Follow-through" value={`${decision.falseBreakout.followThroughQuality}/100`} />
                        <MiniStat label="Exhaustion" value={`${decision.falseBreakout.exhaustionScore}/100`} />
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-3 text-sm leading-6 text-foreground">
                        {decision.falseBreakout.explanation}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {decision.falseBreakout.supportingSignals.map((signal) => (
                          <Badge key={signal} variant="outline" className="border-white/10 bg-white/[0.03] text-slate-300">
                            {signal}
                          </Badge>
                        ))}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {decision.falseBreakout.conflictingSignals.map((signal) => (
                          <Badge key={signal} variant="outline" className="border-white/10 bg-white/[0.03] text-slate-300">
                            {signal}
                          </Badge>
                        ))}
                      </div>

                      {decision.falseBreakout.warning ? (
                        <div className="flex gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                          <div>{decision.falseBreakout.warning}</div>
                        </div>
                      ) : null}
                    </div>
                  </details>
                </div>
              </CardContent>
            </Card>
          </CollapsibleSection>

          <CollapsibleSection
            title="Model reliability"
            description="Market quality, decision notes, and calibration diagnostics."
          >
            <div className="space-y-4">
              <Card className="border-white/10 bg-[#0c1628]/88">
                <CardHeader className="pb-3">
                  <CardTitle>Market Quality</CardTitle>
                  <CardDescription>
                    Guardrail for directional clarity and signal noise.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <MiniStat
                      label="Signal score"
                      value={`${decision.marketQuality.signalQualityScore}/100`}
                    />
                    <MiniStat
                      label="Noise level"
                      value={`${decision.marketQuality.noiseLevel}/100`}
                    />
                    <MiniStat
                      label="Directional clarity"
                      value={decision.marketQuality.directionalClarity}
                    />
                    <MiniStat
                      label="Stability"
                      value={decision.marketQuality.stabilityAssessment}
                    />
                    <MiniStat
                      label="Exchange agreement"
                      value={`${decision.marketQuality.exchangeAgreementScore}/100`}
                    />
                    <MiniStat
                      label="Stale feeds"
                      value={`${decision.marketQuality.staleExchangeCount}/${decision.marketQuality.totalExchangeCount}`}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        "border-white/10",
                        decision.marketQuality.signalQualityState === "strong signal"
                          ? "bg-emerald-500/10 text-emerald-200"
                          : decision.marketQuality.signalQualityState === "moderate signal"
                            ? "bg-sky-500/10 text-sky-200"
                            : decision.marketQuality.signalQualityState === "weak signal"
                              ? "bg-amber-500/10 text-amber-200"
                              : "bg-rose-500/10 text-rose-200",
                      )}
                    >
                      {decision.marketQuality.signalQualityState}
                    </Badge>
                    <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-slate-300">
                      {decision.marketQuality.conflictingSignalCount} conflicts
                    </Badge>
                  </div>
                  {decision.marketQuality.warning ? (
                    <div className="flex gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      <div>{decision.marketQuality.warning}</div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-[#0c1628]/88">
                <CardHeader className="pb-3">
                  <CardTitle>Decision Notes</CardTitle>
                  <CardDescription>
                    Compact readout for quick monitoring.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {decision.notes.map((note) => (
                    <div
                      key={note}
                      className="rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-muted-foreground"
                    >
                      {note}
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <MiniStat label="Feed" value={feedLabel(connectionState, isStale)} />
                    <MiniStat label="Quality" value={feedQuality(decision.dataQuality.tickCount, decision.dataQuality.coverageMinutes)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <MiniStat label="Last message" value={formatOptionalMs(lastMessageAtMs)} />
                    <MiniStat label="Heartbeat" value={formatOptionalMs(lastHeartbeatAtMs)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <MiniStat label="Reconnects" value={String(reconnectAttempt)} />
                    <MiniStat label="Ticks" value={String(decision.dataQuality.tickCount)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <MiniStat label="Spread bps" value={formatMetric(decision.spreadBps, "bps")} />
                    <MiniStat label="Coverage" value={formatCoverage(decision.dataQuality.coverageMinutes)} />
                  </div>
                </CardContent>
              </Card>

              <ConfidenceReliabilityPanel signalPerformance={signalPerformance} />
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="Journal / research history"
            description="Snapshot history, forward outcomes, and local export controls."
          >
            <Card className="border-white/10 bg-[#0c1628]/88">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>Signal Performance</CardTitle>
                    <CardDescription>
                      Recent bias snapshots and their forward outcomes over 1m, 5m, 15m, and 1h.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-white/10 bg-white/[0.03]"
                      onClick={() => exportJournalFile(signalPerformance, "csv")}
                      disabled={signalPerformance.length === 0}
                    >
                      Export CSV
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-white/10 bg-white/[0.03]"
                      onClick={() => exportJournalFile(signalPerformance, "json")}
                      disabled={signalPerformance.length === 0}
                    >
                      Export JSON
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      className="border-white/10"
                      onClick={() => setClearDialogOpen(true)}
                      disabled={signalPerformance.length === 0}
                    >
                      Clear Journal
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <MiniStat
                    label="Tracked snapshots"
                    value={formatCompactNumber(signalPerformance.length)}
                  />
                  <MiniStat
                    label="Resolved 1m"
                    value={formatCompactNumber(countResolved(signalPerformance, "1m"))}
                  />
                  <MiniStat
                    label="Resolved 15m"
                    value={formatCompactNumber(countResolved(signalPerformance, "15m"))}
                  />
                </div>

                <div className="max-h-[28rem] overflow-auto rounded-2xl border border-white/10">
                  <table className="min-w-full text-left text-xs">
                    <thead className="sticky top-0 bg-[#08111f] text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Time</th>
                        <th className="px-3 py-2">Bias</th>
                        <th className="px-3 py-2">Start</th>
                        <th className="px-3 py-2">Confidence</th>
                        <th className="px-3 py-2">1m</th>
                        <th className="px-3 py-2">5m</th>
                        <th className="px-3 py-2">15m</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {signalPerformance.length > 0 ? (
                        signalPerformance.map((row) => (
                          <tr key={row.id} className="border-white/5">
                            <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                              {formatWallClock(row.timestampMs)}
                            </td>
                            <td className="px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-foreground">
                              {formatDirectionalReadout(row)}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] text-foreground">
                              {formatCurrency(row.startingPrice, 2)}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] text-foreground">
                              {row.confidence}
                            </td>
                            <td className="px-3 py-2">
                              <OutcomeCell outcome={row.outcomes["1m"]} />
                            </td>
                            <td className="px-3 py-2">
                              <OutcomeCell outcome={row.outcomes["5m"]} />
                            </td>
                            <td className="px-3 py-2">
                              <OutcomeCell outcome={row.outcomes["15m"]} />
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                            Waiting for the first live bias snapshot.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </CollapsibleSection>
        </div>

        <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Clear BTC journal?</DialogTitle>
              <DialogDescription>
                This removes the locally stored BTC decision journal from this browser.
                The live feed and current analysis remain untouched.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setClearDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  clearJournal()
                  setClearDialogOpen(false)
                }}
              >
                Clear Journal
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <footer className="pb-4 pt-1 text-xs leading-5 text-muted-foreground">
          Analytics only. The terminal summarizes live BTC market data for research and
          monitoring. It does not execute trades, route orders, or provide advice wording.
        </footer>
      </div>
    </main>
  )
}

function TickRow({
  tick,
  previous,
}: {
  tick: RealtimeBtcTick
  previous: RealtimeBtcTick | null
}) {
  const delta = previous ? tick.price - previous.price : null
  const tone =
    delta === null ? "text-foreground" : delta >= 0 ? "text-emerald-300" : "text-rose-300"

  return (
    <tr className="border-white/5">
      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {formatMillisecondTime(tick.exchangeTimeMs)}
      </td>
      <td className={cn("px-3 py-2 font-mono text-[11px] tabular-nums", tone)}>
        {formatCurrency(tick.price, 2)}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-foreground">
        {formatCurrency(tick.bid, 2)}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-foreground">
        {formatCurrency(tick.ask, 2)}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {formatMetric(tick.spreadBps, "bps")}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {formatMetric(tick.lastSize, "BTC")}
      </td>
    </tr>
  )
}

function ExplanationBlock({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </div>
      <div className="text-sm leading-6 text-foreground">{value}</div>
    </div>
  )
}

function OutcomeCell({
  outcome,
}: {
  outcome: BtcJournalOutcome
}) {
  const tone =
    !outcome.resolved
      ? "text-muted-foreground"
      : outcome.directionallyCorrect
        ? "text-emerald-200"
        : "text-rose-200"

  const label = outcome.resolved
    ? outcome.directionallyCorrect
      ? "correct"
      : "miss"
    : "pending"

  return (
    <div className={cn("space-y-1 font-mono text-[11px]", tone)}>
      <div>{formatSignedCurrency(outcome.priceChange)}</div>
      <div>{formatSignedPercent(outcome.percentChange)}</div>
      <div className="text-[10px] uppercase tracking-[0.18em]">{label}</div>
    </div>
  )
}

function AlertRow({
  tone,
  text,
}: {
  tone: "neutral" | "warning" | "danger"
  text: string
}) {
  const toneClasses =
    tone === "danger"
      ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
      : tone === "warning"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-100"
        : "border-white/10 bg-white/[0.02] text-muted-foreground"

  return (
    <div className={cn("flex gap-3 rounded-2xl border px-3 py-3 text-sm", toneClasses)}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>{text}</div>
    </div>
  )
}

function CollapsibleSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <details className="rounded-3xl border border-white/10 bg-[#0c1628]/88">
      <summary className="cursor-pointer list-none px-5 py-4 outline-none transition-colors hover:bg-white/[0.02] focus-visible:bg-white/[0.02] focus-visible:outline-none">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              {title}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">{description}</div>
          </div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Expand
          </div>
        </div>
      </summary>
      <div className="border-t border-white/10 p-4">{children}</div>
    </details>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-medium text-foreground">{value}</div>
    </div>
  )
}

function TerminalToken({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-200">
      {label}: {value}
    </span>
  )
}

function StatusToken({
  tone,
  children,
}: {
  tone: string
  children: ReactNode
}) {
  return (
    <span className={cn("rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em]", tone)}>
      {children}
    </span>
  )
}

function breakoutDirectionReadout(direction: string) {
  switch (direction) {
    case "up":
      return "upward"
    case "down":
      return "downward"
    default:
      return "none"
  }
}

function breakoutStatusTone(status: string) {
  if (status === "confirmed breakout") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
  }

  if (status === "breakout developing") {
    return "border-sky-500/20 bg-sky-500/10 text-sky-200"
  }

  if (status === "false breakout risk") {
    return "border-rose-500/20 bg-rose-500/10 text-rose-200"
  }

  if (status === "ambiguous") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-200"
  }

  return "border-white/10 bg-white/[0.03] text-slate-300"
}

function marketStateTone(state: string) {
  if (state === "clean") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
  }

  if (state === "mixed") {
    return "border-sky-500/20 bg-sky-500/10 text-sky-200"
  }

  if (state === "noisy") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-200"
  }

  if (state === "unstable") {
    return "border-rose-500/20 bg-rose-500/10 text-rose-200"
  }

  return "border-slate-500/20 bg-slate-500/10 text-slate-200"
}

function suppressionTone(level: string) {
  if (level === "none") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
  }

  if (level === "caution") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-200"
  }

  if (level === "suppress directional bias") {
    return "border-rose-500/20 bg-rose-500/10 text-rose-200"
  }

  return "border-slate-500/20 bg-slate-500/10 text-slate-200"
}

function regimeTone(regime: string) {
  if (regime === "trending up") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
  }

  if (regime === "trending down") {
    return "border-rose-500/20 bg-rose-500/10 text-rose-200"
  }

  if (regime === "breakout conditions") {
    return "border-violet-500/20 bg-violet-500/10 text-violet-200"
  }

  if (regime === "high-volatility expansion") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-200"
  }

  if (regime === "low-volatility compression") {
    return "border-cyan-500/20 bg-cyan-500/10 text-cyan-200"
  }

  if (regime === "mean-reverting") {
    return "border-sky-500/20 bg-sky-500/10 text-sky-200"
  }

  if (regime === "exhaustion conditions") {
    return "border-orange-500/20 bg-orange-500/10 text-orange-200"
  }

  return "border-slate-500/20 bg-slate-500/10 text-slate-200"
}

function MarketRegimeTimeline({
  currentRegime,
  transitions,
  warnings,
  asOfMs,
}: {
  currentRegime: BtcMarketRegimeSnapshot
  transitions: BtcRegimeTransition[]
  warnings: string[]
  asOfMs: number
}) {
  const segments = useMemo(
    () => buildRegimeTimelineSegments(transitions, currentRegime, asOfMs),
    [asOfMs, currentRegime, transitions],
  )

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Market Regime Timeline
          </div>
          <div className="text-sm text-muted-foreground">
            Recent regime shifts, confidence, and stability compressed into a horizontal scan line.
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          <LegendPill tone="emerald">Transition</LegendPill>
          <LegendPill tone="amber">Unstable</LegendPill>
          <LegendPill tone="rose">Low confidence</LegendPill>
          <LegendPill tone="violet">False breakout</LegendPill>
        </div>
      </div>

      {segments.length > 0 ? (
        <div className="overflow-x-auto pb-1">
          <div className="flex items-stretch gap-1.5">
            {segments.map((segment, index) => (
              <button
                type="button"
                key={`${segment.startMs}-${segment.regime}-${index}`}
                className={cn(
                  "group relative flex min-h-[4.5rem] min-w-[4.25rem] flex-1 items-stretch rounded-lg border px-2 py-1 text-left outline-none transition-all duration-150",
                  timelineToneClasses(segment.regime),
                  segment.isTransition ? "ring-1 ring-white/25" : "",
                  segment.isLowConfidence || segment.isUnstable || segment.isFalseBreakout
                    ? "border-white/25"
                    : "border-white/10",
                  "hover:-translate-y-0.5 hover:border-white/35 focus-visible:-translate-y-0.5 focus-visible:border-white/40 focus-visible:ring-2 focus-visible:ring-white/20",
                )}
                style={{
                  flexGrow: segment.growth,
                  flexBasis: "4.5rem",
                }}
                aria-label={segment.tooltip}
                title={segment.tooltip}
              >
                <div className="flex h-full min-h-[3.8rem] flex-col justify-between gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground">
                      {segment.abbrev}
                    </div>
                    <div className="flex items-center gap-1">
                      {segment.isTransition ? (
                        <span className="size-2 rounded-full bg-emerald-300/90 shadow-[0_0_0_2px_rgba(16,185,129,0.16)]" />
                      ) : null}
                      {segment.isLowConfidence ? (
                        <span className="size-2 rounded-full bg-rose-300/90 shadow-[0_0_0_2px_rgba(244,63,94,0.16)]" />
                      ) : null}
                      {segment.isUnstable ? (
                        <span className="size-2 rounded-full bg-amber-300/90 shadow-[0_0_0_2px_rgba(245,158,11,0.16)]" />
                      ) : null}
                      {segment.isFalseBreakout ? (
                        <span className="size-2 rounded-full bg-violet-300/90 shadow-[0_0_0_2px_rgba(167,139,250,0.16)]" />
                      ) : null}
                    </div>
                  </div>

                  <div className="relative flex-1 overflow-hidden rounded-md border border-white/10 bg-black/25">
                    <div
                      className={cn(
                        "absolute inset-y-0 left-0",
                        segment.isFalseBreakout
                          ? "bg-violet-500/25"
                          : segment.isLowConfidence
                            ? "bg-rose-500/20"
                            : segment.isUnstable
                              ? "bg-amber-500/20"
                              : segment.isTransition
                                ? "bg-emerald-500/20"
                                : "bg-white/10",
                      )}
                      style={{ width: `${segment.fillPct}%` }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center px-1">
                      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-foreground/90">
                        {segment.label}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-1 font-mono text-[9px] text-muted-foreground">
                    <span>{segment.timestampLabel}</span>
                    <span>{segment.confidence}/100</span>
                    <span>{segment.stability}/100</span>
                  </div>
                </div>
                <span className="sr-only">{segment.tooltip}</span>
                <span className="pointer-events-none absolute left-1/2 top-0 z-20 hidden w-max max-w-[18rem] -translate-x-1/2 -translate-y-[110%] rounded-lg border border-white/10 bg-[#08111f] px-3 py-2 text-left text-[11px] leading-5 text-slate-200 shadow-[0_16px_40px_rgba(0,0,0,0.4)] group-hover:block group-focus-visible:block">
                  <span className="block font-mono uppercase tracking-[0.18em] text-slate-300">
                    {segment.tooltipTitle}
                  </span>
                  <span className="mt-1 block">{segment.tooltip}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-muted-foreground">
          Regime history will populate as the live decision engine classifies new states.
        </div>
      )}

      <div className="grid gap-2 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm leading-6 text-muted-foreground">
          The strip emphasizes transitions and flags low-confidence, unstable, and failed breakout regimes so shifts are easier to scan than a text list.
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm leading-6 text-muted-foreground">
          {warnings.length > 0 ? warnings.slice(0, 3).join(" ") : "No additional regime warnings right now."}
        </div>
      </div>
    </div>
  )
}

function LegendPill({
  tone,
  children,
}: {
  tone: "emerald" | "amber" | "rose" | "violet"
  children: string
}) {
  const toneClasses =
    tone === "emerald"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
      : tone === "amber"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-100"
        : tone === "rose"
          ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
          : "border-violet-500/20 bg-violet-500/10 text-violet-100"

  return (
    <span className={cn("rounded-full border px-2 py-1", toneClasses)}>{children}</span>
  )
}

function ExchangeHealthRow({
  feed,
}: {
  feed: {
    exchange: string
    label: string
    latestTick: {
      price: number
      bid: number | null
      ask: number | null
      spread: number | null
      latencyMs: number
    } | null
    stale: boolean
    connectionState: string
    error: string | null
  }
}) {
  const tick = feed.latestTick
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">{feed.label}</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {feed.exchange}
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "border-white/10",
            feed.connectionState === "open" && !feed.stale
              ? "bg-emerald-500/10 text-emerald-200"
              : feed.stale
                ? "bg-amber-500/10 text-amber-200"
                : "bg-rose-500/10 text-rose-200",
          )}
        >
          {feed.stale ? "stale" : "live"}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <MiniStat
          label="Latest price"
          value={tick ? formatCurrency(tick.price, 2) : "n/a"}
        />
        <MiniStat
          label="Bid / ask"
          value={
            tick && tick.bid !== null && tick.ask !== null
              ? `${formatCurrency(tick.bid, 2)} / ${formatCurrency(tick.ask, 2)}`
              : "n/a"
          }
        />
        <MiniStat
          label="Spread"
          value={tick && tick.spread !== null ? formatCurrency(tick.spread, 2) : "n/a"}
        />
        <MiniStat
          label="Latency"
          value={formatLatency(tick?.latencyMs ?? null)}
        />
      </div>
      {feed.error ? (
        <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {feed.error}
        </div>
      ) : null}
    </div>
  )
}

function buildRegimeTimelineSegments(
  transitions: BtcRegimeTransition[],
  currentRegime: BtcMarketRegimeSnapshot,
  asOfMs: number,
) {
  const normalized = [...transitions].sort((left, right) => left.timestampMs - right.timestampMs)
  const segments: Array<{
    regime: string
    label: string
    abbrev: string
    startMs: number
    endMs: number
    confidence: number
    stability: number
    timestampLabel: string
    durationLabel: string
    isTransition: boolean
    isLowConfidence: boolean
    isUnstable: boolean
    isFalseBreakout: boolean
    fillPct: number
    tooltipTitle: string
    tooltip: string
    growth: number
  }> = []

  for (let index = 0; index < normalized.length; index += 1) {
    const transition = normalized[index]
    const nextTransition = normalized[index + 1] ?? null
    const endMs = nextTransition?.timestampMs ?? asOfMs
    const durationMinutes = Math.max((endMs - transition.timestampMs) / 60000, 0.25)
    const isLowConfidence = transition.confidence < 55
    const isUnstable = transition.stabilityScore < 45 || isLowConfidence
    const isFalseBreakout =
      transition.to === "breakout conditions" &&
      Boolean(nextTransition) &&
      (nextTransition?.to === "choppy / noisy" ||
        nextTransition?.to === "mean-reverting" ||
        nextTransition?.to === "exhaustion conditions")
    const fillPct = clamp(transition.confidence, 18, 100)

    segments.push({
      regime: transition.to,
      label: abbreviateRegime(transition.to),
      abbrev: abbreviateRegime(transition.to),
      startMs: transition.timestampMs,
      endMs,
      confidence: transition.confidence,
      stability: transition.stabilityScore,
      timestampLabel: formatWallClock(transition.timestampMs),
      durationLabel: formatDurationLabel(durationMinutes),
      isTransition: index > 0,
      isLowConfidence,
      isUnstable,
      isFalseBreakout,
      fillPct,
      tooltipTitle: transition.to,
      tooltip: buildRegimeTooltip(transition.to, transition.timestampMs, transition.confidence, transition.stabilityScore, {
        isTransition: index > 0,
        isLowConfidence,
        isUnstable,
        isFalseBreakout,
      }),
      growth: Math.min(durationMinutes, 24),
    })
  }

  const currentStartMs = normalized.at(-1)?.timestampMs ?? asOfMs
  const currentDurationMinutes = Math.max((asOfMs - currentStartMs) / 60000, 0.25)
  segments.push({
    regime: currentRegime.primaryRegime,
    label: abbreviateRegime(currentRegime.primaryRegime),
    abbrev: abbreviateRegime(currentRegime.primaryRegime),
    startMs: currentStartMs,
    endMs: asOfMs,
    confidence: currentRegime.regimeConfidence,
    stability: currentRegime.regimeStabilityScore,
    timestampLabel: formatWallClock(currentStartMs),
    durationLabel: formatDurationLabel(currentDurationMinutes),
    isTransition: normalized.length > 0,
    isLowConfidence: currentRegime.regimeConfidence < 55,
    isUnstable:
      currentRegime.regimeStabilityScore < 45 ||
      currentRegime.regimeClarity === "ambiguous" ||
      currentRegime.isTransitioning,
    isFalseBreakout:
      currentRegime.primaryRegime === "breakout conditions" &&
      (currentRegime.warnings.some((warning) => warning.toLowerCase().includes("false breakout")) ||
        currentRegime.warnings.some((warning) => warning.toLowerCase().includes("reversal risk"))),
    fillPct: clamp(currentRegime.regimeConfidence, 18, 100),
    tooltipTitle: currentRegime.primaryRegime,
    tooltip: buildRegimeTooltip(currentRegime.primaryRegime, currentStartMs, currentRegime.regimeConfidence, currentRegime.regimeStabilityScore, {
      isTransition: normalized.length > 0,
      isLowConfidence: currentRegime.regimeConfidence < 55,
      isUnstable:
        currentRegime.regimeStabilityScore < 45 ||
        currentRegime.regimeClarity === "ambiguous" ||
        currentRegime.isTransitioning,
      isFalseBreakout:
        currentRegime.primaryRegime === "breakout conditions" &&
        (currentRegime.warnings.some((warning) => warning.toLowerCase().includes("false breakout")) ||
          currentRegime.warnings.some((warning) => warning.toLowerCase().includes("reversal risk"))),
    }),
    growth: Math.min(currentDurationMinutes, 24),
  })

  return segments
}

function formatDurationLabel(minutes: number) {
  if (!Number.isFinite(minutes) || minutes < 1) {
    return "<1m"
  }

  if (minutes < 60) {
    return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`
  }

  const hours = minutes / 60
  return `${hours.toFixed(hours < 10 ? 1 : 0)}h`
}

function abbreviateRegime(regime: string) {
  switch (regime) {
    case "trending up":
      return "TU"
    case "trending down":
      return "TD"
    case "mean-reverting":
      return "MR"
    case "high-volatility expansion":
      return "HV"
    case "low-volatility compression":
      return "LC"
    case "choppy / noisy":
      return "CN"
    case "breakout conditions":
      return "BO"
    case "exhaustion conditions":
      return "EX"
    default:
      return "??"
  }
}

function buildRegimeTooltip(
  regime: string,
  timestampMs: number,
  confidence: number,
  stability: number,
  flags: {
    isTransition: boolean
    isLowConfidence: boolean
    isUnstable: boolean
    isFalseBreakout: boolean
  },
) {
  const flagParts = [
    flags.isTransition ? "transition" : null,
    flags.isLowConfidence ? "low confidence" : null,
    flags.isUnstable ? "unstable" : null,
    flags.isFalseBreakout ? "false breakout pattern" : null,
  ].filter(Boolean)

  const flagText = flagParts.length > 0 ? ` Flags: ${flagParts.join(", ")}.` : ""

  return `${regime} at ${formatWallClock(timestampMs)}. Confidence ${confidence}/100. Stability ${stability}/100.${flagText}`
}

function timelineToneClasses(regime: string) {
  switch (regime) {
    case "trending up":
      return "bg-emerald-500/10"
    case "trending down":
      return "bg-rose-500/10"
    case "mean-reverting":
      return "bg-sky-500/10"
    case "high-volatility expansion":
      return "bg-amber-500/10"
    case "low-volatility compression":
      return "bg-cyan-500/10"
    case "choppy / noisy":
      return "bg-slate-500/10"
    case "breakout conditions":
      return "bg-violet-500/10"
    case "exhaustion conditions":
      return "bg-orange-500/10"
    default:
      return "bg-white/[0.03]"
  }
}

function formatMetric(value: number | null | undefined, suffix: string) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a"
  }

  const prefix = value > 0 ? "+" : ""
  const rounded =
    Math.abs(value) >= 100
      ? value.toFixed(0)
      : Math.abs(value) < 1
        ? value.toFixed(4)
        : value.toFixed(2)
  return `${prefix}${rounded}${suffix ? ` ${suffix}` : ""}`
}

function formatTradeSize(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a"
  }

  return `${formatCompactNumber(value)} BTC`
}

function formatMillisecondTime(value: number) {
  return new Date(value).toISOString().slice(11, 23)
}

function formatWallClock(value: number) {
  return new Date(value).toISOString().slice(11, 23)
}

function formatOptionalMs(value: number | null) {
  if (value === null) {
    return "n/a"
  }

  return formatWallClock(value)
}

function formatLatency(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "n/a"
  }

  return `${Math.round(value)} ms`
}

function feedLabel(state: string, stale: boolean) {
  if (stale) {
    return "stale"
  }

  if (state === "open") {
    return "live"
  }

  return state
}

function feedQuality(ticks: number, coverageMinutes: number | null) {
  if (ticks < 2 || coverageMinutes === null) {
    return "warming up"
  }

  if (coverageMinutes >= 30) {
    return "broad coverage"
  }

  if (coverageMinutes >= 10) {
    return "good coverage"
  }

  return "short coverage"
}

function formatCoverage(value: number | null) {
  if (value === null) {
    return "n/a"
  }

  return `${value.toFixed(1)}m`
}

function calculatePriceMove(ticks: RealtimeBtcTick[]) {
  if (ticks.length < 2) {
    return null
  }

  const first = ticks[0]
  const last = ticks.at(-1)
  if (!first || !last || first.price <= 0) {
    return null
  }

  return ((last.price - first.price) / first.price) * 100
}

function countResolved(rows: BtcJournalRow[], window: "1m" | "5m" | "15m" | "1h") {
  return rows.filter((row) => row.outcomes[window].resolved).length
}

function formatDirectionalReadout(row: BtcJournalRow) {
  const readout =
    row.marketQuality?.directionalReadout ??
    (row.bias === "neutral" ? "unclear" : row.bias)

  return readout
}

function formatSignedCurrency(value: number) {
  if (!Number.isFinite(value)) {
    return "n/a"
  }

  const digits = Math.abs(value) < 1 ? 4 : 2
  return `${value >= 0 ? "+" : ""}${formatCurrency(value, digits)}`
}

function formatSignedPercent(value: number) {
  if (!Number.isFinite(value)) {
    return "n/a"
  }

  const digits = Math.abs(value) < 1 ? 4 : 2
  return `${value >= 0 ? "+" : ""}${formatPercent(value, digits)}`
}

function formatSignedPercentValue(value: number) {
  return formatSignedPercent(value)
}

function formatPercentOrNA(value: number | null, digits = 2) {
  if (value === null || Number.isNaN(value)) {
    return "n/a"
  }

  const precision = Math.abs(value) < 1 ? Math.max(digits, 4) : digits
  return `${value >= 0 ? "+" : ""}${formatPercent(value, precision)}`
}

function exportJournalFile(
  rows: BtcJournalRow[],
  format: "csv" | "json",
) {
  const content =
    format === "csv"
      ? exportBtcJournalAsCsv(rows)
      : exportBtcJournalAsJson(rows)

  const blob = new Blob([content], {
    type: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `btc-decision-journal.${format}`
  anchor.click()
  URL.revokeObjectURL(url)
}
