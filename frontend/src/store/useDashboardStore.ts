import { create } from "zustand";

export interface Position {
  symbol: string;
  size: number;
  entry_price: number;
  current_price: number;
  pnl: number;
}

export interface TickData {
  time: string;
  price: number;
  portfolioValue: number;
}

interface DashboardState {
  connected: boolean;
  socket: WebSocket | null;
  ticks: TickData[];
  symbol: string;
  currentPrice: number;
  portfolioValue: number;
  activePosition: "BUY" | "SELL" | "HOLD";
  xgboostConfidence: number;
  positions: Position[];
  liquidated: boolean;
  alert: string | null;
  
  connect: () => void;
  disconnect: () => void;
  liquidate: () => void;
  resetSimulation: () => void;
}

export const useDashboardStore = create<DashboardState>((set, get) => {
  let reconnectTimeout: NodeJS.Timeout | null = null;

  return {
    connected: false,
    socket: null,
    ticks: [],
    symbol: "SPY",
    currentPrice: 505.0,
    portfolioValue: 100000.0,
    activePosition: "HOLD",
    xgboostConfidence: 0.5,
    positions: [],
    liquidated: false,
    alert: null,

    connect: () => {
      // Avoid duplicate connections
      if (get().socket?.readyState === WebSocket.OPEN) return;

      const wsUrl = "ws://localhost:8000/ws/dashboard";
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("WebSocket connected to:", wsUrl);
        set({ connected: true, socket: ws, alert: null });
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const now = new Date();
          const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

          set((state) => {
            // Append new chart tick
            const newTick: TickData = {
              time: timeStr,
              price: data.price,
              portfolioValue: data.portfolio_value,
            };
            
            // Limit chart array size to 50 items to prevent performance degradation
            const newTicks = [...state.ticks, newTick].slice(-50);

            return {
              symbol: data.symbol || "SPY",
              currentPrice: data.price,
              portfolioValue: data.portfolio_value,
              activePosition: data.active_position,
              xgboostConfidence: data.xgboost_confidence,
              positions: data.positions || [],
              liquidated: data.liquidated,
              alert: data.alert || null,
              ticks: newTicks,
            };
          });
        } catch (e) {
          console.error("Error parsing WebSocket message:", e);
        }
      };

      ws.onclose = () => {
        console.log("WebSocket connection closed.");
        set({ connected: false, socket: null });
        // Attempt to reconnect every 3 seconds
        if (!reconnectTimeout) {
          reconnectTimeout = setTimeout(() => {
            reconnectTimeout = null;
            get().connect();
          }, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        ws.close();
      };
    },

    disconnect: () => {
      const socket = get().socket;
      if (socket) {
        socket.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      set({ connected: false, socket: null });
    },

    liquidate: () => {
      const socket = get().socket;
      if (socket && socket.readyState === WebSocket.OPEN) {
        console.log("Sending EMERGENCY_LIQUIDATE command...");
        socket.send(JSON.stringify({ command: "EMERGENCY_LIQUIDATE" }));
      } else {
        console.error("WebSocket is not connected. Cannot liquidate.");
      }
    },

    resetSimulation: () => {
      // Trigger a state reset on the server via HTTP or WebSocket
      const socket = get().socket;
      if (socket && socket.readyState === WebSocket.OPEN) {
        console.log("Sending RESET command...");
        socket.send(JSON.stringify({ command: "RESET" }));
      }
      
      // Also hit HTTP reset endpoint in case the server needs a direct reset
      fetch("http://localhost:8000/api/reset", { method: "POST" })
        .then(res => res.json())
        .then(data => console.log("HTTP Reset:", data))
        .catch(err => console.error("HTTP Reset error:", err));
    }
  };
});
