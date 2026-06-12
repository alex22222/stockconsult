"""Dynamic stock universe discovery for strategy scripts."""

import json
import os
import re
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
REBUILD_DIR = DATA_DIR / "rebuild"
PAPER_TRADING_DIR = DATA_DIR / "paper_trading"
STOCK_CODE_RE = re.compile(r"^\d{6}$")

StockMap = Dict[str, str]
StockMetaMap = Dict[str, Dict[str, str]]


def normalize_symbol(value: object) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    return digits[:6] if len(digits) >= 6 else ""


def infer_exchange(symbol: str) -> str:
    return "SSE" if symbol.startswith(("5", "6", "9")) else "SZSE"


def get_baostock_code(symbol: str) -> str:
    return f"{'sh' if infer_exchange(symbol) == 'SSE' else 'sz'}.{symbol}"


def _load_json(path: Path):
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _merge_stock(stocks: StockMap, meta: StockMetaMap, symbol: object, name: object = "", sector: object = ""):
    code = normalize_symbol(symbol)
    if not STOCK_CODE_RE.match(code):
        return

    candidate_name = str(name or "").strip()
    existing_name = stocks.get(code, "")
    stock_name = existing_name if existing_name and (not candidate_name or candidate_name == code) else candidate_name or code
    stocks[code] = stock_name

    item = meta.setdefault(code, {"name": stock_name})
    item["name"] = stock_name
    if sector:
        item["sector"] = str(sector).strip()
    item["exchange"] = infer_exchange(code)


def _merge_items(stocks: StockMap, meta: StockMetaMap, items: Iterable[dict]):
    for item in items:
        if isinstance(item, dict):
            _merge_stock(
                stocks,
                meta,
                item.get("symbol") or item.get("code") or item.get("stock_code"),
                item.get("name") or item.get("stock_name"),
                item.get("sector") or item.get("industry"),
            )


def _latest_daily_summary_path() -> Optional[Path]:
    summaries = sorted(REBUILD_DIR.glob("daily_summary_*.json"))
    return summaries[-1] if summaries else None


def _load_from_rebuild_outputs() -> Tuple[StockMap, StockMetaMap]:
    stocks: StockMap = {}
    meta: StockMetaMap = {}

    summary_path = _latest_daily_summary_path()
    summary = _load_json(summary_path) if summary_path else None
    if isinstance(summary, dict):
        _merge_items(stocks, meta, summary.get("predictions", []))
        _merge_items(stocks, meta, summary.get("focus_pool", []))

    focus_pool = _load_json(REBUILD_DIR / "focus_pool.json")
    if isinstance(focus_pool, dict):
        _merge_items(stocks, meta, focus_pool.get("focus", []))

    history = _load_json(REBUILD_DIR / "prediction_history.json")
    if isinstance(history, list):
        latest_by_symbol: Dict[str, dict] = {}
        for item in history:
            code = normalize_symbol(item.get("symbol") if isinstance(item, dict) else "")
            if code:
                latest_by_symbol[code] = item
        _merge_items(stocks, meta, latest_by_symbol.values())

    return stocks, meta


def _load_from_local_daily_files() -> Tuple[StockMap, StockMetaMap]:
    stocks: StockMap = {}
    meta: StockMetaMap = {}

    for path in sorted(DATA_DIR.glob("*_daily.csv")):
        code = normalize_symbol(path.name.split("_", 1)[0])
        if STOCK_CODE_RE.match(code):
            _merge_stock(stocks, meta, code)

    return stocks, meta


def _load_from_env(env_name: str) -> Tuple[StockMap, StockMetaMap]:
    stocks: StockMap = {}
    meta: StockMetaMap = {}
    raw = os.environ.get(env_name, "")
    if not raw:
        return stocks, meta

    for part in raw.split(","):
        piece = part.strip()
        if not piece:
            continue
        if ":" in piece:
            symbol, name = piece.split(":", 1)
        else:
            symbol, name = piece, ""
        _merge_stock(stocks, meta, symbol, name)

    return stocks, meta


def get_rebuild_stock_metadata() -> StockMetaMap:
    for stocks, meta in (
        _load_from_env("STOCK_UNIVERSE"),
        _load_from_rebuild_outputs(),
        _load_from_local_daily_files(),
    ):
        if stocks:
            break
    else:
        stocks, meta = {}, {}

    return {symbol: meta.get(symbol, {"name": name, "exchange": infer_exchange(symbol)}) for symbol, name in stocks.items()}


def get_rebuild_stocks() -> StockMap:
    meta = get_rebuild_stock_metadata()
    return {symbol: item.get("name") or symbol for symbol, item in meta.items()}


def get_sentiment_stocks() -> StockMap:
    env_stocks, _ = _load_from_env("SENTIMENT_STOCKS")
    if env_stocks:
        return env_stocks

    focus_pool = _load_json(REBUILD_DIR / "focus_pool.json")
    stocks: StockMap = {}
    meta: StockMetaMap = {}
    if isinstance(focus_pool, dict):
        _merge_items(stocks, meta, focus_pool.get("focus", []))

    portfolio = _load_json(PAPER_TRADING_DIR / "portfolio.json")
    if isinstance(portfolio, dict):
        _merge_items(stocks, meta, portfolio.get("positions", []))

    return stocks or get_rebuild_stocks()


def get_stock_name(symbol: str) -> str:
    code = normalize_symbol(symbol)
    return get_rebuild_stocks().get(code, code)


def get_sector(symbol: str) -> str:
    code = normalize_symbol(symbol)
    return get_rebuild_stock_metadata().get(code, {}).get("sector", "其他")


def get_demo_stock() -> Dict[str, str]:
    stocks = get_rebuild_stocks()
    symbol = next(iter(stocks), "")
    return {
        "code": symbol,
        "name": stocks.get(symbol, symbol),
        "market": "sh" if infer_exchange(symbol) == "SSE" else "sz",
    }
