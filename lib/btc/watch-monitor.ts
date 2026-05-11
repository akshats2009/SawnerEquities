"use client"

import type { BtcDirectionBias } from "@/lib/analysis/priceDecision"
import type { BtcMarketStateSnapshot } from "@/lib/analysis/marketState"
import type { BtcMarketRegimeSnapshot } from "@/lib/analysis/regimeDetection"
import type { BtcFalseBreakoutSnapshot } from "@/lib/analysis/falseBreakout"
import type { BtcSignalSuppressionSnapshot } from "@/lib/analysis/signalSuppression"
import type { BtcMarketQualitySnapshot } from "@/lib/analysis/priceDecision"

export interface BtcMarketWatchEntry {
  id: string
  timestampMs: number
  price: number
  directionReadout: string
  confidence: number
  marketState: BtcMarketStateSnapshot
  marketQuality: BtcMarketQualitySnapshot
  riskState: string
  observationWindow: string
  suppressionLevel: BtcSignalSuppressionSnapshot["level"]
  regime: BtcMarketRegimeSnapshot
  falseBreakout: BtcFalseBreakoutSnapshot
  topReason: string
  whatToWatchNext: string
  activeExchangeCount: number
  totalExchangeCount: number
  isStale: boolean
  latencyMs: number | null
  directionBias: BtcDirectionBias
}

const STORAGE_KEY = "sawner-equities-btc-watch-log"
const MAX_ENTRIES = 240

export function readBtcWatchEntries(): BtcMarketWatchEntry[] {
  if (typeof window === "undefined") {
    return []
  }

  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as BtcMarketWatchEntry[]
    return Array.isArray(parsed)
      ? parsed.sort((left, right) => right.timestampMs - left.timestampMs)
      : []
  } catch {
    return []
  }
}

export function writeBtcWatchEntries(entries: BtcMarketWatchEntry[]) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
}

export function clearBtcWatchEntries() {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.removeItem(STORAGE_KEY)
}

export function appendBtcWatchEntry(entry: BtcMarketWatchEntry) {
  const current = readBtcWatchEntries()
  const next = [entry, ...current.filter((item) => item.id !== entry.id)]
  writeBtcWatchEntries(next)
  return next.slice(0, MAX_ENTRIES)
}
