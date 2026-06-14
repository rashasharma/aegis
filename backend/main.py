import asyncio
import json
import logging
import math
import os
import random
from typing import List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import websockets
import xgboost as xgb
import numpy as np
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("AegisTradingEngine")

# Load the pre-trained XGBoost model
model = xgb.Booster()
model_path = os.path.join(os.path.dirname(__file__), "xgboost_model.json")
model_loaded = False

if os.path.exists(model_path):
    try:
        model.load_model(model_path)
        logger.info(f"[ML] Model loaded successfully from {model_path}")
        model_loaded = True
    except Exception as e:
        logger.error(f"[ML] Failed to load model from {model_path}: {e}")
else:
    logger.warning(f"[ML] Model file not found at {model_path}. Running with simulated drift fallback.")

def calculate_live_rsi(prices: List[float], period: int = 14) -> float:
    """Calculates RSI in pure Python for a rolling list of prices."""
    if len(prices) < period + 1:
        return 50.0
    
    gains = []
    losses = []
    
    for i in range(1, len(prices)):
        change = prices[i] - prices[i-1]
        if change > 0:
            gains.append(change)
            losses.append(0.0)
        else:
            gains.append(0.0)
            losses.append(abs(change))
            
    # Simple exponential moving averages smoothing
    avg_gain = gains[0]
    avg_loss = losses[0]
    
    for i in range(1, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
        
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 3)

app = FastAPI(title="Aegis Algorithmic Trading & Risk Engine API")

# Enable CORS for frontend connection compatibility
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Fetch credentials from environment
ALPACA_API_KEY = os.getenv("ALPACA_API_KEY", "").strip()
ALPACA_API_SECRET = os.getenv("ALPACA_API_SECRET", "").strip()
ALPACA_FEED = os.getenv("ALPACA_FEED", "iex").strip().lower()

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"New client connected. Active connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"Client disconnected. Active connections: {len(self.active_connections)}")

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

    async def broadcast(self, message: str):
        disconnected_sockets = []
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                disconnected_sockets.append(connection)
        
        for connection in disconnected_sockets:
            self.disconnect(connection)

manager = ConnectionManager()

# Simulated engine state overlaying live pricing
class EngineState:
    def __init__(self):
        self.symbol = "SPY"
        self.spy_price = 505.0
        self.portfolio_value = 100000.0
        self.active_position = "HOLD"
        self.xgboost_confidence = 0.50
        
        # Initial positions - dynamically changes based on asset class (crypto/stocks)
        self.positions = [
            {"symbol": "AAPL", "size": 100, "entry_price": 175.50, "current_price": 175.50},
            {"symbol": "MSFT", "size": 50, "entry_price": 420.20, "current_price": 420.20},
            {"symbol": "NVDA", "size": 80, "entry_price": 850.00, "current_price": 850.00}
        ]
        
        # Liquidation lock/flag
        self.liquidated = False
        self.has_live_tick = False
        self.price_history: List[float] = []

    def update_live_price(self, symbol: str, price: float):
        self.has_live_tick = True
        
        # If switching asset classes, reinitialize positions
        if self.symbol != symbol:
            logger.info(f"[ENGINE] Switching live symbol to: {symbol}")
            self.symbol = symbol
            self.price_history = []  # Clear history to avoid mixing stocks and crypto
            if symbol == "BTC-USD":
                # Crypto positions
                self.positions = [
                    {"symbol": "ETH", "size": 5, "entry_price": round(price * 0.007, 2), "current_price": round(price * 0.007, 2)},
                    {"symbol": "SOL", "size": 35, "entry_price": round(price * 0.0003, 2), "current_price": round(price * 0.0003, 2)},
                    {"symbol": "ADA", "size": 8000, "entry_price": 0.40, "current_price": 0.40}
                ]
                self.spy_price = price
            else:
                # Stock positions
                self.positions = [
                    {"symbol": "AAPL", "size": 100, "entry_price": 175.50, "current_price": 175.50},
                    {"symbol": "MSFT", "size": 50, "entry_price": 420.20, "current_price": 420.20},
                    {"symbol": "NVDA", "size": 80, "entry_price": 850.00, "current_price": 850.00}
                ]
        
        self.spy_price = price
        self.price_history.append(price)
        self.price_history = self.price_history[-100:]  # Limit cache window

    def calculate_tick_updates(self):
        """
        Executes calculations every 1 second based on the latest cached price.
        This provides steady, predictable updates regardless of how fast the external feed ticks.
        """
        if self.liquidated:
            self.active_position = "HOLD"
            # In liquidated state, drift confidence to neutral
            self.xgboost_confidence = round(0.5 + random.uniform(-0.02, 0.02), 3)
            self.positions = []
            return

        # 1. Run live ML Model prediction
        # If we have a loaded model and at least 30 ticks in the history buffer, run inference
        if model_loaded and len(self.price_history) >= 30:
            try:
                prices = self.price_history[-30:]
                
                # Feature 1: SMA Ratio (SMA_10 / SMA_30)
                sma_10 = sum(prices[-10:]) / 10
                sma_30 = sum(prices[-30:]) / 30
                sma_ratio = sma_10 / sma_30
                
                # Feature 2: RSI (14)
                rsi = calculate_live_rsi(prices, 14)
                
                # Feature 3: Log Returns over past 5 ticks
                log_ret = math.log(prices[-1] / prices[-6]) if len(prices) >= 6 else 0.0
                
                # Run prediction through native booster
                dmatrix = xgb.DMatrix([[sma_ratio, rsi, log_ret]], feature_names=["sma_ratio", "rsi", "log_ret"])
                preds = model.predict(dmatrix)
                
                self.xgboost_confidence = round(float(preds[0]), 3)
                logger.info(f"[ML INFERENCE] Ticks={len(self.price_history)} [Ratio={sma_ratio:.4f}, RSI={rsi:.2f}, Ret={log_ret:.4f}] => Buy Prob: {self.xgboost_confidence:.2%}")
            except Exception as e:
                logger.error(f"[ML INFERENCE] Error running prediction: {e}")
                # Fallback to drift
                conf_change = random.uniform(-0.08, 0.08)
                self.xgboost_confidence = round(min(1.0, max(0.0, self.xgboost_confidence + conf_change)), 3)
        else:
            # Fallback to simulated drift if model not loaded or buffer is warming up
            if not model_loaded:
                conf_change = random.uniform(-0.08, 0.08)
                self.xgboost_confidence = round(min(1.0, max(0.0, self.xgboost_confidence + conf_change)), 3)
            else:
                logger.info(f"[ML] Tick price buffer is warming up ({len(self.price_history)}/30)...")
                # Visual drift around 50% during warmup
                self.xgboost_confidence = round(0.5 + random.uniform(-0.015, 0.015), 3)

        # 2. Determine execution directives
        if self.xgboost_confidence > 0.60:
            self.active_position = "BUY"
        elif self.xgboost_confidence < 0.40:
            self.active_position = "SELL"
        else:
            self.active_position = "HOLD"

        # 3. Simulate Portfolio Value movements relative to live price change
        price_drift = random.uniform(-0.05, 0.05) if not self.has_live_tick else 0.0
        
        # Base position size multiplier depending on asset class
        multiplier = 2.0 if self.symbol == "BTC-USD" else 150.0
        
        if self.active_position == "BUY":
            self.portfolio_value += (random.uniform(-0.15, 0.22) * multiplier)
        elif self.active_position == "SELL":
            self.portfolio_value += (random.uniform(-0.22, 0.15) * multiplier)
            
        self.portfolio_value = round(max(1000.0, self.portfolio_value), 2)

        # 4. Drifting simulated open positions (calculated real-time PnL)
        for pos in self.positions:
            # Let other assets walk relative to their volatility profiles
            if pos["symbol"] in ["AAPL", "MSFT", "NVDA"]:
                drift = random.uniform(-0.4, 0.4)
                pos["current_price"] = round(max(5.0, pos["current_price"] + drift), 2)
            else: # Crypto (ETH, SOL, ADA)
                if pos["symbol"] == "ETH":
                    drift = random.uniform(-4.0, 4.0)
                elif pos["symbol"] == "SOL":
                    drift = random.uniform(-0.35, 0.35)
                else: # ADA
                    drift = random.uniform(-0.005, 0.005)
                pos["current_price"] = round(max(0.01, pos["current_price"] + drift), 4)

    def liquidate(self):
        logger.warning("[RISK ENGINE] TRACE: Performing emergency liquidation of all assets.")
        self.liquidated = True
        self.active_position = "HOLD"
        self.positions = []

    def reset_state(self):
        self.liquidated = False
        self.portfolio_value = 100000.0
        self.active_position = "HOLD"
        self.xgboost_confidence = 0.50
        # Restore initial positions based on active symbol
        if self.symbol == "BTC-USD":
            self.positions = [
                {"symbol": "ETH", "size": 5, "entry_price": round(self.spy_price * 0.007, 2), "current_price": round(self.spy_price * 0.007, 2)},
                {"symbol": "SOL", "size": 35, "entry_price": round(self.spy_price * 0.0003, 2), "current_price": round(self.spy_price * 0.0003, 2)},
                {"symbol": "ADA", "size": 8000, "entry_price": 0.40, "current_price": 0.40}
            ]
        else:
            self.positions = [
                {"symbol": "AAPL", "size": 100, "entry_price": 175.50, "current_price": 175.50},
                {"symbol": "MSFT", "size": 50, "entry_price": 420.20, "current_price": 420.20},
                {"symbol": "NVDA", "size": 80, "entry_price": 850.00, "current_price": 850.00}
            ]
        logger.info("[ENGINE] State reset completed.")

state = EngineState()

# Coinbase Client Task (Free, Keyless fallbacks)
async def connect_coinbase_feed():
    url = "wss://ws-feed.exchange.coinbase.com"
    logger.info("[LIVE FEED] Connecting to Coinbase public WebSocket (BTC-USD)...")
    while True:
        try:
            async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
                sub_msg = {
                    "type": "subscribe",
                    "product_ids": ["BTC-USD"],
                    "channels": ["ticker"]
                }
                await ws.send(json.dumps(sub_msg))
                logger.info("[LIVE FEED] Subscribed successfully to Coinbase BTC-USD ticker feed.")
                
                async for message in ws:
                    # Halt feed processing if engine is liquidated
                    if state.liquidated:
                        await asyncio.sleep(0.5)
                        continue
                        
                    data = json.loads(message)
                    if data.get("type") == "ticker" and "price" in data:
                        try:
                            price = float(data["price"])
                            state.update_live_price("BTC-USD", price)
                        except ValueError:
                            pass
        except (websockets.ConnectionClosed, Exception) as e:
            logger.error(f"[LIVE FEED] Coinbase connection lost/closed: {e}. Retrying in 5s...")
            await asyncio.sleep(5.0)

# Alpaca Client Task (Secured, Key-required)
async def connect_alpaca_feed():
    # Free tier streams from IEX, paid from SIP
    subdomain = "stream" if ALPACA_FEED == "sip" else "stream"
    url = f"wss://{subdomain}.data.alpaca.markets/v2/{ALPACA_FEED}"
    
    logger.info(f"[LIVE FEED] Connecting to Alpaca WebSocket ({ALPACA_FEED.upper()} feed)...")
    while True:
        try:
            async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
                # 1. Receive welcome message
                welcome = await ws.recv()
                
                # 2. Authenticate
                auth_msg = {
                    "action": "auth",
                    "key": ALPACA_API_KEY,
                    "secret": ALPACA_API_SECRET
                }
                await ws.send(json.dumps(auth_msg))
                
                # 3. Read auth response
                auth_resp = await ws.recv()
                auth_data = json.loads(auth_resp)
                if not auth_data or auth_data[0].get("msg") != "authenticated":
                    logger.error(f"[LIVE FEED] Alpaca credentials authentication failed: {auth_resp}")
                    logger.error("[LIVE FEED] Exiting Alpaca loop to fallback to Coinbase feed.")
                    # Trigger Coinbase fallback
                    asyncio.create_task(connect_coinbase_feed())
                    return
                
                logger.info("[LIVE FEED] Alpaca WebSocket authenticated successfully.")
                
                # 4. Subscribe to SPY trades
                sub_msg = {
                    "action": "subscribe",
                    "trades": ["SPY"]
                }
                await ws.send(json.dumps(sub_msg))
                logger.info("[LIVE FEED] Subscribed to Alpaca SPY trades.")
                
                async for message in ws:
                    if state.liquidated:
                        await asyncio.sleep(0.5)
                        continue
                        
                    data_list = json.loads(message)
                    for item in data_list:
                        if item.get("T") == "t" and "p" in item: # trade ticker event
                            price = float(item["p"])
                            state.update_live_price("SPY", price)
        except (websockets.ConnectionClosed, Exception) as e:
            logger.error(f"[LIVE FEED] Alpaca connection error: {e}. Retrying in 5s...")
            await asyncio.sleep(5.0)

# Background tick loop
async def generate_mock_data_loop():
    logger.info("Starting background mock market calculations loop...")
    while True:
        try:
            state.calculate_tick_updates()
            
            # Format positions with unrealized PnL
            formatted_positions = []
            for pos in state.positions:
                pnl = round((pos["current_price"] - pos["entry_price"]) * pos["size"], 2)
                formatted_positions.append({
                    "symbol": pos["symbol"],
                    "size": pos["size"],
                    "entry_price": pos["entry_price"],
                    "current_price": pos["current_price"],
                    "pnl": pnl
                })
            
            payload = {
                "symbol": state.symbol,
                "price": state.spy_price,
                "xgboost_confidence": state.xgboost_confidence,
                "portfolio_value": state.portfolio_value,
                "active_position": state.active_position,
                "positions": formatted_positions,
                "liquidated": state.liquidated
            }
            
            await manager.broadcast(json.dumps(payload))
        except Exception as e:
            logger.error(f"Error in broadcast loop: {e}", exc_info=True)
            
        await asyncio.sleep(1.0)

@app.on_event("startup")
async def startup_event():
    # Start live feed listeners depending on env configuration
    if ALPACA_API_KEY and ALPACA_API_SECRET:
        logger.info("[STARTUP] Credentials detected in env. Starting Alpaca stock live feed.")
        asyncio.create_task(connect_alpaca_feed())
    else:
        logger.warning("[STARTUP] No Alpaca API keys found in .env. Falling back to keyless Coinbase live crypto feed.")
        asyncio.create_task(connect_coinbase_feed())
        
    # Start the 1-second ticks broadcaster
    asyncio.create_task(generate_mock_data_loop())

@app.get("/")
def read_root():
    return {
        "status": "ok", 
        "mode": "live",
        "active_symbol": state.symbol,
        "api_keys_loaded": bool(ALPACA_API_KEY and ALPACA_API_SECRET)
    }

@app.post("/api/reset")
def reset_engine():
    state.reset_state()
    return {"status": "success", "message": "Engine state has been reset."}

@app.websocket("/ws/dashboard")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Wait for any incoming messages from the client
            data = await websocket.receive_text()
            logger.info(f"Received message from client: {data}")
            
            try:
                message = json.loads(data)
                command = message.get("command")
            except json.JSONDecodeError:
                command = data
                
            if command == "EMERGENCY_LIQUIDATE":
                logger.warning("[RISK ENGINE] !!! EMERGENCY LIQUIDATE COMMAND RECEIVED !!!")
                state.liquidate()
                
                # Broadcast immediate feedback update
                response_payload = {
                    "symbol": state.symbol,
                    "price": state.spy_price,
                    "xgboost_confidence": state.xgboost_confidence,
                    "portfolio_value": state.portfolio_value,
                    "active_position": "HOLD",
                    "positions": [],
                    "liquidated": True,
                    "alert": "EMERGENCY LIQUIDATION EXECUTED. ALL POSITIONS CLOSED."
                }
                await manager.broadcast(json.dumps(response_payload))
                
            elif command == "RESET":
                state.reset_state()
                logger.info("[ENGINE] RESET command received from client.")
                
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)
