import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  formatCurrency,
  formatPercent,
  formatProbability,
  shortMarketTicker,
  signedCurrency,
} from "@/lib/utils"
import { AnalysisSnapshot, MarketAnalysis } from "@/types"

import { RecommendationBadge } from "@/components/dashboard/recommendation-badge"
import { StatePanel } from "@/components/dashboard/state-panel"

const MINUTES_PER_YEAR = 365 * 24 * 60

export function ProbabilityVisualization({
  snapshot,
  market,
}: {
  snapshot: AnalysisSnapshot
  market: MarketAnalysis | null
}) {
  if (!market) {
    return (
      <Card className="border-white/10 bg-[#0b1324]/90">
        <CardHeader>
          <CardTitle>Probability View</CardTitle>
          <CardDescription>
            Distribution, expected move range, and strike placement for the active
            selection.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StatePanel
            title="No contract selected"
            description="Choose a market from the scanner to populate the probability view."
            detail="Above/below probabilities and expected move range will appear here."
          />
        </CardContent>
      </Card>
    )
  }

  const expectedMove = buildExpectedMoveRange(
    snapshot.btc.spotPrice,
    market.minutesToSettlement,
    snapshot.volatility.modelVol,
  )
  const strikeInsideRange =
    expectedMove && market.market.strikePrice !== null
      ? market.market.strikePrice >= expectedMove.lower &&
        market.market.strikePrice <= expectedMove.upper
      : null
  const strikeMarker =
    expectedMove && market.market.strikePrice !== null
      ? toMarkerPosition(
          market.market.strikePrice,
          expectedMove.lower,
          expectedMove.upper,
        )
      : null
  const spotMarker = expectedMove ? 50 : null
  const abovePct = clampPercent((market.fairProbabilityAbove ?? 0) * 100)
  const belowPct = clampPercent((market.fairProbabilityBelow ?? 0) * 100)

  return (
    <Card className="border-white/10 bg-[#0b1324]/90">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Probability View</CardTitle>
            <CardDescription>
              {shortMarketTicker(market.market.ticker)} selected from the live scanner.
            </CardDescription>
          </div>
          <RecommendationBadge recommendation={market.recommendation} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <ProbabilityStat
            label="Above Strike"
            value={formatProbability(market.fairProbabilityAbove)}
            detail={`Model probability above ${formatCurrency(market.market.strikePrice)}`}
            tone="positive"
          />
          <ProbabilityStat
            label="Below Strike"
            value={formatProbability(market.fairProbabilityBelow)}
            detail={`Complement probability below the same strike`}
          />
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-[0.24em] text-slate-400">
                Model Split
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Implied above {formatProbability(market.marketImpliedMid)} from the
                live two-sided quote.
              </div>
            </div>
            <div className="font-mono text-xs text-slate-400">
              Edge {formatEdgeLabel(market)}
            </div>
          </div>

          <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/5">
            <div className="flex h-full">
              <div
                className="bg-slate-500/45"
                style={{ width: `${belowPct}%` }}
              />
              <div
                className="bg-gradient-to-r from-cyan-500/70 to-emerald-500/80"
                style={{ width: `${abovePct}%` }}
              />
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between font-mono text-xs text-slate-300">
            <span>Below {formatProbability(market.fairProbabilityBelow)}</span>
            <span>Above {formatProbability(market.fairProbabilityAbove)}</span>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-[0.24em] text-slate-400">
                Expected Move Range
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                One-sigma move from current spot using the live model volatility.
              </div>
            </div>

            {expectedMove ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-white/10 bg-white/[0.03] text-slate-300"
                >
                  ±{formatCurrency(expectedMove.moveDollars)}
                </Badge>
                <Badge
                  variant="outline"
                  className="border-white/10 bg-white/[0.03] text-slate-300"
                >
                  {formatPercent(expectedMove.movePct)}
                </Badge>
                {strikeInsideRange !== null ? (
                  <Badge
                    variant="outline"
                    className={
                      strikeInsideRange
                        ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-100"
                        : "border-amber-500/20 bg-amber-500/10 text-amber-100"
                    }
                  >
                    {strikeInsideRange ? "Strike Inside Range" : "Strike Outside Range"}
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </div>

          {expectedMove ? (
            <>
              <div className="relative mt-5 h-4 rounded-full bg-white/5">
                <div className="absolute inset-0 rounded-full border border-white/10" />
                {spotMarker !== null ? (
                  <Marker position={spotMarker} colorClassName="bg-cyan-300" />
                ) : null}
                {strikeMarker !== null ? (
                  <Marker position={strikeMarker} colorClassName="bg-amber-300" />
                ) : null}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <RangeStat label="Lower" value={formatCurrency(expectedMove.lower)} />
                <RangeStat label="Spot" value={formatCurrency(snapshot.btc.spotPrice)} />
                <RangeStat label="Strike" value={formatCurrency(market.market.strikePrice)} />
                <RangeStat label="Upper" value={formatCurrency(expectedMove.upper)} />
              </div>
            </>
          ) : (
            <StatePanel
              title="Expected range unavailable"
              description="The selected market does not have enough time or strike data for a range estimate."
              className="mt-4"
            />
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ProbabilityStat
            label="Distance From Strike"
            value={signedCurrency(market.distanceToStrikeDollars)}
            detail={formatPercent(market.distanceToStrikePct)}
          />
          <ProbabilityStat
            label="Time To Settlement"
            value={formatDuration(market.minutesToSettlement)}
            detail="Used directly in the short-horizon probability estimate"
          />
        </div>
      </CardContent>
    </Card>
  )
}

function ProbabilityStat({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string
  value: string
  detail: string
  tone?: "neutral" | "positive"
}) {
  return (
    <div
      className={
        tone === "positive"
          ? "rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-4"
          : "rounded-xl border border-white/10 bg-black/20 p-4"
      }
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

function RangeStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#0d162b] p-3">
      <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 font-mono text-sm font-semibold text-foreground tabular-nums">
        {value}
      </div>
    </div>
  )
}

function Marker({
  position,
  colorClassName,
}: {
  position: number
  colorClassName: string
}) {
  return (
    <div
      className="absolute inset-y-[-8px]"
      style={{ left: `calc(${position}% - 1px)` }}
    >
      <div className={colorClassName + " h-8 w-0.5 rounded-full"} />
    </div>
  )
}

function buildExpectedMoveRange(
  spotPrice: number,
  minutesToSettlement: number | null,
  modelVol: number,
) {
  if (!Number.isFinite(spotPrice) || spotPrice <= 0) {
    return null
  }

  if (
    minutesToSettlement === null ||
    minutesToSettlement <= 0 ||
    !Number.isFinite(modelVol) ||
    modelVol <= 0
  ) {
    return null
  }

  const sigmaT = modelVol * Math.sqrt(minutesToSettlement / MINUTES_PER_YEAR)
  const moveDollars = spotPrice * sigmaT

  return {
    lower: Math.max(spotPrice - moveDollars, 0),
    upper: spotPrice + moveDollars,
    moveDollars,
    movePct: sigmaT * 100,
  }
}

function toMarkerPosition(value: number, lower: number, upper: number) {
  if (upper <= lower) {
    return 50
  }

  return clampPercent(((value - lower) / (upper - lower)) * 100)
}

function clampPercent(value: number) {
  return Math.min(Math.max(value, 0), 100)
}

function formatDuration(minutes: number | null) {
  if (minutes === null) {
    return "--"
  }

  if (minutes < 60) {
    return `${Math.max(Math.round(minutes), 0)} min`
  }

  const hours = Math.floor(minutes / 60)
  const remainder = Math.max(Math.round(minutes % 60), 0)
  return `${hours}h ${remainder}m`
}

function formatEdgeLabel(market: MarketAnalysis) {
  return market.rawEdge === null
    ? "--"
    : `${market.suggestedSide} ${formatProbability(Math.abs(market.rawEdge))}`
}
