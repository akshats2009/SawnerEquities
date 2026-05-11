import type { SocialPost, SocialSourceStatus } from "@/lib/social/types"

export const BTC_SOCIAL_KEYWORDS = [
  "BTC",
  "Bitcoin",
  "crypto",
  "ETF",
  "Fed",
  "inflation",
  "CPI",
  "rates",
  "Trump",
  "Treasury",
  "SEC",
  "Binance",
  "Coinbase",
] as const

export interface FetchXSocialPostsResult extends SocialSourceStatus {
  posts: SocialPost[]
  source: "x"
}

export async function fetchXSocialPosts(options?: {
  limit?: number
  keywords?: readonly string[]
}): Promise<FetchXSocialPostsResult> {
  const bearerToken = process.env.X_BEARER_TOKEN?.trim()
  if (!bearerToken) {
    return {
      source: "x",
      enabled: false,
      warning: "X_BEARER_TOKEN is not configured.",
      itemCount: 0,
      posts: [],
    }
  }

  const limit = clampLimit(options?.limit ?? 10, 1, 10)
  const keywords = options?.keywords?.length ? [...options.keywords] : [...BTC_SOCIAL_KEYWORDS]
  const query = buildRecentSearchQuery(keywords)
  const fetchedAt = new Date().toISOString()

  try {
    const url = new URL("https://api.x.com/2/tweets/search/recent")
    url.searchParams.set("query", query)
    url.searchParams.set("max_results", String(limit))
    url.searchParams.set(
      "tweet.fields",
      "created_at,public_metrics,author_id,lang,entities",
    )
    url.searchParams.set("expansions", "author_id")
    url.searchParams.set(
      "user.fields",
      "name,username,verified,public_metrics",
    )

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "User-Agent": "SawnerEquities/1.0",
      },
    })

    if (!response.ok) {
      return {
        source: "x",
        enabled: true,
        warning: `X API request failed (${response.status}).`,
        itemCount: 0,
        posts: [],
      }
    }

    const payload = (await response.json()) as XRecentSearchResponse
    const users = new Map(
      (payload.includes?.users ?? []).map((user) => [user.id, user]),
    )
    const posts = (payload.data ?? []).map((tweet) => {
      const user = users.get(tweet.author_id)
      const text = tweet.text?.trim() ?? ""
      const matchedKeywords = matchKeywords(text, keywords)
      const credibilityScore = calculateXCredibility({
        user,
        text,
        matchedKeywords,
        metrics: tweet.public_metrics ?? null,
      })

      return {
        id: tweet.id,
        source: "x",
        author: user?.username ? `@${user.username}` : user?.name ?? "X user",
        text,
        url: `https://x.com/i/web/status/${tweet.id}`,
        createdAt: normalizeIso(tweet.created_at) ?? fetchedAt,
        fetchedAt,
        engagementMetrics: {
          likes: tweet.public_metrics?.like_count ?? null,
          reposts: tweet.public_metrics?.retweet_count ?? null,
          replies: tweet.public_metrics?.reply_count ?? null,
          views: tweet.public_metrics?.impression_count ?? null,
          bookmarks: tweet.public_metrics?.bookmark_count ?? null,
        },
        matchedKeywords,
        credibilityScore,
      } satisfies SocialPost
    })

    return {
      source: "x",
      enabled: true,
      warning: null,
      itemCount: posts.length,
      posts,
    }
  } catch (error) {
    return {
      source: "x",
      enabled: true,
      warning: error instanceof Error ? error.message : "Unable to fetch X social posts.",
      itemCount: 0,
      posts: [],
    }
  }
}

function buildRecentSearchQuery(keywords: readonly string[]) {
  const terms = keywords.map((keyword) => quoteKeyword(keyword)).join(" OR ")
  return `(${terms}) lang:en -is:retweet`
}

function quoteKeyword(keyword: string) {
  if (/^[A-Za-z0-9_]+$/.test(keyword)) {
    return keyword
  }

  return `"${keyword.replaceAll('"', '\\"')}"`
}

function matchKeywords(text: string, keywords: readonly string[]) {
  const haystack = text.toLowerCase()
  return keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()))
}

function calculateXCredibility({
  user,
  text,
  matchedKeywords,
  metrics,
}: {
  user: XUser | undefined
  text: string
  matchedKeywords: string[]
  metrics: XPublicMetrics | null
}) {
  const base = user?.verified ? 74 : 58
  const followerLift = user?.public_metrics?.followers_count
    ? clampLimit(Math.log10(Math.max(user.public_metrics.followers_count, 1)) * 10 + 12, 0, 20)
    : 0
  const engagementLift =
    metrics?.like_count || metrics?.retweet_count || metrics?.reply_count
      ? clampLimit(
          Math.log10(
            Math.max(
              (metrics?.like_count ?? 0) +
                (metrics?.retweet_count ?? 0) +
                (metrics?.reply_count ?? 0),
              1,
            ),
          ) * 6,
          0,
          12,
        )
      : 0
  const keywordLift = matchedKeywords.length > 0 ? 8 : 0
  const lengthPenalty = text.length < 40 ? 8 : 0
  return Math.round(clampLimit(base + followerLift + engagementLift + keywordLift - lengthPenalty, 25, 95))
}

function normalizeIso(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function clampLimit(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

interface XRecentSearchResponse {
  data?: Array<{
    id: string
    text: string
    author_id: string
    created_at: string
    public_metrics?: XPublicMetrics
  }>
  includes?: {
    users?: XUser[]
  }
}

interface XUser {
  id: string
  name?: string
  username?: string
  verified?: boolean
  public_metrics?: {
    followers_count?: number
    following_count?: number
    tweet_count?: number
    listed_count?: number
  }
}

interface XPublicMetrics {
  like_count?: number
  retweet_count?: number
  reply_count?: number
  quote_count?: number
  bookmark_count?: number
  impression_count?: number
}
