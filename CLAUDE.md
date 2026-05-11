@AGENTS.md

# Sawner Equities

## Project Purpose

Sawner Equities is a real-time BTC market-state intelligence terminal.

The goal is NOT:
- betting UI
- broker integration
- trade execution
- financial advice

The goal IS:
- real-time BTC market interpretation
- 15m / 30m / 1h directional outlooks
- market-state analysis
- suppression of low-quality signals
- regime detection
- false-breakout intelligence
- multi-exchange confirmation
- social/news catalyst awareness
- research and forecasting

---

# Core Architecture

Data Sources
→ Multi-Exchange Feed Layer
→ Collector / Persistence Layer
→ Datastore Modules
→ Analysis Modules
→ Forecast Modules
→ Decision-First Dashboard

---

# Current Major Systems

## Multi-Exchange BTC Feed
Sources: Coinbase, Kraken, Bitstamp

Features:
- normalized tick structure
- exchange agreement scoring
- stale feed detection
- consolidated BTC price
- rolling buffers

Files:
- hooks/useMultiExchangeBtc.ts
- lib/btc/multiExchangeRealtime.ts

---

## Analysis Systems

### Regime Detection
Detects: trending up/down, mean reversion, volatility expansion/compression, chop/noise, breakout/exhaustion
Files: lib/analysis/regimeDetection.ts

### Signal Suppression
Levels: none → caution → suppress directional bias → unavailable
Files: lib/analysis/signalSuppression.ts

### False Breakout Intelligence
Detects: breakout attempts, exhaustion, weak follow-through, fakeouts
Files: lib/analysis/falseBreakout.ts

### Market State
Computes: information quality, liquidity quality, exchange consensus, adverse-selection risk, interpretability
Files: lib/analysis/marketState.ts

### Forward Forecasting
Horizons: 15m / 30m / 1h
Files: lib/analysis/horizonForecast.ts

---

# Social / News Intelligence

Sources: X.com API, CryptoPanic, NewsAPI, optional Truth Social

Features: catalyst scoring, urgency, credibility, event pressure, market-moving likelihood

Files: lib/social/*, lib/news/*, lib/sentiment/*

---

# Journal / Research Systems

Features: local BTC decision journal, outcome tracking, confidence calibration, reliability diagnostics, catalyst history, export to CSV/JSON

Files: lib/btc/*, lib/journal/*, components/dashboard/ConfidenceReliabilityPanel.tsx

---

# UI Philosophy

Decision-first interface. Primary view shows:
- BTC price
- directional outlook
- confidence
- risk state
- market state
- observation window
- top reason
- what to watch next

Advanced diagnostics collapsed by default. Avoid clutter.

---

# Constraints

Do NOT:
- add betting language
- add broker integration
- add execution logic
- add fake data
- redesign architecture unnecessarily

Prefer:
- small targeted edits
- preserving existing systems
- concise UI
- analytics/research framing

---

# Development Rules

Before coding:
1. Inspect only relevant files
2. Avoid rescanning entire repo
3. Touch as few files as possible

Validation:
- npm run lint
- npx tsc --noEmit

Avoid full builds unless necessary.

---

# Critical Rule

Do not redesign or rewrite existing architecture unless explicitly requested.

Prefer:
- incremental improvements
- preserving interfaces
- minimal diffs
- targeted fixes
