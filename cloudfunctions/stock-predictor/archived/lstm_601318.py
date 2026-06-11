# -*- coding: utf-8 -*-
"""
中国平安 LSTM 深度学习模型
==========================

输入：过去 lookback 天的特征序列
输出：次日涨跌概率

相比传统模型的优势：
- 捕捉时间序列依赖关系
- 自动学习特征的时序组合
"""
import warnings
warnings.filterwarnings('ignore')
import os
import pandas as pd
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from sklearn.preprocessing import StandardScaler
from local_data_provider import LocalDataProvider
from optimize_601318 import build_601318_features, load_value_data

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {DEVICE}")


class StockDataset(Dataset):
    """时间序列数据集"""
    def __init__(self, X_seq, y_seq):
        self.X = torch.FloatTensor(X_seq)
        self.y = torch.FloatTensor(y_seq)
    
    def __len__(self):
        return len(self.X)
    
    def __getitem__(self, idx):
        return self.X[idx], self.y[idx]


class LSTMModel(nn.Module):
    """LSTM + Attention 模型"""
    def __init__(self, input_size, hidden_size=64, num_layers=2, dropout=0.2):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout,
            bidirectional=False,
        )
        self.attention = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.Tanh(),
            nn.Linear(32, 1),
        )
        self.fc = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(32, 1),
            nn.Sigmoid(),
        )
    
    def forward(self, x):
        # x: (batch, seq_len, features)
        lstm_out, (h_n, c_n) = self.lstm(x)  # lstm_out: (batch, seq_len, hidden)
        
        # Attention weights
        attn_weights = torch.softmax(self.attention(lstm_out), dim=1)  # (batch, seq_len, 1)
        context = torch.sum(attn_weights * lstm_out, dim=1)  # (batch, hidden)
        
        return self.fc(context).squeeze(-1)  # (batch,)


def build_sequence_features(X: pd.DataFrame, y: pd.Series, lookback: int = 20):
    """
    构建时间序列特征
    
    Returns:
        X_seq: (samples, lookback, features)
        y_seq: (samples,)
    """
    X_vals = X.values
    y_vals = y.values
    
    sequences = []
    targets = []
    
    for i in range(lookback, len(X_vals)):
        seq = X_vals[i-lookback:i]
        target = y_vals[i]
        sequences.append(seq)
        targets.append(target)
    
    return np.array(sequences), np.array(targets)


def train_lstm(X_train, y_train, X_val, y_val, lookback=20, epochs=50, batch_size=64, lr=0.001):
    """训练LSTM模型"""
    input_size = X_train.shape[2]
    
    model = LSTMModel(input_size=input_size, hidden_size=64, num_layers=2, dropout=0.2).to(DEVICE)
    criterion = nn.BCELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-5)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode='max', factor=0.5, patience=5)
    
    train_dataset = StockDataset(X_train, y_train)
    val_dataset = StockDataset(X_val, y_val)
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=batch_size)
    
    best_val_acc = 0
    best_model_state = None
    
    for epoch in range(epochs):
        model.train()
        train_losses = []
        
        for X_batch, y_batch in train_loader:
            X_batch = X_batch.to(DEVICE)
            y_batch = y_batch.to(DEVICE)
            
            optimizer.zero_grad()
            outputs = model(X_batch)
            loss = criterion(outputs, y_batch)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            
            train_losses.append(loss.item())
        
        # 验证
        model.eval()
        val_preds = []
        val_targets = []
        
        with torch.no_grad():
            for X_batch, y_batch in val_loader:
                X_batch = X_batch.to(DEVICE)
                outputs = model(X_batch)
                val_preds.extend(outputs.cpu().numpy())
                val_targets.extend(y_batch.numpy())
        
        val_preds_binary = (np.array(val_preds) > 0.5).astype(int)
        val_acc = np.mean(val_preds_binary == np.array(val_targets))
        
        scheduler.step(val_acc)
        
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            best_model_state = model.state_dict().copy()
        
        if (epoch + 1) % 10 == 0:
            print(f"  Epoch {epoch+1}/{epochs}: train_loss={np.mean(train_losses):.4f}, val_acc={val_acc:.4f}")
    
    # 加载最佳模型
    if best_model_state:
        model.load_state_dict(best_model_state)
    
    return model, best_val_acc


def backtest_lstm(symbol="601318", train_ratio=0.7, lookback=20):
    """LSTM回测"""
    local = LocalDataProvider(DATA_DIR)
    raw = local.get_all_data_for_stock(symbol, days=5000)
    value_df = load_value_data()
    X, y = build_601318_features(raw, value_df)
    
    if X.empty or len(X) < 300:
        print("数据不足")
        return None
    
    # 标准化（只用训练集fit）
    split = int(len(X) * train_ratio)
    
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X.iloc[:split])
    X_test_scaled = scaler.transform(X.iloc[split:])
    
    # 构建序列
    X_train_seq, y_train_seq = build_sequence_features(
        pd.DataFrame(X_train_scaled, columns=X.columns),
        y.iloc[:split],
        lookback
    )
    
    # 验证集（从训练集中取最后20%）
    val_split = int(len(X_train_seq) * 0.8)
    X_tr, X_val = X_train_seq[:val_split], X_train_seq[val_split:]
    y_tr, y_val = y_train_seq[:val_split], y_train_seq[val_split:]
    
    print(f"训练集: {len(X_tr)} 条, 验证集: {len(X_val)} 条")
    
    # 训练LSTM
    print("训练LSTM...")
    model, val_acc = train_lstm(X_tr, y_tr, X_val, y_val, lookback=lookback, epochs=50, batch_size=64)
    print(f"最佳验证准确率: {val_acc:.2%}")
    
    # 测试集预测
    X_test_full = pd.DataFrame(
        np.vstack([X_train_scaled[-lookback:], X_test_scaled]),
        columns=X.columns
    )
    X_test_seq, y_test_seq = build_sequence_features(X_test_full, y.iloc[split-lookback:], lookback)
    
    model.eval()
    with torch.no_grad():
        test_tensor = torch.FloatTensor(X_test_seq).to(DEVICE)
        test_probs = model(test_tensor).cpu().numpy()
    
    test_preds = (test_probs > 0.5).astype(int)
    test_acc = np.mean(test_preds == y_test_seq)
    print(f"测试集准确率: {test_acc:.2%}")
    
    # 回测
    stock_df = raw["stock_daily"].sort_values("日期").reset_index(drop=True)
    close = stock_df["收盘"].astype(float).values
    dates = stock_df["日期"].astype(str).values
    
    # 对齐
    close = close[split:split+len(test_probs)]
    dates = dates[split:split+len(test_probs)]
    confidences = np.abs(test_probs - 0.5) * 2
    
    # 简单回测
    capital = 10000.0
    position = 0
    entry_price = 0
    trades = []
    equity = []
    
    COMMISSION = 0.00025
    STAMP_TAX = 0.001
    MIN_COMM = 5
    SLIPPAGE = 0.001
    
    for i in range(len(test_probs)):
        price = close[i]
        date = dates[i]
        pred = test_preds[i]
        conf = confidences[i]
        cur_eq = capital + position * price
        equity.append({"date": date, "equity": cur_eq, "price": price})
        
        # 止损止盈
        if position > 0:
            ret = (price - entry_price) / entry_price
            if ret <= -0.05 or ret >= 0.10:
                revenue = position * price * (1 - SLIPPAGE)
                comm = max(revenue * COMMISSION, MIN_COMM)
                tax = revenue * STAMP_TAX
                capital += revenue - comm - tax
                reason = "STOP" if ret <= -0.05 else "PROFIT"
                trades.append({"date": date, "action": "SELL", "price": price, "shares": position, "reason": reason})
                position = 0
                continue
        
        if conf < 0.20:
            continue
        
        if pred == 1 and position == 0:
            buy_amt = capital * 0.8
            p_slip = price * (1 + SLIPPAGE)
            shares = int(buy_amt / p_slip / 100) * 100
            if shares >= 100:
                cost = shares * p_slip
                comm = max(cost * COMMISSION, MIN_COMM)
                total = cost + comm
                if total <= capital:
                    capital -= total
                    position = shares
                    entry_price = price
                    trades.append({"date": date, "action": "BUY", "price": price, "shares": shares})
        
        elif pred == 0 and position > 0:
            revenue = position * price * (1 - SLIPPAGE)
            comm = max(revenue * COMMISSION, MIN_COMM)
            tax = revenue * STAMP_TAX
            capital += revenue - comm - tax
            trades.append({"date": date, "action": "SELL", "price": price, "shares": position, "reason": "SIGNAL"})
            position = 0
    
    if position > 0:
        price = close[-1]
        revenue = position * price * (1 - SLIPPAGE)
        comm = max(revenue * COMMISSION, MIN_COMM)
        tax = revenue * STAMP_TAX
        capital += revenue - comm - tax
        trades.append({"date": dates[-1], "action": "SELL", "price": price, "shares": position, "reason": "FINAL"})
    
    # 指标
    df_eq = pd.DataFrame(equity)
    df_eq["return"] = df_eq["equity"].pct_change()
    
    initial = 10000.0
    final = capital
    total_ret = (final - initial) / initial
    n_days = len(df_eq)
    ann_ret = total_ret * 252 / n_days if n_days > 0 else 0
    vol = df_eq["return"].std() * np.sqrt(252) * 100
    sharpe = (ann_ret * 100 - 3) / vol if vol > 0 else 0
    cummax = df_eq["equity"].cummax()
    max_dd = ((cummax - df_eq["equity"]) / cummax).max() * 100
    
    trade_rets = []
    last_buy = None
    for t in trades:
        if t["action"] == "BUY":
            last_buy = t
        elif t["action"] == "SELL" and last_buy:
            trade_rets.append((t["price"] - last_buy["price"]) / last_buy["price"])
            last_buy = None
    
    win_rate = sum(1 for r in trade_rets if r > 0) / len(trade_rets) * 100 if trade_rets else 0
    avg_ret = np.mean(trade_rets) * 100 if trade_rets else 0
    
    return {
        "val_acc": val_acc,
        "test_acc": test_acc,
        "total_return": total_ret,
        "annual": ann_ret,
        "sharpe": sharpe,
        "max_dd": max_dd,
        "trades": len([t for t in trades if t["action"] == "SELL"]),
        "win_rate": win_rate,
        "avg_trade": avg_ret,
    }


def main():
    print("=" * 70)
    print("中国平安 LSTM 深度学习模型")
    print("=" * 70)
    
    result = backtest_lstm()
    if result:
        print(f"\n{'='*70}")
        print(f"验证准确率:   {result['val_acc']:.2%}")
        print(f"测试准确率:   {result['test_acc']:.2%}")
        print(f"总收益:       {result['total_return']:>+10.2%}")
        print(f"年化收益:     {result['annual']:>+10.1%}")
        print(f"夏普比率:     {result['sharpe']:>10.2f}")
        print(f"最大回撤:     {result['max_dd']:>9.1f}%")
        print(f"交易次数:     {result['trades']:>10}次")
        print(f"胜率:         {result['win_rate']:>9.1f}%")
        print(f"均收益:       {result['avg_trade']:>+9.2f}%")
        print(f"{'='*70}")


if __name__ == "__main__":
    main()
