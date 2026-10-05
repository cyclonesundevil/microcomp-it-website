import math
import os
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

from cache_io import atomic_write_json, read_json_or_none
from nfl_roster_monitor import canonical_team_code


KALSHI_EDGE_SCHEMA_VERSION = 1
DEFAULT_MODELS = ("current_season_matrix", "rsm_stage7c", "rsm_plus")
BENCHMARK_MODELS = ("market_blend",)
EDGE_THRESHOLDS = (0.03, 0.05, 0.07)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def kalshi_data_root() -> Path:
    configured = os.getenv("NFL_KALSHI_EDGE_DATA_DIR", "").strip()
    if configured:
        return Path(configured)
    data_root = Path("/data") if os.path.isdir("/data") else Path(__file__).resolve().parents[1] / "cache"
    return data_root / "kalshi_edge"


def kalshi_snapshot_store_path() -> Path:
    return kalshi_data_root() / "kalshi_moneyline_snapshots.json"


def _to_float(value) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _norm_market_type(value: object) -> str:
    raw = str(value or "moneyline").strip().lower().replace("-", "_")
    if raw in {"game", "winner", "straight_up", "straightup", "win"}:
        return "moneyline"
    return raw


def _mid_price(row: dict) -> Optional[float]:
    explicit = _to_float(row.get("kalshi_mid_price") or row.get("mid") or row.get("mid_price") or row.get("price"))
    if explicit is not None:
        return explicit / 100.0 if explicit > 1 else explicit
    bid = _to_float(row.get("kalshi_yes_bid") or row.get("yes_bid") or row.get("bid"))
    ask = _to_float(row.get("kalshi_yes_ask") or row.get("yes_ask") or row.get("ask"))
    if bid is None or ask is None:
        return None
    bid = bid / 100.0 if bid > 1 else bid
    ask = ask / 100.0 if ask > 1 else ask
    return (bid + ask) / 2.0


def _contract_side(row: dict) -> str:
    side = str(row.get("contract_side") or row.get("side") or "").strip().lower()
    if side in {"home", "home_win", "home yes"}:
        return "home_win"
    if side in {"away", "away_win", "away yes"}:
        return "away_win"
    team = canonical_team_code(row.get("team") or row.get("contract_team") or row.get("ticker_side"))
    if team and team == canonical_team_code(row.get("home_team")):
        return "home_win"
    if team and team == canonical_team_code(row.get("away_team")):
        return "away_win"
    return side or "home_win"


def _game_key(row: dict) -> str:
    game_id = str(row.get("game_id") or "").strip()
    if game_id:
        return game_id
    return "|".join([
        str(row.get("season") or ""),
        str(row.get("week") or ""),
        canonical_team_code(row.get("away_team")),
        canonical_team_code(row.get("home_team")),
    ])


def _minutes_to_kickoff(observed_at: str, kickoff_at: str) -> Optional[float]:
    try:
        observed = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
        kickoff = datetime.fromisoformat(kickoff_at.replace("Z", "+00:00"))
        return (kickoff - observed).total_seconds() / 60.0
    except (AttributeError, ValueError):
        return None


def normalize_kalshi_snapshot(row: dict, defaults: Optional[dict] = None) -> dict:
    defaults = defaults or {}
    merged = {**defaults, **(row or {})}
    observed_at = str(merged.get("observed_at") or defaults.get("observed_at") or utc_now_iso())
    kickoff_at = str(merged.get("kickoff_at") or merged.get("kickoff") or "")
    mid = _mid_price(merged)
    implied = _to_float(merged.get("kalshi_implied_probability") or merged.get("implied_probability") or merged.get("probability"))
    if implied is not None and implied > 1:
        implied /= 100.0
    if implied is None:
        implied = mid
    away = canonical_team_code(merged.get("away_team"))
    home = canonical_team_code(merged.get("home_team"))
    normalized = {
        "schema_version": KALSHI_EDGE_SCHEMA_VERSION,
        "season": int(merged["season"]) if str(merged.get("season") or "").isdigit() else merged.get("season"),
        "week": int(merged["week"]) if str(merged.get("week") or "").isdigit() else merged.get("week"),
        "game_id": str(merged.get("game_id") or ""),
        "away_team": away,
        "home_team": home,
        "market_type": _norm_market_type(merged.get("market_type")),
        "contract_side": _contract_side({**merged, "away_team": away, "home_team": home}),
        "kalshi_yes_bid": _to_float(merged.get("kalshi_yes_bid") or merged.get("yes_bid") or merged.get("bid")),
        "kalshi_yes_ask": _to_float(merged.get("kalshi_yes_ask") or merged.get("yes_ask") or merged.get("ask")),
        "kalshi_mid_price": mid,
        "kalshi_implied_probability": implied,
        "volume": _to_float(merged.get("volume")),
        "liquidity": _to_float(merged.get("liquidity")),
        "observed_at": observed_at,
        "kickoff_at": kickoff_at,
        "minutes_to_kickoff": _to_float(merged.get("minutes_to_kickoff")) if merged.get("minutes_to_kickoff") not in (None, "") else _minutes_to_kickoff(observed_at, kickoff_at),
        "source_url": str(merged.get("source_url") or merged.get("url") or ""),
        "market_id": str(merged.get("market_id") or merged.get("ticker") or ""),
    }
    if normalized["market_type"] != "moneyline":
        normalized["experimental_warning"] = "Only moneyline markets are analyzed in the current Kalshi Edge Lab."
    return normalized


def _extract_snapshot_rows(payload) -> tuple[list[dict], dict]:
    if isinstance(payload, list):
        return payload, {}
    if not isinstance(payload, dict):
        return [], {}
    defaults = {
        key: payload.get(key)
        for key in ("season", "week", "observed_at", "kickoff_at", "source_url")
        if payload.get(key) is not None
    }
    rows = payload.get("snapshots") or payload.get("markets") or payload.get("rows") or payload.get("data")
    if isinstance(rows, list):
        return rows, defaults
    return [payload], defaults


def read_kalshi_snapshots() -> list[dict]:
    payload = read_json_or_none(kalshi_snapshot_store_path())
    if not isinstance(payload, dict):
        return []
    rows = payload.get("snapshots")
    return rows if isinstance(rows, list) else []


def import_kalshi_snapshots(payload) -> dict:
    rows, defaults = _extract_snapshot_rows(payload)
    normalized = [
        normalize_kalshi_snapshot(row, defaults)
        for row in rows
        if isinstance(row, dict)
    ]
    normalized = [
        row for row in normalized
        if row.get("market_type") == "moneyline" and row.get("away_team") and row.get("home_team") and row.get("kalshi_implied_probability") is not None
    ]
    existing = read_kalshi_snapshots()
    by_key = {}
    for row in existing + normalized:
        key = (
            _game_key(row),
            row.get("contract_side"),
            row.get("observed_at"),
            row.get("market_id"),
        )
        by_key[key] = row
    snapshots = sorted(by_key.values(), key=lambda row: (row.get("season") or 0, row.get("week") or 0, row.get("observed_at") or "", row.get("away_team") or "", row.get("home_team") or "", row.get("contract_side") or ""))
    atomic_write_json(kalshi_snapshot_store_path(), {
        "schema_version": KALSHI_EDGE_SCHEMA_VERSION,
        "updated_at": utc_now_iso(),
        "snapshots": snapshots,
    }, indent=2, sort_keys=True)
    return {
        "success": True,
        "imported": len(normalized),
        "total_snapshots": len(snapshots),
        "store_path": str(kalshi_snapshot_store_path()),
    }


def _logistic(margin: float, scale: float) -> float:
    scale = max(scale, 0.1)
    x = max(-30.0, min(30.0, margin / scale))
    return 1.0 / (1.0 + math.exp(-x))


def _log_loss(probability: float, actual: int) -> float:
    p = min(max(probability, 1e-6), 1 - 1e-6)
    return -(actual * math.log(p) + (1 - actual) * math.log(1 - p))


def _brier(probability: float, actual: int) -> float:
    return (probability - actual) ** 2


def calibrate_margin_to_win(records: Iterable[dict], model: str, min_sample: int = 25) -> dict:
    points = []
    for row in records or []:
        if row.get("model") != model:
            continue
        margin = _to_float(row.get("pred_margin"))
        actual_margin = _to_float(row.get("actual_margin") if row.get("actual_margin") is not None else row.get("home_margin"))
        if margin is None or actual_margin is None:
            continue
        points.append((margin, 1 if actual_margin > 0 else 0))
    if len(points) < min_sample:
        scale = 6.5
        confidence = "low"
    else:
        candidates = [x / 10.0 for x in range(25, 151)]
        scale = min(candidates, key=lambda value: sum(_log_loss(_logistic(margin, value), actual) for margin, actual in points) / len(points))
        confidence = "medium" if len(points) < 100 else "high"
    scored = [(_logistic(margin, scale), actual) for margin, actual in points]
    return {
        "model": model,
        "sample_size": len(points),
        "scale": scale,
        "confidence": confidence,
        "fallback_used": len(points) < min_sample,
        "brier_score": sum(_brier(prob, actual) for prob, actual in scored) / len(scored) if scored else None,
        "log_loss": sum(_log_loss(prob, actual) for prob, actual in scored) / len(scored) if scored else None,
        "calibrated_at": utc_now_iso(),
    }


def _records_from_matchup_history(history_by_model: dict[str, list[dict]]) -> list[dict]:
    records = []
    for model, rows in (history_by_model or {}).items():
        for row in rows or []:
            records.append({**row, "model": row.get("model") or model})
    return records


def latest_moneyline_pairs(snapshots: list[dict], season=None, week=None) -> dict[str, dict]:
    grouped: dict[str, dict] = defaultdict(dict)
    for row in snapshots:
        if row.get("market_type") != "moneyline":
            continue
        if season is not None and row.get("season") not in {None, "", season}:
            continue
        if week is not None and row.get("week") not in {None, "", week}:
            continue
        key = _game_key(row)
        side = row.get("contract_side")
        existing = grouped[key].get(side)
        if existing is None or str(row.get("observed_at") or "") >= str(existing.get("observed_at") or ""):
            grouped[key][side] = row
    return grouped


def _kalshi_home_probability(pair: dict) -> Optional[float]:
    home = pair.get("home_win")
    away = pair.get("away_win")
    if home and home.get("kalshi_implied_probability") is not None:
        return _to_float(home.get("kalshi_implied_probability"))
    if away and away.get("kalshi_implied_probability") is not None:
        away_prob = _to_float(away.get("kalshi_implied_probability"))
        return 1.0 - away_prob if away_prob is not None else None
    return None


def _selected_trade(edge_home: Optional[float], threshold: float) -> Optional[dict]:
    if edge_home is None:
        return None
    if edge_home >= threshold:
        return {"side": "home_win", "edge": edge_home}
    if -edge_home >= threshold:
        return {"side": "away_win", "edge": -edge_home}
    return None


def _actual_home_win(game: dict) -> Optional[bool]:
    home_score = _to_float(game.get("home_score"))
    away_score = _to_float(game.get("away_score"))
    actual_margin = _to_float(game.get("actual_margin") if game.get("actual_margin") is not None else game.get("home_margin"))
    if home_score is not None and away_score is not None:
        return home_score > away_score
    if actual_margin is not None:
        return actual_margin > 0
    return None


def _trade_profit(selected_side: str, price: Optional[float], actual_home_win: Optional[bool]) -> Optional[float]:
    if price is None or actual_home_win is None:
        return None
    side_won = actual_home_win if selected_side == "home_win" else not actual_home_win
    return (1.0 - price) if side_won else -price


def kalshi_edge_rows(
    upcoming_snapshot: dict,
    snapshots: list[dict],
    calibrations: dict[str, dict],
    thresholds: Iterable[float] = EDGE_THRESHOLDS,
    models: Iterable[str] = DEFAULT_MODELS + BENCHMARK_MODELS,
) -> list[dict]:
    season = upcoming_snapshot.get("season")
    week = upcoming_snapshot.get("week")
    kalshi_pairs = latest_moneyline_pairs(snapshots, season, week)
    rows = []
    for game in upcoming_snapshot.get("games", []) or []:
        schedule = game.get("schedule") or game
        game_key = _game_key(schedule)
        pair = kalshi_pairs.get(game_key)
        if not pair:
            fallback_key = "|".join([
                str(schedule.get("season") or season or ""),
                str(schedule.get("week") or week or ""),
                canonical_team_code(schedule.get("away_team")),
                canonical_team_code(schedule.get("home_team")),
            ])
            pair = kalshi_pairs.get(fallback_key)
        if not pair:
            continue
        kalshi_home = _kalshi_home_probability(pair)
        if kalshi_home is None:
            continue
        actual_home_win = _actual_home_win(schedule)
        models_payload = game.get("models") or {}
        for model in models:
            prediction = models_payload.get(model)
            if not isinstance(prediction, dict):
                continue
            pred_margin = _to_float(prediction.get("pred_margin"))
            if pred_margin is None:
                continue
            calibration = calibrations.get(model) or calibrate_margin_to_win([], model)
            model_home = _logistic(pred_margin, _to_float(calibration.get("scale")) or 6.5)
            edge_home = model_home - kalshi_home
            price_home = kalshi_home
            price_away = 1.0 - kalshi_home
            for threshold in thresholds:
                selected = _selected_trade(edge_home, threshold)
                selected_side = selected["side"] if selected else None
                price = price_home if selected_side == "home_win" else price_away if selected_side == "away_win" else None
                rows.append({
                    "season": schedule.get("season") or season,
                    "week": schedule.get("week") or week,
                    "game_id": schedule.get("game_id") or "",
                    "away_team": canonical_team_code(schedule.get("away_team")),
                    "home_team": canonical_team_code(schedule.get("home_team")),
                    "gameday": schedule.get("gameday") or "",
                    "gametime": schedule.get("gametime") or "",
                    "model": model,
                    "threshold": threshold,
                    "pred_margin": pred_margin,
                    "model_home_win_probability": model_home,
                    "model_away_win_probability": 1.0 - model_home,
                    "kalshi_home_win_probability": kalshi_home,
                    "kalshi_away_win_probability": 1.0 - kalshi_home,
                    "home_edge": edge_home,
                    "away_edge": -edge_home,
                    "recommended_side": selected_side,
                    "recommended_team": schedule.get("home_team") if selected_side == "home_win" else schedule.get("away_team") if selected_side == "away_win" else None,
                    "trade_price": price,
                    "simulated_profit": _trade_profit(selected_side, price, actual_home_win) if selected_side else None,
                    "actual_home_win": actual_home_win,
                    "roster_overlay_applied": bool(prediction.get("rsm_roster_overlay_applied")),
                    "calibration_confidence": calibration.get("confidence"),
                    "calibration_sample_size": calibration.get("sample_size"),
                    "kalshi_observed_at": (pair.get("home_win") or pair.get("away_win") or {}).get("observed_at"),
                    "source_url": (pair.get("home_win") or pair.get("away_win") or {}).get("source_url"),
                })
    return rows


def summarize_backtest(rows: list[dict]) -> dict:
    trades = [row for row in rows if row.get("recommended_side") and row.get("simulated_profit") is not None]
    by_model = []
    for model in sorted({row.get("model") for row in trades if row.get("model")}):
        model_rows = [row for row in trades if row.get("model") == model]
        invested = sum(row.get("trade_price") or 0.0 for row in model_rows)
        profit = sum(row.get("simulated_profit") or 0.0 for row in model_rows)
        wins = sum(1 for row in model_rows if (row.get("simulated_profit") or 0) > 0)
        by_model.append({
            "model": model,
            "trades": len(model_rows),
            "hit_rate": wins / len(model_rows) if model_rows else None,
            "total_profit": profit,
            "roi": profit / invested if invested else None,
            "average_edge": sum(abs(row.get("home_edge") or 0.0) for row in model_rows) / len(model_rows) if model_rows else None,
            "average_price": invested / len(model_rows) if model_rows else None,
        })
    invested = sum(row.get("trade_price") or 0.0 for row in trades)
    profit = sum(row.get("simulated_profit") or 0.0 for row in trades)
    return {
        "games_analyzed": len({(row.get("game_id"), row.get("away_team"), row.get("home_team")) for row in rows}),
        "rows_analyzed": len(rows),
        "trades_triggered": len(trades),
        "hit_rate": sum(1 for row in trades if (row.get("simulated_profit") or 0) > 0) / len(trades) if trades else None,
        "total_simulated_pl": profit,
        "roi": profit / invested if invested else None,
        "average_edge": sum(abs(row.get("home_edge") or 0.0) for row in trades) / len(trades) if trades else None,
        "average_price": invested / len(trades) if trades else None,
        "by_model": by_model,
    }


def kalshi_edge_report(
    upcoming_snapshot: dict,
    history_by_model: Optional[dict[str, list[dict]]] = None,
    snapshots: Optional[list[dict]] = None,
) -> dict:
    snapshots = read_kalshi_snapshots() if snapshots is None else snapshots
    history_records = _records_from_matchup_history(history_by_model or {})
    models = DEFAULT_MODELS + BENCHMARK_MODELS
    calibrations = {model: calibrate_margin_to_win(history_records, model) for model in models}
    rows = kalshi_edge_rows(upcoming_snapshot, snapshots, calibrations, models=models)
    latest_import = max((row.get("observed_at") or "" for row in snapshots), default=None)
    return {
        "success": True,
        "experimental": True,
        "schema_version": KALSHI_EDGE_SCHEMA_VERSION,
        "warning": "Research only. Kalshi data is not used by production picks or model math.",
        "snapshot_count": len(snapshots),
        "latest_import_observed_at": latest_import,
        "season": upcoming_snapshot.get("season"),
        "week": upcoming_snapshot.get("week"),
        "calibrations": calibrations,
        "rows": rows,
        "backtest": summarize_backtest(rows),
    }
