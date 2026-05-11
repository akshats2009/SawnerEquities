export type NewsSourceId = "cryptopanic" | "newsapi" | "manual" | "unknown"

export interface NewsItem {
  id: string
  source: NewsSourceId
  title: string
  summary: string
  url: string | null
  publishedAt: string
  fetchedAt: string
  matchedKeywords: string[]
  credibilityScore: number
}

export interface NewsSourceStatus {
  enabled: boolean
  warning: string | null
  itemCount: number
}
