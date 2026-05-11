"use client"

import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CircleSlash2,
  Gauge,
  LineChart,
  RefreshCw,
  Satellite,
  Zap,
} from "lucide-react"
import { useState, type ReactNode } from "react"

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
import { cn, formatCompactNumber, formatCurrency, formatPercent } from "@/lib/utils"
import { type RealtimeBtcTick } from "@/lib/btc/realtime"
import {
  exportBtcJournalAsCsv,
  exportBtcJournalAsJson,
} from "@/lib/btc/journal"
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
    clearJournal,
  } = useRealtimeBtc()
  const [clearDialogOpen, setClearDialogOpen] = useState(false)

  const price = decision.lastPrice
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

  const sparkline = ticks.slice(-120)

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
                Coinbase WebSocket
              </Badge>
              <span className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                {latestTick ? `Last tick ${formatWallClock(latestTick.exchangeTimeMs)}` : "Awaiting first tick"}
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
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                    Live BTC-USD
                  </div>
                  <div className={cn("mt-2 font-mono text-4xl font-semibold tabular-nums sm:text-5xl", priceDirectionClass)}>
                    {formatCurrency(price, 0)}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>{priceMove === null ? "No move yet" : `${priceMove >= 0 ? "+" : ""}${formatPercent(priceMove, 2)}`}</span>
                    <span className="opacity-60">•</span>
                    <span>{formatTradeSize(decision.volume24h)}</span>
                    <span className="opacity-60">•</span>
                    <span>{decision.spread !== null ? `Spread ${formatCurrency(decision.spread, 2)}` : "Spread n/a"}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 text-right">
                  <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-slate-300">
                    {decision.marketQuality.directionalReadout}
                  </Badge>
                  <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                    Confidence
                  </div>
                  <div className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                    {decision.confidenceScore}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MiniStat label="Bid" value={formatCurrency(decision.bid, 2)} />
                <MiniStat label="Ask" value={formatCurrency(decision.ask, 2)} />
                <MiniStat label="Spread" value={formatCurrency(decision.spread, 2)} />
                <MiniStat label="Volume 24h" value={formatTradeSize(decision.volume24h)} />
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <Sparkline ticks={sparkline} />
              </div>
            </CardContent>
          </Card>
        </header>

        <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <Card className="border-white/10 bg-[#0c1628]/88">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Decision Summary</CardTitle>
                    <CardDescription>
                      Direction, confidence, volatility, and short-term regime.
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
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <DecisionChip
                  label="Direction bias"
                  value={decision.marketQuality.directionalReadout}
                  icon={directionIcon(decision.directionBias)}
                />
                <DecisionChip
                  label="Volatility regime"
                  value={decision.volatilityRegime}
                  icon={<Gauge className="size-4" />}
                />
                <DecisionChip
                  label="Momentum"
                  value={decision.momentumStatus}
                  icon={<Zap className="size-4" />}
                />
                <DecisionChip
                  label="Observation window"
                  value={decision.observationWindow}
                  icon={<Activity className="size-4" />}
                />
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-[#0c1628]/88">
              <CardHeader className="pb-3">
                <CardTitle>Bias Explanation</CardTitle>
                <CardDescription>
                  Why the terminal is leaning this way, and what would change it.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ExplanationBlock
                  label="Primary reason"
                  value={decision.explanation.primaryReason}
                />
                <ExplanationList
                  label="Supporting signals"
                  items={decision.explanation.supportingSignals}
                />
                <ExplanationList
                  label="Conflicting signals"
                  items={decision.explanation.conflictingSignals}
                />
                <ExplanationBlock
                  label="Invalidation"
                  value={decision.explanation.invalidationCondition}
                />
                <ExplanationBlock
                  label="What would change the bias"
                  value={decision.explanation.biasChangeCondition}
                />
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <AnalyticsPanel
                title="Momentum"
                description="Return shape, acceleration, and persistence."
                icon={<ArrowUpRight className="size-4" />}
                rows={[
                  ["Tick velocity", formatMetric(decision.tickVelocityPerMin, "ticks/min")],
                  ["1m return", formatMetric(decision.rollingReturns["1m"], "%")],
                  ["5m return", formatMetric(decision.rollingReturns["5m"], "%")],
                  ["15m return", formatMetric(decision.rollingReturns["15m"], "%")],
                  ["Acceleration", formatMetric(decision.priceAccelerationBpsPerMin2, "bps/min^2")],
                  ["Trend persistence", `${decision.trendPersistenceScore}/100`],
                ]}
              />
              <AnalyticsPanel
                title="Volatility"
                description="Compression, expansion, and market regime."
                icon={<ArrowDownRight className="size-4" />}
                rows={[
                  ["1m RV", formatMetric(decision.realizedVolatility["1m"], "% ann.")],
                  ["5m RV", formatMetric(decision.realizedVolatility["5m"], "% ann.")],
                  ["15m RV", formatMetric(decision.realizedVolatility["15m"], "% ann.")],
                  ["Spread state", decision.spreadState],
                  ["Spread delta", formatMetric(decision.spreadDeltaPct, "%")],
                  ["Chop state", decision.chopState],
                ]}
              />
            </div>

            <Card className="border-white/10 bg-[#0c1628]/88">
              <CardHeader className="pb-3">
                <CardTitle>Tick Stream</CardTitle>
                <CardDescription>
                  Most recent Coinbase BTC-USD ticks with millisecond timestamps.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-[28rem] overflow-auto rounded-2xl border border-white/10">
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
                          <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                            Waiting for the first live tick from Coinbase.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="border-white/10 bg-[#0c1628]/88">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Alert Panel</CardTitle>
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
                {error ? (
                  <AlertRow tone="danger" text={error} />
                ) : null}
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
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-[#0c1628]/88">
              <CardHeader className="pb-3">
                <CardTitle>Market Structure</CardTitle>
                <CardDescription>
                  Compact view of the current BTC microstructure.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <MiniStat label="Spread bps" value={formatMetric(decision.spreadBps, "bps")} />
                <MiniStat label="Data stale" value={decision.dataQuality.stale ? "yes" : "no"} />
                <MiniStat label="Volume 24h" value={formatTradeSize(decision.volume24h)} />
                <MiniStat label="Coverage" value={formatCoverage(decision.dataQuality.coverageMinutes)} />
              </CardContent>
            </Card>

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
                              {formatCurrency(row.startingPrice, 0)}
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

            <ConfidenceReliabilityPanel signalPerformance={signalPerformance} />
          </div>
        </section>

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

function Sparkline({ ticks }: { ticks: RealtimeBtcTick[] }) {
  const prices = ticks.map((tick) => tick.price)
  if (prices.length < 2) {
    return (
      <div className="flex h-36 items-center justify-center text-sm text-muted-foreground">
        Sparkline will appear once live ticks arrive.
      </div>
    )
  }

  const width = 900
  const height = 180
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const padding = 12
  const points = prices.map((price, index) => {
    const x =
      prices.length === 1
        ? width / 2
        : padding + (index / (prices.length - 1)) * (width - padding * 2)
    const y =
      max === min
        ? height / 2
        : padding + (1 - (price - min) / (max - min)) * (height - padding * 2)
    return `${x},${y}`
  })
  const last = prices.at(-1) ?? 0
  const first = prices[0]
  const positive = last >= first

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-muted-foreground">
        <span>Live sparkline</span>
        <span>{positive ? "positive drift" : "negative drift"}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-36 w-full overflow-visible">
        <defs>
          <linearGradient id="btc-spark-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(245, 158, 11, 0.28)" />
            <stop offset="100%" stopColor="rgba(245, 158, 11, 0.02)" />
          </linearGradient>
          <linearGradient id="btc-spark-line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="rgb(251, 191, 36)" />
            <stop offset="100%" stopColor="rgb(34, 197, 94)" />
          </linearGradient>
        </defs>
        <polyline
          fill="none"
          stroke="url(#btc-spark-line)"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points.join(" ")}
        />
        <polygon
          fill="url(#btc-spark-fill)"
          stroke="none"
          points={`0,${height} ${points.join(" ")} ${width},${height}`}
        />
      </svg>
    </div>
  )
}

function AnalyticsPanel({
  title,
  description,
  icon,
  rows,
}: {
  title: string
  description: string
  icon: ReactNode
  rows: [string, string][]
}) {
  return (
    <Card className="border-white/10 bg-[#0c1628]/88">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-muted-foreground">
            {icon}
          </div>
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm"
          >
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono text-foreground">{value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function DecisionChip({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {label}
      </div>
      <div className="mt-2 text-base font-semibold text-foreground">{value}</div>
    </div>
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

function ExplanationList({
  label,
  items,
}: {
  label: string
  items: string[]
}) {
  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm leading-6 text-foreground">
            <span className="mt-2 size-1.5 rounded-full bg-primary/70" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
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

function formatMetric(value: number | null | undefined, suffix: string) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a"
  }

  const prefix = value > 0 ? "+" : ""
  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2)
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

function directionIcon(value: string) {
  if (value === "bullish") {
    return <ArrowUpRight className="size-4" />
  }

  if (value === "bearish") {
    return <ArrowDownRight className="size-4" />
  }

  return <CircleSlash2 className="size-4" />
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

  return `${value >= 0 ? "+" : ""}${formatCurrency(value, 0)}`
}

function formatSignedPercent(value: number) {
  if (!Number.isFinite(value)) {
    return "n/a"
  }

  return `${value >= 0 ? "+" : ""}${formatPercent(value, 2)}`
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
