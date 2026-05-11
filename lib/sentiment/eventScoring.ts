import { clamp } from "@/lib/utils"
import type { NewsItem, NewsSourceStatus } from "@/lib/news/types"
import type {
  SocialPost,
  SocialSourceStatus,
} from "@/lib/social/types"

export type BtcEventChannel = "social" | "news"
export type BtcEventSentiment = "bullish" | "bearish" | "neutral" | "unknown"
export type BtcEventCategory =
  | "macro"
  | "regulation"
  | "exchange"
  | "ETF/institutional"
  | "political"
  | "security/hack"
  | "influencer/social"
  | "general crypto news"
export type BtcEventRiskState = "calm" | "elevated" | "active catalyst" | "unreliable/noisy"

export interface BtcScoredMarketEvent {
  id: string
  channel: BtcEventChannel
  source: string
  author: string | null
  title: string
  text: string
  summary: string
  url: string | null
  publishedAt: string
  fetchedAt: string
  matchedKeywords: string[]
  credibilityScore: number
  sentiment: BtcEventSentiment
  urgency: number
  marketMovingScore: number
  category: BtcEventCategory
  explanation: string
}

export interface BtcSocialNewsSourceStatus {
  x: SocialSourceStatus
  truthSocial: SocialSourceStatus
  news: {
    cryptocurrencyCv: NewsSourceStatus
  }
}

export interface BtcSocialNewsSnapshot {
  asOfMs: number
  available: boolean
  pressureScore: number
  marketMovingScore: number
  eventRiskState: BtcEventRiskState
  confidenceImpact: number
  sourceCredibilityScore: number
  summary: string
  explanation: string
  warning: string | null
  topEvents: BtcScoredMarketEvent[]
  sourceStatus: BtcSocialNewsSourceStatus
}

export function buildBtcSocialNewsSnapshot(input: {
  asOfMs: number
  socialPosts: SocialPost[]
  newsItems: NewsItem[]
  sourceStatus: BtcSocialNewsSourceStatus
}): BtcSocialNewsSnapshot {
  const scoredEvents = [
    ...input.socialPosts.map((post) => scoreSocialPost(post, input.asOfMs)),
    ...input.newsItems.map((item) => scoreNewsItem(item, input.asOfMs)),
  ]
    .filter((event) => event.text.length > 0 || event.summary.length > 0)
    .sort((left, right) => {
      if (right.marketMovingScore !== left.marketMovingScore) {
        return right.marketMovingScore - left.marketMovingScore
      }

      const rightTime = new Date(right.publishedAt).getTime()
      const leftTime = new Date(left.publishedAt).getTime()
      return rightTime - leftTime
    })

  const topEvents = scoredEvents.slice(0, 5)
  const available = topEvents.length > 0
  const sourceCredibilityScore = average(topEvents.map((event) => event.credibilityScore))
  const pressureScore = calculatePressureScore(topEvents)
  const marketMovingScore = average(topEvents.map((event) => event.marketMovingScore))
  const confidenceImpact = calculateConfidenceImpact({
    available,
    topEvents,
    sourceStatus: input.sourceStatus,
    pressureScore,
  })
  const eventRiskState = classifyEventRiskState({
    available,
    topEvents,
    confidenceImpact,
    sourceStatus: input.sourceStatus,
    pressureScore,
  })
  const summary = buildSummary({ available, topEvents, pressureScore, eventRiskState })
  const explanation = buildExplanation({ available, topEvents, pressureScore, eventRiskState })
  const warning = buildWarning({
    available,
    topEvents,
    sourceStatus: input.sourceStatus,
    eventRiskState,
  })

  return {
    asOfMs: input.asOfMs,
    available,
    pressureScore,
    marketMovingScore,
    eventRiskState,
    confidenceImpact,
    sourceCredibilityScore,
    summary,
    explanation,
    warning,
    topEvents,
    sourceStatus: input.sourceStatus,
  }
}

function scoreSocialPost(post: SocialPost, asOfMs: number): BtcScoredMarketEvent {
  return scoreEvent({
    channel: "social",
    id: post.id,
    source: post.source,
    author: post.author,
    title: null,
    text: post.text,
    summary: post.text,
    url: post.url,
    publishedAt: post.createdAt,
    fetchedAt: post.fetchedAt,
    matchedKeywords: post.matchedKeywords,
    credibilityScore: post.credibilityScore,
    asOfMs,
  })
}

function scoreNewsItem(item: NewsItem, asOfMs: number): BtcScoredMarketEvent {
  return scoreEvent({
    channel: "news",
    id: item.id,
    source: item.source,
    author: null,
    title: item.title,
    text: `${item.title} ${item.summary}`.trim(),
    summary: item.summary,
    url: item.url,
    publishedAt: item.publishedAt,
    fetchedAt: item.fetchedAt,
    matchedKeywords: item.matchedKeywords,
    credibilityScore: item.credibilityScore,
    asOfMs,
  })
}

function scoreEvent(input: {
  channel: BtcEventChannel
  id: string
  source: string
  author: string | null
  title: string | null
  text: string
  summary: string
  url: string | null
  publishedAt: string
  fetchedAt: string
  matchedKeywords: string[]
  credibilityScore: number
  asOfMs: number
}): BtcScoredMarketEvent {
  const normalizedText = `${input.title ?? ""} ${input.text ?? ""} ${input.summary ?? ""}`.trim()
  const category = classifyEventCategory(normalizedText, input.source, input.matchedKeywords)
  const sentiment = classifyEventSentiment(normalizedText, category)
  const urgency = calculateUrgencyScore({
    text: normalizedText,
    category,
    publishedAt: input.publishedAt,
    asOfMs: input.asOfMs,
  })
  const categoryWeight = categoryWeightScore(category)
  const recencyWeight = recencyWeightScore(input.publishedAt, input.asOfMs)
  const keywordWeight = clamp(input.matchedKeywords.length * 8, 0, 24)
  const marketMovingScore = Math.round(
    clamp(
      input.credibilityScore * 0.35 +
        urgency * 0.35 +
        categoryWeight * 0.1 +
        recencyWeight * 0.12 +
        keywordWeight * 0.08,
      0,
      100,
    ),
  )
  const explanation = buildEventExplanation({
    category,
    sentiment,
    urgency,
    credibilityScore: input.credibilityScore,
    matchedKeywords: input.matchedKeywords,
    marketMovingScore,
  })

  return {
    id: input.id,
    channel: input.channel,
    source: input.source,
    author: input.author,
    title: input.title ?? input.summary.slice(0, 120),
    text: input.text,
    summary: input.summary,
    url: input.url,
    publishedAt: input.publishedAt,
    fetchedAt: input.fetchedAt,
    matchedKeywords: input.matchedKeywords,
    credibilityScore: input.credibilityScore,
    sentiment,
    urgency,
    marketMovingScore,
    category,
    explanation,
  }
}

function classifyEventCategory(
  text: string,
  source: string,
  matchedKeywords: string[],
): BtcEventCategory {
  const haystack = text.toLowerCase()
  const sourceLower = source.toLowerCase()

  if (includesAny(haystack, ["sec", "regulation", "rule", "lawsuit", "approval", "filing", "enforcement", "court"])) {
    return "regulation"
  }

  if (includesAny(haystack, ["fed", "inflation", "cpi", "rates", "treasury", "powell", "macro", "yield", "jobs"])) {
    return "macro"
  }

  if (includesAny(haystack, ["etf", "blackrock", "fidelity", "grayscale", "institutional", "spot fund", "ibit", "flows"])) {
    return "ETF/institutional"
  }

  if (includesAny(haystack, ["coinbase", "binance", "kraken", "bitstamp", "exchange", "outage", "withdrawal", "deposit", "listing", "delist", "hack"])) {
    return "exchange"
  }

  if (includesAny(haystack, ["hack", "exploit", "breach", "phishing", "malware", "ransom", "security"])) {
    return "security/hack"
  }

  if (includesAny(haystack, ["trump", "election", "white house", "treasury", "politics", "political"])) {
    return "political"
  }

  if (sourceLower.includes("x") || sourceLower.includes("truth")) {
    return "influencer/social"
  }

  if (matchedKeywords.length > 0) {
    return "general crypto news"
  }

  return "general crypto news"
}

function classifyEventSentiment(
  text: string,
  category: BtcEventCategory,
): BtcEventSentiment {
  const haystack = text.toLowerCase()
  const bullishHits = countMatches(haystack, [
    "bullish",
    "approval",
    "approved",
    "inflow",
    "inflation cools",
    "rate cut",
    "cut",
    "buy",
    "accumulation",
    "adoption",
    "surge",
    "spot etf",
    "support",
    "record high",
  ])
  const bearishHits = countMatches(haystack, [
    "bearish",
    "crackdown",
    "lawsuit",
    "hack",
    "outage",
    "outflows",
    "selloff",
    "liquidation",
    "inflation hot",
    "rate hike",
    "hike",
    "freeze",
    "ban",
    "risk off",
  ])

  if (category === "security/hack" || category === "regulation") {
    if (bearishHits >= bullishHits) {
      return "bearish"
    }
  }

  if (bullishHits >= 2 && bullishHits > bearishHits) {
    return "bullish"
  }

  if (bearishHits >= 2 && bearishHits > bullishHits) {
    return "bearish"
  }

  if (bullishHits === 0 && bearishHits === 0) {
    return "neutral"
  }

  if (bullishHits > bearishHits) {
    return "bullish"
  }

  if (bearishHits > bullishHits) {
    return "bearish"
  }

  return "neutral"
}

function calculateUrgencyScore({
  text,
  category,
  publishedAt,
  asOfMs,
}: {
  text: string
  category: BtcEventCategory
  publishedAt: string
  asOfMs: number
}) {
  const ageMinutes = Math.max((asOfMs - new Date(publishedAt).getTime()) / 60000, 0)
  const recencyScore = clamp(100 - ageMinutes * 2.25, 10, 100)
  const triggerBoost = includesAny(text.toLowerCase(), [
    "breaking",
    "urgent",
    "just in",
    "now",
    "halt",
    "hacked",
    "approval",
    "decision",
    "suspension",
    "fed",
    "cpi",
    "powell",
  ])
    ? 12
    : 0
  const categoryBoost =
    category === "macro" || category === "regulation" || category === "security/hack"
      ? 10
      : category === "ETF/institutional"
        ? 8
        : 0
  return Math.round(clamp(recencyScore + triggerBoost + categoryBoost, 0, 100))
}

function categoryWeightScore(category: BtcEventCategory) {
  switch (category) {
    case "macro":
      return 100
    case "regulation":
      return 95
    case "security/hack":
      return 90
    case "ETF/institutional":
      return 88
    case "exchange":
      return 82
    case "political":
      return 78
    case "influencer/social":
      return 62
    default:
      return 70
  }
}

function recencyWeightScore(publishedAt: string, asOfMs: number) {
  const ageMinutes = Math.max((asOfMs - new Date(publishedAt).getTime()) / 60000, 0)
  return clamp(100 - ageMinutes * 2, 15, 100)
}

function buildEventExplanation(input: {
  category: BtcEventCategory
  sentiment: BtcEventSentiment
  urgency: number
  credibilityScore: number
  matchedKeywords: string[]
  marketMovingScore: number
}) {
  const sentimentPhrase =
    input.sentiment === "bullish"
      ? "bullish"
      : input.sentiment === "bearish"
        ? "bearish"
        : input.sentiment === "neutral"
          ? "neutral"
          : "unclear"
  const keywordText =
    input.matchedKeywords.length > 0 ? `Matched keywords: ${input.matchedKeywords.join(", ")}.` : "No keyword match was recorded."

  return `${capitalize(input.category)} event with ${sentimentPhrase} sentiment, ${input.urgency}/100 urgency, and ${input.marketMovingScore}/100 market-moving strength. Credibility ${input.credibilityScore}/100. ${keywordText}`
}

function buildSummary(input: {
  available: boolean
  topEvents: BtcScoredMarketEvent[]
  pressureScore: number
  eventRiskState: BtcEventRiskState
}) {
  if (!input.available || input.topEvents.length === 0) {
    return "No configured social or news source returned a usable BTC-relevant event."
  }

  const lead = input.topEvents[0]
  const direction =
    input.pressureScore > 12
      ? "bullish"
      : input.pressureScore < -12
        ? "bearish"
        : "mixed"

  return `Top event flow is ${direction} with ${input.eventRiskState} event risk. Leading catalyst: ${lead.category} from ${lead.source}.`
}

function buildExplanation(input: {
  available: boolean
  topEvents: BtcScoredMarketEvent[]
  pressureScore: number
  eventRiskState: BtcEventRiskState
}) {
  if (!input.available || input.topEvents.length === 0) {
    return "No market-moving event data is available from the configured social/news sources."
  }

  const lead = input.topEvents[0]
  const direction =
    input.pressureScore > 10
      ? "upward pressure"
      : input.pressureScore < -10
        ? "downward pressure"
        : "mixed pressure"
  return `The strongest current event points to ${direction} from a ${lead.category} catalyst, with ${lead.urgency}/100 urgency and ${lead.marketMovingScore}/100 market-moving strength.`
}

function buildWarning(input: {
  available: boolean
  topEvents: BtcScoredMarketEvent[]
  sourceStatus: BtcSocialNewsSourceStatus
  eventRiskState: BtcEventRiskState
}) {
  const warnings: string[] = []

  if (!input.available || input.topEvents.length === 0) {
    if (
      !input.sourceStatus.x.enabled &&
      !input.sourceStatus.truthSocial.enabled &&
      !input.sourceStatus.news.cryptocurrencyCv.enabled
    ) {
      return "No social/news sources are configured. Event pressure is unavailable."
    }

    warnings.push("No BTC-relevant events were returned by the configured sources.")
  }

  if (input.eventRiskState === "active catalyst") {
    warnings.push("A major catalyst is active. Interpret short-horizon BTC moves with extra caution.")
  }

  if (input.eventRiskState === "unreliable/noisy") {
    warnings.push("Social/news flow is noisy or low confidence.")
  }

  return warnings.length > 0 ? warnings.join(" ") : null
}

function classifyEventRiskState(input: {
  available: boolean
  topEvents: BtcScoredMarketEvent[]
  confidenceImpact: number
  sourceStatus: BtcSocialNewsSourceStatus
  pressureScore: number
}): BtcEventRiskState {
  if (!input.available || input.topEvents.length === 0) {
    return "unreliable/noisy"
  }

  const activeSourceCount = countEnabledSources(input.sourceStatus)
  const lead = input.topEvents[0]
  const spread = Math.abs(input.pressureScore)

  if (
    lead.marketMovingScore >= 72 &&
    lead.urgency >= 65 &&
    activeSourceCount >= 1
  ) {
    return "active catalyst"
  }

  if (
    input.confidenceImpact >= 70 ||
    spread >= 35 ||
    activeSourceCount <= 1 && lead.credibilityScore < 55
  ) {
    return "unreliable/noisy"
  }

  if (spread >= 18 || lead.marketMovingScore >= 48) {
    return "elevated"
  }

  return "calm"
}

function calculatePressureScore(events: BtcScoredMarketEvent[]) {
  if (events.length === 0) {
    return 0
  }

  const weighted = events.reduce(
    (sum, event) => {
      const direction =
        event.sentiment === "bullish" ? 1 : event.sentiment === "bearish" ? -1 : 0
      const weight = event.marketMovingScore * (event.credibilityScore / 100)
      return {
        score: sum.score + direction * weight,
        weight: sum.weight + weight,
      }
    },
    { score: 0, weight: 0 },
  )

  if (weighted.weight === 0) {
    return 0
  }

  return Math.round(clamp((weighted.score / weighted.weight) * 100, -100, 100))
}

function calculateConfidenceImpact({
  available,
  topEvents,
  sourceStatus,
  pressureScore,
}: {
  available: boolean
  topEvents: BtcScoredMarketEvent[]
  sourceStatus: BtcSocialNewsSourceStatus
  pressureScore: number
}) {
  if (!available || topEvents.length === 0) {
    return countEnabledSources(sourceStatus) > 0 ? 35 : 60
  }

  const lead = topEvents[0]
  const activeSourceCount = countEnabledSources(sourceStatus)
  const sourcePenalty = activeSourceCount <= 1 ? 18 : 0
  const contradictionPenalty =
    topEvents.some((event) => event.sentiment === "bullish") &&
    topEvents.some((event) => event.sentiment === "bearish")
      ? 10
      : 0
  const pressurePenalty = Math.min(Math.abs(pressureScore) * 0.35, 24)
  const leadPenalty = lead.marketMovingScore >= 75 ? 12 : lead.marketMovingScore >= 55 ? 8 : 4
  return Math.round(clamp(leadPenalty + sourcePenalty + contradictionPenalty + pressurePenalty, 0, 100))
}

function countEnabledSources(sourceStatus: BtcSocialNewsSourceStatus) {
  return [
    sourceStatus.x.enabled,
    sourceStatus.truthSocial.enabled,
    sourceStatus.news.cryptocurrencyCv.enabled,
  ].filter(Boolean).length
}

function includesAny(haystack: string, needles: string[]) {
  return needles.some((needle) => haystack.includes(needle))
}

function countMatches(haystack: string, needles: string[]) {
  return needles.reduce((count, needle) => count + (haystack.includes(needle) ? 1 : 0), 0)
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
