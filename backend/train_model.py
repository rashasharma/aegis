import logging
import os
import pandas as pd
import numpy as np
import yfinance as yf
import xgboost as xgb

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ModelTrainer")

def calculate_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Calculates Relative Strength Index (RSI) using pandas."""
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).copy()
    loss = (-delta.where(delta < 0, 0)).copy()
    
    # Use exponential moving average for smoothing
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi

def train_and_save_model():
    logger.info("Initializing offline training pipeline...")
    
    # 1. Download historical BTC-USD data from yfinance (1-hour bars for last 1 year)
    # BTC-USD is used because it ticks 24/7, providing a highly active and comprehensive dataset.
    ticker = "BTC-USD"
    logger.info(f"Downloading historical 1-hour data for {ticker} from Yahoo Finance...")
    try:
        data = yf.download(ticker, period="1y", interval="1h")
        if data.empty:
            raise ValueError("No data returned from yfinance.")
        logger.info(f"Successfully downloaded {len(data)} bars.")
    except Exception as e:
        logger.error(f"Failed to download data: {e}")
        return False

    # Flatten columns in case of multi-indexing
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = [col[0] for col in data.columns]

    df = data.copy()

    # 2. Feature Engineering
    logger.info("Engineering technical indicators (SMA, RSI, Log Returns)...")
    # SMA Ratio (SMA_10 / SMA_30)
    df["SMA_10"] = df["Close"].rolling(window=10).mean()
    df["SMA_30"] = df["Close"].rolling(window=30).mean()
    df["sma_ratio"] = df["SMA_10"] / df["SMA_30"]

    # RSI (14)
    df["rsi"] = calculate_rsi(df["Close"], period=14)

    # Log Returns over past 5 periods
    df["log_ret"] = np.log(df["Close"] / df["Close"].shift(5))

    # Drop NaNs created by rolling windows
    df = df.dropna()

    # 3. Create Target Labels
    # Target = 1 if the price in the next period is higher than current Close, 0 otherwise
    df["target"] = (df["Close"].shift(-1) > df["Close"]).astype(int)
    
    # Drop the last row since we don't have its future target close
    df = df.iloc[:-1]

    features = ["sma_ratio", "rsi", "log_ret"]
    X = df[features]
    y = df["target"]

    # 4. Train-Test Split (Chronological to prevent data leakage)
    split_idx = int(len(df) * 0.8)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]

    logger.info(f"Training set size: {len(X_train)} rows. Testing set size: {len(X_test)} rows.")

    # 5. Train XGBoost model using the native API
    logger.info("Fitting native XGBoost Booster...")
    dtrain = xgb.DMatrix(X_train, label=y_train)
    dtest = xgb.DMatrix(X_test, label=y_test)
    
    params = {
        "max_depth": 4,
        "eta": 0.05,
        "objective": "binary:logistic",
        "eval_metric": "logloss",
        "seed": 42
    }
    
    model = xgb.train(params, dtrain, num_boost_round=100)

    # 6. Evaluate Model
    preds = model.predict(dtest)
    predictions = (preds > 0.5).astype(int)
    accuracy = (predictions == y_test).mean()
    logger.info(f"Model Training Complete. Test Set Accuracy: {accuracy:.4f}")

    # Log baseline comparison (always predicting 1 or 0)
    baseline = max(y_test.mean(), 1 - y_test.mean())
    logger.info(f"Baseline (Always predicting majority class) Accuracy: {baseline:.4f}")

    # 7. Save Model
    model_path = os.path.join(os.path.dirname(__file__), "xgboost_model.json")
    logger.info(f"Saving model file to: {model_path}")
    model.save_model(model_path)
    logger.info("SUCCESS: Model training complete and exported.")
    return True

if __name__ == "__main__":
    train_and_save_model()
