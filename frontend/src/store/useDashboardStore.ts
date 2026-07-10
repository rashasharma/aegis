import { create } from "zustand";

export interface AssetInfo {
  symbol: string;
  name: string;
  type: "crypto" | "equity";
  default_price: number;
  qty_step: number;
  precision: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ForkPoint {
  time: number;
  price: number;
  user_equity: number;
  best_equity: number;
  user_pnl: number;
  best_pnl: number;
}

export interface Indicators {
  rsi: number;
  sma_ratio: number;
  volatility: number;
}

export interface Position {
  symbol: string;
  size: number;
  entry_price: number;
  current_price: number;
  pnl: number;
}

export interface PromptData {
  id: string;
  symbol: string;
  headline: string;
  context: string;
  clue?: string;
  start_price: number;
  options: string[];
  time_left: number;
}

export interface EvaluationData {
  user_choice: string;
  ml_directive: string;
  start_price: number;
  time_left: number;
  forked_ticks?: ForkPoint[];
}

export interface DebriefData {
  start_price: number;
  final_price: number;
  pct_change: number;
  user_choice: string;
  user_pnl: number;
  best_choice: string;
  best_pnl: number;
  ml_choice: string;
  ml_pnl: number;
  pnl_diff: number;
  grade: string;
  lesson: string;
}

export interface GameState {
  state: "IDLE" | "PROMPTING" | "EVALUATING" | "DEBRIEF";
  prompt: PromptData | null;
  evaluation: EvaluationData | null;
  debrief: DebriefData | null;
}

interface DashboardState {
  connected: boolean;
  socket: WebSocket | null;
  activeAsset: string;
  selectedAssets: string[];
  activeCategory: "all" | "crypto" | "equity";
  availableAssets: AssetInfo[];
  currentPrice: number;
  prices: Record<string, number>;
  portfolioValue: number;
  cash: number;
  holdingsValue: number;
  directive: "BUY" | "SELL" | "HOLD";
  confidence: number;
  indicators: Indicators;
  positions: Position[];
  candles: Candle[];
  allCandles: Record<string, Candle[]>;
  currentCandle: Candle | null;
  forkPoints: ForkPoint[];
  liquidated: boolean;
  game: GameState;
  snapshotVersion: number;

  connect: () => void;
  disconnect: () => void;
  selectAsset: (symbol: string) => void;
  toggleAssetSelection: (symbol: string) => void;
  selectAllAssets: () => void;
  setActiveCategory: (cat: "all" | "crypto" | "equity") => void;
  executeOrder: (symbol: string, action: "BUY" | "SELL", quantity: number) => void;
  submitDecision: (choice: "BUY" | "SELL" | "HOLD") => void;
  triggerPrompt: () => void;
  dismissDebrief: () => void;
  liquidate: () => void;
  reset: (customStartingCash?: number) => void;
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws/dashboard";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const useDashboardStore = create<DashboardState>((set, get) => {
  let reconnectTimer: NodeJS.Timeout | null = null;

  return {
    connected: false,
    socket: null,
    activeAsset: "BTC-USD",
    selectedAssets: ["BTC-USD"],
    activeCategory: "crypto",
    availableAssets: [
      { symbol: "BTC-USD", name: "Bitcoin", type: "crypto", default_price: 76500.0, qty_step: 0.05, precision: 2 },
      { symbol: "ETH-USD", name: "Ethereum", type: "crypto", default_price: 2480.0, qty_step: 0.5, precision: 2 },
      { symbol: "SOL-USD", name: "Solana", type: "crypto", default_price: 100.0, qty_step: 5.0, precision: 2 },
      { symbol: "NVDA", name: "Nvidia", type: "equity", default_price: 218.0, qty_step: 10.0, precision: 2 },
      { symbol: "AAPL", name: "Apple", type: "equity", default_price: 332.0, qty_step: 10.0, precision: 2 },
      { symbol: "MSFT", name: "Microsoft", type: "equity", default_price: 425.0, qty_step: 5.0, precision: 2 },
      { symbol: "TSLA", name: "Tesla", type: "equity", default_price: 365.0, qty_step: 10.0, precision: 2 },
    ],
    currentPrice: 76500.0,
    prices: {
      "BTC-USD": 76500.0,
      "ETH-USD": 2480.0,
      "SOL-USD": 100.0,
      NVDA: 218.0,
      AAPL: 332.0,
      MSFT: 425.0,
      TSLA: 365.0,
    },
    portfolioValue: 100000.0,
    cash: 100000.0,
    holdingsValue: 0.0,
    directive: "HOLD",
    confidence: 0.5,
    indicators: { rsi: 50.0, sma_ratio: 1.0, volatility: 0.001 },
    positions: [],
    candles: [],
    allCandles: {},
    currentCandle: null,
    forkPoints: [],
    liquidated: false,
    snapshotVersion: 0,
    game: {
      state: "IDLE",
      prompt: null,
      evaluation: null,
      debrief: null,
    },

    connect: () => {
      const current = get().socket;
      if (current && current.readyState === WebSocket.OPEN) return;

      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        set({ connected: true, socket: ws });
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          if (payload.type === "SNAPSHOT") {
            const port = payload.portfolio || {};
            set({
              snapshotVersion: get().snapshotVersion + 1,
              activeAsset: payload.active_asset || get().activeAsset,
              availableAssets: payload.available_assets || get().availableAssets,
              currentPrice: payload.price ?? get().currentPrice,
              prices: payload.prices || get().prices,
              candles: payload.candles || [],
              allCandles: payload.all_candles || get().allCandles,
              currentCandle: null,
              forkPoints: [],
              directive: payload.directive || "HOLD",
              confidence: payload.confidence ?? 0.5,
              indicators: payload.indicators || { rsi: 50.0, sma_ratio: 1.0, volatility: 0.001 },
              portfolioValue: port.portfolio_value ?? 100000.0,
              cash: port.cash ?? 100000.0,
              holdingsValue: port.holdings_value ?? 0.0,
              positions: port.positions || [],
              game: payload.game || get().game,
            });
            return;
          }

          if (payload.type === "TICK") {
            const port = payload.portfolio || {};
            const newPrice = payload.price ?? get().currentPrice;
            const newCandle = payload.current_candle;
            const forkPoint = payload.fork_point;
            const newPrices = payload.prices || get().prices;

            set((state) => {
              const isActive = !payload.symbol || payload.symbol === state.activeAsset;

              let updatedCandles = state.candles;
              if (newCandle && isActive) {
                if (updatedCandles.length > 0 && updatedCandles[updatedCandles.length - 1].time === newCandle.time) {
                  updatedCandles = [...updatedCandles.slice(0, -1), newCandle];
                } else {
                  updatedCandles = [...updatedCandles, newCandle].slice(-120);
                }
              }

              let updatedForks = state.forkPoints;
              if (forkPoint) {
                updatedForks = [...updatedForks, forkPoint];
              } else if (payload.game?.state === "IDLE") {
                updatedForks = [];
              }

              const updatedAllCandles = { ...state.allCandles };
              if (payload.symbol && newCandle) {
                const symCandles = updatedAllCandles[payload.symbol] || [];
                if (symCandles.length > 0 && symCandles[symCandles.length - 1].time === newCandle.time) {
                  updatedAllCandles[payload.symbol] = [...symCandles.slice(0, -1), newCandle];
                } else {
                  updatedAllCandles[payload.symbol] = [...symCandles, newCandle].slice(-120);
                }
              }

              return {
                currentPrice: isActive ? newPrice : state.currentPrice,
                prices: newPrices,
                currentCandle: isActive ? (newCandle || state.currentCandle) : state.currentCandle,
                candles: updatedCandles,
                allCandles: updatedAllCandles,
                forkPoints: updatedForks,
                portfolioValue: port.portfolio_value ?? state.portfolioValue,
                cash: port.cash ?? state.cash,
                holdingsValue: port.holdings_value ?? state.holdingsValue,
                positions: port.positions || state.positions,
                directive: payload.directive || state.directive,
                confidence: payload.confidence ?? state.confidence,
                indicators: payload.indicators || state.indicators,
                game: payload.game || state.game,
              };
            });
          }
        } catch {}
      };

      ws.onclose = () => {
        set({ connected: false, socket: null });
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            get().connect();
          }, 2500);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    },

    disconnect: () => {
      const ws = get().socket;
      if (ws) ws.close();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      set({ connected: false, socket: null });
    },

    selectAsset: (symbol: string) => {
      set({ activeAsset: symbol, selectedAssets: [symbol], forkPoints: [] });
      const ws = get().socket;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ command: "SELECT_ASSET", symbol }));
      }
    },

    toggleAssetSelection: (symbol: string) => {
      set((state) => {
        const isSelected = state.selectedAssets.includes(symbol);
        let next: string[];
        if (isSelected) {
          next = state.selectedAssets.filter((s) => s !== symbol);
          if (next.length === 0) next = [symbol];
        } else {
          next = [...state.selectedAssets, symbol];
        }

        const active = next.includes(state.activeAsset) ? state.activeAsset : next[0];
        const ws = state.socket;
        if (ws && ws.readyState === WebSocket.OPEN && active !== state.activeAsset) {
          ws.send(JSON.stringify({ command: "SELECT_ASSET", symbol: active }));
        }

        return {
          selectedAssets: next,
          activeAsset: active,
        };
      });
    },

    selectAllAssets: () => {
      const all = get().availableAssets.map((a) => a.symbol);
      set({ selectedAssets: all });
    },

    setActiveCategory: (cat: "all" | "crypto" | "equity") => {
      set({ activeCategory: cat });
    },

    executeOrder: (symbol: string, action: "BUY" | "SELL", quantity: number) => {
      const ws = get().socket;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ command: "EXECUTE_ORDER", symbol, action, quantity }));
      }
    },

    submitDecision: (choice: "BUY" | "SELL" | "HOLD") => {
      const ws = get().socket;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ command: "SUBMIT_DECISION", choice }));
      }
    },

    triggerPrompt: () => {
      const ws = get().socket;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ command: "TRIGGER_PROMPT" }));
      } else {
        fetch(`${API_URL}/api/trigger-challenge`, { method: "POST" }).catch(() => {});
      }
    },

    dismissDebrief: () => {
      const ws = get().socket;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ command: "DISMISS_DEBRIEF" }));
      }
      set((state) => ({
        forkPoints: [],
        game: {
          ...state.game,
          state: "IDLE",
          debrief: null,
        },
      }));
    },

    liquidate: () => {
      const ws = get().socket;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ command: "EMERGENCY_LIQUIDATE" }));
      }
      set({ liquidated: true });
    },

    reset: (customStartingCash?: number) => {
      const ws = get().socket;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ command: "RESET", initial_cash: customStartingCash }));
      }
      set({ liquidated: false });
      fetch(`${API_URL}/api/reset`, { method: "POST" }).catch(() => {});
    },
  };
});
