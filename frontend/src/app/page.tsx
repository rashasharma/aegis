"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
} from "lightweight-charts";
import {
  Activity,
  ShieldAlert,
  TrendingUp,
  Cpu,
  Layers,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Shield,
  Zap,
  Play,
  Wallet,
  Check,
  Maximize2,
  CheckSquare,
  Square,
  BarChart2,
  LineChart as LineChartIcon,
} from "lucide-react";
import { useDashboardStore, Candle, ForkPoint } from "@/store/useDashboardStore";

const ASSET_COLORS: Record<string, string> = {
  "BTC-USD": "#06b6d4",
  "ETH-USD": "#a855f7",
  "SOL-USD": "#10b981",
  NVDA: "#f59e0b",
  AAPL: "#ec4899",
  MSFT: "#3b82f6",
  TSLA: "#f43f5e",
};

export default function Home() {
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);
  const [customCapitalInput, setCustomCapitalInput] = useState<string>("100000");
  const [chartReady, setChartReady] = useState(false);
  const [chartMode, setChartMode] = useState<"candlestick" | "comparative">("candlestick");

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const userPathSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bestPathSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const multiAssetSeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

  const {
    activeAsset,
    selectedAssets,
    activeCategory,
    availableAssets,
    currentPrice,
    prices,
    portfolioValue,
    cash,
    holdingsValue,
    directive,
    confidence,
    positions,
    liquidated,
    candles,
    allCandles,
    currentCandle,
    forkPoints,
    game,
    snapshotVersion,
    connect,
    disconnect,
    selectAsset,
    toggleAssetSelection,
    selectAllAssets,
    setActiveCategory,
    submitDecision,
    triggerPrompt,
    dismissDebrief,
    liquidate,
    reset,
  } = useDashboardStore();

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toUpperCase();

      if (game.state === "PROMPTING") {
        if (key === "B") submitDecision("BUY");
        if (key === "H") submitDecision("HOLD");
        if (key === "S") submitDecision("SELL");
      } else if (game.state === "IDLE") {
        if (key === "D") triggerPrompt();
      } else if (game.state === "DEBRIEF") {
        if (e.key === "Escape" || key === "C") dismissDebrief();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [game.state, submitDecision, triggerPrompt, dismissDebrief]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const container = chartContainerRef.current;
    const initialWidth = container.clientWidth || 700;

    const chart = createChart(container, {
      width: initialWidth,
      height: 380,
      layout: {
        background: { type: ColorType.Solid, color: "#09090b" },
        textColor: "#71717a",
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.03)" },
        horzLines: { color: "rgba(255, 255, 255, 0.03)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(255, 255, 255, 0.2)",
          width: 1,
          style: LineStyle.Dashed,
        },
        horzLine: {
          color: "rgba(255, 255, 255, 0.2)",
          width: 1,
          style: LineStyle.Dashed,
        },
      },
      rightPriceScale: {
        borderColor: "#27272a",
        scaleMargins: { top: 0.08, bottom: 0.24 },
      },
      leftPriceScale: {
        visible: false,
        borderColor: "#27272a",
        scaleMargins: { top: 0.15, bottom: 0.25 },
      },
      timeScale: {
        borderColor: "#27272a",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#f43f5e",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#f43f5e",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    const userPathSeries = chart.addSeries(LineSeries, {
      color: "#f59e0b",
      lineWidth: 2,
      priceScaleId: "left",
      title: "Your Path",
    });

    const bestPathSeries = chart.addSeries(LineSeries, {
      color: "#a855f7",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceScaleId: "left",
      title: "Optimal Path",
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) {
        setHoveredCandle(null);
        return;
      }
      const data = param.seriesData.get(candleSeries) as {
        open?: number;
        high?: number;
        low?: number;
        close?: number;
        time?: number;
      };
      if (data && data.open !== undefined) {
        const volData = param.seriesData.get(volumeSeries) as { value?: number };
        setHoveredCandle({
          time: Number(data.time),
          open: data.open,
          high: data.high ?? data.open,
          low: data.low ?? data.open,
          close: data.close ?? data.open,
          volume: volData?.value ?? 0,
        });
      } else {
        setHoveredCandle(null);
      }
    });

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width } = entries[0].contentRect;
      if (width > 0) {
        chart.applyOptions({ width });
      }
    });

    resizeObserver.observe(container);

    chartInstanceRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    userPathSeriesRef.current = userPathSeries;
    bestPathSeriesRef.current = bestPathSeries;
    setChartReady(true);

    const multiSeries = multiAssetSeriesRef.current;
    return () => {
      setChartReady(false);
      resizeObserver.disconnect();
      chart.remove();
      chartInstanceRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      userPathSeriesRef.current = null;
      bestPathSeriesRef.current = null;
      multiSeries.clear();
    };
  }, []);

  const isMultiAsset = selectedAssets.length > 1;
  const effectiveMode = isMultiAsset && chartMode === "comparative" ? "comparative" : "candlestick";

  useEffect(() => {
    if (!chartReady || !chartInstanceRef.current) return;
    const chart = chartInstanceRef.current;

    if (effectiveMode === "comparative") {
      if (candleSeriesRef.current) candleSeriesRef.current.setData([]);
      if (volumeSeriesRef.current) volumeSeriesRef.current.setData([]);

      for (const sym of selectedAssets) {
        let series = multiAssetSeriesRef.current.get(sym);
        if (!series) {
          series = chart.addSeries(LineSeries, {
            color: ASSET_COLORS[sym] || "#06b6d4",
            lineWidth: 2,
            title: sym.replace("-USD", ""),
            priceFormat: {
              type: "custom",
              formatter: (val: number) => `${val >= 0 ? "+" : ""}${val.toFixed(2)}%`,
            },
          });
          multiAssetSeriesRef.current.set(sym, series);
        }

        const symCandles = sym === activeAsset ? candles : (allCandles[sym] || []);
        if (symCandles.length > 0) {
          const sorted = [...symCandles].sort((a, b) => a.time - b.time);
          const basePrice = sorted[0].close;
          const unique: { time: UTCTimestamp; value: number }[] = [];
          let lastTime = -1;
          for (const c of sorted) {
            const t = Math.floor(c.time);
            if (t > lastTime && !isNaN(c.close) && basePrice > 0) {
              const pct = ((c.close - basePrice) / basePrice) * 100;
              unique.push({ time: t as UTCTimestamp, value: Number(pct.toFixed(2)) });
              lastTime = t;
            }
          }
          series.setData(unique);
        } else {
          series.setData([]);
        }
      }

      for (const [sym, series] of multiAssetSeriesRef.current.entries()) {
        if (!selectedAssets.includes(sym)) {
          series.setData([]);
        }
      }

      chart.timeScale().fitContent();
    } else {
      for (const series of multiAssetSeriesRef.current.values()) {
        series.setData([]);
      }

      const storeCandles = useDashboardStore.getState().candles;
      if (candleSeriesRef.current && volumeSeriesRef.current && storeCandles.length > 0) {
        const sorted = [...storeCandles].sort((a, b) => a.time - b.time);
        const unique: Candle[] = [];
        let lastTime = -1;
        for (const c of sorted) {
          const t = Math.floor(c.time);
          if (t > lastTime && !isNaN(c.open) && !isNaN(c.close)) {
            unique.push({ ...c, time: t });
            lastTime = t;
          }
        }

        if (unique.length > 0) {
          candleSeriesRef.current.setData(
            unique.map((c) => ({
              time: c.time as UTCTimestamp,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
            }))
          );

          volumeSeriesRef.current.setData(
            unique.map((c) => ({
              time: c.time as UTCTimestamp,
              value: c.volume,
              color: c.close >= c.open ? "rgba(16, 185, 129, 0.4)" : "rgba(244, 63, 94, 0.4)",
            }))
          );

          chart.timeScale().fitContent();
        }
      }
    }
  }, [effectiveMode, selectedAssets, activeAsset, snapshotVersion, chartReady, allCandles, candles]);

  useEffect(() => {
    if (!currentCandle) return;
    const t = Math.floor(currentCandle.time);

    if (effectiveMode === "comparative") {
      const series = multiAssetSeriesRef.current.get(activeAsset);
      const symCandles = candles;
      const basePrice = symCandles.length > 0 && symCandles[0].close > 0 ? symCandles[0].close : currentCandle.open;
      if (series && basePrice > 0) {
        const pct = ((currentCandle.close - basePrice) / basePrice) * 100;
        series.update({
          time: t as UTCTimestamp,
          value: Number(pct.toFixed(2)),
        });
      }
    } else {
      if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
      candleSeriesRef.current.update({
        time: t as UTCTimestamp,
        open: currentCandle.open,
        high: currentCandle.high,
        low: currentCandle.low,
        close: currentCandle.close,
      });

      volumeSeriesRef.current.update({
        time: t as UTCTimestamp,
        value: currentCandle.volume,
        color: currentCandle.close >= currentCandle.open ? "rgba(16, 185, 129, 0.4)" : "rgba(244, 63, 94, 0.4)",
      });
    }
  }, [currentCandle, effectiveMode, activeAsset, candles]);

  useEffect(() => {
    if (!chartInstanceRef.current || !userPathSeriesRef.current || !bestPathSeriesRef.current) return;

    if (game.state === "EVALUATING" && forkPoints.length > 0) {
      chartInstanceRef.current.priceScale("left").applyOptions({ visible: true });

      const sorted = [...forkPoints].sort((a, b) => a.time - b.time);
      const unique: ForkPoint[] = [];
      let lastTime = -1;
      for (const f of sorted) {
        const t = Math.floor(f.time);
        if (t > lastTime) {
          unique.push({ ...f, time: t });
          lastTime = t;
        }
      }

      userPathSeriesRef.current.setData(
        unique.map((f) => ({
          time: f.time as UTCTimestamp,
          value: f.user_equity,
        }))
      );

      bestPathSeriesRef.current.setData(
        unique.map((f) => ({
          time: f.time as UTCTimestamp,
          value: f.best_equity,
        }))
      );
    } else {
      userPathSeriesRef.current.setData([]);
      bestPathSeriesRef.current.setData([]);
      chartInstanceRef.current.priceScale("left").applyOptions({ visible: false });
    }
  }, [forkPoints, game.state]);

  const activeCandle = hoveredCandle || (candles.length > 0 ? candles[candles.length - 1] : null);

  const filteredAssets = useMemo(() => {
    if (activeCategory === "all") return availableAssets;
    return availableAssets.filter((a) => a.type === activeCategory);
  }, [availableAssets, activeCategory]);

  let confidenceColor = "bg-slate-500";
  let confidenceTextColor = "text-slate-400";

  if (confidence > 0.55) {
    confidenceColor = "bg-emerald-500";
    confidenceTextColor = "text-emerald-400";
  } else if (confidence < 0.45) {
    confidenceColor = "bg-rose-500";
    confidenceTextColor = "text-rose-400";
  }

  const positionBadges = {
    BUY: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    SELL: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    HOLD: "bg-zinc-800 text-zinc-400 border-zinc-700",
  };

  const handleApplyStartingCapital = (presetVal?: number) => {
    const val = presetVal !== undefined ? presetVal : parseFloat(customCapitalInput);
    if (!isNaN(val) && val > 0) {
      setCustomCapitalInput(val.toString());
      reset(val);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col antialiased selection:bg-zinc-800 font-sans">
      {liquidated && (
        <div className="bg-rose-950/60 border-b border-rose-800 py-2.5 px-4 text-center text-xs font-semibold text-rose-200 tracking-wider flex items-center justify-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-400" />
          <span>RISK ENGINE ACTIVE: ALL POSITIONS FLATTENED TO CASH</span>
          <button
            onClick={() => reset()}
            className="ml-4 px-2.5 py-1 rounded-md bg-rose-900/80 hover:bg-rose-800 transition-colors text-white border border-rose-700 flex items-center gap-1.5 cursor-pointer text-xs font-mono"
          >
            <RefreshCw className="w-3 h-3" /> Re-enable Trading
          </button>
        </div>
      )}

      <div className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 lg:p-8 flex flex-col gap-6">
        <header className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 md:px-6 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400">
              <Zap className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h1 className="text-base font-semibold font-mono tracking-tight text-zinc-100">AEGIS</h1>
              <p className="text-xs text-zinc-400">Algorithmic Trading & Risk Management Console</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={triggerPrompt}
              disabled={game.state !== "IDLE"}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-100 text-xs font-mono font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
            >
              <Play className="w-3.5 h-3.5 text-cyan-400 fill-current" />
              <span>Decision Drill</span>
              <kbd className="hidden sm:inline px-1.5 py-0.5 text-[10px] bg-zinc-900 rounded text-zinc-400 border border-zinc-700">
                D
              </kbd>
            </button>

            <button
              onClick={() => handleApplyStartingCapital()}
              title="Reset Simulation to Configured Balance"
              className="p-2 rounded-md border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5 md:p-4 flex flex-col gap-3 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono uppercase text-zinc-400 font-semibold tracking-wider">
                Universe:
              </span>
              <div className="inline-flex items-center p-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-xs font-mono">
                <button
                  onClick={() => setActiveCategory("all")}
                  className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                    activeCategory === "all" ? "bg-zinc-800 text-white font-medium shadow-xs" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  All Assets
                </button>
                <button
                  onClick={() => setActiveCategory("crypto")}
                  className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                    activeCategory === "crypto" ? "bg-zinc-800 text-white font-medium shadow-xs" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Crypto
                </button>
                <button
                  onClick={() => setActiveCategory("equity")}
                  className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                    activeCategory === "equity" ? "bg-zinc-800 text-white font-medium shadow-xs" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Equities
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono">
              <button
                onClick={selectAllAssets}
                className="px-2.5 py-1 rounded text-[11px] font-mono text-zinc-400 hover:text-zinc-100 border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Select All ({availableAssets.length})
              </button>
              <button
                onClick={() => selectAsset(activeAsset)}
                className="px-2.5 py-1 rounded text-[11px] font-mono text-cyan-400 hover:text-cyan-300 border border-cyan-500/30 bg-cyan-500/10 transition-colors cursor-pointer"
              >
                Focus {activeAsset} Only
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {filteredAssets.map((asset) => {
              const isSelected = selectedAssets.includes(asset.symbol);
              const isActive = activeAsset === asset.symbol;
              const livePrice = prices[asset.symbol] ?? asset.default_price;

              return (
                <div
                  key={asset.symbol}
                  onClick={() => toggleAssetSelection(asset.symbol)}
                  className={`flex flex-col gap-1.5 p-2.5 rounded-lg border text-xs font-mono transition-all cursor-pointer select-none ${
                    isActive
                      ? "border-cyan-500/50 bg-zinc-850 text-white shadow-xs ring-1 ring-cyan-500/30"
                      : isSelected
                      ? "border-zinc-700 bg-zinc-900 text-zinc-100"
                      : "border-zinc-800/80 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {isSelected ? (
                        <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
                      ) : (
                        <Square className="w-3.5 h-3.5 text-zinc-600" />
                      )}
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: ASSET_COLORS[asset.symbol] || "#06b6d4" }}
                      />
                      <span className="font-semibold text-zinc-100">{asset.symbol.replace("-USD", "")}</span>
                    </div>
                    {isActive && (
                      <span className="text-[9px] font-bold px-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                        FOCUS
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[11px] pt-0.5 tabular-nums">
                    <span className="text-zinc-300 font-medium">
                      ${livePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-[10px] text-zinc-500 uppercase">
                      {asset.type === "crypto" ? "Crypto" : "Equity"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 md:p-5 flex flex-col gap-4 min-h-[440px] shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-cyan-400" />
                  <h2 className="text-xs font-bold uppercase tracking-wider font-mono text-zinc-200">
                    {effectiveMode === "comparative"
                      ? `Comparative Return (${selectedAssets.length} Assets)`
                      : `${activeAsset} Candlestick Feed`}
                  </h2>
                </div>

                {isMultiAsset && (
                  <div className="inline-flex items-center p-0.5 rounded-md bg-zinc-950 border border-zinc-800 text-[11px] font-mono">
                    <button
                      onClick={() => setChartMode("candlestick")}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded transition-colors cursor-pointer ${
                        effectiveMode === "candlestick"
                          ? "bg-zinc-800 text-zinc-100 font-medium shadow-xs"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <BarChart2 className="w-3 h-3" />
                      <span>Candles</span>
                    </button>
                    <button
                      onClick={() => setChartMode("comparative")}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded transition-colors cursor-pointer ${
                        effectiveMode === "comparative"
                          ? "bg-zinc-800 text-zinc-100 font-medium shadow-xs"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <LineChartIcon className="w-3 h-3" />
                      <span>Comparative %</span>
                    </button>
                  </div>
                )}

                <button
                  onClick={() => chartInstanceRef.current?.timeScale().fitContent()}
                  title="Fit Content / Reset Zoom"
                  className="p-1 rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
                <span className="text-zinc-300">
                  Price: <strong className="text-zinc-100">${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                </span>
                <span className="text-zinc-300">
                  Portfolio: <strong className="text-emerald-400">${portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono tabular-nums pb-1">
              {effectiveMode === "comparative" ? (
                <div className="flex flex-wrap items-center gap-2">
                  {selectedAssets.map((sym) => {
                    const symCandles = sym === activeAsset ? candles : (allCandles[sym] || []);
                    let retStr = "0.00%";
                    let isPos = true;
                    if (symCandles.length > 0) {
                      const base = symCandles[0].close;
                      const curr = symCandles[symCandles.length - 1].close;
                      if (base > 0) {
                        const pct = ((curr - base) / base) * 100;
                        isPos = pct >= 0;
                        retStr = `${isPos ? "+" : ""}${pct.toFixed(2)}%`;
                      }
                    }
                    return (
                      <div key={sym} className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-zinc-800 bg-zinc-950/60 text-[11px]">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ASSET_COLORS[sym] || "#06b6d4" }} />
                        <span className="text-zinc-200 font-semibold">{sym.replace("-USD", "")}</span>
                        <span className={isPos ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>{retStr}</span>
                      </div>
                    );
                  })}
                </div>
              ) : activeCandle ? (
                <div className="flex flex-wrap items-center gap-3 md:gap-5 text-zinc-400 text-xs">
                  <span>O: <strong className="text-zinc-200">{activeCandle.open.toFixed(2)}</strong></span>
                  <span>H: <strong className="text-emerald-400">{activeCandle.high.toFixed(2)}</strong></span>
                  <span>L: <strong className="text-rose-400">{activeCandle.low.toFixed(2)}</strong></span>
                  <span>C: <strong className={activeCandle.close >= activeCandle.open ? "text-emerald-400" : "text-rose-400"}>{activeCandle.close.toFixed(2)}</strong></span>
                  <span>Vol: <strong className="text-zinc-200">{Math.round(activeCandle.volume).toLocaleString()}</strong></span>
                </div>
              ) : (
                <span className="text-zinc-500">Connecting...</span>
              )}

              {effectiveMode === "candlestick" && (
                <div className="flex items-center gap-3 text-[11px]">
                  <div className="flex items-center gap-1 text-zinc-400">
                    <span className="w-2 h-2 rounded-xs bg-emerald-500 inline-block" />
                    <span>Bullish</span>
                  </div>
                  <div className="flex items-center gap-1 text-zinc-400">
                    <span className="w-2 h-2 rounded-xs bg-rose-500 inline-block" />
                    <span>Bearish</span>
                  </div>
                  {game.state === "EVALUATING" && (
                    <>
                      <div className="flex items-center gap-1 text-amber-400 font-semibold">
                        <span className="w-3.5 h-0.5 bg-amber-400 inline-block" />
                        <span>Your Path</span>
                      </div>
                      <div className="flex items-center gap-1 text-purple-400 font-semibold">
                        <span className="w-3.5 h-0.5 bg-purple-400 border-b border-dashed border-purple-400 inline-block" />
                        <span>Optimal Path</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {game.state === "PROMPTING" && game.prompt && (
              <div className="p-4 rounded-lg bg-zinc-950 border border-cyan-500/40 flex flex-col gap-3">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="font-bold text-white uppercase">{game.prompt.headline}</span>
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    {game.prompt.time_left}s remaining
                  </span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed font-sans">{game.prompt.context}</p>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => submitDecision("BUY")}
                    className="flex-1 py-2 px-3 rounded-md bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold font-mono transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    <span>[B] BUY</span>
                  </button>
                  <button
                    onClick={() => submitDecision("HOLD")}
                    className="flex-1 py-2 px-3 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-bold font-mono transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Shield className="w-3.5 h-3.5" />
                    <span>[H] HOLD</span>
                  </button>
                  <button
                    onClick={() => submitDecision("SELL")}
                    className="flex-1 py-2 px-3 rounded-md bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 text-xs font-bold font-mono transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ArrowDownRight className="w-3.5 h-3.5" />
                    <span>[S] SELL</span>
                  </button>
                </div>
              </div>
            )}

            {game.state === "EVALUATING" && game.evaluation && (
              <div className="p-3 rounded-lg bg-zinc-950 border border-cyan-500/40 flex items-center justify-between text-xs font-mono">
                <span className="text-zinc-200">
                  Simulating: <strong className="text-cyan-400">{game.evaluation.user_choice}</strong> at ${game.evaluation.start_price.toFixed(2)}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-amber-400">Amber: Your Path</span>
                  <span className="text-purple-400">Purple: Optimal</span>
                  <span className="text-zinc-400 font-bold">{game.evaluation.time_left}s</span>
                </div>
              </div>
            )}

            <div className="w-full relative min-h-[380px] rounded-lg overflow-hidden bg-zinc-950 border border-zinc-800/80">
              <div ref={chartContainerRef} className="w-full h-[380px]" />
              {candles.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-zinc-950/90 backdrop-blur-xs z-10">
                  <Activity className="w-6 h-6 text-cyan-400 animate-spin" />
                  <p className="text-xs text-zinc-400 font-mono">Connecting to live market stream...</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 md:p-5 flex flex-col justify-between gap-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  <h2 className="text-xs font-bold uppercase tracking-wider font-mono text-zinc-300">
                    ML Brain Diagnostics
                  </h2>
                </div>
                <span className={`text-[11px] font-bold font-mono px-2.5 py-0.5 rounded border ${positionBadges[directive]}`}>
                  {directive}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center text-xs font-mono tabular-nums">
                  <span className="text-zinc-400">XGBoost Buy Probability ({activeAsset})</span>
                  <span className={`font-bold ${confidenceTextColor}`}>{Math.round(confidence * 100)}%</span>
                </div>

                <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${confidenceColor} transition-all duration-500`}
                    style={{ width: `${confidence * 100}%` }}
                  />
                </div>

                <div className="flex justify-between text-[10px] text-zinc-500 font-mono mt-0.5">
                  <span>BEARISH (&lt;47%)</span>
                  <span>NEUTRAL</span>
                  <span>BULLISH (&gt;53%)</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 border-t border-zinc-800/80 pt-3 text-center font-mono">
                <div className="p-2 rounded bg-zinc-950/50 border border-zinc-800/80">
                  <span className="text-[10px] text-zinc-500 block">RSI (14)</span>
                  <span className="text-xs font-bold text-zinc-200">{useDashboardStore.getState().indicators.rsi.toFixed(1)}</span>
                </div>
                <div className="p-2 rounded bg-zinc-950/50 border border-zinc-800/80">
                  <span className="text-[10px] text-zinc-500 block">SMA RATIO</span>
                  <span className="text-xs font-bold text-zinc-200">{useDashboardStore.getState().indicators.sma_ratio.toFixed(4)}</span>
                </div>
                <div className="p-2 rounded bg-zinc-950/50 border border-zinc-800/80">
                  <span className="text-[10px] text-zinc-500 block">VOLATILITY</span>
                  <span className="text-xs font-bold text-zinc-200">{useDashboardStore.getState().indicators.volatility.toFixed(4)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 md:p-5 flex flex-col gap-3.5 shadow-xs">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-cyan-400" />
                  <h2 className="text-xs font-bold uppercase tracking-wider font-mono text-zinc-300">
                    Starting Capital
                  </h2>
                </div>
                <span className="text-xs font-mono text-emerald-400 font-medium tabular-nums">
                  ${cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                Set starting portfolio balance or benchmark performance against capital tiers:
              </p>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-2 text-xs font-mono text-zinc-500">$</span>
                  <input
                    type="number"
                    min="1000"
                    step="5000"
                    value={customCapitalInput}
                    onChange={(e) => setCustomCapitalInput(e.target.value)}
                    className="w-full pl-6 pr-3 py-1.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-100 font-mono text-xs focus:outline-none focus:border-zinc-600 tabular-nums shadow-xs"
                  />
                </div>
                <button
                  onClick={() => handleApplyStartingCapital()}
                  className="px-3 py-1.5 rounded-md bg-zinc-100 hover:bg-zinc-200 text-zinc-900 text-xs font-mono font-medium transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Set</span>
                </button>
              </div>

              <div className="grid grid-cols-4 gap-1.5 pt-1">
                {[50000, 100000, 250000, 1000000].map((val) => (
                  <button
                    key={val}
                    onClick={() => handleApplyStartingCapital(val)}
                    className={`py-1 rounded text-[10px] font-mono transition-colors border cursor-pointer ${
                      Number(customCapitalInput) === val
                        ? "bg-zinc-800 text-zinc-100 border-zinc-600 font-medium shadow-xs"
                        : "bg-zinc-950/60 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    ${val >= 1000000 ? `${val / 1000000}M` : `${val / 1000}k`}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 md:p-5 flex flex-col gap-3 shadow-xs">
              <div className="flex items-center gap-2 border-b border-zinc-800/80 pb-3">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider font-mono text-zinc-300">
                  Risk Management Kill-Switch
                </h2>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                Emergency liquidation flattens all open exposure across all held instruments into liquid cash immediately.
              </p>

              <button
                onClick={liquidate}
                disabled={liquidated}
                className={`w-full py-2.5 rounded-md text-xs font-semibold tracking-wider uppercase font-mono select-none flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-xs ${
                  liquidated
                    ? "bg-zinc-800 text-zinc-500 border border-zinc-700/50 cursor-not-allowed"
                    : "bg-rose-600 hover:bg-rose-700 text-white"
                }`}
              >
                <ShieldAlert className="w-4 h-4" />
                <span>{liquidated ? "Engine Locked" : "Emergency Liquidate"}</span>
              </button>
            </div>
          </div>
        </div>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 md:p-5 flex flex-col gap-4 shadow-xs">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-zinc-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider font-mono text-zinc-300">
                Active Open Exposure
              </h2>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
              <span className="text-zinc-400">Holdings: <strong className="text-zinc-200">${holdingsValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
              <span className="text-zinc-400">Open Positions: <strong className="text-cyan-400">{positions.length}</strong></span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-800/80 bg-zinc-950/40">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/50 text-zinc-400 font-mono text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-3.5 font-medium">Asset</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Position Size</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Entry Price</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Current Price</th>
                  <th className="py-2.5 px-3.5 font-medium text-right">Unrealized PnL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-mono tabular-nums">
                {positions.length > 0 ? (
                  positions.map((pos) => (
                    <tr key={pos.symbol} className="hover:bg-zinc-900/40 transition-colors">
                      <td className="py-2.5 px-3.5 font-semibold text-zinc-100 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ASSET_COLORS[pos.symbol] || "#06b6d4" }} />
                        <span>{pos.symbol}</span>
                      </td>
                      <td className="py-2.5 px-3.5 text-right text-zinc-300">{pos.size}</td>
                      <td className="py-2.5 px-3.5 text-right text-zinc-300">${pos.entry_price.toFixed(2)}</td>
                      <td className="py-2.5 px-3.5 text-right text-zinc-300">${pos.current_price.toFixed(2)}</td>
                      <td className={`py-2.5 px-3.5 text-right font-semibold ${pos.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {pos.pnl >= 0 ? "+" : ""}${pos.pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-zinc-500 italic font-sans">
                      {liquidated ? "Risk protocol active. All trading assets liquidated." : "No open exposures currently detected."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {game.state === "DEBRIEF" && game.debrief && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-lg p-6 rounded-xl bg-zinc-950 border border-zinc-800 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="font-bold text-sm text-zinc-100 font-mono uppercase">Post-Drill Debrief</h3>
                <p className="text-xs text-zinc-400 font-mono">{activeAsset} Evaluation Result</p>
              </div>
              <span
                className={`text-base font-bold font-mono px-3 py-0.5 rounded border ${
                  game.debrief.grade === "A"
                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                    : game.debrief.grade === "B"
                    ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                    : game.debrief.grade === "C"
                    ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                    : "bg-rose-500/20 text-rose-400 border-rose-500/30"
                }`}
              >
                Grade: {game.debrief.grade}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2.5 text-center font-mono text-xs tabular-nums">
              <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800">
                <span className="text-[10px] text-zinc-400 block mb-1">YOUR CHOICE</span>
                <span className="font-bold text-zinc-100 block">{game.debrief.user_choice}</span>
                <span className={`text-[11px] font-bold mt-1 block ${game.debrief.user_pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {game.debrief.user_pnl >= 0 ? "+" : ""}${game.debrief.user_pnl.toFixed(2)}
                </span>
                {game.debrief.user_choice === "HOLD" && (
                  <span className="text-[9px] text-zinc-500 block mt-0.5">Cash Preserved</span>
                )}
              </div>

              <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800">
                <span className="text-[10px] text-zinc-400 block mb-1">OPTIMAL PLAY</span>
                <span className="font-bold text-purple-400 block">{game.debrief.best_choice}</span>
                <span className="text-[11px] font-bold text-emerald-400 mt-1 block">
                  +${game.debrief.best_pnl.toFixed(2)}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800">
                <span className="text-[10px] text-zinc-400 block mb-1">AI MODEL</span>
                <span className="font-bold text-cyan-400 block">{game.debrief.ml_choice}</span>
                <span className={`text-[11px] font-bold mt-1 block ${game.debrief.ml_pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {game.debrief.ml_pnl >= 0 ? "+" : ""}${game.debrief.ml_pnl.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono tabular-nums space-y-1">
              <div className="flex justify-between text-zinc-400">
                <span>Movement:</span>
                <span className={game.debrief.pct_change >= 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                  {game.debrief.pct_change >= 0 ? "+" : ""}{game.debrief.pct_change.toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Start / Final Price:</span>
                <span className="text-zinc-200">${game.debrief.start_price.toFixed(2)} → ${game.debrief.final_price.toFixed(2)}</span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 leading-relaxed font-sans">
              <strong className="text-cyan-400 block mb-1 font-mono text-[10px] uppercase">Educational Takeaway</strong>
              {game.debrief.lesson}
            </div>

            <button
              onClick={dismissDebrief}
              className="w-full py-2 rounded-md bg-zinc-100 hover:bg-zinc-200 text-zinc-900 text-xs font-mono font-semibold transition-colors cursor-pointer shadow-xs"
            >
              Continue Trading
            </button>
          </div>
        </div>
      )}

      <footer className="py-6 border-t border-zinc-800/60 text-center text-[11px] text-zinc-500 font-mono tracking-wider uppercase">
        © 2026 Aegis Systems Inc. Protected Cloud Node
      </footer>
    </div>
  );
}
