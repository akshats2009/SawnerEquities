import type { NewsItem, NewsSourceStatus } from "@/lib/news/types"

export interface FetchCryptoNewsResult extends NewsSourceStatus {
  items: NewsItem[]
  source: "cryptopanic" | "newsapi"
}

export async function fetchCryptoNewsItems(options?: {
  limit?: number
  keywords?: readonly string[]
}): Promise<{
  items: NewsItem[]
  sourceStatus: {
    cryptopanic: NewsSourceStatus
    newsapi: NewsSourceStatus
  }
}> {
  const limit = clampLimit(options?.limit ?? 10, 1, 10)
  const keywords = options?.keywords?.length ? [...options.keywords] : [...DEFAULT_NEWS_KEYWORDS]
  const [cryptoPanic, newsApi] = await Promise.all([
    fetchCryptoPanicNews({ limit, keywords }),
    fetchNewsApiItems({ limit, keywords }),
  ])

  const items = [...cryptoPanic.items, ...newsApi.items]
    .sort((left, right) => {
      const leftTime = new Date(left.publishedAt).getTime()
      const rightTime = new Date(right.publishedAt).getTime()
      return rightTime - leftTime
    })
    .slice(0, limit * 2)
    .filter((item, index, array) => array.findIndex((other) => other.id === item.id) === index)

  return {
    items,
    sourceStatus: {
      cryptopanic: cryptoPanic,
      newsapi: newsApi,
    },
  }
}

export async function fetchCryptoPanicNews(options?: {
  limit?: number
  keywords?: readonly string[]
}): Promise<FetchCryptoNewsResult> {
  const apiKey = process.env.CRYPTOPANIC_API_KEY?.trim()
  const fetchedAt = new Date().toISOString()
  if (!apiKey) {
    return {
      source: "cryptopanic",
      enabled: false,
      warning: "CRYPTOPANIC_API_KEY is not configured.",
      itemCount: 0,
      items: [],
    }
  }

  const limit = clampLimit(options?.limit ?? 8, 1, 8)
  const keywords = options?.keywords?.length ? [...options.keywords] : [...DEFAULT_NEWS_KEYWORDS]

  try {
    const url = new URL("https://cryptopanic.com/api/v1/posts/")
    url.searchParams.set("auth_token", apiKey)
    url.searchParams.set("public", "true")
    url.searchParams.set("kind", "news")
    url.searchParams.set("currencies", "BTC")
    url.searchParams.set("filter", "important")
    url.searchParams.set("limit", String(limit))

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "SawnerEquities/1.0",
      },
    })

    if (!response.ok) {
      return {
        source: "cryptopanic",
        enabled: true,
        warning: `CryptoPanic request failed (${response.status}).`,
        itemCount: 0,
        items: [],
      }
    }

    const payload = (await response.json()) as CryptoPanicResponse
    const items = (payload.results ?? []).map((item) => normalizeCryptoPanicItem(item, fetchedAt, keywords))
    return {
      source: "cryptopanic",
      enabled: true,
      warning: null,
      itemCount: items.length,
      items,
    }
  } catch (error) {
    return {
      source: "cryptopanic",
      enabled: true,
      warning: error instanceof Error ? error.message : "Unable to fetch CryptoPanic news.",
      itemCount: 0,
      items: [],
    }
  }
}

export async function fetchNewsApiItems(options?: {
  limit?: number
  keywords?: readonly string[]
}): Promise<FetchCryptoNewsResult> {
  const apiKey = process.env.NEWS_API_KEY?.trim()
  const fetchedAt = new Date().toISOString()
  if (!apiKey) {
    return {
      source: "newsapi",
      enabled: false,
      warning: "NEWS_API_KEY is not configured.",
      itemCount: 0,
      items: [],
    }
  }

  const limit = clampLimit(options?.limit ?? 8, 1, 8)
  const keywords = options?.keywords?.length ? [...options.keywords] : [...DEFAULT_NEWS_KEYWORDS]
  const query = buildNewsQuery(keywords)

  try {
    const url = new URL("https://newsapi.org/v2/everything")
    url.searchParams.set("q", query)
    url.searchParams.set("language", "en")
    url.searchParams.set("sortBy", "publishedAt")
    url.searchParams.set("pageSize", String(limit))
    url.searchParams.set("from", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

    const response = await fetch(url, {
      headers: {
        "X-Api-Key": apiKey,
        Accept: "application/json",
        "User-Agent": "SawnerEquities/1.0",
      },
    })

    if (!response.ok) {
      return {
        source: "newsapi",
        enabled: true,
        warning: `NewsAPI request failed (${response.status}).`,
        itemCount: 0,
        items: [],
      }
    }

    const payload = (await response.json()) as NewsApiResponse
    const items = (payload.articles ?? []).map((article) =>
      normalizeNewsApiItem(article, fetchedAt, keywords),
    )

    return {
      source: "newsapi",
      enabled: true,
      warning: null,
      itemCount: items.length,
      items,
    }
  } catch (error) {
    return {
      source: "newsapi",
      enabled: true,
      warning: error instanceof Error ? error.message : "Unable to fetch NewsAPI news.",
      itemCount: 0,
      items: [],
    }
  }
}

const DEFAULT_NEWS_KEYWORDS = [
  "BTC",
  "Bitcoin",
  "crypto",
  "ETF",
  "Fed",
  "inflation",
  "CPI",
  "rates",
  "SEC",
  "Binance",
  "Coinbase",
] as const

function normalizeCryptoPanicItem(
  item: CryptoPanicItem,
  fetchedAt: string,
  keywords: readonly string[],
): NewsItem {
  const text = `${item.title ?? ""} ${item.body ?? ""}`.trim()
  return {
    id: item.id?.toString() ?? item.url ?? text.slice(0, 40) ?? `cryptopanic-${fetchedAt}`,
    source: "cryptopanic",
    title: item.title ?? "CryptoPanic headline",
    summary: item.body ?? item.title ?? "",
    url: item.url ?? null,
    publishedAt: normalizeIso(item.published_at) ?? fetchedAt,
    fetchedAt,
    matchedKeywords: matchKeywords(text, keywords),
    credibilityScore: calculateNewsCredibility({
      title: item.title ?? "",
      summary: item.body ?? "",
      source: "cryptopanic",
      category: item.kind ?? null,
    }),
  }
}

function normalizeNewsApiItem(
  article: NewsApiArticle,
  fetchedAt: string,
  keywords: readonly string[],
): NewsItem {
  const text = `${article.title ?? ""} ${article.description ?? ""}`.trim()
  return {
    id: article.url ?? article.title ?? `newsapi-${fetchedAt}`,
    source: "newsapi",
    title: article.title ?? "NewsAPI headline",
    summary: article.description ?? article.content ?? article.title ?? "",
    url: article.url ?? null,
    publishedAt: normalizeIso(article.publishedAt) ?? fetchedAt,
    fetchedAt,
    matchedKeywords: matchKeywords(text, keywords),
    credibilityScore: calculateNewsCredibility({
      title: article.title ?? "",
      summary: article.description ?? article.content ?? "",
      source: article.source?.name ?? "newsapi",
      category: null,
    }),
  }
}

function buildNewsQuery(keywords: readonly string[]) {
  return keywords.slice(0, 10).map((keyword) => quoteKeyword(keyword)).join(" OR ")
}

const NEWSAPI_OUTLET_CREDIBILITY: Record<string, number> = {
  "reuters": 88,
  "bloomberg": 85,
  "associated press": 85,
  "coindesk": 78,
  "cointelegraph": 72,
  "the block": 76,
  "decrypt": 70,
  "financial times": 84,
  "wall street journal": 84,
  "cnbc": 78,
  "forbes": 70,
}

function getNewsApiOutletScore(sourceName: string): number {
  const nameLower = sourceName.toLowerCase()
  for (const [outlet, score] of Object.entries(NEWSAPI_OUTLET_CREDIBILITY)) {
    if (nameLower.includes(outlet)) {
      return score
    }
  }
  return 66
}

function calculateNewsCredibility({
  title,
  summary,
  source,
  category,
}: {
  title: string
  summary: string
  source: string
  category: string | null
}) {
  const sourceLower = source.toLowerCase()
  const base =
    sourceLower.includes("newsapi")
      ? 66
      : sourceLower.includes("cryptopanic")
        ? 72
        : getNewsApiOutletScore(source)
  const titleLift = title.length > 50 ? 6 : 0
  const summaryLift = summary.length > 80 ? 6 : 0
  const categoryLift =
    category && /(breaking|hot|important|rising)/i.test(category) ? 4 : 0
  return Math.round(clampLimit(base + titleLift + summaryLift + categoryLift, 25, 96))
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

function quoteKeyword(keyword: string) {
  if (/^[A-Za-z0-9_]+$/.test(keyword)) {
    return keyword
  }

  return `"${keyword.replaceAll('"', '\\"')}"`
}

function clampLimit(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

interface CryptoPanicResponse {
  results?: CryptoPanicItem[]
}

interface CryptoPanicItem {
  id?: number | string
  title?: string
  body?: string
  url?: string
  published_at?: string
  kind?: string
}

interface NewsApiResponse {
  articles?: NewsApiArticle[]
}

interface NewsApiArticle {
  url?: string
  title?: string
  description?: string
  content?: string
  publishedAt?: string
  source?: {
    name?: string
  }
}
