import type { SocialPost, SocialSourceStatus } from "@/lib/social/types"

export interface FetchTruthSocialPostsResult extends SocialSourceStatus {
  posts: SocialPost[]
  source: "truth_social"
}

export async function fetchTruthSocialPosts(options?: {
  limit?: number
  keywords?: readonly string[]
}): Promise<FetchTruthSocialPostsResult> {
  const feedUrl = process.env.TRUTH_SOCIAL_FEED_URL?.trim()
  if (!feedUrl) {
    return {
      source: "truth_social",
      enabled: false,
      warning:
        "TRUTH_SOCIAL_FEED_URL is not configured. Truth Social ingestion is disabled unless a manual or third-party feed is provided.",
      itemCount: 0,
      posts: [],
    }
  }

  const limit = clampLimit(options?.limit ?? 5, 1, 5)
  const keywords = options?.keywords?.length ? [...options.keywords] : []
  const fetchedAt = new Date().toISOString()

  try {
    const response = await fetch(feedUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "SawnerEquities/1.0",
      },
    })

    if (!response.ok) {
      return {
        source: "truth_social",
        enabled: true,
        warning: `Truth Social feed request failed (${response.status}).`,
        itemCount: 0,
        posts: [],
      }
    }

    const payload = (await response.json()) as unknown
    const records = normalizeTruthSocialPayload(payload)
      .slice(0, limit)
      .map((record, index) => {
        const text = `${record.text ?? record.summary ?? ""}`.trim()
        const matchedKeywords = matchKeywords(text, keywords)
        return {
          id: record.id ?? `truth-${index}`,
          source: "truth_social",
          author: record.author ?? record.account ?? "Truth Social feed",
          text,
          url: record.url ?? null,
          createdAt: normalizeIso(record.createdAt ?? record.created_at ?? record.publishedAt) ?? fetchedAt,
          fetchedAt,
          engagementMetrics: {
            likes: toNumber(record.likes ?? record.like_count ?? null),
            reposts: toNumber(record.reposts ?? record.repost_count ?? record.shares ?? null),
            replies: toNumber(record.replies ?? record.reply_count ?? null),
            views: toNumber(record.views ?? record.view_count ?? null),
            bookmarks: null,
          },
          matchedKeywords,
          credibilityScore: calculateTruthCredibility(record),
        } satisfies SocialPost
      })

    return {
      source: "truth_social",
      enabled: true,
      warning: records.length === 0 ? "No parseable Truth Social records were returned by the configured feed." : null,
      itemCount: records.length,
      posts: records,
    }
  } catch (error) {
    return {
      source: "truth_social",
      enabled: true,
      warning: error instanceof Error ? error.message : "Unable to fetch Truth Social feed.",
      itemCount: 0,
      posts: [],
    }
  }
}

function normalizeTruthSocialPayload(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload as TruthSocialRecord[]
  }

  if (payload && typeof payload === "object") {
    const record = payload as { posts?: unknown; data?: unknown; items?: unknown }
    if (Array.isArray(record.posts)) {
      return record.posts as TruthSocialRecord[]
    }
    if (Array.isArray(record.data)) {
      return record.data as TruthSocialRecord[]
    }
    if (Array.isArray(record.items)) {
      return record.items as TruthSocialRecord[]
    }
  }

  return []
}

function calculateTruthCredibility(record: TruthSocialRecord) {
  const base = record.verified === true ? 62 : 38
  const contentLift = record.text?.length && record.text.length > 60 ? 8 : 0
  const keywordLift = record.text && /(btc|bitcoin|crypto|etf|sec|fed|rates|inflation)/i.test(record.text) ? 6 : 0
  return Math.round(clampLimit(base + contentLift + keywordLift, 20, 80))
}

function matchKeywords(text: string, keywords: readonly string[]) {
  const haystack = text.toLowerCase()
  return keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()))
}

function normalizeIso(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function clampLimit(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

interface TruthSocialRecord {
  id?: string
  author?: string
  account?: string
  text?: string
  summary?: string
  url?: string
  createdAt?: string
  created_at?: string
  publishedAt?: string
  likes?: number
  like_count?: number
  reposts?: number
  repost_count?: number
  shares?: number
  replies?: number
  reply_count?: number
  views?: number
  view_count?: number
  verified?: boolean
}
