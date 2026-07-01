"use client";

import { useEffect, useState } from "react";
import { useDashboardStore } from "@/store/useDashboardStore";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Legend 
} from "recharts";
import { 
  Activity, 
  ShieldAlert, 
  TrendingUp, 
  Cpu, 
  TrendingDown,
  DollarSign,
  Layers,
  RefreshCw,
  Zap
} from "lucide-react";

export default function Home() {
  const [mounted, setMounted] = useState(false);
  
  const {
    connected,
    ticks,
    symbol,
    currentPrice,
    portfolioValue,
    activePosition,
    xgboostConfidence,
    positions,
    liquidated,
    alert,
    connect,
    disconnect,
    liquidate,
    resetSimulation
  } = useDashboardStore();

  useEffect(() => {
    setMounted(true);
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Determine XGBoost Confidence colors
  // Green > 0.6, Red < 0.4, Gray/Slate otherwise
  let confidenceColor = "bg-zinc-500";
  let confidenceTextColor = "text-zinc-400";
  let confidenceBorderColor = "border-zinc-500/20";
  let confidenceGlowClass = "glass-panel";

  if (xgboostConfidence > 0.6) {
    confidenceColor = "bg-emerald-500";
    confidenceTextColor = "text-emerald-400";
    confidenceBorderColor = "border-emerald-500/20";
    confidenceGlowClass = "glass-panel glass-panel-glow-green";
  } else if (xgboostConfidence < 0.4) {
    confidenceColor = "bg-rose-500";
    confidenceTextColor = "text-rose-400";
    confidenceBorderColor = "border-rose-500/20";
    confidenceGlowClass = "glass-panel glass-panel-glow-red";
  }

  // Active Position badges styling
  const positionBadges = {
    BUY: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]",
    SELL: "bg-rose-500/10 text-rose-400 border-rose-500/20 shadow-[0_0_10px_rgba(244,63,94,0.1)]",
    HOLD: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
  };

  return (
    <div className="min-h-screen bg-[#07070a] bg-radial-[at_top_right,_var(--tw-gradient-stops)] from-slate-900/40 via-neutral-950 to-black text-gray-100 flex flex-col selection:bg-rose-500/30">
      {/* Top Banner Alert if liquidated */}
      {liquidated && (
        <div className="bg-rose-950/30 border-b border-rose-500/20 backdrop-blur-md py-2 px-4 text-center text-xs font-semibold text-rose-400 tracking-wider flex items-center justify-center gap-2 animate-pulse">
          <ShieldAlert className="w-4 h-4" />
          <span>RISK ENGINE ACTIVE: ALL POSITIONS LIQUIDATED (FLATTENED)</span>
          <button 
            onClick={resetSimulation} 
            className="ml-4 px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/40 transition-colors text-white border border-rose-500/40 flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" /> Re-enable Trading
          </button>
        </div>
      )}

      {/* Main Container */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 lg:p-8 flex flex-col gap-6">
        
        {/* Header Module */}
        <header className="glass-panel rounded-2xl p-4 md:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-white/5 border border-white/10 text-rose-400">
              <Zap className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl font-mono">Aegis</h1>
                <span className="text-[10px] font-mono tracking-widest bg-white/5 text-slate-400 px-1.5 py-0.5 rounded border border-white/5">v1.4</span>
              </div>
              <p className="text-xs text-slate-400">Algorithmic Trading & Risk Engine Control Console</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Simulation reset */}
            <button
              onClick={resetSimulation}
              title="Reset Simulated Data Stream"
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-slate-300 hover:text-white flex items-center justify-center cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            {/* Connection Status Indicator */}
            <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full border border-white/5 text-xs">
              <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500 status-dot-active text-emerald-500" : "bg-rose-500 text-rose-500"}`} />
              <span className="font-mono text-slate-300 tracking-wider">
                {connected ? "LIVE_STREAM" : "DISCONNECTED"}
              </span>
            </div>
          </div>
        </header>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Main Chart Module (Left Column, Span 2) */}
          <div className="lg:col-span-2 glass-panel rounded-2xl p-4 md:p-6 flex flex-col gap-4 min-h-[420px]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-400" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Live Analytics Feed</h2>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono">
                <span className="text-blue-400">{symbol}: ${symbol === "BTC-USD" ? currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : currentPrice.toFixed(2)}</span>
                <span className="text-emerald-400">Portfolio: ${portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
            
            <div className="flex-1 w-full relative min-h-[300px]">
              {mounted && ticks.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={ticks} margin={{ top: 10, right: 5, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="priceGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                    <XAxis 
                      dataKey="time" 
                      stroke="rgba(255,255,255,0.3)" 
                      fontSize={10} 
                      tickLine={false} 
                      axisLine={false}
                    />
                    <YAxis 
                      yAxisId="left" 
                      stroke="#3b82f6" 
                      fontSize={10} 
                      tickLine={false} 
                      axisLine={false}
                      domain={['auto', 'auto']}
                    />
                    <YAxis 
                      yAxisId="right" 
                      orientation="right" 
                      stroke="#10b981" 
                      fontSize={10} 
                      tickLine={false} 
                      axisLine={false}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip 
                      contentStyle={{
                        background: "rgba(10, 10, 15, 0.95)",
                        border: "1px solid rgba(255, 255, 255, 0.1)",
                        borderRadius: "12px",
                        fontFamily: "monospace",
                        fontSize: "11px",
                      }}
                      itemStyle={{ color: "#fff" }}
                    />
                    <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                    <Line 
                      yAxisId="left" 
                      type="monotone" 
                      dataKey="price" 
                      name={`${symbol} Price`} 
                      stroke="#3b82f6" 
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, stroke: '#3b82f6', strokeWidth: 1 }}
                    />
                    <Line 
                      yAxisId="right" 
                      type="monotone" 
                      dataKey="portfolioValue" 
                      name="Portfolio Balance" 
                      stroke="#10b981" 
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, stroke: '#10b981', strokeWidth: 1 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <Activity className="w-8 h-8 text-blue-500 animate-spin" />
                  <p className="text-xs text-slate-400 font-mono">WAITING_FOR_LIVE_DATA_TICK...</p>
                </div>
              )}
            </div>
          </div>

          {/* ML Brain Diagnostics (Right Column) */}
          <div className="flex flex-col gap-6">
            
            {/* Machine Learning Panel */}
            <div className={`${confidenceGlowClass} rounded-2xl p-4 md:p-6 flex flex-col justify-between gap-6`}>
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-indigo-400" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">ML Brain Diagnostics</h2>
              </div>

              {/* XGBoost Gauge */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center text-xs font-mono">
                  <span className="text-slate-400">XGBoost Buy Probability</span>
                  <span className={`font-bold ${confidenceTextColor}`}>{Math.round(xgboostConfidence * 100)}%</span>
                </div>
                
                {/* Horizontal Progress Bar Bar with glow indicator */}
                <div className="h-2.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/5 relative">
                  <div 
                    className={`h-full ${confidenceColor} transition-all duration-1000 ease-out`}
                    style={{ width: `${xgboostConfidence * 100}%` }}
                  />
                </div>

                <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
                  <span>BEARISH (&lt;40%)</span>
                  <span>NEUTRAL</span>
                  <span>BULLISH (&gt;60%)</span>
                </div>
              </div>

              {/* Reinforcement Learning Agent active position */}
              <div className="border-t border-white/5 pt-4 flex flex-col gap-2">
                <span className="text-xs font-mono text-slate-400">RL Agent Active Directive</span>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">Position Execution</span>
                  <span className={`text-xs font-bold font-mono px-3 py-1 rounded-full border ${positionBadges[activePosition]} transition-all duration-300`}>
                    {activePosition}
                  </span>
                </div>
              </div>
            </div>

            {/* Risk Control Panel / Kill-Switch */}
            <div className="glass-panel rounded-2xl p-4 md:p-6 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-rose-400" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Risk Engine Controls</h2>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Triggering the kill-switch flattens all active exposure. The agent halts executing orders and locks the portfolio in liquid cash assets until safety protocol resets.
              </p>
              
              <button
                onClick={liquidate}
                disabled={liquidated}
                className={`w-full py-4 rounded-xl text-sm font-bold tracking-wider uppercase font-mono select-none flex items-center justify-center gap-2 cursor-pointer ${
                  liquidated 
                    ? "bg-zinc-800 text-zinc-500 border border-zinc-700/50 cursor-not-allowed" 
                    : "glow-button text-white"
                }`}
              >
                <ShieldAlert className="w-4 h-4" />
                {liquidated ? "Engine Locked" : "Emergency Liquidate"}
              </button>
            </div>
          </div>
        </div>

        {/* Positions Table (Bottom Row) */}
        <section className="glass-panel rounded-2xl p-4 md:p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-slate-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Active Open Exposure</h2>
            </div>
            <span className="text-xs text-slate-500 font-mono">Total Assets: {positions.length}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs md:text-sm">
              <thead>
                <tr className="border-b border-white/5 text-slate-500 font-mono text-[10px] uppercase tracking-wider">
                  <th className="pb-3 font-medium">Asset Class</th>
                  <th className="pb-3 font-medium text-right">Position Size</th>
                  <th className="pb-3 font-medium text-right">Entry Price</th>
                  <th className="pb-3 font-medium text-right">Current Price</th>
                  <th className="pb-3 font-medium text-right">Unrealized PnL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono">
                {positions.length > 0 ? (
                  positions.map((pos) => (
                    <tr key={pos.symbol} className="hover:bg-white/[0.01] transition-colors">
                      <td className="py-3 font-semibold text-white flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        {pos.symbol}
                      </td>
                      <td className="py-3 text-right text-slate-300">{pos.size}</td>
                      <td className="py-3 text-right text-slate-300">${pos.entry_price.toFixed(2)}</td>
                      <td className="py-3 text-right text-slate-300">${pos.current_price.toFixed(2)}</td>
                      <td className={`py-3 text-right font-semibold ${pos.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {pos.pnl >= 0 ? "+" : ""}${pos.pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 italic">
                      {liquidated ? "Risk protocol active. All trading assets liquidated." : "No open exposures currently detected."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

      </div>
      
      {/* Footer */}
      <footer className="py-6 border-t border-white/5 bg-[#030305] text-center text-[10px] text-slate-600 font-mono tracking-widest uppercase">
        © 2026 Aegis Systems Inc. // Protected Cloud Node
      </footer>
    </div>
  );
}
