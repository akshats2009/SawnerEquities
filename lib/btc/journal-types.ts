import type { BtcDecisionExplanation, BtcDirectionBias, BtcObservationWindow } from "@/lib/analysis/priceDecision"
import type { BtcMarketQualitySnapshot } from "@/lib/analysis/priceDecision"
import type { BtcMarketStateSnapshot } from "@/lib/analysis/marketState"
import type { BtcFalseBreakoutSnapshot } from "@/lib/analysis/falseBreakout"
import type { BtcMarketRegimeSnapshot } from "@/lib/analysis/regimeDetection"
import type { BtcHorizonForecastSnapshot } from "@/lib/analysis/horizonForecast"
import type { BtcSignalSuppressionSnapshot } from "@/lib/analysis/signalSuppression"
import type { BtcSocialNewsSnapshot } from "@/lib/sentiment/eventScoring"
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
  isLive: boolean
}

export interface BtcJournalSnapshot {
  id: string
  timestampMs: number
  startingPrice: number
  bias: BtcDirectionBias
  marketQuality?: BtcMarketQualitySnapshot | null
  marketState?: BtcMarketStateSnapshot | null
  marketRegime?: BtcMarketRegimeSnapshot | null
  falseBreakout?: BtcFalseBreakoutSnapshot | null
  signalSuppression?: BtcSignalSuppressionSnapshot | null
  horizonForecast?: BtcHorizonForecastSnapshot | null
  socialNews?: BtcSocialNewsSnapshot | null
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
