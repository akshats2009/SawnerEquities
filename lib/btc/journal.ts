"use client"

import {
  type BtcJournalExportRow,
  type BtcJournalRow,
} from "@/lib/btc/journal-types"

const STORAGE_KEY = "sawner-equities-btc-journal"

export function readBtcJournalEntries(): BtcJournalRow[] {
  if (typeof window === "undefined") {
    return []
  }

  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as BtcJournalRow[]
    return Array.isArray(parsed)
      ? parsed.sort((left, right) => right.timestampMs - left.timestampMs)
      : []
  } catch {
    return []
  }
}

export function writeBtcJournalEntries(entries: BtcJournalRow[]) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

export function clearBtcJournalEntries() {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.removeItem(STORAGE_KEY)
}

export function appendBtcJournalEntry(entry: BtcJournalRow) {
  const current = readBtcJournalEntries()
  const next = [entry, ...current.filter((item) => item.id !== entry.id)]
  writeBtcJournalEntries(next)
  return next
}

export function journalRowsToExportRows(rows: BtcJournalRow[]): BtcJournalExportRow[] {
  return rows.map((row) => {
    const outcome = row.outcomes[row.observationWindow] ?? null
    const resolved = outcome?.resolved ?? false
    const result = outcome
      ? outcome.status
      : "pending"

    return {
      timestamp: new Date(row.timestampMs).toISOString(),
      entryBtcPrice: row.startingPrice,
      exitBtcPrice:
        outcome && resolved ? row.startingPrice + outcome.priceChange : null,
      directionBias: row.bias,
      confidence: row.confidence,
      observationWindow: row.observationWindow,
      result,
      percentChange: outcome ? outcome.percentChange : null,
      primaryReason: row.explanation.primaryReason,
      supportingSignals: row.explanation.supportingSignals.join(" | "),
      conflictingSignals: row.explanation.conflictingSignals.join(" | "),
      mistakeTag: row.mistakeTag ?? null,
    }
  })
}

export function exportBtcJournalAsJson(rows: BtcJournalRow[]) {
  return JSON.stringify(journalRowsToExportRows(rows), null, 2)
}

export function exportBtcJournalAsCsv(rows: BtcJournalRow[]) {
  const records = journalRowsToExportRows(rows)
  const headers: Array<keyof BtcJournalExportRow> = [
    "timestamp",
    "entryBtcPrice",
    "exitBtcPrice",
    "directionBias",
    "confidence",
    "observationWindow",
    "result",
    "percentChange",
    "primaryReason",
    "supportingSignals",
    "conflictingSignals",
    "mistakeTag",
  ]

  const lines = [
    headers.join(","),
    ...records.map((record) =>
      headers
        .map((header) => escapeCsvCell(formatExportValue(record[header])))
        .join(","),
    ),
  ]

  return lines.join("\n")
}

function formatExportValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return ""
  }

  return typeof value === "number" ? value.toString() : value
}

function escapeCsvCell(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`
  }

  return value
}
