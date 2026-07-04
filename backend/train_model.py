import os
import math
import numpy as np
import pandas as pd
import yfinance as yf
import xgboost as xgb

def calculate_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / (avg_loss + 1e-9)
    return 100.0 - (100.0 / (1.0 + rs))

def extract_features(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [col[0] for col in df.columns]
    close = df["Close"]
    data = pd.DataFrame(index=df.index)
    data["ret_1"] = np.log(close / close.shift(1))
    data["ret_4"] = np.log(close / close.shift(4))
    data["ret_12"] = np.log(close / close.shift(12))
    fast_ema = close.ewm(span=8).mean()
    slow_ema = close.ewm(span=24).mean()
    data["sma_ratio"] = fast_ema / (slow_ema + 1e-9)
    data["rsi"] = calculate_rsi(close, 14)
    data["volatility"] = data["ret_1"].rolling(16).std()
    data["target"] = (close.shift(-2) > close).astype(int)
    return data.dropna()

def train():
    tickers = ["BTC-USD", "ETH-USD", "SOL-USD", "NVDA", "AAPL"]
    frames = []
    for ticker in tickers:
        try:
            raw = yf.download(ticker, period="60d", interval="15m", progress=False)
            if not raw.empty and len(raw) > 50:
                feat = extract_features(raw)
                frames.append(feat)
        except Exception:
            continue

    if not frames:
        return

    combined = pd.concat(frames, ignore_index=True)
    features = ["ret_1", "ret_4", "ret_12", "sma_ratio", "rsi", "volatility"]
    X = combined[features]
    y = combined["target"]

    split_idx = int(len(combined) * 0.8)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]

    dtrain = xgb.DMatrix(X_train, label=y_train, feature_names=features)
    dtest = xgb.DMatrix(X_test, label=y_test, feature_names=features)

    params = {
        "max_depth": 4,
        "eta": 0.03,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "objective": "binary:logistic",
        "eval_metric": "logloss",
        "seed": 42
    }

    model = xgb.train(params, dtrain, num_boost_round=120, evals=[(dtest, "test")], verbose_eval=False)

    preds = model.predict(dtest)
    pred_labels = (preds > 0.5).astype(int)
    acc = (pred_labels == y_test.values).mean()
    majority = max(y_test.mean(), 1 - y_test.mean())
    print(f"Test Accuracy: {acc:.4f} | Baseline: {majority:.4f} | Edge: {acc - majority:+.4f}")

    out_path = os.path.join(os.path.dirname(__file__), "xgboost_model.json")
    model.save_model(out_path)
    print("Model saved to", out_path)

if __name__ == "__main__":
    train()
