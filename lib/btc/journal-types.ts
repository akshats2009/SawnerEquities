import type { BtcDecisionExplanation, BtcDirectionBias, BtcObservationWindow } from "@/lib/analysis/priceDecision"
import type { MistakeTag } from "@/types"

export type BtcJournalWindow = "1m" | "5m" | "15m" | "1h"
export type BtcJournalOutcomeStatus = "pending" | "correct" | "incorrect"

export interface BtcJournalOutcome {
  window: BtcJournalWindow
  targetAtMs: number
  priceChange: number
  percentChange: number
  directionallyCorrect: boolean | null
  resolved: boolean
  status: BtcJournalOutcomeStatus
}

export interface BtcJournalSnapshot {
  id: string
  timestampMs: number
  startingPrice: number
  bias: BtcDirectionBias
  confidence: number
  observationWindow: BtcObservationWindow
  sourceTickMs: number | null
  explanation: BtcDecisionExplanation
  mistakeTag?: MistakeTag | null
}

export interface BtcJournalRow extends BtcJournalSnapshot {
  outcomes: Record<BtcJournalWindow, BtcJournalOutcome>
}

export interface BtcJournalExportRow {
  timestamp: string
  entryBtcPrice: number | null
  exitBtcPrice: number | null
  directionBias: BtcDirectionBias
  confidence: number
  observationWindow: BtcObservationWindow
  result: BtcJournalOutcomeStatus
  percentChange: number | null
  primaryReason: string
  supportingSignals: string
  conflictingSignals: string
  mistakeTag: MistakeTag | null
}
