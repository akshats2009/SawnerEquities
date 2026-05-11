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
    cryptopanic: NewsSourceStatus
    newsapi: NewsSourceStatus
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

  const socialPosts = [...xResult.posts, ...truthResult.posts]
  const newsItems = newsResult.items
  const snapshot = buildBtcSocialNewsSnapshot({
    asOfMs: Date.now(),
    socialPosts,
    newsItems,
    sourceStatus: {
      x: xResult,
      truthSocial: truthResult,
      news: newsResult.sourceStatus,
    },
  })

  return {
    ...snapshot,
    sourceStatus: snapshot.sourceStatus,
    socialPosts,
    newsItems,
    socialStatus: xResult,
    truthStatus: truthResult,
    newsStatus: newsResult.sourceStatus,
  }
}
