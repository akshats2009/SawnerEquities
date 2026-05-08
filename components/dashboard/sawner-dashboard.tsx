"use client"

import {
  useDeferredValue,
  useEffect,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react"
import {
  Activity,
  AlertTriangle,
  BookOpenText,
  Filter,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from "lucide-react"

import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { MarketTable } from "@/components/dashboard/market-table"
import { MetricCard } from "@/components/dashboard/metric-card"
import { ProbabilityVisualization } from "@/components/dashboard/probability-visualization"
import { RiskPanel } from "@/components/dashboard/risk-panel"
import { StatePanel } from "@/components/dashboard/state-panel"
import { TradeJournal } from "@/components/dashboard/trade-journal"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { formatCurrency } from "@/lib/utils"
import { readJournalEntries } from "@/lib/journal/storage"
import { AnalysisSnapshot, JournalEntry, MarketAnalysis } from "@/types"

const DEFAULT_TICKER = "KXBTCD-26MAY0809"
const DEFAULT_BANKROLL = "10000"
const DEFAULT_MAX_RISK_PCT = "0.015"

type MarketFilter = "all" | "actionable" | "no-trade"
type DashboardErrorKind =
  | "invalid-ticker"
  | "invalid-input"
  | "missing-data"
  | "api-failure"

interface DashboardErrorState {
  kind: DashboardErrorKind
  title: string
  description: string
  detail?: string
}

class SnapshotLoadError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "SnapshotLoadError"
    this.status = status
  }
}

export function SawnerDashboard() {
  const [ticker, setTicker] = useState(DEFAULT_TICKER)
  const [bankroll, setBankroll] = useState(DEFAULT_BANKROLL)
  const [maxRiskPct, setMaxRiskPct] = useState(DEFAULT_MAX_RISK_PCT)
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(null)
  const [selectedMarket, setSelectedMarket] = useState<MarketAnalysis | null>(null)
  const [filter, setFilter] = useState<MarketFilter>("all")
  const [errorState, setErrorState] = useState<DashboardErrorState | null>(null)
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>(() =>
    readJournalEntries(),
  )
  const [isRefreshing, setIsRefreshing] = useState(true)
  const [isPending, startTransition] = useTransition()

  const deferredFilter = useDeferredValue(filter)

  useEffect(() => {
    let cancelled = false

    void fetchSnapshotData(DEFAULT_TICKER, DEFAULT_BANKROLL, DEFAULT_MAX_RISK_PCT)
      .then((payload) => {
        if (cancelled) {
          return
        }

        startTransition(() => {
          setSnapshot(payload)
          setSelectedMarket((current) => pickSelectedMarket(payload, current))
        })
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setErrorState(toDashboardError(error))
      })
      .finally(() => {
        if (!cancelled) {
          setIsRefreshing(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [startTransition])

  async function loadSnapshot(
    nextTicker: string,
    nextBankroll: string,
    nextMaxRiskPct: string,
  ) {
    setErrorState(null)
    setIsRefreshing(true)

    try {
      const payload = await fetchSnapshotData(
        nextTicker,
        nextBankroll,
        nextMaxRiskPct,
      )

      startTransition(() => {
        setSnapshot(payload)
        setSelectedMarket((current) => pickSelectedMarket(payload, current))
      })
    } catch (error) {
      setErrorState(toDashboardError(error))
    } finally {
      setIsRefreshing(false)
    }
  }

  function handleRefresh(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void loadSnapshot(ticker, bankroll, maxRiskPct)
  }

  const visibleMarkets = snapshot
    ? snapshot.markets.filter((market) => {
        if (deferredFilter === "actionable") {
          return market.recommendation !== "NO TRADE"
        }

        if (deferredFilter === "no-trade") {
          return market.recommendation === "NO TRADE"
        }

        return true
      })
    : []

  const actionableCount =
    snapshot?.markets.filter((market) => market.recommendation !== "NO TRADE").length ?? 0

  const marketState = getMarketState(snapshot, deferredFilter, visibleMarkets.length)

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[1580px] flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <DashboardHeader snapshot={snapshot} isRefreshing={isRefreshing || isPending} />

        <Card className="border-white/10 bg-[#0b1324]/90">
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Scan Controls</CardTitle>
                <CardDescription>
                  Ticker, bankroll, and per-trade risk settings for the live dashboard.
                </CardDescription>
              </div>
              <Badge className="border-white/10 bg-white/[0.03] text-slate-300">
                Analysis-Focused
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <form
              className="grid gap-4 lg:grid-cols-[1.45fr_0.85fr_0.85fr_auto]"
              onSubmit={handleRefresh}
            >
              <DashboardField label="Kalshi Event / Market Ticker">
                <Input
                  value={ticker}
                  onChange={(event) => setTicker(event.target.value)}
                  placeholder={DEFAULT_TICKER}
                />
              </DashboardField>

              <DashboardField label="Bankroll">
                <Input
                  value={bankroll}
                  onChange={(event) => setBankroll(event.target.value)}
                  placeholder={DEFAULT_BANKROLL}
                />
              </DashboardField>

              <DashboardField label="Max Risk Per Trade">
                <Input
                  value={maxRiskPct}
                  onChange={(event) => setMaxRiskPct(event.target.value)}
                  placeholder={DEFAULT_MAX_RISK_PCT}
                />
              </DashboardField>

              <div className="flex items-end">
                <Button type="submit" className="w-full gap-2 lg:w-auto">
                  <RefreshCw
                    className={
                      isRefreshing || isPending ? "size-4 animate-spin" : "size-4"
                    }
                  />
                  {isRefreshing || isPending ? "Refreshing" : "Run Scan"}
                </Button>
              </div>
            </form>

            {errorState && snapshot ? (
              <StatePanel
                title={errorState.title}
                description={errorState.description}
                detail={errorState.detail}
                tone={errorState.kind === "api-failure" ? "danger" : "warning"}
              />
            ) : null}
          </CardContent>
        </Card>

        {snapshot ? (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Resolved Event"
                value={snapshot.resolvedEventTicker}
                detail={`Requested ${snapshot.requestedTicker}`}
                tone="neutral"
                valueClassName="text-sm"
                icon={<BookOpenText className="size-5" />}
              />
              <MetricCard
                label="Default Stance"
                value="NO TRADE"
                detail={snapshot.defaultStance}
                tone="neutral"
                icon={<ShieldAlert className="size-5" />}
              />
              <MetricCard
                label="Actionable Setups"
                value={String(actionableCount)}
                detail={`${snapshot.markets.length} total contracts in the current scan`}
                tone={actionableCount > 0 ? "positive" : "caution"}
                icon={<Activity className="size-5" />}
              />
              <MetricCard
                label="Per-Trade Risk Cap"
                value={formatCurrency(snapshot.bankroll * snapshot.maxRiskPct)}
                detail={`${(snapshot.maxRiskPct * 100).toFixed(1)}% of bankroll before quote friction`}
                tone="neutral"
                icon={<Wallet className="size-5" />}
              />
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_390px]">
              <Card className="border-white/10 bg-[#0b1324]/90">
                <CardHeader className="gap-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <CardTitle>Market Table</CardTitle>
                      <CardDescription>
                        Event {snapshot.resolvedEventTicker} with live quote, model,
                        edge, liquidity, and recommendation context.
                      </CardDescription>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <FilterButton
                        label="All Markets"
                        active={filter === "all"}
                        onClick={() => startTransition(() => setFilter("all"))}
                      />
                      <FilterButton
                        label="Actionable"
                        active={filter === "actionable"}
                        onClick={() => startTransition(() => setFilter("actionable"))}
                      />
                      <FilterButton
                        label="No Trade"
                        active={filter === "no-trade"}
                        onClick={() => startTransition(() => setFilter("no-trade"))}
                      />
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {marketState ? (
                    <StatePanel
                      title={marketState.title}
                      description={marketState.description}
                      detail={marketState.detail}
                      tone={marketState.tone}
                      icon={marketState.icon}
                    />
                  ) : (
                    <MarketTable
                      markets={visibleMarkets}
                      selectedTicker={selectedMarket?.market.ticker}
                      onSelect={setSelectedMarket}
                    />
                  )}
                </CardContent>
              </Card>

              <div className="grid gap-4 content-start">
                <RiskPanel snapshot={snapshot} market={selectedMarket} />
                <ProbabilityVisualization snapshot={snapshot} market={selectedMarket} />
              </div>
            </section>

            <TradeJournal
              entries={journalEntries}
              onEntriesChange={setJournalEntries}
              selectedMarket={selectedMarket}
            />

            <Card className="border-white/10 bg-[#0b1324]/90">
              <CardHeader>
                <CardTitle>Methodology Notes</CardTitle>
                <CardDescription>
                  Analysis constraints and system reminders surfaced directly in the UI.
                </CardDescription>
              </CardHeader>

              <CardContent className="grid gap-3 lg:grid-cols-2">
                <div className="grid gap-3">
                  <NoteCard
                    label="Probability Engine"
                    body="Uses live BTC spot, strike distance, time remaining, and recent realized volatility to estimate above/below odds."
                  />
                  <NoteCard
                    label="Risk Firewall"
                    body="Edge, spread, liquidity, timing, volatility, and bankroll sizing must all pass before the recommendation flips away from NO TRADE."
                  />
                </div>

                <div className="grid gap-3">
                  {snapshot.disclaimers.map((disclaimer) => (
                    <NoteCard key={disclaimer} label="Disclosure" body={disclaimer} />
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        ) : errorState ? (
          <StatePanel
            title={errorState.title}
            description={errorState.description}
            detail={errorState.detail}
            tone={errorState.kind === "api-failure" ? "danger" : "warning"}
            actionLabel="Retry Default Scan"
            onAction={() =>
              void loadSnapshot(
                DEFAULT_TICKER,
                DEFAULT_BANKROLL,
                DEFAULT_MAX_RISK_PCT,
              )
            }
          />
        ) : (
          <LoadingDashboard />
        )}
      </div>
    </main>
  )
}

async function fetchSnapshotData(
  ticker: string,
  bankroll: string,
  maxRiskPct: string,
) {
  const params = new URLSearchParams({
    ticker,
    bankroll,
    maxRiskPct,
  })

  const response = await fetch(`/api/analyze?${params.toString()}`, {
    cache: "no-store",
  })
  const payload = (await response.json()) as AnalysisSnapshot | { error: string }

  if (!response.ok || "error" in payload) {
    const message =
      "error" in payload ? payload.error : "Unable to load live market data."
    throw new SnapshotLoadError(response.status, message)
  }

  return payload
}

function pickSelectedMarket(
  snapshot: AnalysisSnapshot,
  current: MarketAnalysis | null,
) {
  return (
    snapshot.markets.find((market) => market.market.ticker === current?.market.ticker) ??
    snapshot.topOpportunities[0] ??
    snapshot.markets[0] ??
    null
  )
}

function toDashboardError(error: unknown): DashboardErrorState {
  if (error instanceof SnapshotLoadError) {
    const normalized = error.message.toLowerCase()

    if (error.status === 400 && normalized.includes("ticker")) {
      return {
        kind: "invalid-ticker",
        title: "Invalid ticker",
        description:
          "The scanner could not resolve that Kalshi event or market ticker.",
        detail: `Try a full event ticker like ${DEFAULT_TICKER}.`,
      }
    }

    if (error.status === 400) {
      return {
        kind: "invalid-input",
        title: "Invalid scan inputs",
        description: error.message,
        detail: "Check bankroll and max-risk formatting before re-running the scan.",
      }
    }

    if (normalized.includes("ticker") || normalized.includes("event")) {
      return {
        kind: "invalid-ticker",
        title: "Ticker not available",
        description: error.message,
        detail: "The requested event may be closed, missing, or mistyped.",
      }
    }

    return {
      kind: "api-failure",
      title: "Live data request failed",
      description: error.message,
      detail: "The dashboard kept the last good snapshot when one was available.",
    }
  }

  return {
    kind: "api-failure",
    title: "Unexpected dashboard error",
    description: "The scanner hit an unexpected failure while building the UI state.",
  }
}

function getMarketState(
  snapshot: AnalysisSnapshot | null,
  filter: MarketFilter,
  visibleCount: number,
) {
  if (!snapshot) {
    return null
  }

  if (snapshot.markets.length === 0) {
    return {
      title: "Missing market data",
      description:
        "The API responded, but no contracts were returned for the requested event.",
      detail: "Try another event ticker or re-run the scan once the market feed updates.",
      tone: "warning" as const,
      icon: AlertTriangle,
    }
  }

  if (visibleCount > 0) {
    return null
  }

  if (filter === "actionable") {
    return {
      title: "No actionable setups",
      description:
        "No contracts currently pass the full edge, liquidity, volatility, and sizing firewall.",
      detail: "This is normal. The dashboard defaults to patience.",
      tone: "neutral" as const,
      icon: Filter,
    }
  }

  return {
    title: "No contracts in this view",
    description:
      "The current filter removed every visible row from the market table.",
    detail: "Switch filters to inspect the rest of the scan.",
    tone: "neutral" as const,
    icon: Filter,
  }
}

function DashboardField({
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

function FilterButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      className="gap-1.5"
      onClick={onClick}
    >
      <Filter className="size-3.5" />
      {label}
    </Button>
  )
}

function NoteCard({
  label,
  body,
}: {
  label: string
  body: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
        {label}
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-300">{body}</p>
    </div>
  )
}

function LoadingDashboard() {
  return (
    <div className="grid gap-4">
      <Card className="border-white/10 bg-[#0b1324]/90">
        <CardContent className="grid gap-3 pt-5 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="animate-pulse rounded-xl border border-white/10 bg-black/20 p-4"
            >
              <div className="h-2 w-20 rounded bg-white/10" />
              <div className="mt-4 h-5 w-32 rounded bg-white/10" />
              <div className="mt-3 h-2 w-full rounded bg-white/10" />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_390px]">
        <Card className="border-white/10 bg-[#0b1324]/90">
          <CardContent className="space-y-3 pt-5">
            {Array.from({ length: 7 }).map((_, index) => (
              <div
                key={index}
                className="animate-pulse rounded-xl border border-white/10 bg-black/20 p-4"
              >
                <div className="h-3 w-28 rounded bg-white/10" />
                <div className="mt-3 h-3 w-full rounded bg-white/10" />
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {Array.from({ length: 2 }).map((_, index) => (
            <Card key={index} className="border-white/10 bg-[#0b1324]/90">
              <CardContent className="space-y-3 pt-5">
                <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
                <div className="h-16 animate-pulse rounded-xl border border-white/10 bg-black/20" />
                <div className="h-16 animate-pulse rounded-xl border border-white/10 bg-black/20" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
