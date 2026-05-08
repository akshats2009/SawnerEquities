import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Recommendation } from "@/types"

const recommendationClasses: Record<Recommendation, string> = {
  "BUY YES": "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  "BUY NO": "border-sky-500/30 bg-sky-500/10 text-sky-200",
  "NO TRADE": "border-white/10 bg-white/[0.03] text-slate-300",
}

export function RecommendationBadge({
  recommendation,
  className,
}: {
  recommendation: Recommendation
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "justify-center rounded-md px-2.5 py-1 font-mono text-[11px] tracking-[0.16em]",
        recommendationClasses[recommendation],
        className,
      )}
    >
      {recommendation}
    </Badge>
  )
}
