import asyncio
import json
import logging
import math
import os
import random
import time
import uuid
from typing import Dict, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import websockets
import uvicorn
import xgboost as xgb
import yfinance as yf
import pandas as pd
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("AegisServer")

AVAILABLE_ASSETS = [
    {"symbol": "BTC-USD", "name": "Bitcoin", "type": "crypto", "default_price": 76500.0, "qty_step": 0.05, "precision": 2},
    {"symbol": "ETH-USD", "name": "Ethereum", "type": "crypto", "default_price": 2480.0, "qty_step": 0.5, "precision": 2},
    {"symbol": "SOL-USD", "name": "Solana", "type": "crypto", "default_price": 100.0, "qty_step": 5.0, "precision": 2},
    {"symbol": "NVDA", "name": "Nvidia", "type": "equity", "default_price": 218.0, "qty_step": 10.0, "precision": 2},
    {"symbol": "AAPL", "name": "Apple", "type": "equity", "default_price": 332.0, "qty_step": 10.0, "precision": 2},
    {"symbol": "MSFT", "name": "Microsoft", "type": "equity", "default_price": 425.0, "qty_step": 5.0, "precision": 2},
    {"symbol": "TSLA", "name": "Tesla", "type": "equity", "default_price": 365.0, "qty_step": 10.0, "precision": 2},
]

PROMPT_TEMPLATES = [
    {
        "headline": "Resistance Squeeze Pattern",
        "context": "Price has pressed against local highs three times with tightening candle bodies. Order flow shows seller exhaustion.",
        "clue": "Watch for a rapid upward breakout if resistance fails, or a sharp rejection if buyers pull bids."
    },
    {
        "headline": "Overbought Momentum Exhaustion",
        "context": "Short-term momentum has expanded rapidly. RSI is elevated above baseline with tick velocity flattening.",
        "clue": "Chasing the top carries negative risk-reward. Consider waiting for a pullback or scaling down exposure."
    },
    {
        "headline": "Dynamic Moving Average Support",
        "context": "Price pulled back directly into the fast exponential moving average and printed an immediate absorption wick.",
        "clue": "Pullbacks to rising moving averages in an uptrend are classic continuation entries with tight risk."
    },
    {
        "headline": "Volatility Compression Breakout",
        "context": "Market is coiling in a narrow range. The spread between short and long moving averages has compressed.",
        "clue": "High volatility typically follows low volatility. Prepare for an aggressive directional expansion."
    }
]

def calculate_rsi(prices: List[float], period: int = 14) -> float:
    if len(prices) < period + 1:
        return 50.0
    gains = []
    losses = []
    for i in range(1, len(prices)):
        diff = prices[i] - prices[i - 1]
        if diff > 0:
            gains.append(diff)
            losses.append(0.0)
        else:
            gains.append(0.0)
            losses.append(abs(diff))
    avg_gain = gains[0]
    avg_loss = losses[0]
    for i in range(1, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
    rs = avg_gain / (avg_loss + 1e-9)
    return round(100.0 - (100.0 / (1.0 + rs)), 2)

def calculate_ema(prices: List[float], span: int) -> float:
    if not prices:
        return 0.0
    alpha = 2.0 / (span + 1.0)
    ema = prices[0]
    for p in prices[1:]:
        ema = alpha * p + (1.0 - alpha) * ema
    return ema

class MLBooster:
    def __init__(self):
        model_path = os.path.join(os.path.dirname(__file__), "xgboost_model.json")
        self.model = xgb.Booster()
        self.loaded = False
        if os.path.exists(model_path):
            try:
                self.model.load_model(model_path)
                self.loaded = True
            except Exception:
                self.loaded = False

    def predict(self, price_history: List[float]) -> Dict:
        if len(price_history) < 24:
            curr = price_history[-1] if price_history else 0.0
            return {
                "confidence": 0.50,
                "directive": "HOLD",
                "rsi": 50.0,
                "sma_ratio": 1.0,
                "volatility": 0.001
            }

        prices = price_history[-50:]
        p_now = prices[-1]
        p_1 = prices[-2]
        p_4 = prices[-5] if len(prices) >= 5 else prices[0]
        p_12 = prices[-13] if len(prices) >= 13 else prices[0]

        ret_1 = math.log(p_now / (p_1 + 1e-9))
        ret_4 = math.log(p_now / (p_4 + 1e-9))
        ret_12 = math.log(p_now / (p_12 + 1e-9))

        fast_ema = calculate_ema(prices, 8)
        slow_ema = calculate_ema(prices, 24)
        sma_ratio = fast_ema / (slow_ema + 1e-9)
        rsi = calculate_rsi(prices, 14)

        rets = [math.log(prices[i] / (prices[i - 1] + 1e-9)) for i in range(len(prices) - 16, len(prices))]
        m_ret = sum(rets) / len(rets)
        volatility = math.sqrt(sum((r - m_ret) ** 2 for r in rets) / len(rets))

        if not self.loaded:
            return {
                "confidence": 0.50,
                "directive": "HOLD",
                "rsi": rsi,
                "sma_ratio": round(sma_ratio, 4),
                "volatility": round(volatility, 6)
            }

        try:
            dmatrix = xgb.DMatrix([[ret_1, ret_4, ret_12, sma_ratio, rsi, volatility]],
                                  feature_names=["ret_1", "ret_4", "ret_12", "sma_ratio", "rsi", "volatility"])
            preds = self.model.predict(dmatrix)
            prob = float(preds[0])
            confidence = round(prob, 3)

            if confidence >= 0.53:
                action = "BUY"
            elif confidence <= 0.47:
                action = "SELL"
            else:
                action = "HOLD"

            return {
                "confidence": confidence,
                "directive": action,
                "rsi": rsi,
                "sma_ratio": round(sma_ratio, 4),
                "volatility": round(volatility, 6)
            }
        except Exception:
            return {
                "confidence": 0.50,
                "directive": "HOLD",
                "rsi": rsi,
                "sma_ratio": round(sma_ratio, 4),
                "volatility": round(volatility, 6)
            }

class Ledger:
    def __init__(self, initial_cash: float = 100000.0):
        self.initial_cash = initial_cash
        self.cash = initial_cash
        self.positions: Dict[str, Dict[str, float]] = {}

    def seed(self, symbol: str, price: float, custom_cash: Optional[float] = None):
        if custom_cash is not None and custom_cash > 0:
            self.initial_cash = float(custom_cash)
        self.cash = self.initial_cash
        self.positions.clear()
        step = 0.5 if "BTC" in symbol else 5.0
        cost = step * price
        if self.cash >= cost:
            self.cash -= cost
            self.positions[symbol] = {
                "size": step,
                "entry_price": price
            }

    def execute_order(self, symbol: str, action: str, quantity: float, price: float) -> bool:
        if action == "BUY":
            cost = quantity * price
            if self.cash < cost:
                return False
            self.cash -= cost
            if symbol in self.positions:
                pos = self.positions[symbol]
                new_size = pos["size"] + quantity
                new_entry = ((pos["size"] * pos["entry_price"]) + (quantity * price)) / new_size
                pos["size"] = new_size
                pos["entry_price"] = new_entry
            else:
                self.positions[symbol] = {
                    "size": quantity,
                    "entry_price": price
                }
            return True

        if action == "SELL":
            if symbol not in self.positions or self.positions[symbol]["size"] <= 0:
                return False
            pos = self.positions[symbol]
            qty_to_sell = min(quantity, pos["size"])
            revenue = qty_to_sell * price
            self.cash += revenue
            pos["size"] -= qty_to_sell
            if pos["size"] <= 0:
                del self.positions[symbol]
            return True

        return False

    def liquidate_all(self, current_prices: Dict[str, float]):
        for sym, pos in list(self.positions.items()):
            price = current_prices.get(sym, pos["entry_price"])
            revenue = pos["size"] * price
            self.cash += revenue
        self.positions.clear()

    def get_snapshot(self, current_prices: Dict[str, float]) -> Dict:
        holdings_value = 0.0
        pos_list = []
        for sym, pos in self.positions.items():
            curr_p = current_prices.get(sym, pos["entry_price"])
            pos_val = pos["size"] * curr_p
            holdings_value += pos_val
            cost_basis = pos["size"] * pos["entry_price"]
            pnl = pos_val - cost_basis
            pos_list.append({
                "symbol": sym,
                "size": round(pos["size"], 4),
                "entry_price": round(pos["entry_price"], 2),
                "current_price": round(curr_p, 2),
                "pnl": round(pnl, 2)
            })

        total_value = round(self.cash + holdings_value, 2)
        return {
            "portfolio_value": total_value,
            "cash": round(self.cash, 2),
            "holdings_value": round(holdings_value, 2),
            "positions": pos_list
        }

class DecisionGame:
    def __init__(self):
        self.state = "IDLE"
        self.prompt_data = None
        self.evaluation_data = None
        self.debrief_data = None
        self.eval_start_time = 0.0
        self.eval_prices: List[float] = []
        self.eval_portfolio_start = 100000.0

    def trigger_prompt(self, symbol: str, current_price: float, ml_directive: str):
        self.state = "PROMPTING"
        tmpl = random.choice(PROMPT_TEMPLATES)
        self.prompt_data = {
            "id": str(uuid.uuid4())[:8],
            "symbol": symbol,
            "headline": f"{symbol}: {tmpl['headline']}",
            "context": tmpl["context"],
            "clue": tmpl["clue"],
            "start_price": current_price,
            "options": ["BUY", "HOLD", "SELL"],
            "time_left": 10
        }
        self.evaluation_data = None
        self.debrief_data = None

    def submit_decision(self, choice: str, current_price: float, portfolio_val: float, ml_directive: str):
        self.state = "EVALUATING"
        self.eval_start_time = time.time()
        self.eval_prices = [current_price]
        self.eval_portfolio_start = portfolio_val
        self.evaluation_data = {
            "user_choice": choice,
            "ml_directive": ml_directive,
            "start_price": current_price,
            "time_left": 15,
            "forked_ticks": []
        }
        self.prompt_data = None

    def tick_evaluating(self, current_price: float, current_portfolio: float) -> Optional[Dict]:
        if self.state != "EVALUATING" or not self.evaluation_data:
            return None

        self.eval_prices.append(current_price)
        elapsed = time.time() - self.eval_start_time
        time_left = max(0, int(15 - elapsed))
        self.evaluation_data["time_left"] = time_left

        start_p = self.evaluation_data["start_price"]
        delta = current_price - start_p
        unit_qty = 25000.0 / (start_p if start_p > 0 else 1.0)

        user_choice = self.evaluation_data["user_choice"]
        if user_choice == "BUY":
            user_pnl = unit_qty * delta
        elif user_choice == "SELL":
            user_pnl = unit_qty * -delta
        else:
            user_pnl = 0.0

        best_pnl = unit_qty * abs(delta)

        user_eq = round(self.eval_portfolio_start + user_pnl, 2)
        best_eq = round(self.eval_portfolio_start + best_pnl, 2)

        fork_point = {
            "time": int(time.time()),
            "price": current_price,
            "user_equity": user_eq,
            "best_equity": best_eq,
            "user_pnl": round(user_pnl, 2),
            "best_pnl": round(best_pnl, 2)
        }
        self.evaluation_data["forked_ticks"].append(fork_point)

        if elapsed >= 15.0:
            self._finalize_debrief(current_price, unit_qty)

        return fork_point

    def _finalize_debrief(self, final_price: float, unit_qty: float):
        start_p = self.evaluation_data["start_price"]
        delta = final_price - start_p
        pct_change = round((delta / start_p) * 100, 2) if start_p > 0 else 0.0

        user_choice = self.evaluation_data["user_choice"]
        ml_directive = self.evaluation_data.get("ml_directive", "HOLD")

        if delta > 0.0001:
            best_choice = "BUY"
        elif delta < -0.0001:
            best_choice = "SELL"
        else:
            best_choice = "HOLD"

        if user_choice == "BUY":
            user_pnl = unit_qty * delta
        elif user_choice == "SELL":
            user_pnl = unit_qty * -delta
        else:
            user_pnl = 0.0

        best_pnl = unit_qty * abs(delta)

        if ml_directive == "BUY":
            ml_pnl = unit_qty * delta
        elif ml_directive == "SELL":
            ml_pnl = unit_qty * -delta
        else:
            ml_pnl = 0.0

        pnl_diff = round(user_pnl - best_pnl, 2)

        if user_choice == best_choice and user_choice != "HOLD":
            grade = "A"
            lesson = f"Optimal execution. Correctly identified market direction for a gain of ${user_pnl:,.2f}."
        elif user_choice == "HOLD" and best_choice == "HOLD":
            grade = "A"
            lesson = "Flat consolidation window. Holding cash preserved 100% of capital ($0.00 PnL) with zero drawdown."
        elif user_choice == "HOLD":
            grade = "B"
            lesson = f"Held cash ($0.00 PnL). Market moved {pct_change:+.2f}%, where an aggressive {best_choice} could have made +${best_pnl:,.2f}."
        elif abs(delta) < 0.0005 * start_p:
            grade = "B"
            lesson = "Flat consolidation window. Holding minimized unnecessary fees and slippage."
        else:
            grade = "F"
            lesson = f"Executed {user_choice} against directional trend of {pct_change:+.2f}%. Always align positioning with momentum."

        self.debrief_data = {
            "start_price": round(start_p, 2),
            "final_price": round(final_price, 2),
            "pct_change": pct_change,
            "user_choice": user_choice,
            "user_pnl": round(user_pnl, 2),
            "best_choice": best_choice,
            "best_pnl": round(best_pnl, 2),
            "ml_choice": ml_directive,
            "ml_pnl": round(ml_pnl, 2),
            "pnl_diff": pnl_diff,
            "grade": grade,
            "lesson": lesson
        }
        self.state = "DEBRIEF"
        self.evaluation_data = None

    def dismiss_debrief(self):
        self.state = "IDLE"
        self.debrief_data = None
        self.evaluation_data = None
        self.prompt_data = None

    def get_state_payload(self) -> Dict:
        return {
            "state": self.state,
            "prompt": self.prompt_data,
            "evaluation": self.evaluation_data,
            "debrief": self.debrief_data
        }

class MarketFeed:
    def __init__(self):
        self.prices: Dict[str, float] = {a["symbol"]: a["default_price"] for a in AVAILABLE_ASSETS}
        self.price_histories: Dict[str, List[float]] = {a["symbol"]: [] for a in AVAILABLE_ASSETS}
        self.candles: Dict[str, List[Dict]] = {a["symbol"]: [] for a in AVAILABLE_ASSETS}
        self.current_candle: Dict[str, Dict] = {}
        self.candle_interval = 15
        self.running = False
        self.active_asset = "BTC-USD"
        self.listeners: List[asyncio.Queue] = []

    def seed_initial_candles(self):
        for asset in AVAILABLE_ASSETS:
            sym = asset["symbol"]
            base = asset["default_price"]
            now = int(time.time()) - (80 * 60)
            p = base
            seed_candles = []
            for i in range(80):
                p += (random.random() - 0.49) * (p * 0.0008)
                p = round(p, 2)
                seed_candles.append({
                    "time": now + (i * 60),
                    "open": p,
                    "high": round(p * 1.0006, 2),
                    "low": round(p * 0.9994, 2),
                    "close": p,
                    "volume": round(random.uniform(5.0, 50.0), 2)
                })

            self.candles[sym] = seed_candles
            last_c = seed_candles[-1]
            self.prices[sym] = last_c["close"]
            self.price_histories[sym] = [c["close"] for c in seed_candles[-40:]]
            self.current_candle[sym] = {
                "time": int(time.time()),
                "open": last_c["close"],
                "high": last_c["close"],
                "low": last_c["close"],
                "close": last_c["close"],
                "volume": 0.0
            }

    async def fetch_historical_yfinance(self):
        for asset in AVAILABLE_ASSETS:
            sym = asset["symbol"]
            try:
                loop = asyncio.get_event_loop()
                df = await loop.run_in_executor(None, lambda s=sym: yf.download(s, period="1d", interval="1m", progress=False))
                if not df.empty and len(df) >= 10:
                    if isinstance(df.columns, pd.MultiIndex):
                        df.columns = [col[0] for col in df.columns]
                    seed_candles = []
                    for idx, row in df.tail(80).iterrows():
                        ts = int(idx.timestamp())
                        seed_candles.append({
                            "time": ts,
                            "open": round(float(row["Open"]), 2),
                            "high": round(float(row["High"]), 2),
                            "low": round(float(row["Low"]), 2),
                            "close": round(float(row["Close"]), 2),
                            "volume": round(float(row.get("Volume", 10.0)), 2)
                        })
                    if seed_candles:
                        self.candles[sym] = seed_candles
                        last_c = seed_candles[-1]
                        self.prices[sym] = last_c["close"]
                        self.price_histories[sym] = [c["close"] for c in seed_candles[-40:]]
                        self.current_candle[sym] = {
                            "time": int(time.time()),
                            "open": last_c["close"],
                            "high": last_c["close"],
                            "low": last_c["close"],
                            "close": last_c["close"],
                            "volume": 0.0
                        }
            except Exception:
                pass

    def update_tick(self, symbol: str, price: float, volume: float = 1.0):
        if symbol not in self.prices:
            return
        self.prices[symbol] = price
        self.price_histories[symbol].append(price)
        if len(self.price_histories[symbol]) > 100:
            self.price_histories[symbol].pop(0)

        now = int(time.time())
        curr = self.current_candle.get(symbol)
        if not curr:
            curr = {
                "time": now,
                "open": price,
                "high": price,
                "low": price,
                "close": price,
                "volume": volume
            }
            self.current_candle[symbol] = curr
        else:
            if now - curr["time"] >= self.candle_interval:
                self.candles[symbol].append(dict(curr))
                if len(self.candles[symbol]) > 120:
                    self.candles[symbol].pop(0)
                curr["time"] = now
                curr["open"] = price
                curr["high"] = price
                curr["low"] = price
                curr["close"] = price
                curr["volume"] = volume
            else:
                curr["high"] = max(curr["high"], price)
                curr["low"] = min(curr["low"], price)
                curr["close"] = price
                curr["volume"] += volume

        for q in self.listeners:
            try:
                q.put_nowait({"symbol": symbol, "price": price, "current_candle": dict(curr)})
            except Exception:
                pass

    async def stream_coinbase(self):
        crypto_symbols = [a["symbol"] for a in AVAILABLE_ASSETS if a["type"] == "crypto"]
        url = "wss://ws-feed.exchange.coinbase.com"
        while self.running:
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=10) as ws:
                    sub_msg = {
                        "type": "subscribe",
                        "product_ids": crypto_symbols,
                        "channels": ["ticker"]
                    }
                    await ws.send(json.dumps(sub_msg))
                    async for raw in ws:
                        if not self.running:
                            break
                        msg = json.loads(raw)
                        if msg.get("type") == "ticker" and "price" in msg:
                            pid = msg.get("product_id")
                            p = float(msg["price"])
                            v = float(msg.get("last_size", 0.1))
                            self.update_tick(pid, p, v)
            except Exception:
                await asyncio.sleep(2)

    async def stream_equities_replay(self):
        equity_symbols = [a["symbol"] for a in AVAILABLE_ASSETS if a["type"] == "equity"]
        while self.running:
            for sym in equity_symbols:
                p = self.prices[sym]
                drift = (random.random() - 0.495) * (p * 0.0006)
                new_p = round(p + drift, 2)
                vol = round(random.uniform(10.0, 150.0), 1)
                self.update_tick(sym, new_p, vol)
            await asyncio.sleep(1.0)

    async def start(self):
        self.running = True
        self.seed_initial_candles()
        asyncio.create_task(self.fetch_historical_yfinance())
        asyncio.create_task(self.stream_coinbase())
        asyncio.create_task(self.stream_equities_replay())

    def stop(self):
        self.running = False

app = FastAPI(title="Aegis Engine")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

feed = MarketFeed()
ledger = Ledger(100000.0)
ml = MLBooster()
game = DecisionGame()
active_clients: List[WebSocket] = []

@app.on_event("startup")
async def on_startup():
    await feed.start()
    ledger.seed(feed.active_asset, feed.prices[feed.active_asset])

@app.on_event("shutdown")
def on_shutdown():
    feed.stop()

@app.get("/health")
def health():
    return {"status": "ok", "active_asset": feed.active_asset, "assets": [a["symbol"] for a in AVAILABLE_ASSETS]}

@app.post("/api/select-asset")
def select_asset(payload: Dict):
    sym = payload.get("symbol")
    if sym in feed.prices:
        feed.active_asset = sym
        return {"status": "ok", "active_asset": sym}
    return {"status": "error", "message": "Unknown symbol"}

@app.post("/api/trigger-challenge")
def api_trigger():
    sym = feed.active_asset
    p = feed.prices[sym]
    pred = ml.predict(feed.price_histories[sym])
    game.trigger_prompt(sym, p, pred["directive"])
    return {"status": "ok", "game": game.get_state_payload()}

@app.post("/api/reset")
def api_reset():
    ledger.seed(feed.active_asset, feed.prices[feed.active_asset])
    game.dismiss_debrief()
    return {"status": "ok"}

@app.websocket("/ws/dashboard")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    active_clients.append(ws)

    queue = asyncio.Queue()
    feed.listeners.append(queue)

    def make_snapshot(sym: str) -> Dict:
        p = feed.prices[sym]
        pred = ml.predict(feed.price_histories[sym])
        curr_c = feed.current_candle.get(sym)
        c_list = list(feed.candles.get(sym, []))
        if curr_c:
            c_list.append(dict(curr_c))
        return {
            "type": "SNAPSHOT",
            "active_asset": sym,
            "available_assets": AVAILABLE_ASSETS,
            "price": p,
            "prices": dict(feed.prices),
            "candles": c_list,
            "all_candles": {s: list(feed.candles.get(s, [])) for s in feed.prices},
            "directive": pred["directive"],
            "confidence": pred["confidence"],
            "indicators": {
                "rsi": pred["rsi"],
                "sma_ratio": pred["sma_ratio"],
                "volatility": pred["volatility"]
            },
            "portfolio": ledger.get_snapshot(feed.prices),
            "game": game.get_state_payload()
        }

    try:
        await ws.send_text(json.dumps(make_snapshot(feed.active_asset)))
    except Exception:
        pass

    async def incoming_reader():
        while True:
            try:
                data = await ws.receive_text()
                msg = json.loads(data)
                cmd = msg.get("command")

                if cmd == "SELECT_ASSET":
                    sym = msg.get("symbol")
                    if sym in feed.prices:
                        feed.active_asset = sym
                        await ws.send_text(json.dumps(make_snapshot(sym)))

                elif cmd == "TRIGGER_PROMPT":
                    sym = feed.active_asset
                    p = feed.prices[sym]
                    pred = ml.predict(feed.price_histories[sym])
                    game.trigger_prompt(sym, p, pred["directive"])

                elif cmd == "SUBMIT_DECISION":
                    choice = msg.get("choice", "HOLD")
                    sym = feed.active_asset
                    p = feed.prices[sym]
                    pred = ml.predict(feed.price_histories[sym])
                    snap = ledger.get_snapshot(feed.prices)
                    game.submit_decision(choice, p, snap["portfolio_value"], pred["directive"])
                    step_qty = next((a["qty_step"] for a in AVAILABLE_ASSETS if a["symbol"] == sym), 1.0)
                    if choice in ["BUY", "SELL"]:
                        ledger.execute_order(sym, choice, step_qty, p)

                elif cmd == "EXECUTE_ORDER":
                    o_sym = msg.get("symbol", feed.active_asset)
                    o_act = msg.get("action", "BUY")
                    o_qty = float(msg.get("quantity", 1.0))
                    o_price = feed.prices.get(o_sym, 1.0)
                    ledger.execute_order(o_sym, o_act, o_qty, o_price)
                    await ws.send_text(json.dumps(make_snapshot(feed.active_asset)))

                elif cmd == "DISMISS_DEBRIEF":
                    game.dismiss_debrief()

                elif cmd == "EMERGENCY_LIQUIDATE":
                    ledger.liquidate_all(feed.prices)
                    await ws.send_text(json.dumps(make_snapshot(feed.active_asset)))

                elif cmd == "RESET":
                    c_cash = msg.get("initial_cash")
                    ledger.seed(feed.active_asset, feed.prices[feed.active_asset], c_cash)
                    game.dismiss_debrief()
                    await ws.send_text(json.dumps(make_snapshot(feed.active_asset)))

            except (WebSocketDisconnect, asyncio.CancelledError):
                break
            except Exception:
                pass

    reader_task = asyncio.create_task(incoming_reader())

    try:
        last_eval_tick_time = 0.0
        while True:
            tick = await queue.get()
            sym = tick["symbol"]
            p = tick["price"]

            if sym == feed.active_asset:
                now_ts = time.time()
                fork_point = None
                if game.state == "EVALUATING" and (now_ts - last_eval_tick_time >= 0.8):
                    snap = ledger.get_snapshot(feed.prices)
                    fork_point = game.tick_evaluating(p, snap["portfolio_value"])
                    last_eval_tick_time = now_ts

                pred = ml.predict(feed.price_histories[sym])
                curr_c = feed.current_candle.get(sym)

                out = {
                    "type": "TICK",
                    "symbol": sym,
                    "price": p,
                    "prices": dict(feed.prices),
                    "current_candle": curr_c,
                    "directive": pred["directive"],
                    "confidence": pred["confidence"],
                    "indicators": {
                        "rsi": pred["rsi"],
                        "sma_ratio": pred["sma_ratio"],
                        "volatility": pred["volatility"]
                    },
                    "portfolio": ledger.get_snapshot(feed.prices),
                    "game": game.get_state_payload(),
                    "fork_point": fork_point
                }
                try:
                    await ws.send_text(json.dumps(out))
                except Exception:
                    break
            else:
                curr_c = feed.current_candle.get(sym)
                out = {
                    "type": "TICK",
                    "symbol": sym,
                    "price": p,
                    "prices": dict(feed.prices),
                    "current_candle": curr_c,
                    "portfolio": ledger.get_snapshot(feed.prices)
                }
                try:
                    await ws.send_text(json.dumps(out))
                except Exception:
                    break

    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        reader_task.cancel()
        if queue in feed.listeners:
            feed.listeners.remove(queue)
        if ws in active_clients:
            active_clients.remove(ws)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
