"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

export function TradingViewBtcChart({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Clean up any previous widget instance
    container.innerHTML = ""

    const script = document.createElement("script")
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
    script.type = "text/javascript"
    script.async = true
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: "COINBASE:BTCUSD",
      interval: "1",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      backgroundColor: "rgba(8, 17, 31, 1)",
      gridColor: "rgba(255, 255, 255, 0.05)",
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    })

    container.appendChild(script)

    return () => {
      if (container) {
        container.innerHTML = ""
      }
    }
  }, [])

  return (
    <div className={cn("tradingview-widget-container h-[480px] w-full", className)}>
      <div ref={containerRef} className="tradingview-widget-container__widget h-full w-full" />
    </div>
  )
}
