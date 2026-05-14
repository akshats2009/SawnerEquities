import { fetchCryptoNewsItems } from "@/lib/news/cryptoNews"
import type { NewsItem, NewsSourceStatus } from "@/lib/news/types"
import { fetchTruthSocialPosts } from "@/lib/social/truthSocial"
import { BTC_SOCIAL_KEYWORDS, fetchXSocialPosts } from "@/lib/social/x"
import type { SocialPost, SocialSourceStatus } from "@/lib/social/types"
import {
  buildBtcSocialNewsSnapshot,
  type BtcSocialNewsSnapshot,
  type BtcSocialNewsSourceStatus,
} from "@/lib/sentiment/eventScoring"

export interface FetchBtcSocialNewsResult extends BtcSocialNewsSnapshot {
  sourceStatus: BtcSocialNewsSourceStatus
  socialPosts: SocialPost[]
  newsItems: NewsItem[]
  socialStatus: SocialSourceStatus
  truthStatus: SocialSourceStatus
  newsStatus: {
    cryptocurrencyCv: NewsSourceStatus
  }
}

export async function fetchBtcSocialNewsIntelligence(options?: {
  limit?: number
}): Promise<FetchBtcSocialNewsResult> {
  const limit = options?.limit ?? 5
  const [xResult, truthResult, newsResult] = await Promise.all([
    fetchXSocialPosts({ limit: Math.max(limit * 2, 8) }),
    fetchTruthSocialPosts({
      limit: Math.max(limit, 5),
      keywords: BTC_SOCIAL_KEYWORDS,
    }),
    fetchCryptoNewsItems({ limit: Math.max(limit * 2, 10) }),
  ])

  const rawSocialPosts = [...xResult.posts, ...truthResult.posts]
  const rawNewsItems = newsResult.items

  // Deduplicate across X posts and news items: if two items share >= 70% of
  // their top-8 words keep the one with higher credibilityScore.
  function tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter(Boolean)
  }

  function topWords(text: string, n: number): Set<string> {
    return new Set(tokenize(text).slice(0, n))
  }

  function overlapRatio(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0
    let shared = 0
    for (const w of a) {
      if (b.has(w)) shared++
    }
    return shared / Math.max(a.size, b.size)
  }

  // Build a unified list of items with title/text and credibility for dedup.
  type AnyItem = { _kind: "post"; item: SocialPost } | { _kind: "news"; item: NewsItem }
  const unified: AnyItem[] = [
    ...rawSocialPosts.map((p) => ({ _kind: "post" as const, item: p })),
    ...rawNewsItems.map((n) => ({ _kind: "news" as const, item: n })),
  ]

  const getText = (u: AnyItem) =>
    u._kind === "post" ? u.item.text : u.item.title
  const getCredibility = (u: AnyItem) =>
    u._kind === "post" ? u.item.credibilityScore : u.item.credibilityScore

  const kept = new Array<boolean>(unified.length).fill(true)
  for (let i = 0; i < unified.length; i++) {
    if (!kept[i]) continue
    const wordsI = topWords(getText(unified[i]), 8)
    for (let j = i + 1; j < unified.length; j++) {
      if (!kept[j]) continue
      const wordsJ = topWords(getText(unified[j]), 8)
      if (overlapRatio(wordsI, wordsJ) >= 0.7) {
        // Drop the lower-credibility duplicate
        if (getCredibility(unified[i]) >= getCredibility(unified[j])) {
          kept[j] = false
        } else {
          kept[i] = false
          break
        }
      }
    }
  }

  const socialPosts = unified
    .filter((u, idx) => kept[idx] && u._kind === "post")
    .map((u) => (u as { _kind: "post"; item: SocialPost }).item)
  const newsItems = unified
    .filter((u, idx) => kept[idx] && u._kind === "news")
    .map((u) => (u as { _kind: "news"; item: NewsItem }).item)

  const snapshot = buildBtcSocialNewsSnapshot({
    asOfMs: Date.now(),
    socialPosts,
    newsItems,
    sourceStatus: {
      x: xResult,
      truthSocial: truthResult,
      news: {
        cryptocurrencyCv: aggregateNewsStatus(newsResult.sourceStatus),
      },
    },
  })

  return {
    ...snapshot,
    sourceStatus: snapshot.sourceStatus,
    socialPosts,
    newsItems,
    socialStatus: xResult,
    truthStatus: truthResult,
    newsStatus: {
      cryptocurrencyCv: aggregateNewsStatus(newsResult.sourceStatus),
    },
  }
}

function aggregateNewsStatus(sourceStatus: {
  cryptopanic: NewsSourceStatus
  newsapi: NewsSourceStatus
}) {
  return {
    enabled: sourceStatus.cryptopanic.enabled || sourceStatus.newsapi.enabled,
    warning:
      sourceStatus.cryptopanic.warning ??
      sourceStatus.newsapi.warning ??
      null,
    itemCount: sourceStatus.cryptopanic.itemCount + sourceStatus.newsapi.itemCount,
  }
}
