import { buildDemoBacktestReport } from "@/lib/backtest"
import {
  formatCurrency,
  formatProbability,
  formatTimestamp,
  signedCurrency,
} from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export default function BacktestPage() {
  const report = buildDemoBacktestReport()
  const equityPath = buildLinePath(report.equityCurve.map((point) => point.equity))
  const drawdownPath = buildLinePath(
    report.drawdownCurve.map((point) => Math.abs(point.drawdown)),
  )

  return (
    <main className="min-h-screen bg-[#07111f] px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-white/10 bg-white/[0.03]">
            <CardHeader className="gap-4">
              <div className="flex flex-wrap gap-3">
                <Badge className="border-cyan-400/25 bg-cyan-400/10 text-cyan-100">
                  Backtest Research
                </Badge>
                <Badge className="border-amber-500/25 bg-amber-500/10 text-amber-100">
                  Statistical Honesty First
                </Badge>
              </div>
              <div className="space-y-2">
                <CardTitle className="text-3xl text-white">
                  Historical Replay Infrastructure
                </CardTitle>
                <CardDescription className="max-w-3xl text-base leading-7 text-slate-300">
                  Deterministic replay for BTC-linked Kalshi-style contracts. The
                  demo below uses synthetic contract prices on a synthetic BTC path
                  so the full reporting stack can be inspected without touching
                  execution code or the live dashboard.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <StatCard
                label="Trades"
                value={String(report.summary.tradeCount)}
                detail={`${report.summary.skippedTradeCount} skipped`}
              />
              <StatCard
                label="Win Rate"
                value={formatProbability(report.summary.winRate)}
                detail={`Sharpe-style ${formatDecimal(report.summary.sharpeLike)}`}
              />
              <StatCard
                label="Net PnL"
                value={signedCurrency(report.summary.netPnl)}
                detail={`Drawdown ${formatCurrency(report.summary.maxDrawdown)}`}
              />
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.03]">
            <CardHeader>
              <CardTitle>Run It</CardTitle>
              <CardDescription>
                Use the API for quick synthetic replays or POST real historical
                contract quotes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-300">
              <CodeBlock
                code={`curl "http://127.0.0.1:3000/api/backtest?hours=72&interval=15m&expiryMinutes=60&bankroll=10000&maxRiskPct=0.015"`}
              />
              <CodeBlock
                code={`curl -X POST http://127.0.0.1:3000/api/backtest \\
  -H "Content-Type: application/json" \\
  -d '{
    "fetch": { "start": "2026-05-01T00:00:00Z", "end": "2026-05-03T00:00:00Z" },
    "contracts": [
      {
        "id": "hist-1",
        "listedTime": "2026-05-01T12:00:00Z",
        "expiryTime": "2026-05-01T13:00:00Z",
        "strikePrice": 64000,
        "marketImpliedProbability": 0.54,
        "source": "historical-market"
      }
    ]
  }'`}
              />
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Expected Value"
            value={formatCurrency(report.summary.expectedValue)}
            detail="Average realized PnL per settled trade."
          />
          <StatCard
            label="Trade Frequency"
            value={formatDecimal(report.summary.tradeFrequencyPerDay)}
            detail="Settled trades per day across the replay window."
          />
          <StatCard
            label="Calibration"
            value={formatDecimal(report.calibration.brierScore)}
            detail={`${report.calibration.sampleCount} evaluated opportunities.`}
          />
          <StatCard
            label="Bankroll Return"
            value={formatProbability(report.summary.bankrollReturnPct)}
            detail={`${formatCurrency(report.summary.bankrollStart)} to ${formatCurrency(report.summary.bankrollEnd)}`}
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <CurveCard
            title="Equity Curve"
            description="Cash plus cost-basis marking on open positions."
            color="#38bdf8"
            path={equityPath}
          />
          <CurveCard
            title="Drawdown Curve"
            description="Absolute drawdown from running equity peak."
            color="#fb7185"
            path={drawdownPath}
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <Card className="border-white/10 bg-white/[0.03]">
            <CardHeader>
              <CardTitle>Warnings</CardTitle>
              <CardDescription>
                Overfitting and realism checks.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {report.warnings.map((warning) => (
                <div
                  key={`${warning.code}-${warning.level}`}
                  className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-50"
                >
                  <div className="font-medium uppercase tracking-[0.16em] text-amber-200">
                    {warning.level}
                  </div>
                  <div className="mt-1">{warning.message}</div>
                </div>
              ))}
              {report.assumptions.map((assumption) => (
                <div
                  key={assumption}
                  className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-slate-300"
                >
                  {assumption}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.03]">
            <CardHeader>
              <CardTitle>Regime Comparison</CardTitle>
              <CardDescription>
                Low-volatility, elevated-volatility, trending, sideways, and
                macro-event slices.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10">
                    <TableHead>Regime</TableHead>
                    <TableHead>Trades</TableHead>
                    <TableHead>Win Rate</TableHead>
                    <TableHead>EV</TableHead>
                    <TableHead>Net PnL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.regimeAnalysis.map((regime) => (
                    <TableRow key={regime.regime} className="border-white/10">
                      <TableCell>{regime.regime}</TableCell>
                      <TableCell>{regime.tradeCount}</TableCell>
                      <TableCell>{formatProbability(regime.winRate)}</TableCell>
                      <TableCell>{formatCurrency(regime.expectedValue)}</TableCell>
                      <TableCell>{signedCurrency(regime.netPnl)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <Card className="border-white/10 bg-white/[0.03]">
            <CardHeader>
              <CardTitle>Calibration Bins</CardTitle>
              <CardDescription>
                Predicted probability versus realized frequency.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10">
                    <TableHead>Bin</TableHead>
                    <TableHead>Count</TableHead>
                    <TableHead>Predicted</TableHead>
                    <TableHead>Actual</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.calibration.bins.map((bin) => (
                    <TableRow key={bin.label} className="border-white/10">
                      <TableCell>{bin.label}</TableCell>
                      <TableCell>{bin.count}</TableCell>
                      <TableCell>{formatProbability(bin.predictedProbability)}</TableCell>
                      <TableCell>{formatProbability(bin.actualFrequency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.03]">
            <CardHeader>
              <CardTitle>Recent Trade Log</CardTitle>
              <CardDescription>
                Settled trades from the replay ledger.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10">
                    <TableHead>Entry</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead>Edge</TableHead>
                    <TableHead>PnL</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.tradeLog.slice(-12).reverse().map((trade) => (
                    <TableRow key={`${trade.contractId}-${trade.settledTime}`} className="border-white/10">
                      <TableCell>{formatTimestamp(trade.entryTime)}</TableCell>
                      <TableCell>{trade.side}</TableCell>
                      <TableCell>{formatProbability(trade.edge)}</TableCell>
                      <TableCell>{signedCurrency(trade.pnl)}</TableCell>
                      <TableCell>{trade.result}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  )
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-sm text-slate-400">{detail}</div>
    </div>
  )
}

function CurveCard({
  title,
  description,
  color,
  path,
}: {
  title: string
  description: string
  color: string
  path: string
}) {
  return (
    <Card className="border-white/10 bg-white/[0.03]">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <svg viewBox="0 0 640 220" className="h-56 w-full">
            <rect x="0" y="0" width="640" height="220" fill="transparent" />
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </CardContent>
    </Card>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/30 p-4 text-xs leading-6 text-slate-200">
      <code>{code}</code>
    </pre>
  )
}

function buildLinePath(values: number[]) {
  if (values.length === 0) {
    return "M 0 110 L 640 110"
  }

  const width = 640
  const height = 220
  const padding = 12
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  return values
    .map((value, index) => {
      const x =
        values.length === 1
          ? width / 2
          : (index / (values.length - 1)) * (width - padding * 2) + padding
      const y =
        height -
        padding -
        ((value - min) / range) * (height - padding * 2)
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(" ")
}

function formatDecimal(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a"
  }

  return value.toFixed(digits)
}
