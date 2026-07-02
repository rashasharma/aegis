# Aegis // Algorithmic Trading & Risk Engine Dashboard

A high-performance full-stack web application for real-time algorithmic trading visualization and emergency risk control. Features a Python FastAPI streaming simulator and a glassmorphic Next.js interface with real-time Recharts analytics and state synchronization.

---

## Architecture Overview

1. **Python FastAPI Backend** (`/backend`):
   * Runs an asynchronous tick simulator broadcasting simulated stock prices (SPY), machine learning predictions (XGBoost buy probability), RL agent active states, and real-time open positions via WebSockets.
   * Exposes WebSocket endpoint `/ws/dashboard` and REST administrative controls at `/api/reset`.
   * Listens for client actions and executes safety/liquidation operations instantly.

2. **Next.js Frontend** (`/frontend`):
   * Utilizes **Zustand** for lightweight, high-performance WebSocket message streaming.
   * Utilizes **Recharts** to render high-frequency real-time pricing and balance data.
   * Displays a glassmorphic control console built with **Tailwind CSS** (Liquid Glass & Mica design tokens) and **Lucide Icons**.

---

## Getting Started

Follow the steps below to set up and start both servers.

### 1. Start the FastAPI Backend

Open a terminal window and execute:

```powershell
# Navigate to the backend directory
cd backend

# Create a virtual environment (if not already done)
py -m venv venv

# Activate the virtual environment
# On Windows PowerShell:
.\venv\Scripts\Activate.ps1
# On macOS/Linux:
source venv/bin/activate

# Install requirements
pip install -r requirements.txt

# Start the server with Uvicorn (direct python call is most robust on Windows)
.\venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

The FastAPI backend will start at **http://127.0.0.1:8000**. The WebSocket connection will listen at `ws://127.0.0.1:8000/ws/dashboard`.

---

### 2. Start the Next.js Frontend

Open a new terminal window and execute:

```powershell
# Navigate to the frontend directory
cd frontend

# Install packages (if not already done)
npm install

# Run the development server
npm run dev
```

Open your browser and navigate to **http://localhost:3000** to view the live dashboard.

---

## Features Walkthrough

### 📊 Real-Time Charts & Exposure
* The **Live Analytics Feed** displays stock (SPY) price ticks and Portfolio value every 1 second.
* The **Active Open Exposure** table calculates current unrealized PnL based on live-updating asset prices.

### 🧠 ML Brain Diagnostics
* **XGBoost Confidence indicator** visualizes buy probabilities. The panel glows dynamic green for high bullish confidence (> 60%), red for bearish (< 40%), and neutral gray otherwise.
* **RL Agent Position badge** syncs active trade execution orders ("BUY", "SELL", or "HOLD").

### 🚨 Risk Engine Kill-Switch
* Click **Emergency Liquidate** to send a critical shutdown payload to the backend server.
* The server will immediately flatten all exposure, close active positions, output a warning console log, and lock the portfolio.
* Click **Re-enable Trading** or the **Reset** button in the dashboard header to restore the mock trading loop.
