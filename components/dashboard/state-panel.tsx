import { AlertTriangle, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const toneClasses = {
  neutral: "border-white/10 bg-white/[0.02]",
  warning: "border-amber-500/20 bg-amber-500/8",
  danger: "border-rose-500/20 bg-rose-500/8",
} as const

export function StatePanel({
  title,
  description,
  detail,
  tone = "neutral",
  icon: Icon = AlertTriangle,
  actionLabel,
  onAction,
  className,
}: {
  title: string
  description: string
  detail?: string
  tone?: keyof typeof toneClasses
  icon?: LucideIcon
  actionLabel?: string
  onAction?: () => void
  className?: string
}) {
  return (
    <div className={cn("rounded-xl border p-5", toneClasses[tone], className)}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md border border-white/10 bg-black/20 p-2 text-muted-foreground">
          <Icon className="size-4" />
        </div>

        <div className="min-w-0 space-y-1">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
          {detail ? (
            <div className="font-mono text-xs text-slate-400">{detail}</div>
          ) : null}
          {actionLabel && onAction ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={onAction}
            >
              {actionLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
