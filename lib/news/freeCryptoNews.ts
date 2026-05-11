"use client"

import type { NewsItem, NewsSourceStatus } from "@/lib/news/types"

export interface FetchFreeCryptoNewsResult extends NewsSourceStatus {
  items: NewsItem[]
  source: "cryptocurrency_cv"
}

type FeedCandidate = {
  url: string
  label: string
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

const FREE_FEED_CANDIDATES: FeedCandidate[] = [
  { url: "https://r.jina.ai/http://www.coindesk.com/arc/outboundfeeds/rss/", label: "CoinDesk RSS" },
  { url: "https://r.jina.ai/http://cointelegraph.com/rss.xml", label: "Cointelegraph RSS" },
  { url: "https://r.jina.ai/http://decrypt.co/feed", label: "Decrypt RSS" },
  { url: "https://r.jina.ai/http://www.sec.gov/newsroom/press-releases", label: "SEC press releases" },
]

export async function fetchFreeCryptoNewsItems(options?: {
  limit?: number
  keywords?: readonly string[]
}): Promise<{
  items: NewsItem[]
  sourceStatus: {
    cryptocurrencyCv: NewsSourceStatus
  }
}> {
  const limit = clampLimit(options?.limit ?? 10, 1, 20)
  const keywords = options?.keywords?.length ? [...options.keywords] : [...DEFAULT_NEWS_KEYWORDS]
  const fetchedAt = new Date().toISOString()

  try {
    const results = await Promise.all(
      FREE_FEED_CANDIDATES.map((candidate) =>
        fetchCandidateFeed(candidate, fetchedAt, keywords, limit),
      ),
    )

    const items = results
      .flatMap((result) => result.items)
      .sort((left, right) => {
        const leftTime = new Date(left.publishedAt).getTime()
        const rightTime = new Date(right.publishedAt).getTime()
        return rightTime - leftTime
      })
      .filter((item, index, array) => array.findIndex((other) => other.id === item.id) === index)
      .slice(0, limit)

    const enabledCandidates = results.filter((result) => result.enabledCount > 0)
    const firstFailure = results.find((result) => result.warning !== null)?.warning ?? null
    const sourceStatusWarning =
      enabledCandidates.length === 0
        ? firstFailure ?? "cryptocurrency.cv free feeds are unavailable right now."
        : items.length === 0
          ? "cryptocurrency.cv returned no BTC-relevant items for the current free feed set."
          : null

    return {
      items,
      sourceStatus: {
        cryptocurrencyCv: {
          enabled: enabledCandidates.length > 0,
          warning: sourceStatusWarning,
          itemCount: items.length,
        },
      },
    }
  } catch (error) {
    return {
      items: [],
      sourceStatus: {
        cryptocurrencyCv: {
          enabled: false,
          warning:
            error instanceof Error ? error.message : "Unable to fetch cryptocurrency.cv news.",
          itemCount: 0,
        },
      },
    }
  }
}

async function fetchCandidateFeed(
  candidate: FeedCandidate,
  fetchedAt: string,
  keywords: readonly string[],
  limit: number,
) {
  try {
    const response = await fetch(candidate.url, {
      headers: {
        Accept: "application/rss+xml, application/xml, application/json;q=0.9, text/plain;q=0.8",
        "User-Agent": "SawnerEquities/1.0",
      },
      cache: "no-store",
    })

    if (!response.ok) {
      return {
        items: [] as NewsItem[],
        enabledCount: 0,
        warning: `${candidate.label} request failed (${response.status}).`,
      }
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
    const raw = await response.text()
    const records = contentType.includes("xml") || looksLikeXml(raw)
      ? parseXmlFeed(raw, candidate)
      : looksLikeMarkdown(raw)
        ? parseMarkdownFeed(raw, candidate)
        : parseJsonFeed(raw)

    const items = records
      .map((record, index) =>
        normalizeNewsRecord(record, fetchedAt, keywords, `${candidate.label}-${index}`),
      )
      .filter((item): item is NewsItem => item !== null)

    return { items: items.slice(0, limit), enabledCount: items.length, warning: null }
  } catch {
    return {
      items: [] as NewsItem[],
      enabledCount: 0,
      warning: `${candidate.label} could not be fetched.`,
    }
  }
}

function parseJsonFeed(raw: string) {
  try {
    const payload = JSON.parse(raw) as unknown
    return extractRecords(payload)
  } catch {
    return []
  }
}

function parseXmlFeed(raw: string, candidate: FeedCandidate) {
  if (typeof DOMParser === "undefined") {
    return []
  }

  const doc = new DOMParser().parseFromString(raw, "application/xml")
  if (doc.querySelector("parsererror")) {
    return []
  }

  const rssItems = Array.from(doc.querySelectorAll("item")).map((item) =>
    xmlToRecord(item, candidate),
  )
  if (rssItems.length > 0) {
    return rssItems
  }

  return Array.from(doc.querySelectorAll("entry")).map((entry) => xmlToRecord(entry, candidate))
}

function parseMarkdownFeed(raw: string, candidate: FeedCandidate) {
  const lines = raw.split(/\r?\n/)
  const feedTitle = readString(extractMarkdownTitle(raw)) ?? candidate.label
  const records: Record<string, unknown>[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    const urlMatch = line.match(/\((https?:\/\/[^)\s]+)\)/)
    if (!urlMatch) {
      continue
    }

    const url = urlMatch[1]
    const nextLine = lines.slice(index + 1, index + 4).find((candidateLine) =>
      /^\w{3},\s\d{1,2}\s[a-zA-Z]{3}\s\d{4}/.test(candidateLine.trim()),
    )
    const publishedAt = normalizeIso(nextLine?.trim()) ?? null
    const title = slugToTitle(extractSlug(url)) ?? feedTitle

    records.push({
      id: url,
      title,
      headline: title,
      summary: title,
      description: title,
      url,
      link: url,
      source: feedTitle,
      publishedAt,
      published_at: publishedAt,
      createdAt: publishedAt,
      date: publishedAt,
      text: title,
    })
  }

  return records
}

function xmlToRecord(node: Element, candidate: FeedCandidate) {
  const title = readString(
    node.querySelector("title")?.textContent ?? node.querySelector("headline")?.textContent,
  )
  const description = readString(
    node.querySelector("description")?.textContent ??
      node.querySelector("summary")?.textContent ??
      node.querySelector("content")?.textContent,
  )
  const link =
    readString(node.querySelector("link")?.getAttribute("href")) ??
    readString(node.querySelector("link")?.textContent)
  const guid = readString(node.querySelector("guid")?.textContent)
  const publishedAt = normalizeIso(
    node.querySelector("pubDate")?.textContent ??
      node.querySelector("published")?.textContent ??
      node.querySelector("updated")?.textContent,
  )
  const source = readString(
    node.querySelector("source")?.textContent ??
      node.querySelector("author")?.textContent ??
      candidate.label,
  )
  const categories = Array.from(node.querySelectorAll("category"))
    .map((category) => readString(category.textContent))
    .filter((category): category is string => category !== null)

  return {
    id: guid ?? link ?? `${title ?? description ?? candidate.label}-${publishedAt ?? Date.now()}`,
    title,
    description,
    link,
    source,
    publishedAt,
    categories,
  }
}

function normalizeNewsRecord(
  record: Record<string, unknown>,
  fetchedAt: string,
  keywords: readonly string[],
  suffix: string,
): NewsItem | null {
  const title = readString(
    record.title ?? record.headline ?? record.name ?? record.story_title ?? record.article_title,
  )
  const summary = readString(
    record.summary ??
      record.description ??
      record.content ??
      record.body ??
      record.excerpt ??
      record.story_excerpt ??
      record.lede,
  )
  const url = readString(record.url ?? record.link ?? record.canonical_url)
  const sourceName = readString(
    record.source ??
      record.source_name ??
      record.publisher ??
      record.publisher_name ??
      record.site ??
      record.domain,
  )
  const publishedAt = normalizeIso(
    record.publishedAt ??
      record.published_at ??
      record.createdAt ??
      record.created_at ??
      record.date ??
      record.time ??
      record.published ??
      record.updated,
  )

  const text = `${title ?? ""} ${summary ?? ""}`.trim()
  const matchedKeywords = matchKeywords(text, keywords)
  const finalTitle = title ?? summary ?? `BTC news ${suffix}`

  if (!finalTitle && !summary) {
    return null
  }

  return {
    id:
      readString(record.id ?? record.slug ?? record.guid ?? url) ??
      `${finalTitle}-${suffix}-${fetchedAt}`,
    source: normalizeSource(sourceName ?? "cryptocurrency_cv"),
    title: finalTitle,
    summary: summary ?? finalTitle,
    url,
    publishedAt: publishedAt ?? fetchedAt,
    fetchedAt,
    matchedKeywords,
    credibilityScore: calculateCredibility({
      title: finalTitle,
      summary: summary ?? "",
      source: sourceName ?? "cryptocurrency.cv",
      matchedKeywords,
    }),
  }
}

function calculateCredibility(input: {
  title: string
  summary: string
  source: string
  matchedKeywords: readonly string[]
}) {
  const sourceLower = input.source.toLowerCase()
  const base =
    sourceLower.includes("reuters") || sourceLower.includes("bloomberg") || sourceLower.includes("ap")
      ? 88
      : sourceLower.includes("coindesk") || sourceLower.includes("the block") || sourceLower.includes("decrypt")
        ? 82
        : sourceLower.includes("cryptocurrency.cv") || sourceLower.includes("crypto news")
          ? 72
          : 60
  const titleLift = input.title.length > 50 ? 6 : 0
  const summaryLift = input.summary.length > 80 ? 4 : 0
  const keywordLift = input.matchedKeywords.length > 0 ? 6 : 0
  return Math.round(clampLimit(base + titleLift + summaryLift + keywordLift, 25, 96))
}

function extractRecords(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord)
  }

  if (isRecord(payload)) {
    const containers = [
      payload.articles,
      payload.news,
      payload.results,
      payload.data,
      payload.items,
    ]

    for (const container of containers) {
      if (Array.isArray(container)) {
        return container.filter(isRecord)
      }
    }
  }

  return []
}

function matchKeywords(text: string, keywords: readonly string[]) {
  const haystack = text.toLowerCase()
  return keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()))
}

function normalizeIso(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    return null
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function readString(value: unknown) {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function clampLimit(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function looksLikeXml(raw: string) {
  const trimmed = raw.trimStart()
  return trimmed.startsWith("<?xml") || trimmed.startsWith("<rss") || trimmed.startsWith("<feed")
}

function looksLikeMarkdown(raw: string) {
  const trimmed = raw.trimStart()
  return trimmed.startsWith("Title:") || trimmed.startsWith("# ") || trimmed.includes("### [")
}

function extractMarkdownTitle(raw: string) {
  const match = raw.match(/^Title:\s*(.+)$/m)
  return match?.[1]?.trim() ?? null
}

function extractSlug(url: string) {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split("/").filter(Boolean)
    return segments.at(-1) ?? url
  } catch {
    return url
  }
}

function slugToTitle(slug: string | null) {
  if (!slug) {
    return null
  }

  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim()
}

function normalizeSource(source: string) {
  if (source === "cryptocurrency_cv") {
    return "cryptocurrency_cv"
  }

  return source.toLowerCase().replace(/\s+/g, "_")
}
