"use client"

import { type KeyboardEvent } from "react"

import { RecommendationBadge } from "@/components/dashboard/recommendation-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  cn,
  formatCompactNumber,
  formatCurrency,
  formatEdge,
  formatProbability,
  formatTimestamp,
  shortMarketTicker,
} from "@/lib/utils"
import { MarketAnalysis } from "@/types"

export function MarketTable({
  markets,
  selectedTicker,
  onSelect,
}: {
  markets: MarketAnalysis[]
  selectedTicker?: string | null
  onSelect: (market: MarketAnalysis) => void
}) {
  return (
    <Table className="min-w-[1160px]">
      <TableHeader>
        <TableRow className="border-white/10 hover:bg-transparent">
          <TableHead className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
            Contract
          </TableHead>
          <TableHead className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
            Strike
          </TableHead>
          <TableHead className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
            YES Bid / Ask
          </TableHead>
          <TableHead className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
            NO Bid / Ask
          </TableHead>
          <TableHead className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
            Implied Prob
          </TableHead>
          <TableHead className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
            Model Prob
          </TableHead>
          <TableHead className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
            Est. Edge
          </TableHead>
          <TableHead className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
            Spread
          </TableHead>
          <TableHead className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
            Liquidity
          </TableHead>
          <TableHead className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
            Confidence
          </TableHead>
          <TableHead className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
            Recommendation
          </TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {markets.map((analysis) => {
          const selected = selectedTicker === analysis.market.ticker
          const impliedBelow =
            analysis.marketImpliedMid === null ? null : 1 - analysis.marketImpliedMid

          return (
            <TableRow
              key={analysis.market.ticker}
              data-state={selected ? "selected" : undefined}
              tabIndex={0}
              className={cn(
                "cursor-pointer border-white/8 align-top hover:bg-white/[0.03] focus-visible:outline-none",
                selected && "bg-white/[0.04]",
              )}
              onClick={() => onSelect(analysis)}
              onKeyDown={(event) => handleRowKeyDown(event, analysis, onSelect)}
            >
              <TableCell className="min-w-[210px]">
                <div className="space-y-1">
                  <div className="font-medium text-foreground">
                    {shortMarketTicker(analysis.market.ticker)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {analysis.market.status.toUpperCase()} · settles{" "}
                    {formatTimestamp(
                      analysis.market.settlementTime ?? analysis.market.closeTime,
                    )}
                  </div>
                </div>
              </TableCell>

              <TableCell className="font-mono text-sm tabular-nums">
                {formatCurrency(analysis.market.strikePrice)}
              </TableCell>

              <TableCell className="font-mono text-sm tabular-nums">
                {formatProbability(analysis.market.yesBid)} /{" "}
                {formatProbability(analysis.market.yesAsk)}
              </TableCell>

              <TableCell className="font-mono text-sm tabular-nums">
                {formatProbability(analysis.market.noBid)} /{" "}
                {formatProbability(analysis.market.noAsk)}
              </TableCell>

              <TableCell className="min-w-[132px]">
                <div className="font-mono text-sm tabular-nums">
                  {formatProbability(analysis.marketImpliedMid)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Below {formatProbability(impliedBelow)}
                </div>
              </TableCell>

              <TableCell className="min-w-[132px]">
                <div className="font-mono text-sm tabular-nums">
                  {formatProbability(analysis.fairProbabilityAbove)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Below {formatProbability(analysis.fairProbabilityBelow)}
                </div>
              </TableCell>

              <TableCell className="min-w-[120px]">
                <div className="font-mono text-sm tabular-nums">
                  {formatEdge(analysis.rawEdge)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {analysis.suggestedSide} side
                </div>
              </TableCell>

              <TableCell className="font-mono text-sm tabular-nums">
                {formatProbability(analysis.bidAskSpread)}
              </TableCell>

              <TableCell className="min-w-[136px]">
                <div className="font-mono text-sm tabular-nums">
                  {formatCompactNumber(analysis.market.liquidity)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Vol {formatCompactNumber(analysis.market.volume)} · OI{" "}
                  {formatCompactNumber(analysis.market.openInterest)}
                </div>
              </TableCell>

              <TableCell className="min-w-[108px]">
                <div className="font-mono text-sm tabular-nums">
                  {analysis.confidenceScore}/100
                </div>
                <div className="text-xs text-muted-foreground">
                  Score {analysis.riskAdjustedScore}
                </div>
              </TableCell>

              <TableCell>
                <RecommendationBadge recommendation={analysis.recommendation} />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function handleRowKeyDown(
  event: KeyboardEvent<HTMLTableRowElement>,
  analysis: MarketAnalysis,
  onSelect: (market: MarketAnalysis) => void,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault()
    onSelect(analysis)
  }
}
