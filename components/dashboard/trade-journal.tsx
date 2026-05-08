"use client"

import { useState, type FormEvent, type ReactNode } from "react"

import { RecommendationBadge } from "@/components/dashboard/recommendation-badge"
import { StatePanel } from "@/components/dashboard/state-panel"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  formatCurrency,
  formatProbability,
  formatTimestamp,
  shortMarketTicker,
} from "@/lib/utils"
import { appendJournalEntry, summarizeJournalBehavior } from "@/lib/journal/storage"
import { JournalEntry, MarketAnalysis, MistakeTag, Recommendation } from "@/types"

const SIDE_OPTIONS: Recommendation[] = ["BUY YES", "BUY NO", "NO TRADE"]
const RESULT_OPTIONS: JournalEntry["result"][] = ["open", "win", "loss", "scratch"]
const MISTAKE_OPTIONS: MistakeTag[] = [
  "none",
  "FOMO",
  "chase",
  "bad sizing",
  "no edge",
  "ignored model",
]

export function TradeJournal({
  entries,
  onEntriesChange,
  selectedMarket,
}: {
  entries: JournalEntry[]
  onEntriesChange: (entries: JournalEntry[]) => void
  selectedMarket: MarketAnalysis | null
}) {
  const behavior = summarizeJournalBehavior(entries)
  const [marketTicker, setMarketTicker] = useState("")
  const [strike, setStrike] = useState("")
  const [side, setSide] = useState<Recommendation>("NO TRADE")
  const [entryPrice, setEntryPrice] = useState("")
  const [modelProbability, setModelProbability] = useState("")
  const [thesis, setThesis] = useState("")
  const [result, setResult] = useState<JournalEntry["result"]>("open")
  const [mistakeTag, setMistakeTag] = useState<MistakeTag>("none")

  function importSelectedMarket() {
    if (!selectedMarket) {
      return
    }

    setMarketTicker(selectedMarket.market.ticker)
    setStrike(
      selectedMarket.market.strikePrice !== null
        ? String(selectedMarket.market.strikePrice)
        : "",
    )
    setSide(selectedMarket.recommendation)
    setEntryPrice(
      selectedMarket.actionPrice !== null ? String(selectedMarket.actionPrice) : "",
    )
    setModelProbability(
      selectedMarket.suggestedSide === "YES"
        ? String(selectedMarket.fairProbabilityAbove ?? "")
        : String(selectedMarket.fairProbabilityBelow ?? ""),
    )
    setThesis(
      `${selectedMarket.recommendation} only if the live quote, liquidity, and volatility regime still match the scanner.`,
    )
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const entry: JournalEntry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      marketTicker: marketTicker.trim(),
      strike: parseNullableNumber(strike),
      side,
      entryPrice: parseNullableNumber(entryPrice),
      modelProbability: parseNullableNumber(modelProbability),
      thesis: thesis.trim(),
      result,
      mistakeTag,
    }

    if (!entry.marketTicker || !entry.thesis) {
      return
    }

    const nextEntries = appendJournalEntry(entry)
    onEntriesChange(nextEntries)
    setThesis("")
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_420px]">
      <Card className="border-white/10 bg-[#0b1324]/90">
        <CardHeader>
          <CardTitle>Trade Journal</CardTitle>
          <CardDescription>
            Manual review workflow only. Entries stay local and do not route any
            orders.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">
                Selected scanner contract
              </div>
              {selectedMarket ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{selectedMarket.market.ticker}</span>
                  <span>·</span>
                  <span>Entry {formatProbability(selectedMarket.actionPrice)}</span>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Select a market from the scanner to prefill the journal.
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedMarket ? (
                <RecommendationBadge recommendation={selectedMarket.recommendation} />
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={importSelectedMarket}
                disabled={!selectedMarket}
              >
                Import Selected Setup
              </Button>
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Ticker">
                <Input
                  value={marketTicker}
                  onChange={(event) => setMarketTicker(event.target.value)}
                  placeholder="KXBTCD-26MAY0809-T80499.99"
                />
              </Field>

              <Field label="Strike">
                <Input
                  value={strike}
                  onChange={(event) => setStrike(event.target.value)}
                  placeholder="80499.99"
                />
              </Field>

              <Field label="Side">
                <Select
                  value={side}
                  onValueChange={(value) => setSide(value as Recommendation)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SIDE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Entry Price">
                <Input
                  value={entryPrice}
                  onChange={(event) => setEntryPrice(event.target.value)}
                  placeholder="0.47"
                />
              </Field>

              <Field label="Model Probability">
                <Input
                  value={modelProbability}
                  onChange={(event) => setModelProbability(event.target.value)}
                  placeholder="0.53"
                />
              </Field>

              <Field label="Result">
                <Select
                  value={result}
                  onValueChange={(value) =>
                    setResult(value as JournalEntry["result"])
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RESULT_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Mistake Tag">
                <Select
                  value={mistakeTag}
                  onValueChange={(value) => setMistakeTag(value as MistakeTag)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MISTAKE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="Thesis">
              <Textarea
                value={thesis}
                onChange={(event) => setThesis(event.target.value)}
                placeholder="What made this setup valid or invalid under the model and the risk firewall?"
                className="min-h-32"
              />
            </Field>

            <div className="flex justify-end">
              <Button type="submit">Save Journal Entry</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 content-start">
        <Card className="border-white/10 bg-[#0b1324]/90">
          <CardHeader>
            <CardTitle>Behavior Firewall</CardTitle>
            <CardDescription>
              Manual review signals pulled from the recent journal sample.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <BehaviorMetric
                label="Recent Loss Streak"
                value={String(behavior.recentLossStreak)}
              />
              <BehaviorMetric
                label="Discipline Hits"
                value={String(behavior.recentDisciplineHits)}
              />
            </div>

            {behavior.warnings.length > 0 ? (
              <div className="space-y-2">
                {behavior.warnings.map((warning) => (
                  <div
                    key={warning}
                    className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
                  >
                    {warning}
                  </div>
                ))}
              </div>
            ) : (
              <StatePanel
                title="No behavior warnings"
                description="The recent journal sample is not showing a notable discipline pattern."
              />
            )}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-[#0b1324]/90">
          <CardHeader>
            <CardTitle>Recent Entries</CardTitle>
            <CardDescription>
              Local record of thesis, result, and review tags.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            {entries.length > 0 ? (
              entries.slice(0, 6).map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-xl border border-white/10 bg-black/20 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">
                        {shortMarketTicker(entry.marketTicker)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatTimestamp(entry.createdAt)}
                      </div>
                    </div>

                    <RecommendationBadge recommendation={entry.side} />
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <EntryMeta label="Entry" value={formatProbability(entry.entryPrice)} />
                    <EntryMeta label="Result" value={entry.result.toUpperCase()} />
                    <EntryMeta label="Mistake" value={entry.mistakeTag} />
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <EntryMeta label="Strike" value={formatCurrency(entry.strike)} />
                    <EntryMeta
                      label="Model Prob"
                      value={formatProbability(entry.modelProbability)}
                    />
                  </div>

                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    {entry.thesis}
                  </p>
                </div>
              ))
            ) : (
              <StatePanel
                title="No journal entries yet"
                description="Saved trade notes, result tags, and mistakes will populate here."
                detail="Use the form to start building a manual review trail."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="text-xs uppercase tracking-[0.18em] text-slate-400">
        {label}
      </span>
      {children}
    </label>
  )
}

function BehaviorMetric({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold text-foreground tabular-nums">
        {value}
      </div>
    </div>
  )
}

function EntryMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#0d162b] p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 font-mono text-xs font-semibold text-foreground tabular-nums">
        {value}
      </div>
    </div>
  )
}

function parseNullableNumber(value: string) {
  if (!value.trim()) {
    return null
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}
