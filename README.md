# Sawner Equities

Sawner Equities is an analysis-only dashboard for Kalshi BTC above/below markets. It scans a Kalshi BTC event, pulls live BTC data, estimates rough above/below probabilities from recent realized volatility, compares those probabilities with market prices, and applies a strict no-trade firewall before surfacing any idea.

The app does **not** place trades, does **not** handle deposits or execution, and is intentionally biased toward **NO TRADE** unless edge, liquidity, spread, volatility, and bankroll sizing rules all pass.

## Stack

- Next.js 16
- TypeScript
- Tailwind CSS v4
- shadcn/ui
- Kalshi public market data API
- Coinbase Exchange public market data API

## Features

- Kalshi market scanner for event tickers such as `KXBTCD-26MAY0809`
- Related contract table with strike, YES/NO bid/ask, last price, volume, open interest, close time, and settlement time
- BTC spot plus recent `1m`, `5m`, `15m`, and `1h` candles
- Realized volatility regime detection with fat-tail warning
- Probability engine using a short-horizon lognormal approximation
- Raw edge, spread-adjusted edge, liquidity-adjusted edge, and confidence score
- No-trade engine with strict rule checks
- Risk firewall with bankroll-aware sizing capped to `1%-2%`
- Local manual trade journal with behavior warnings
- Historical BTC replay support with configurable intervals
- Simulated Kalshi-style contract testing using supplied or synthetic market implied probabilities
- Deterministic backtest engine with drawdown, Sharpe-style, calibration, and regime reporting
- Paper-trading ledger with bankroll tracking and historical replay frames
- Lightweight research UI at `/backtest` and API access at `/api/backtest`

## Project Structure

```text
app/
components/
lib/
  analysis/
  backtest/
  btc/
  journal/
  kalshi/
  risk/
types/
README.md
```

## Getting Started

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Then open `http://127.0.0.1:3000`.

## Example Input

- Kalshi event ticker: `KXBTCD-26MAY0809`
- Starting bankroll: `10000`
- Default risk cap: `0.015`

## Analysis Flow

1. Resolve the provided Kalshi ticker to its parent event.
2. Pull all related BTC above/below markets from Kalshi.
3. Pull live BTC spot and recent Coinbase candles.
4. Compute:
   - distance to strike
   - time to settlement
   - realized volatility over the recent `15`, `30`, and `60` minute windows
   - fair probability of finishing above/below strike
   - implied probabilities from market quotes
   - raw edge, spread-adjusted edge, and liquidity-adjusted edge
   - confidence score and risk-adjusted score
5. Apply the no-trade firewall and bankroll sizing rules.

## Historical Backtesting

The historical module is intentionally separate from live scanning. It supports:

- BTC historical candles normalized into reusable replay datasets
- `1m`, `5m`, `15m`, and `1h` intervals
- Supplied historical contract quotes or synthetic Kalshi-style price generation
- Deterministic YES/NO settlement against historical BTC closes
- Win rate, EV, drawdown, Sharpe-style score, trade frequency, skipped trades, and calibration reports
- Regime analysis across low-volatility, elevated-volatility, trending, sideways, and macro-event windows
- Overfitting warnings for small samples, unrealistic assumptions, heavy parameter sweeps, and unstable regime performance
- Paper-trading mode with bankroll tracking and replay frames

## Core Formulas

- Realized volatility:
  - log returns from recent `1m` BTC closes
  - annualized with `sqrt(minutes per year)`
- Fair probability:
  - `P(S_T > K) = 1 - N( ln(K / S_0) / (sigma * sqrt(T)) )`
- Raw edge:
  - `model probability - actionable ask price`
- Spread-adjusted edge:
  - `raw edge - spread / 2`
- Liquidity-adjusted edge:
  - spread-adjusted edge scaled by a liquidity score

These are deliberately rough screening formulas, not an options-grade pricing model.

## Journal

The trade journal is stored locally in browser storage and supports:

- market ticker
- strike
- side
- entry price
- model probability
- thesis
- result
- mistake tag

The journal also highlights recent loss streaks and repeated discipline issues such as `FOMO`, `chase`, or `ignored model`.

## Running Historical Tests

Start the app:

```bash
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open the demo research page:

```text
http://127.0.0.1:3000/backtest
```

Run a quick synthetic replay on historical BTC candles:

```bash
curl "http://127.0.0.1:3000/api/backtest?hours=72&interval=15m&expiryMinutes=60&bankroll=10000&maxRiskPct=0.015"
```

Run a replay with your own historical contract quotes:

```bash
curl -X POST http://127.0.0.1:3000/api/backtest \
  -H "Content-Type: application/json" \
  -d '{
    "fetch": {
      "start": "2026-05-01T00:00:00Z",
      "end": "2026-05-03T00:00:00Z"
    },
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
  }'
```

If you omit `contracts`, POST can also generate synthetic Kalshi-style prices by setting:

```json
{
  "synthetic": true
}
```

That mode is useful for framework validation, but the warnings will explicitly mark it as non-production evidence.

## Backtest Assumptions

- Settlement uses the first candle close at or after expiry.
- YES wins only when BTC finishes strictly above the strike; NO includes equal-or-below outcomes.
- Open positions are marked at cost basis until settlement unless you change that behavior in config.
- No execution slippage is modeled beyond the quoted spread and fixed per-trade cost.
- Synthetic contract generation is deterministic and reproducible, but it is not a substitute for historical Kalshi quote archives.

## Known Limitations

- Coinbase candles are a proxy for settlement and do not reproduce tick-level index prints.
- Historical Kalshi order book data is not bundled in the repo; true edge validation requires you to supply historical contract quotes.
- Sharpe-style output is trade-based, not a full mark-to-market portfolio Sharpe.
- Synthetic price generation is deliberately conservative in labeling and warnings, but it can still understate real friction.
- Macro-event analysis is only as good as the event windows you provide.

## Important Disclaimers

- Analysis only. No trading execution is implemented.
- This app is educational software, not investment advice.
- Short-horizon probability estimates can be very wrong during regime shifts.
- Wide spreads and thin liquidity are common in prediction markets.
- Capital preservation takes priority over constant action.
