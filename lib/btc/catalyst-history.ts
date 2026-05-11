"use client"

import type {
  BtcEventCategory,
  BtcEventSentiment,
  BtcScoredMarketEvent,
} from "@/lib/sentiment/eventScoring"

const STORAGE_KEY = "sawner-equities-btc-catalyst-history"
const MAX_ENTRIES = 180

export interface BtcCatalystHistoryEntry {
  id: string
  source: string
  title: string
  text: string
  url: string | null
  timestampMs: number
  sentiment: BtcEventSentiment
  urgency: number
  marketMovingScore: number
  category: BtcEventCategory
  credibilityScore: number
  matchedKeywords: string[]
  explanation: string
}

export interface BtcCatalystExportRow {
  timestamp: string
  source: string
  title: string
  text: string
  url: string | null
  sentiment: BtcEventSentiment
  urgency: number
  marketMovingScore: number
  category: BtcEventCategory
  credibilityScore: number
  matchedKeywords: string
  explanation: string
}

export function readBtcCatalystEntries(): BtcCatalystHistoryEntry[] {
  if (typeof window === "undefined") {
    return []
  }

  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as BtcCatalystHistoryEntry[]
    return Array.isArray(parsed)
      ? parsed.sort((left, right) => right.timestampMs - left.timestampMs)
      : []
  } catch {
    return []
  }
}

export function writeBtcCatalystEntries(entries: BtcCatalystHistoryEntry[]) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(entries.slice(0, MAX_ENTRIES)),
  )
}

export function clearBtcCatalystEntries() {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.removeItem(STORAGE_KEY)
}

export function appendBtcCatalystEvents(
  currentEntries: BtcCatalystHistoryEntry[],
  events: BtcScoredMarketEvent[],
) {
  const nextEntries = [
    ...events.map(buildCatalystEntry),
    ...currentEntries,
  ]

  const deduped = dedupeCatalystEntries(nextEntries)
  const sorted = deduped.sort((left, right) => right.timestampMs - left.timestampMs)
  const bounded = sorted.slice(0, MAX_ENTRIES)
  writeBtcCatalystEntries(bounded)
  return bounded
}

export function catalystEntriesToExportRows(
  entries: BtcCatalystHistoryEntry[],
): BtcCatalystExportRow[] {
  return entries.map((entry) => ({
    timestamp: new Date(entry.timestampMs).toISOString(),
    source: entry.source,
    title: entry.title,
    text: entry.text,
    url: entry.url,
    sentiment: entry.sentiment,
    urgency: entry.urgency,
    marketMovingScore: entry.marketMovingScore,
    category: entry.category,
    credibilityScore: entry.credibilityScore,
    matchedKeywords: entry.matchedKeywords.join(" | "),
    explanation: entry.explanation,
  }))
}

export function exportBtcCatalystHistoryAsJson(entries: BtcCatalystHistoryEntry[]) {
  return JSON.stringify(catalystEntriesToExportRows(entries), null, 2)
}

export function exportBtcCatalystHistoryAsCsv(entries: BtcCatalystHistoryEntry[]) {
  const rows = catalystEntriesToExportRows(entries)
  const headers: Array<keyof BtcCatalystExportRow> = [
    "timestamp",
    "source",
    "title",
    "text",
    "url",
    "sentiment",
    "urgency",
    "marketMovingScore",
    "category",
    "credibilityScore",
    "matchedKeywords",
    "explanation",
  ]

  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => escapeCsvCell(formatExportValue(row[header])))
        .join(","),
    ),
  ]

  return lines.join("\n")
}

function buildCatalystEntry(event: BtcScoredMarketEvent): BtcCatalystHistoryEntry {
  return {
    id: event.id,
    source: event.source,
    title: event.title,
    text: event.text,
    url: event.url,
    timestampMs: resolveEventTimestampMs(event),
    sentiment: event.sentiment,
    urgency: event.urgency,
    marketMovingScore: event.marketMovingScore,
    category: event.category,
    credibilityScore: event.credibilityScore,
    matchedKeywords: event.matchedKeywords,
    explanation: event.explanation,
  }
}

function resolveEventTimestampMs(event: BtcScoredMarketEvent) {
  const publishedAtMs = Date.parse(event.publishedAt)
  if (Number.isFinite(publishedAtMs)) {
    return publishedAtMs
  }

  const fetchedAtMs = Date.parse(event.fetchedAt)
  return Number.isFinite(fetchedAtMs) ? fetchedAtMs : Date.now()
}

function dedupeCatalystEntries(entries: BtcCatalystHistoryEntry[]) {
  const seen = new Set<string>()
  const deduped: BtcCatalystHistoryEntry[] = []

  for (const entry of entries) {
    if (seen.has(entry.id)) {
      continue
    }

    seen.add(entry.id)
    deduped.push(entry)
  }

  return deduped
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
