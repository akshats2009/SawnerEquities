import { type ReactNode } from "react"
import { Activity, CandlestickChart, Clock3, RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { cn, formatCurrency, formatProbability, formatTimestamp } from "@/lib/utils"
import { AnalysisSnapshot } from "@/types"

export function DashboardHeader({
  snapshot,
  isRefreshing,
}: {
  snapshot: AnalysisSnapshot | null
  isRefreshing: boolean
}) {
  return (
    <Card className="border-white/10 bg-[#0a1222]/95 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      <CardContent className="space-y-6 pt-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <div className="text-[11px] uppercase tracking-[0.34em] text-slate-400">
              Sawner Equities
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                BTC Event Probability Dashboard
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">
                Bloomberg-style scanner for Kalshi BTC above/below markets. The
                interface stays analysis-focused and assumes `NO TRADE` unless live
                edge, liquidity, volatility, and sizing all clear together.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge className="border-white/10 bg-white/[0.04] text-slate-200">
              Analysis Only
            </Badge>
            <Badge className="border-white/10 bg-white/[0.04] text-slate-200">
              Default Outcome: NO TRADE
            </Badge>
            {isRefreshing ? (
              <Badge className="border-cyan-500/20 bg-cyan-500/10 text-cyan-100">
                <RefreshCw className="size-3 animate-spin" />
                Refreshing
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <HeaderMetric
            label="BTC Live Price"
            value={snapshot ? formatCurrency(snapshot.btc.spotPrice) : "--"}
            detail={
              snapshot
                ? `${snapshot.btc.source.toUpperCase()} spot feed`
                : "Awaiting live BTC quote"
            }
            icon={<CandlestickChart className="size-4" />}
          />
          <HeaderMetric
            label="Volatility Regime"
            value={
              snapshot ? (
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded-md px-2.5 py-1 font-mono text-[11px] tracking-[0.16em]",
                    getRegimeClass(snapshot.volatility.regime),
                  )}
                >
                  {snapshot.volatility.regimeLabel}
                </Badge>
              ) : (
                "--"
              )
            }
            detail={
              snapshot
                ? `30m realized vol ${formatProbability(snapshot.volatility.rv30)}`
                : "No volatility snapshot yet"
            }
            icon={<Activity className="size-4" />}
          />
          <HeaderMetric
            label="Last Refresh"
            value={snapshot ? formatTimestamp(snapshot.asOf) : "--"}
            detail={
              snapshot ? "Latest completed scanner run" : "Waiting on first scan"
            }
            icon={<Clock3 className="size-4" />}
          />
          <HeaderMetric
            label="Resolved Event"
            value={snapshot?.resolvedEventTicker ?? "--"}
            detail={
              snapshot
                ? `Requested ${snapshot.requestedTicker}`
                : "Kalshi event scope will populate here"
            }
            icon={<RefreshCw className="size-4" />}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function getRegimeClass(regime: string) {
  switch (regime) {
    case "calm":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
    case "active":
      return "border-cyan-500/20 bg-cyan-500/10 text-cyan-200"
    case "elevated":
      return "border-amber-500/20 bg-amber-500/10 text-amber-100"
    case "extreme":
      return "border-rose-500/20 bg-rose-500/10 text-rose-200"
    default:
      return "border-white/10 bg-white/[0.03] text-slate-300"
  }
}

function HeaderMetric({
  label,
  value,
  detail,
  icon,
}: {
  label: string
  value: ReactNode
  detail: string
  icon: ReactNode
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="text-[10px] uppercase tracking-[0.24em] text-slate-400">
            {label}
          </div>
          <div className="truncate font-mono text-sm font-semibold text-foreground tabular-nums sm:text-base">
            {value}
          </div>
          <div className="text-xs leading-5 text-muted-foreground">{detail}</div>
        </div>
        <div className="mt-0.5 shrink-0 text-slate-500">{icon}</div>
      </div>
    </div>
  )
}
