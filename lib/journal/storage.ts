"use client"

import { JournalBehaviorSummary, JournalEntry } from "@/types"

const STORAGE_KEY = "sawner-equities-journal"

export function readJournalEntries() {
  if (typeof window === "undefined") {
    return [] as JournalEntry[]
  }

  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return [] as JournalEntry[]
  }

  try {
    const parsed = JSON.parse(raw) as JournalEntry[]
    return Array.isArray(parsed)
      ? parsed.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      : []
  } catch {
    return []
  }
}

export function writeJournalEntries(entries: JournalEntry[]) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

export function appendJournalEntry(entry: JournalEntry) {
  const nextEntries = [entry, ...readJournalEntries()]
  writeJournalEntries(nextEntries)
  return nextEntries
}

export function summarizeJournalBehavior(entries: JournalEntry[]): JournalBehaviorSummary {
  const recent = entries.slice(0, 5)
  let recentLossStreak = 0
  for (const entry of recent) {
    if (entry.result === "loss") {
      recentLossStreak += 1
      continue
    }
    break
  }

  const recentDisciplineHits = recent.filter((entry) =>
    ["FOMO", "chase", "bad sizing", "ignored model"].includes(entry.mistakeTag),
  ).length

  const warnings: string[] = []
  if (recentLossStreak >= 2) {
    warnings.push("Revenge-trade behavior risk: multiple recent losses logged.")
  }
  if (recentDisciplineHits >= 2) {
    warnings.push("Discipline warning: recent journal tags show repeated rule breaks.")
  }

  return {
    warnings,
    recentLossStreak,
    recentDisciplineHits,
  }
}
