"use client"

import { useState } from "react"
import { AlertTriangle } from "lucide-react"

import {
  buildConfidenceReliabilityDiagnostics,
  type ConfidenceBucketDiagnostics,
  type ConfidenceThresholdDiagnostics,
  type ConfidenceReliabilityWindow,
} from "@/lib/analysis/confidenceReliability"
import type { BtcJournalRow } from "@/lib/btc/journal-types"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn, formatPercent } from "@/lib/utils"

export function ConfidenceReliabilityPanel({
  signalPerformance,
}: {
  signalPerformance: BtcJournalRow[]
}) {
  const [selectedWindow, setSelectedWindow] =
    useState<ConfidenceReliabilityWindow>("all")
  const diagnostics = buildConfidenceReliabilityDiagnostics(
    signalPerformance,
    selectedWindow,
  )

  return (
    <Card className="border-white/10 bg-[#0c1628]/88">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Confidence Reliability</CardTitle>
            <CardDescription>
              Checks whether higher confidence has actually mapped to better short-window outcomes.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-slate-300">
              {diagnostics.totalResolvedCount} resolved outcomes
            </Badge>
            <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-slate-300">
              {diagnostics.qualifiedResolvedCount} quality-qualified
            </Badge>
            <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-slate-300">
              {diagnostics.regimeQualifiedResolvedCount} regime-qualified
            </Badge>
            <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-slate-300">
              {diagnostics.marketStateQualifiedResolvedCount} market-state-qualified
            </Badge>
            <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-slate-300">
              {diagnostics.suppressionQualifiedResolvedCount} suppression-qualified
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs
          value={selectedWindow}
          onValueChange={(value) =>
            setSelectedWindow(value as ConfidenceReliabilityWindow)
          }
        >
          <TabsList variant="line" className="mb-3 flex w-full flex-wrap gap-2">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="1m">1m</TabsTrigger>
            <TabsTrigger value="5m">5m</TabsTrigger>
            <TabsTrigger value="15m">15m</TabsTrigger>
            <TabsTrigger value="1h">1h</TabsTrigger>
          </TabsList>
        </Tabs>

        {diagnostics.sampleSizeWarning ? (
          <div className="flex gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>{diagnostics.sampleSizeWarning}</div>
          </div>
        ) : null}

        {diagnostics.excludedLowQualityCount > 0 ? (
          <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-3 py-3 text-sm text-sky-100">
            {diagnostics.excludedLowQualityCount} resolved outcomes were below the signal-quality cutoff and were excluded from calibration.
          </div>
        ) : null}

        {diagnostics.excludedLowRegimeCount > 0 ? (
          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/10 px-3 py-3 text-sm text-violet-100">
            {diagnostics.excludedLowRegimeCount} resolved outcomes were below the regime-quality cutoff and were excluded from calibration.
          </div>
        ) : null}

        {diagnostics.excludedSuppressedCount > 0 ? (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-3 text-sm text-rose-100">
            {diagnostics.excludedSuppressedCount} resolved outcomes were suppressed and were excluded from calibration unless override was enabled.
          </div>
        ) : null}

        <CalibrationChart
          buckets={diagnostics.buckets}
          sampleSizeWarning={diagnostics.sampleSizeWarning}
        />

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <SummaryStat label="Resolved" value={String(diagnostics.totalResolvedCount)} />
          <SummaryStat label="Hit rate" value={formatRate(diagnostics.summary.hitRate)} />
          <SummaryStat
            label="Avg move"
            value={formatSignedPercent(diagnostics.summary.averagePercentMove)}
          />
          <SummaryStat
            label="Bullish hit"
            value={formatRate(diagnostics.summary.bullishHitRate)}
          />
          <SummaryStat
            label="Bearish hit"
            value={formatRate(diagnostics.summary.bearishHitRate)}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryStat
            label="Breakout hit"
            value={formatRate(diagnostics.breakout.breakoutHitRate)}
          />
          <SummaryStat
            label="Non-breakout hit"
            value={formatRate(diagnostics.breakout.nonBreakoutHitRate)}
          />
          <SummaryStat
            label="False breakout warns"
            value={String(diagnostics.breakout.falseBreakoutWarningCount)}
          />
          <SummaryStat
            label="Warning reversal"
            value={formatRate(diagnostics.breakout.falseBreakoutWarningReversalRate)}
          />
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-3 text-sm leading-6 text-muted-foreground">
          Breakout outcomes are compared against non-breakout outcomes, and false-breakout warnings are
          measured against actual reversal behavior in the selected window.
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-[#08111f] text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Bucket</th>
                <th className="px-3 py-2">Resolved</th>
                <th className="px-3 py-2">Hit Rate</th>
                <th className="px-3 py-2">Avg Move</th>
                <th className="px-3 py-2">Bullish Hit</th>
                <th className="px-3 py-2">Bearish Hit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {diagnostics.buckets.map((bucket) => (
                <BucketRow key={bucket.label} bucket={bucket} />
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
            <div className="mb-3 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Threshold diagnostics
            </div>
            <div className="space-y-2">
              {diagnostics.thresholds.map((threshold) => (
                <ThresholdRow key={threshold.threshold} threshold={threshold} />
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
            <div className="mb-3 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Read
            </div>
            <div className="space-y-2 text-sm leading-6 text-muted-foreground">
              <p>
                Hit rate is measured across resolved 1m, 5m, and 15m outcomes from recent bias snapshots.
              </p>
              <p>
                Average move is the signed percent change after the snapshot. Bullish and bearish hit rates
                isolate directional accuracy by bias type.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function BucketRow({ bucket }: { bucket: ConfidenceBucketDiagnostics }) {
  const status = bucketReliability(bucket)
  return (
    <tr className="border-white/5">
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1">
          <div className="font-medium text-foreground">{bucket.label}</div>
          <div className="flex flex-wrap gap-1">
            <StatusBadge status={status} />
          </div>
        </div>
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {bucket.resolvedCount}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {formatRate(bucket.hitRate)}
      </td>
      <td className={cn("px-3 py-2 font-mono text-[11px]", toneForMove(bucket.averagePercentMove))}>
        {formatSignedPercent(bucket.averagePercentMove)}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {formatRate(bucket.bullishHitRate)}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {formatRate(bucket.bearishHitRate)}
      </td>
    </tr>
  )
}

function ThresholdRow({ threshold }: { threshold: ConfidenceThresholdDiagnostics }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm">
      <div className="text-muted-foreground">Confidence &gt;= {threshold.threshold}%</div>
      <div className="flex items-center gap-4 font-mono text-xs text-foreground">
        <span>{threshold.resolvedCount} resolved</span>
        <span>{formatRate(threshold.hitRate)}</span>
      </div>
    </div>
  )
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-medium text-foreground">{value}</div>
    </div>
  )
}

function CalibrationChart({
  buckets,
  sampleSizeWarning,
}: {
  buckets: ConfidenceBucketDiagnostics[]
  sampleSizeWarning: string | null
}) {
  const chartHeight = 160

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Calibration chart
          </div>
          <div className="text-sm text-muted-foreground">
            Hit rate by confidence bucket. The dashed line marks ideal calibration.
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <LegendPill tone="emerald">Underconfident</LegendPill>
          <LegendPill tone="rose">Overconfident</LegendPill>
          <LegendPill tone="amber">Unreliable</LegendPill>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="relative rounded-2xl border border-white/10 bg-[#08111f] p-3">
          <div className="relative flex h-48 items-end gap-2">
            <CalibrationGrid />
            {buckets.map((bucket) => {
              const hitRatePct =
                bucket.hitRate === null ? null : clampPercentage(bucket.hitRate * 100)
              const idealPct = midpointPercentage(bucket.minConfidence, bucket.maxConfidence)
              const status = bucketReliability(bucket)
              const barHeight =
                hitRatePct === null ? 0 : Math.max((hitRatePct / 100) * chartHeight, 6)
              const idealHeight = (idealPct / 100) * chartHeight

              return (
                <div key={bucket.label} className="relative flex flex-1 flex-col items-center justify-end gap-2">
                  <div className="relative flex h-[160px] w-full items-end justify-center">
                    <div
                      className={cn(
                        "relative w-full max-w-[72px] rounded-t-md border border-white/10 bg-white/5",
                        status === "underconfident"
                          ? "bg-emerald-500/25"
                          : status === "overconfident"
                            ? "bg-rose-500/25"
                            : "bg-amber-500/25",
                      )}
                      style={{ height: `${barHeight}px` }}
                    >
                      <div
                        className="absolute inset-x-0 border-t border-dashed border-white/35"
                        style={{ top: `${Math.max(0, 160 - idealHeight)}px` }}
                      />
                      {bucket.resolvedCount < 4 ? (
                        <div className="absolute inset-0 rounded-t-md border border-amber-500/30 bg-amber-500/10" />
                      ) : null}
                    </div>
                  </div>
                  <div className="w-full text-center">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      {bucket.label}
                    </div>
                    <div className="mt-1 text-[11px] font-mono text-muted-foreground">
                      {bucket.hitRate === null ? "n/a" : formatRate(bucket.hitRate)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <span>confidence bucket</span>
            <span>hit rate</span>
          </div>
        </div>

        <div className="space-y-2 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-muted-foreground">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Chart key
          </div>
          <LegendLine tone="emerald" label="Underconfident: hit rate above midpoint confidence" />
          <LegendLine tone="rose" label="Overconfident: hit rate below midpoint confidence" />
          <LegendLine tone="amber" label="Unreliable: bucket sample size too small" />
          <LegendLine tone="slate" label="Dashed line: ideal calibration at the bucket midpoint" />
          {sampleSizeWarning ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-amber-100">
              Low sample warning applies to this selection.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function CalibrationGrid() {
  return (
    <div className="pointer-events-none absolute inset-3 flex flex-col justify-between">
      <div className="border-t border-white/10" />
      <div className="border-t border-white/10" />
      <div className="border-t border-white/10" />
      <div className="border-t border-white/10" />
    </div>
  )
}

function LegendPill({
  tone,
  children,
}: {
  tone: "emerald" | "rose" | "amber" | "violet"
  children: string
}) {
  const toneClasses =
    tone === "emerald"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
      : tone === "rose"
        ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
        : tone === "violet"
          ? "border-violet-500/20 bg-violet-500/10 text-violet-100"
          : "border-amber-500/20 bg-amber-500/10 text-amber-100"

  return (
    <span className={cn("rounded-full border px-2 py-1", toneClasses)}>{children}</span>
  )
}

function LegendLine({
  tone,
  label,
}: {
  tone: "emerald" | "rose" | "amber" | "slate"
  label: string
}) {
  const toneClasses =
    tone === "emerald"
      ? "bg-emerald-400"
      : tone === "rose"
        ? "bg-rose-400"
        : tone === "amber"
          ? "bg-amber-400"
          : "bg-slate-300"

  return (
    <div className="flex items-start gap-2">
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", toneClasses)} />
      <span>{label}</span>
    </div>
  )
}

function StatusBadge({
  status,
}: {
  status: "underconfident" | "overconfident" | "unreliable"
}) {
  const toneClasses =
    status === "underconfident"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
      : status === "overconfident"
        ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
        : "border-amber-500/20 bg-amber-500/10 text-amber-100"

  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]", toneClasses)}>
      {status}
    </span>
  )
}

function bucketReliability(bucket: ConfidenceBucketDiagnostics) {
  if (bucket.resolvedCount < 4) {
    return "unreliable"
  }

  if (bucket.hitRate === null) {
    return "unreliable"
  }

  const midpoint = midpointPercentage(bucket.minConfidence, bucket.maxConfidence) / 100
  if (bucket.hitRate > midpoint + 0.03) {
    return "underconfident"
  }

  if (bucket.hitRate < midpoint - 0.03) {
    return "overconfident"
  }

  return "unreliable"
}

function midpointPercentage(minConfidence: number, maxConfidence: number) {
  return (minConfidence + Math.min(maxConfidence, 100)) / 2
}

function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, value))
}

function formatRate(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "n/a"
  }

  return formatPercent(value * 100, 1)
}

function formatSignedPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "n/a"
  }

  const digits = Math.abs(value) < 1 ? 4 : 2
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`
}

function toneForMove(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "text-muted-foreground"
  }

  return value >= 0 ? "text-emerald-200" : "text-rose-200"
}
