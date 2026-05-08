import { AlertTriangle } from "lucide-react"

import { RecommendationBadge } from "@/components/dashboard/recommendation-badge"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  cn,
  formatCurrency,
  formatEdge,
  formatProbability,
} from "@/lib/utils"
import { AnalysisSnapshot, MarketAnalysis } from "@/types"

const RULES: Array<{
  key: keyof MarketAnalysis["ruleChecks"]
  label: string
}> = [
  { key: "positiveEdge", label: "Edge" },
  { key: "spreadOk", label: "Spread" },
  { key: "liquidityOk", label: "Liquidity" },
  { key: "volatilityOk", label: "Volatility" },
  { key: "bankrollOk", label: "Sizing" },
  { key: "confidenceOk", label: "Confidence" },
  { key: "timeOk", label: "Timing" },
]

export function RiskPanel({
  snapshot,
  market,
}: {
  snapshot: AnalysisSnapshot
  market: MarketAnalysis | null
}) {
  const edgeQuality = describeEdgeQuality(market)
  const warnings = Array.from(
    new Set([...(market?.warnings ?? []), ...snapshot.warnings]),
  ).slice(0, 6)

  return (
    <Card className="border-white/10 bg-[#0b1324]/90">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Risk Panel</CardTitle>
            <CardDescription>
              Sizing and firewall status for the currently selected contract.
            </CardDescription>
          </div>
          {market ? (
            <RecommendationBadge recommendation={market.recommendation} />
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <RiskMetric
            label="Bankroll"
            value={formatCurrency(snapshot.bankroll)}
            detail={`${(snapshot.maxRiskPct * 100).toFixed(1)}% maximum risk per idea`}
          />
          <RiskMetric
            label="Suggested Max Position"
            value={
              market
                ? `${market.sizing.maxContracts.toLocaleString()} ctr`
                : "Awaiting selection"
            }
            detail={
              market
                ? `${formatCurrency(market.sizing.estimatedCost)} notional at ${formatProbability(market.actionPrice)}`
                : "Select a contract to inspect sizing"
            }
          />
          <RiskMetric
            label="Volatility Regime"
            value={snapshot.volatility.regimeLabel}
            detail={`15m ${formatProbability(snapshot.volatility.rv15)} · 30m ${formatProbability(snapshot.volatility.rv30)} annualized`}
            tone={snapshot.volatility.regime === "extreme" ? "danger" : "neutral"}
          />
          <RiskMetric
            label="Edge Quality"
            value={edgeQuality.label}
            detail={edgeQuality.detail}
            tone={edgeQuality.tone}
          />
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-slate-400">
            <AlertTriangle className="size-3.5" />
            Active Warnings
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {warnings.length > 0 ? (
              warnings.map((warning) => (
                <Badge
                  key={warning}
                  variant="outline"
                  className="border-amber-500/20 bg-amber-500/10 text-amber-100"
                >
                  {warning}
                </Badge>
              ))
            ) : (
              <Badge
                variant="outline"
                className="border-white/10 bg-white/[0.03] text-slate-300"
              >
                No active warnings
              </Badge>
            )}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {RULES.map((rule) => {
            const passed = market?.ruleChecks[rule.key]

            return (
              <div
                key={rule.key}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
              >
                <span className="text-sm text-slate-300">{rule.label}</span>
                <span
                  className={cn(
                    "font-mono text-xs uppercase tracking-[0.16em]",
                    passed === true
                      ? "text-emerald-200"
                      : passed === false
                        ? "text-amber-100"
                        : "text-slate-500",
                  )}
                >
                  {passed === true ? "PASS" : passed === false ? "BLOCKED" : "--"}
                </span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function RiskMetric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string
  value: string
  detail: string
  tone?: "neutral" | "positive" | "warning" | "danger"
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        tone === "positive"
          ? "border-emerald-500/20 bg-emerald-500/8"
          : tone === "warning"
            ? "border-amber-500/20 bg-amber-500/8"
            : tone === "danger"
              ? "border-rose-500/20 bg-rose-500/8"
              : "border-white/10 bg-black/20",
      )}
    >
      <div className="text-[10px] uppercase tracking-[0.24em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 font-mono text-lg font-semibold text-foreground tabular-nums">
        {value}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</div>
    </div>
  )
}

function describeEdgeQuality(market: MarketAnalysis | null) {
  if (!market) {
    return {
      label: "Awaiting Selection",
      detail: "Choose a row from the scanner to inspect risk posture.",
      tone: "neutral" as const,
    }
  }

  if (market.recommendation !== "NO TRADE") {
    return {
      label: "Qualified",
      detail: `${formatEdge(market.rawEdge)} raw edge with ${market.confidenceScore}/100 confidence.`,
      tone: "positive" as const,
    }
  }

  if ((market.rawEdge ?? 0) > 0) {
    return {
      label: "Watchlist",
      detail: `${formatEdge(market.rawEdge)} edge exists, but another firewall rule is still blocking.`,
      tone: "warning" as const,
    }
  }

  return {
    label: "Filtered",
    detail: `${formatEdge(market.rawEdge)} edge does not justify action under the current model.`,
    tone: "neutral" as const,
  }
}
