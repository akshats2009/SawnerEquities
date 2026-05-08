import { ReactNode } from "react"

import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

const toneClasses = {
  neutral: "border-white/10 bg-[#0b1324]/85",
  positive: "border-emerald-500/20 bg-emerald-500/8",
  caution: "border-amber-500/20 bg-amber-500/8",
  danger: "border-rose-500/20 bg-rose-500/8",
} as const

export function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
  icon,
  valueClassName,
}: {
  label: string
  value: string
  detail: string
  tone?: keyof typeof toneClasses
  icon?: ReactNode
  valueClassName?: string
}) {
  return (
    <Card
      size="sm"
      className={cn(
        "border shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]",
        toneClasses[tone],
      )}
    >
      <CardContent className="flex items-start justify-between gap-4 pt-3">
        <div className="min-w-0 space-y-2">
          <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground/80">
            {label}
          </div>
          <div
            className={cn(
              "truncate font-mono text-lg font-semibold tracking-tight text-foreground tabular-nums",
              valueClassName,
            )}
          >
            {value}
          </div>
          <div className="text-xs leading-5 text-muted-foreground">{detail}</div>
        </div>
        {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      </CardContent>
    </Card>
  )
}
