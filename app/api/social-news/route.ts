import { fetchBtcSocialNewsIntelligence } from "@/lib/social/collector"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const snapshot = await fetchBtcSocialNewsIntelligence()
    return Response.json(snapshot)
  } catch (error) {
    return Response.json(
      {
        asOfMs: Date.now(),
        available: false,
        pressureScore: 0,
        marketMovingScore: 0,
        eventRiskState: "unreliable/noisy",
        confidenceImpact: 100,
        sourceCredibilityScore: 0,
        summary: "Social/news intelligence is unavailable.",
        explanation:
          error instanceof Error ? error.message : "Unable to collect social/news intelligence.",
        warning: "Social/news intelligence is unavailable.",
        topEvents: [],
        sourceStatus: {
          x: {
            enabled: false,
            warning: null,
            itemCount: 0,
          },
          truthSocial: {
            enabled: false,
            warning: null,
            itemCount: 0,
          },
          news: {
            cryptocurrencyCv: {
              enabled: false,
              warning: null,
              itemCount: 0,
            },
          },
        },
      },
      { status: 200 },
    )
  }
}
