import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
})

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function formatCurrency(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a"
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function formatProbability(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a"
  }

  return `${(value * 100).toFixed(digits)}%`
}

export function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a"
  }

  return `${value.toFixed(digits)}%`
}

export function formatEdge(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a"
  }

  const points = value * 100
  return `${points >= 0 ? "+" : ""}${points.toFixed(digits)} pts`
}

export function formatCompactNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a"
  }

  return compactFormatter.format(value)
}

export function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "n/a"
  }

  return timeFormatter.format(new Date(value))
}

export function shortMarketTicker(ticker: string) {
  return ticker.includes("-T") ? ticker.split("-T").at(-1) ?? ticker : ticker
}

export function signedCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a"
  }

  const prefix = value >= 0 ? "+" : "-"
  return `${prefix}${currencyFormatter.format(Math.abs(value))}`
}
