"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  CandlestickData,
  IChartApi,
  ISeriesApi,
  IPriceLine,
  HistogramData,
  LineData,
  Time,
  UTCTimestamp,
} from "lightweight-charts"
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
} from "lightweight-charts"

import { Button } from "@/components/ui/button"
import { cn, formatCurrency, formatCompactNumber } from "@/lib/utils"
import type { RealtimeBtcTick } from "@/lib/btc/realtime"

type CandleIntervalSeconds = 1 | 5 | 15 | 60

type AggregatedCandle = CandlestickData<UTCTimestamp> & {
  volume: number
}

type OverlayKey = "ma20" | "vwap" | "levels" | "priceLine"

const CANDLE_INTERVALS: Array<{
  label: string
  seconds: CandleIntervalSeconds
}> = [
  { label: "1s", seconds: 1 },
  { label: "5s", seconds: 5 },
  { label: "15s", seconds: 15 },
  { label: "1m", seconds: 60 },
]

const OVERLAY_CONFIG: Array<{ key: OverlayKey; label: string }> = [
  { key: "priceLine", label: "Price" },
  { key: "ma20", label: "MA20" },
  { key: "vwap", label: "VWAP" },
  { key: "levels", label: "Levels" },
]

export function BtcCandlestickChart({
  ticks,
  className,
}: {
  ticks: RealtimeBtcTick[]
  className?: string
}) {
  const [selectedInterval, setSelectedInterval] = useState<CandleIntervalSeconds>(5)
  const [overlays, setOverlays] = useState<Record<OverlayKey, boolean>>({
    priceLine: true,
    ma20: true,
    vwap: true,
    levels: true,
  })
  const [hoveredCandle, setHoveredCandle] = useState<AggregatedCandle | null>(null)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null)
  const maSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null)
  const priceLineCurrentRef = useRef<IPriceLine | null>(null)
  const priceLineHighRef = useRef<IPriceLine | null>(null)
  const priceLineLowRef = useRef<IPriceLine | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const candlesRef = useRef<AggregatedCandle[]>([])
  const [isReady, setIsReady] = useState(false)

  const { candles, volumes, latestCandle } = useMemo(
    () => aggregateCandles(ticks, selectedInterval),
    [selectedInterval, ticks],
  )

  const { ma20Data, vwapData } = useMemo(() => computeOverlayData(candles), [candles])
  const { localHigh, localLow } = useMemo(() => computeLocalLevels(candles, 20), [candles])

  // Keep ref in sync so the crosshair handler always reads latest candles
  useEffect(() => {
    candlesRef.current = candles
  }, [candles])

  const syncChartData = useCallback(
    (nextCandles: CandlestickData[], nextVolumes: HistogramData[]) => {
      if (!chartRef.current || !candleSeriesRef.current || !volumeSeriesRef.current) {
        return
      }

      candleSeriesRef.current.setData(nextCandles)
      volumeSeriesRef.current.setData(nextVolumes)

      if (nextCandles.length > 0) {
        chartRef.current.timeScale().scrollToRealTime()
      }
    },
    [],
  )

  useEffect(() => {
    let disposed = false

    async function mountChart() {
      if (!containerRef.current || chartRef.current) {
        return
      }

      const chartModule = await import("lightweight-charts")
      if (disposed || !containerRef.current) {
        return
      }

      const chart = chartModule.createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
        layout: {
          background: { type: ColorType.Solid, color: "rgba(8, 17, 31, 1)" },
          textColor: "rgba(226, 232, 240, 0.9)",
          fontFamily:
            "var(--font-geist-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)",
        },
        grid: {
          vertLines: { color: "rgba(255,255,255,0.05)" },
          horzLines: { color: "rgba(255,255,255,0.05)" },
        },
        crosshair: {
          mode: chartModule.CrosshairMode.Normal,
        },
        rightPriceScale: {
          borderVisible: false,
          scaleMargins: { top: 0.08, bottom: 0.2 },
        },
        leftPriceScale: {
          visible: false,
        },
        timeScale: {
          borderVisible: false,
          timeVisible: true,
          secondsVisible: true,
          fixLeftEdge: true,
          rightOffset: 6,
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
        handleScale: {
          axisPressedMouseMove: true,
          mouseWheel: true,
          pinch: true,
        },
        localization: {
          priceFormatter: (price: number) => formatCurrency(price, 2),
          timeFormatter: (time: Time) => {
            const timestamp = typeof time === "number" ? time * 1000 : Date.now()
            return new Date(timestamp).toISOString().slice(11, 23)
          },
        },
      })

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: "rgba(16, 185, 129, 0.95)",
        downColor: "rgba(248, 113, 113, 0.95)",
        borderVisible: false,
        wickUpColor: "rgba(16, 185, 129, 0.95)",
        wickDownColor: "rgba(248, 113, 113, 0.95)",
      })

      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: "rgba(148, 163, 184, 0.35)",
        priceFormat: {
          type: "volume",
        },
        priceScaleId: "",
      })

      const maSeries = chart.addSeries(LineSeries, {
        color: "rgba(251, 191, 36, 0.85)",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })

      const vwapSeries = chart.addSeries(LineSeries, {
        color: "rgba(139, 92, 246, 0.85)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })

      // Update hovered OHLC on crosshair move
      chart.subscribeCrosshairMove((param) => {
        if (!param.time) {
          setHoveredCandle(null)
          return
        }
        const found = candlesRef.current.find((c) => c.time === param.time)
        setHoveredCandle(found ?? null)
      })

      chartRef.current = chart
      candleSeriesRef.current = candleSeries
      volumeSeriesRef.current = volumeSeries
      maSeriesRef.current = maSeries
      vwapSeriesRef.current = vwapSeries
      resizeObserverRef.current = new ResizeObserver(() => {
        if (containerRef.current) {
          chart.resize(
            containerRef.current.clientWidth,
            containerRef.current.clientHeight,
          )
        }
      })
      resizeObserverRef.current.observe(containerRef.current)
      setIsReady(true)
    }

    void mountChart()

    return () => {
      disposed = true
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      chartRef.current?.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      maSeriesRef.current = null
      vwapSeriesRef.current = null
      priceLineCurrentRef.current = null
      priceLineHighRef.current = null
      priceLineLowRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!isReady) {
      return
    }

    syncChartData(candles, volumes)
  }, [candles, isReady, syncChartData, volumes])

  // Sync overlay series and price lines
  useEffect(() => {
    if (!isReady || !candleSeriesRef.current || !maSeriesRef.current || !vwapSeriesRef.current) {
      return
    }

    maSeriesRef.current.setData(overlays.ma20 ? ma20Data : [])
    vwapSeriesRef.current.setData(overlays.vwap ? vwapData : [])

    // Current price line
    if (priceLineCurrentRef.current) {
      candleSeriesRef.current.removePriceLine(priceLineCurrentRef.current)
      priceLineCurrentRef.current = null
    }
    if (overlays.priceLine && latestCandle) {
      priceLineCurrentRef.current = candleSeriesRef.current.createPriceLine({
        price: latestCandle.close,
        color: "rgba(226, 232, 240, 0.55)",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: "now",
      })
    }

    // Local high (resistance)
    if (priceLineHighRef.current) {
      candleSeriesRef.current.removePriceLine(priceLineHighRef.current)
      priceLineHighRef.current = null
    }
    if (overlays.levels && localHigh !== null) {
      priceLineHighRef.current = candleSeriesRef.current.createPriceLine({
        price: localHigh,
        color: "rgba(16, 185, 129, 0.5)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "R",
      })
    }

    // Local low (support)
    if (priceLineLowRef.current) {
      candleSeriesRef.current.removePriceLine(priceLineLowRef.current)
      priceLineLowRef.current = null
    }
    if (overlays.levels && localLow !== null) {
      priceLineLowRef.current = candleSeriesRef.current.createPriceLine({
        price: localLow,
        color: "rgba(248, 113, 113, 0.5)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "S",
      })
    }
  }, [isReady, overlays, ma20Data, vwapData, localHigh, localLow, latestCandle])

  const displayCandle = hoveredCandle ?? latestCandle

  const latestLabel =
    latestCandle === null
      ? "Waiting for live consensus candles."
      : `${CANDLE_INTERVALS.find((interval) => interval.seconds === selectedInterval)?.label ?? "1m"} candle`

  function toggleOverlay(key: OverlayKey) {
    setOverlays((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            TradingView Lightweight Chart
          </div>
          <div className="text-sm text-muted-foreground">
            Consolidated BTC candles built from the multi-exchange consensus tick stream.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {CANDLE_INTERVALS.map((interval) => (
            <Button
              key={interval.seconds}
              type="button"
              size="sm"
              variant={selectedInterval === interval.seconds ? "default" : "outline"}
              className={cn(
                "border-white/10",
                selectedInterval === interval.seconds
                  ? "bg-primary text-primary-foreground"
                  : "bg-white/[0.03]",
              )}
              onClick={() => setSelectedInterval(interval.seconds)}
            >
              {interval.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Overlays
        </span>
        {OVERLAY_CONFIG.map(({ key, label }) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={overlays[key] ? "default" : "outline"}
            className={cn(
              "h-6 border-white/10 px-2 text-[10px]",
              overlays[key]
                ? "bg-primary/80 text-primary-foreground"
                : "bg-white/[0.03] text-muted-foreground",
            )}
            onClick={() => toggleOverlay(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <CandleStat label="Open" value={formatCandleValue(displayCandle?.open)} />
        <CandleStat label="High" value={formatCandleValue(displayCandle?.high)} />
        <CandleStat label="Low" value={formatCandleValue(displayCandle?.low)} />
        <CandleStat label="Close" value={formatCandleValue(displayCandle?.close)} />
        <CandleStat label="Volume" value={formatVolume(displayCandle?.volume)} />
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
        <div ref={containerRef} className="h-[340px] w-full" />
        {candles.length === 0 ? (
          <div className="pointer-events-none -mt-[340px] flex h-[340px] items-center justify-center text-sm text-muted-foreground">
            Candle chart will populate once live consensus ticks arrive.
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
        <span>{latestLabel}</span>
        <span>{candles.length} candles</span>
        <span>{formatCompactNumber(ticks.length)} ticks</span>
      </div>
    </div>
  )
}

function aggregateCandles(ticks: RealtimeBtcTick[], intervalSeconds: CandleIntervalSeconds) {
  const sorted = [...ticks].sort((left, right) => left.exchangeTimeMs - right.exchangeTimeMs)
  const candles: AggregatedCandle[] = []
  const volumes: HistogramData[] = []

  for (const tick of sorted) {
    const bucketStartMs =
      Math.floor(tick.exchangeTimeMs / (intervalSeconds * 1000)) * intervalSeconds * 1000
    const candleTime = Math.floor(bucketStartMs / 1000) as UTCTimestamp
    const volume = tick.lastSize ?? 0
    const previous = candles.at(-1)

    if (previous && previous.time === candleTime) {
      previous.high = Math.max(previous.high, tick.price)
      previous.low = Math.min(previous.low, tick.price)
      previous.close = tick.price
      const lastVolume = volumes.at(-1)
      if (lastVolume && lastVolume.time === candleTime) {
        lastVolume.value += volume
      }
      continue
    }

    candles.push({
      time: candleTime,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      volume,
    })

    volumes.push({
      time: candleTime,
      value: volume,
      color: tick.price >= (previous?.close ?? tick.price)
        ? "rgba(16, 185, 129, 0.35)"
        : "rgba(248, 113, 113, 0.35)",
    })
  }

  return {
    candles,
    volumes,
    latestCandle: candles.at(-1) ?? null,
  }
}

function computeOverlayData(candles: AggregatedCandle[]): {
  ma20Data: LineData<UTCTimestamp>[]
  vwapData: LineData<UTCTimestamp>[]
} {
  const ma20Data: LineData<UTCTimestamp>[] = []
  const vwapData: LineData<UTCTimestamp>[] = []

  const hasVolume = candles.some((c) => c.volume > 0)

  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index]
    const windowStart = Math.max(0, index - 19)
    const slice = candles.slice(windowStart, index + 1)

    // 20-period simple moving average of close
    if (index >= 19) {
      const avg = slice.reduce((sum, c) => sum + c.close, 0) / 20
      ma20Data.push({ time: candle.time, value: avg })
    }

    // Rolling VWAP if volume data exists, otherwise rolling price mean
    if (hasVolume) {
      const totalVolume = slice.reduce((sum, c) => sum + c.volume, 0)
      if (totalVolume > 0) {
        const vwap = slice.reduce((sum, c) => sum + c.close * c.volume, 0) / totalVolume
        vwapData.push({ time: candle.time, value: vwap })
      }
    } else {
      const mean = slice.reduce((sum, c) => sum + c.close, 0) / slice.length
      vwapData.push({ time: candle.time, value: mean })
    }
  }

  return { ma20Data, vwapData }
}

function computeLocalLevels(
  candles: AggregatedCandle[],
  lookback: number,
): { localHigh: number | null; localLow: number | null } {
  if (candles.length === 0) {
    return { localHigh: null, localLow: null }
  }

  const slice = candles.slice(-lookback)
  return {
    localHigh: Math.max(...slice.map((c) => c.high)),
    localLow: Math.min(...slice.map((c) => c.low)),
  }
}

function CandleStat({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-medium text-foreground">{value}</div>
    </div>
  )
}

function formatCandleValue(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a"
  }

  return formatCurrency(value, 2)
}

function formatVolume(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a"
  }

  return `${formatCompactNumber(value)} BTC`
}
