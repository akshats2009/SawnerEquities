export type SocialSourceId = "x" | "truth_social" | "manual" | "unknown"

export interface SocialEngagementMetrics {
  likes: number | null
  reposts: number | null
  replies: number | null
  views: number | null
  bookmarks: number | null
}

export interface SocialPost {
  id: string
  source: SocialSourceId
  author: string
  text: string
  url: string | null
  createdAt: string
  fetchedAt: string
  engagementMetrics: SocialEngagementMetrics
  matchedKeywords: string[]
  credibilityScore: number
}

export interface SocialSourceStatus {
  enabled: boolean
  warning: string | null
  itemCount: number
}
