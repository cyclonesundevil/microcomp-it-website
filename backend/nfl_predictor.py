import argparse
import csv
import hashlib
import io
import json
import os
import pickle
import math
import statistics
import tempfile
import threading
import time
import urllib.request
from datetime import datetime, time as datetime_time, timedelta, timezone
from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
DEFAULT_CACHE_PATH = os.path.join(os.path.dirname(__file__), "data", "nfl_games.csv")
RSM_PROFILE = "rsm_stage7c"
MEAN_REVERSION_PROFILE = "mean_reversion"
MODEL_PROFILES = ("baseline", "enhanced", "market_blend", MEAN_REVERSION_PROFILE, "rothstein", "rothstein_plus", RSM_PROFILE)
UPCOMING_PREDICTION_SCHEMA_VERSION = 5
WEEKLY_PERFORMANCE_TREND_SCHEMA_VERSION = 1
REPORTS_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "reports"))
DEFAULT_AVAILABILITY_ADJUSTMENTS_PATH = os.path.join(os.path.dirname(__file__), "config", "nfl_upcoming_availability_adjustments.json")
INJURY_PROFILES = {
    "general": {
        "label": "General high-impact player",
        "default_impact": 3.0,
        "offense_factor": 0.55,
        "allowed_factor": 0.18,
        "strength_factor": 1.0,
    },
    "qb": {
        "label": "Starting quarterback",
        "default_impact": 7.0,
        "offense_factor": 0.85,
        "allowed_factor": 0.05,
        "strength_factor": 1.15,
    },
    "skill": {
        "label": "RB / WR / TE",
        "default_impact": 4.0,
        "offense_factor": 0.65,
        "allowed_factor": 0.05,
        "strength_factor": 1.0,
    },
    "ol": {
        "label": "Offensive line",
        "default_impact": 4.5,
        "offense_factor": 0.55,
        "allowed_factor": 0.08,
        "strength_factor": 1.0,
    },
    "pass_rush": {
        "label": "Pass rush / defensive line",
        "default_impact": 4.5,
        "offense_factor": 0.10,
        "allowed_factor": 0.55,
        "strength_factor": 1.0,
    },
    "coverage": {
        "label": "Coverage / secondary",
        "default_impact": 4.0,
        "offense_factor": 0.05,
        "allowed_factor": 0.50,
        "strength_factor": 0.95,
    },
    "linebacker": {
        "label": "Linebacker / run defense",
        "default_impact": 3.5,
        "offense_factor": 0.05,
        "allowed_factor": 0.42,
        "strength_factor": 0.85,
    },
    "special": {
        "label": "Kicker / specialist",
        "default_impact": 2.0,
        "offense_factor": 0.25,
        "allowed_factor": 0.10,
        "strength_factor": 0.55,
    },
}

_GAMES_REFRESH_LOCK = threading.Lock()
_UPCOMING_PREDICTION_LOCK = threading.Lock()
_UPCOMING_REFRESH_RUNNING = False
_UPCOMING_PROGRESS_STATE = {
    "status": "idle",
    "ready": False,
    "progress": 0,
    "message": "Forecast idle.",
}
_REQUIRED_GAMES_COLUMNS = {
    "game_id", "season", "week", "game_type", "away_team", "home_team",
    "away_score", "home_score", "spread_line", "total_line",
}
MODEL_SIGNAL_STATUSES = {
    "market": "Market baseline",
    "baseline": "Production",
    "enhanced": "Production",
    "market_blend": "Production",
    MEAN_REVERSION_PROFILE: "Production",
    "rothstein": "Production",
    "rothstein_plus": "Experimental",
    RSM_PROFILE: "Experimental",
    "dsm": "Research only",
    "prm": "Research only",
}
NFL_WEEK_ROLLOVER_TIMEZONE = "America/Phoenix"
NFL_WEEK_ROLLOVER_HOUR = 6


def upcoming_prediction_cache_path() -> str:
    configured = os.getenv("NFL_UPCOMING_CACHE_PATH", "").strip()
    if configured:
        return configured
    if os.path.isdir("/data"):
        return "/data/nfl_upcoming_predictions.json"
    return os.path.join(os.path.dirname(__file__), "data", "nfl_upcoming_predictions.json")


def upcoming_prediction_cache_ttl_seconds() -> int:
    try:
        return max(0, int(os.getenv("NFL_UPCOMING_CACHE_TTL_SECONDS", str(24 * 60 * 60))))
    except ValueError:
        return 24 * 60 * 60


def availability_adjustments_path() -> str:
    return os.getenv("NFL_AVAILABILITY_ADJUSTMENTS_PATH", "").strip() or DEFAULT_AVAILABILITY_ADJUSTMENTS_PATH


def _file_signature(path: str) -> str:
    try:
        digest = hashlib.sha256()
        with open(path, "rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return "missing"


def _games_source_signature() -> str:
    return _file_signature(DEFAULT_CACHE_PATH)


def _availability_adjustments_signature() -> str:
    return _file_signature(availability_adjustments_path())


def _upcoming_checkpoint_path() -> str:
    return f"{upcoming_prediction_cache_path()}.checkpoint.pkl"


def _upcoming_build_fingerprint(games: List[dict], upcoming: List[dict], season: Optional[int], week: Optional[int]) -> str:
    source = {
        "schema_version": UPCOMING_PREDICTION_SCHEMA_VERSION,
        "season": season,
        "week": week,
        "availability_adjustments_signature": _availability_adjustments_signature(),
        "games": [
            (game.get("season"), game.get("week"), game.get("game_id"), game.get("away_score"), game.get("home_score"), game.get("spread_line"), game.get("total_line"))
            for game in games
        ],
        "upcoming": upcoming,
    }
    return hashlib.sha256(json.dumps(source, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def load_upcoming_availability_adjustments() -> List[dict]:
    path = availability_adjustments_path()
    try:
        with open(path, encoding="utf-8") as source:
            payload = json.load(source)
    except (OSError, json.JSONDecodeError):
        return []
    records = payload.get("adjustments", payload) if isinstance(payload, dict) else payload
    if not isinstance(records, list):
        return []
    clean = []
    for record in records:
        if not isinstance(record, dict) or not record.get("team"):
            continue
        try:
            clean.append({
                "season": int(record["season"]) if record.get("season") is not None else None,
                "week": int(record["week"]) if record.get("week") is not None else None,
                "game_id": str(record.get("game_id") or "").strip() or None,
                "team": str(record["team"]).strip().upper(),
                "margin_delta": float(record.get("margin_delta", 0.0) or 0.0),
                "total_delta": float(record.get("total_delta", 0.0) or 0.0),
                "label": str(record.get("label") or "Availability adjustment").strip(),
                "source": str(record.get("source") or "").strip() or None,
            })
        except (TypeError, ValueError):
            continue
    return clean


def matching_availability_adjustments(game: dict, adjustments: List[dict]) -> List[dict]:
    matches = []
    for adjustment in adjustments:
        if adjustment.get("season") is not None and adjustment["season"] != game.get("season"):
            continue
        if adjustment.get("week") is not None and adjustment["week"] != game.get("week"):
            continue
        if adjustment.get("game_id") is not None and adjustment["game_id"] != game.get("game_id"):
            continue
        if adjustment["team"] not in {game.get("away_team"), game.get("home_team")}:
            continue
        matches.append(adjustment)
    return matches


def apply_upcoming_availability_adjustments(prediction: dict, scheduled: dict, adjustments: List[dict]) -> dict:
    relevant = matching_availability_adjustments(scheduled, adjustments)
    if not relevant:
        return prediction

    margin_delta = 0.0
    total_delta = 0.0
    public_adjustments = []
    for adjustment in relevant:
        team_delta = adjustment["margin_delta"]
        if adjustment["team"] == scheduled.get("home_team"):
            margin_delta += team_delta
        elif adjustment["team"] == scheduled.get("away_team"):
            margin_delta -= team_delta
        total_delta += adjustment["total_delta"]
        public_adjustments.append({
            "team": adjustment["team"],
            "margin_delta": adjustment["margin_delta"],
            "total_delta": adjustment["total_delta"],
            "label": adjustment["label"],
            "source": adjustment.get("source"),
        })

    adjusted = dict(prediction)
    adjusted["raw_pred_margin_before_availability"] = prediction.get("pred_margin")
    adjusted["raw_pred_total_before_availability"] = prediction.get("pred_total")
    adjusted["pred_margin"] = prediction["pred_margin"] + margin_delta if prediction.get("pred_margin") is not None else None
    adjusted["pred_total"] = prediction["pred_total"] + total_delta if prediction.get("pred_total") is not None else None
    adjusted["availability_adjusted"] = True
    adjusted["availability_margin_delta"] = margin_delta
    adjusted["availability_total_delta"] = total_delta
    adjusted["availability_adjustments"] = public_adjustments

    market_margin = adjusted.get("market_margin")
    total_line = adjusted.get("total_line")
    adjusted["spread_edge"] = adjusted["pred_margin"] - market_margin if adjusted.get("pred_margin") is not None and market_margin is not None else None
    adjusted["total_edge"] = adjusted["pred_total"] - total_line if adjusted.get("pred_total") is not None and total_line is not None else None
    adjusted["winner_pick"] = "home" if adjusted.get("pred_margin", 0) > 0 else "away" if adjusted.get("pred_margin", 0) < 0 else None

    eligible = bool(adjusted.get("eligible"))
    adjusted["spread_pick"] = (
        side_from_edge(adjusted["spread_edge"], threshold=adjusted["spread_threshold"])
        if eligible and adjusted["spread_edge"] is not None and model_supports_spread_picks(adjusted["model"])
        else None
    )
    adjusted["total_pick"] = (
        total_from_edge(adjusted["total_edge"], threshold=0.0)
        if adjusted["total_edge"] is not None and adjusted["model"] == RSM_PROFILE
        else (
            total_from_edge(adjusted["total_edge"], threshold=adjusted["total_threshold"])
            if eligible and adjusted["total_edge"] is not None and model_supports_totals(adjusted["model"])
            else None
        )
    )
    notes = list(adjusted.get("model_notes") or [])
    notes.append("Upcoming availability adjustment applied after the core model projection; historical/backtest model behavior is unchanged.")
    adjusted["model_notes"] = notes
    return adjusted


def model_status_labels(model_profiles: Tuple[str, ...] = MODEL_PROFILES) -> dict:
    labels = {"market": MODEL_SIGNAL_STATUSES["market"]}
    labels.update({model: MODEL_SIGNAL_STATUSES.get(model, "Production") for model in model_profiles})
    return labels


def build_model_signals(upcoming_row: dict, model_profiles: Tuple[str, ...] = MODEL_PROFILES) -> dict:
    schedule = upcoming_row.get("schedule") or {}
    models = upcoming_row.get("models") or {}
    home_team = schedule.get("home_team")
    away_team = schedule.get("away_team")
    market_margin = _to_float(schedule.get("spread_line"))
    market_total = _to_float(schedule.get("total_line"))
    usable = []
    missing_models = []
    for model in model_profiles:
        prediction = models.get(model)
        if not isinstance(prediction, dict) or prediction.get("display_suppressed"):
            missing_models.append(model)
            continue
        pred_margin = _to_float(prediction.get("pred_margin"))
        pred_total = _to_float(prediction.get("pred_total"))
        if pred_margin is None and pred_total is None:
            missing_models.append(model)
            continue
        usable.append({
            "model": model,
            "status": MODEL_SIGNAL_STATUSES.get(model, "Production"),
            "pred_margin": pred_margin,
            "pred_total": pred_total,
            "availability_adjusted": bool(prediction.get("availability_adjusted")),
        })
    margins = [item["pred_margin"] for item in usable if item["pred_margin"] is not None]
    totals = [item["pred_total"] for item in usable if item["pred_total"] is not None]
    spread_range = _range_or_none(margins)
    total_range = _range_or_none(totals)
    model_count = len(usable)
    missing_count = len(model_profiles) - model_count
    favorite_count, underdog_count, split_count = _favorite_counts(margins, market_margin)
    agreement_label = _agreement_label(model_count, spread_range, split_count)
    market_alignment_label = _market_alignment_label(margins, market_margin)
    total_outlook_label = _total_outlook_label(totals, market_total)
    story = _model_signal_story(
        away_team=away_team,
        home_team=home_team,
        market_margin=market_margin,
        market_total=market_total,
        agreement_label=agreement_label,
        market_alignment_label=market_alignment_label,
        total_outlook_label=total_outlook_label,
        favorite_count=favorite_count,
        underdog_count=underdog_count,
        model_count=model_count,
        missing_count=missing_count,
    )
    return {
        "schema_version": 1,
        "disclaimer": "Model Signals are matchup comparison tools, not betting recommendations.",
        "agreement_label": agreement_label,
        "market_alignment_label": market_alignment_label,
        "total_outlook_label": total_outlook_label,
        "model_spread_range": spread_range,
        "model_total_range": total_range,
        "models_favoring_market_favorite": favorite_count,
        "models_favoring_market_underdog": underdog_count,
        "models_without_output": missing_count,
        "model_count": model_count,
        "model_statuses": model_status_labels(model_profiles),
        "included_models": usable,
        "missing_models": missing_models,
        "story": story,
    }


def attach_model_signals(payload: dict) -> dict:
    games = payload.get("games")
    if not isinstance(games, list):
        return payload
    for row in games:
        if isinstance(row, dict):
            row["model_signals"] = build_model_signals(row)
    payload["model_signals_note"] = "Model Signals are matchup comparison tools, not betting recommendations."
    return payload


def _range_or_none(values: List[float]) -> Optional[float]:
    return max(values) - min(values) if values else None


def _favorite_counts(margins: List[float], market_margin: Optional[float]) -> Tuple[int, int, int]:
    if market_margin is None or abs(market_margin) < 1e-9:
        home = sum(1 for margin in margins if margin > 0)
        away = sum(1 for margin in margins if margin < 0)
        return home, away, min(home, away)
    favorite_sign = 1 if market_margin > 0 else -1
    favorite = sum(1 for margin in margins if margin * favorite_sign > 0)
    underdog = sum(1 for margin in margins if margin * favorite_sign < 0)
    return favorite, underdog, min(favorite, underdog)


def _agreement_label(model_count: int, spread_range: Optional[float], split_count: int) -> str:
    if model_count < 3 or spread_range is None:
        return "Insufficient model coverage"
    if split_count >= 2 or spread_range >= 14:
        return "High disagreement"
    if split_count == 1 or spread_range >= 8:
        return "Mixed signals"
    if spread_range >= 4:
        return "Moderate agreement"
    return "Strong agreement"


def _market_alignment_label(margins: List[float], market_margin: Optional[float]) -> str:
    if market_margin is None or not margins:
        return "No market line available"
    if abs(market_margin) < 1e-9:
        home = sum(1 for margin in margins if margin > 1)
        away = sum(1 for margin in margins if margin < -1)
        return "Models split from market" if home and away else "Models align with market"
    favorite_sign = 1 if market_margin > 0 else -1
    favorite_margins = [margin * favorite_sign for margin in margins]
    favorites = sum(1 for value in favorite_margins if value > 0)
    underdogs = sum(1 for value in favorite_margins if value < 0)
    avg_favorite_margin = sum(favorite_margins) / len(favorite_margins)
    market_favorite_margin = abs(market_margin)
    if favorites and underdogs and min(favorites, underdogs) >= 2:
        return "Models split from market"
    if underdogs > favorites:
        return "Models lean toward underdog"
    if avg_favorite_margin > market_favorite_margin + 2:
        return "Models lean stronger than market favorite"
    return "Models align with market"


def _total_outlook_label(totals: List[float], market_total: Optional[float]) -> str:
    if market_total is None or not totals:
        return "No total signal"
    above = sum(1 for total in totals if total > market_total + 1.5)
    below = sum(1 for total in totals if total < market_total - 1.5)
    if above and below:
        return "Totals mixed"
    if above > len(totals) / 2:
        return "Models lean higher scoring"
    if below > len(totals) / 2:
        return "Models lean lower scoring"
    return "Totals mixed"


def _model_signal_story(
    *,
    away_team: Optional[str],
    home_team: Optional[str],
    market_margin: Optional[float],
    market_total: Optional[float],
    agreement_label: str,
    market_alignment_label: str,
    total_outlook_label: str,
    favorite_count: int,
    underdog_count: int,
    model_count: int,
    missing_count: int,
) -> str:
    matchup = f"{away_team} at {home_team}" if away_team and home_team else "This matchup"
    if market_margin is None:
        market_text = "No market spread is available."
    elif abs(market_margin) < 1e-9:
        market_text = "Market lists the spread near pick'em."
    else:
        favorite = home_team if market_margin > 0 else away_team
        market_text = f"Market favors {favorite} by {abs(market_margin):.1f}."
    total_text = f"Market total is {market_total:.1f}." if market_total is not None else "No market total is available."
    coverage_text = f"{model_count} models returned comparison values"
    if missing_count:
        coverage_text += f"; {missing_count} did not return a displayable output"
    return (
        f"{matchup}: {market_text} {total_text} "
        f"{coverage_text}. {agreement_label}. {market_alignment_label}; {total_outlook_label}. "
        f"Model count relative to the market favorite: {favorite_count} aligned, {underdog_count} opposite."
    )


def _write_pickle_cache(cache_path: str, payload) -> None:
    temporary_path = f"{cache_path}.{os.getpid()}.{time.time_ns()}.tmp"
    with open(temporary_path, "wb") as target:
        pickle.dump(payload, target, protocol=pickle.HIGHEST_PROTOCOL)
        target.flush()
        os.fsync(target.fileno())
    os.replace(temporary_path, cache_path)


def _load_upcoming_checkpoint(fingerprint: str) -> Optional[dict]:
    try:
        with open(_upcoming_checkpoint_path(), "rb") as source:
            checkpoint = pickle.load(source)
        if checkpoint.get("fingerprint") != fingerprint:
            return None
        if not isinstance(checkpoint.get("trained_models"), dict) or not isinstance(checkpoint.get("rows"), list):
            return None
        return checkpoint
    except (OSError, EOFError, AttributeError, KeyError, pickle.PickleError, TypeError, ValueError):
        return None


def _write_upcoming_checkpoint(fingerprint: str, trained_models: dict, rows: list, next_step: int) -> None:
    checkpoint_path = _upcoming_checkpoint_path()
    os.makedirs(os.path.dirname(checkpoint_path) or ".", exist_ok=True)
    _write_pickle_cache(checkpoint_path, {
        "fingerprint": fingerprint,
        "trained_models": trained_models,
        "rows": rows,
        "next_step": next_step,
    })


def _clear_upcoming_checkpoint() -> None:
    try:
        os.remove(_upcoming_checkpoint_path())
    except FileNotFoundError:
        pass


def _historical_model_cache_path(profile: str, games: List[dict]) -> str:
    cache_root = os.getenv("NFL_MODEL_CACHE_DIR", "").strip() or os.path.dirname(upcoming_prediction_cache_path())
    fingerprint_source = [
        (game.get("season"), game.get("week"), game.get("game_id"), game.get("away_score"), game.get("home_score"))
        for game in games
    ]
    fingerprint = hashlib.sha256(json.dumps(fingerprint_source, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]
    return os.path.join(cache_root, f"nfl_{profile}_historical_model_{fingerprint}.pkl")


def _write_model_cache(cache_path: str, model) -> None:
    temporary_path = f"{cache_path}.{os.getpid()}.{time.time_ns()}.tmp"
    with open(temporary_path, "wb") as target:
        pickle.dump(model, target, protocol=pickle.HIGHEST_PROTOCOL)
        target.flush()
        os.fsync(target.fileno())
    os.replace(temporary_path, cache_path)


def _load_or_train_historical_model(games: List[dict], profile: str):
    if not games:
        return create_model(profile)

    cache_path = _historical_model_cache_path(profile, games)
    try:
        with open(cache_path, "rb") as source:
            return pickle.load(source)
    except (OSError, EOFError, AttributeError, pickle.PickleError, ValueError):
        model = train_model(games, profile)
        os.makedirs(os.path.dirname(cache_path) or ".", exist_ok=True)
        _write_model_cache(cache_path, model)
        return model


def _history_cache_root() -> str:
    return os.getenv("NFL_HISTORY_CACHE_DIR", "").strip() or os.path.dirname(upcoming_prediction_cache_path())


def _history_games_fingerprint(games: List[dict]) -> str:
    fingerprint_source = [
        (
            game.get("season"), game.get("week"), game.get("game_id"),
            game.get("away_team"), game.get("home_team"), game.get("away_score"),
            game.get("home_score"), game.get("spread_line"), game.get("total_line"),
            game.get("gameday"),
        )
        for game in games
    ]
    return hashlib.sha256(json.dumps(fingerprint_source, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]


def _history_cache_metadata(games: List[dict], profile: str) -> dict:
    return {
        "schema_version": 3,
        "model_profile": profile,
        "games_fingerprint": _history_games_fingerprint(games),
        "games_source_signature": _games_source_signature(),
        "spread_threshold": default_spread_threshold(profile),
        "total_threshold": default_total_threshold(profile),
    }


def _historical_matchup_cache_path(games: List[dict], away_team: str, home_team: str, profile: str) -> str:
    metadata = _history_cache_metadata(games, profile)
    fingerprint = hashlib.sha256(json.dumps(metadata, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]
    pair = _history_pair_key(away_team, home_team).lower()
    return os.path.join(_history_cache_root(), f"nfl_history_pair_{pair}_{profile}_{fingerprint}.json")


def _all_matchup_history_cache_path(games: List[dict], profile: str) -> str:
    metadata = _history_cache_metadata(games, profile)
    fingerprint = hashlib.sha256(json.dumps(metadata, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]
    return os.path.join(_history_cache_root(), f"nfl_history_all_{profile}_{fingerprint}.json")


def _write_json_cache(cache_path: str, payload) -> None:
    temporary_path = f"{cache_path}.{os.getpid()}.{time.time_ns()}.tmp"
    with open(temporary_path, "w", encoding="utf-8") as target:
        json.dump(payload, target, separators=(",", ":"))
        target.flush()
        os.fsync(target.fileno())
    os.replace(temporary_path, cache_path)


def _history_pair_key(team_a: str, team_b: str) -> str:
    return "__".join(sorted((str(team_a).upper(), str(team_b).upper())))


def _selected_matchup_rows(cached_rows: List[dict], away_team: str, home_team: str) -> List[dict]:
    rows = []
    for row in cached_rows:
        adjusted = dict(row)
        home_spread = adjusted.get("home_spread")
        adjusted["selected_home_spread"] = home_spread if adjusted.get("home_team") == home_team else -home_spread
        rows.append(adjusted)
    rows.sort(key=lambda row: (row["season"], row["week"], row.get("gameday") or ""))
    return rows


def _validate_all_matchup_history_cache(payload: dict, metadata: dict) -> Optional[Dict[str, List[dict]]]:
    if not isinstance(payload, dict):
        return None
    if payload.get("metadata") != metadata:
        return None
    pairs = payload.get("pairs")
    if not isinstance(pairs, dict):
        return None
    for pair_rows in pairs.values():
        if not isinstance(pair_rows, list):
            return None
    return pairs


def _validate_pair_matchup_history_cache(payload: dict, metadata: dict, pair_key: str) -> Optional[List[dict]]:
    if not isinstance(payload, dict):
        return None
    if payload.get("metadata") != metadata or payload.get("pair_key") != pair_key:
        return None
    rows = payload.get("rows")
    return rows if isinstance(rows, list) else None


def _write_matchup_history_cache_bundle(cache_path: str, metadata: dict, pairs: Dict[str, List[dict]]) -> None:
    os.makedirs(os.path.dirname(cache_path) or ".", exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat()
    _write_json_cache(cache_path, {
        "metadata": metadata,
        "generated_at": generated_at,
        "pairs": pairs,
    })
    for pair_key, rows in pairs.items():
        pair_path = _historical_matchup_cache_path_from_metadata(metadata, pair_key)
        _write_json_cache(pair_path, {
            "metadata": metadata,
            "pair_key": pair_key,
            "generated_at": generated_at,
            "rows": rows,
        })


def _historical_matchup_cache_path_from_metadata(metadata: dict, pair_key: str) -> str:
    fingerprint = hashlib.sha256(json.dumps(metadata, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]
    return os.path.join(
        _history_cache_root(),
        f"nfl_history_pair_{pair_key.lower()}_{metadata['model_profile']}_{fingerprint}.json",
    )


def _cacheable_matchup_row(game: dict, model_profile: str, eligible: bool, pred_margin: Optional[float], pred_total: Optional[float]) -> dict:
    spread_threshold = default_spread_threshold(model_profile)
    total_threshold = default_total_threshold(model_profile)
    spread_edge = pred_margin - game["spread_line"] if pred_margin is not None else None
    total_edge = pred_total - game["total_line"] if pred_total is not None else None
    spread_pick = side_from_edge(spread_edge, spread_threshold) if spread_edge is not None and eligible and model_supports_spread_picks(model_profile) else None
    total_pick = total_from_edge(total_edge, total_threshold) if total_edge is not None and model_supports_totals(model_profile) else None

    spread_result = None
    if spread_pick:
        cover_margin = game["actual_margin"] - game["spread_line"]
        if abs(cover_margin) < 1e-9:
            spread_result = "push"
        elif (spread_pick == "home" and cover_margin > 0) or (spread_pick == "away" and cover_margin < 0):
            spread_result = "correct"
        else:
            spread_result = "wrong"

    total_result = None
    if total_pick:
        total_margin = game["actual_total"] - game["total_line"]
        if abs(total_margin) < 1e-9:
            total_result = "push"
        elif (total_pick == "over" and total_margin > 0) or (total_pick == "under" and total_margin < 0):
            total_result = "correct"
        else:
            total_result = "wrong"

    return {
        "season": game["season"],
        "week": game["week"],
        "gameday": game.get("gameday"),
        "away_team": game["away_team"],
        "home_team": game["home_team"],
        "away_score": game["away_score"],
        "home_score": game["home_score"],
        "home_spread": game["spread_line"],
        "total_line": game["total_line"],
        "actual_total": game["actual_total"],
        "home_margin": game["actual_margin"],
        "model": model_profile,
        "model_eligible": eligible,
        "pred_margin": pred_margin,
        "pred_total": pred_total,
        "spread_pick": spread_pick,
        "spread_result": spread_result,
        "total_pick": total_pick,
        "total_result": total_result,
    }


def _build_all_matchup_history(games: List[dict], model_profile: str) -> Dict[str, List[dict]]:
    pairs: Dict[str, List[dict]] = {}
    if model_profile == RSM_PROFILE:
        rsm_rows = _rsm_validation_rows()
        for game in games:
            if game.get("game_id") not in rsm_rows:
                continue
            rsm = rsm_rows[game["game_id"]]
            row = _cacheable_matchup_row(
                game,
                RSM_PROFILE,
                False,
                _row_float(rsm, "roster_fair_home_margin"),
                None,
            )
            pairs.setdefault(_history_pair_key(game["away_team"], game["home_team"]), []).append(row)
        return pairs

    model = create_model(model_profile)
    for game in games:
        eligible = True
        if model_profile == "rothstein_plus":
            eligible = is_rothstein_plus_eligible(model, game)

        pred_margin, pred_total = model.predict(game)
        row = _cacheable_matchup_row(game, model_profile, eligible, pred_margin, pred_total)
        pairs.setdefault(_history_pair_key(game["away_team"], game["home_team"]), []).append(row)
        model.update(game, pred_margin, pred_total)

    for pair_rows in pairs.values():
        pair_rows.sort(key=lambda row: (row["season"], row["week"], row.get("gameday") or ""))
    return pairs


def warm_matchup_history_cache(games: List[dict], model_profile: str = "baseline") -> bool:
    metadata = _history_cache_metadata(games, model_profile)
    cache_path = _all_matchup_history_cache_path(games, model_profile)
    try:
        with open(cache_path, encoding="utf-8") as source:
            pairs = _validate_all_matchup_history_cache(json.load(source), metadata)
            if pairs is not None:
                for pair_key, rows in pairs.items():
                    pair_path = _historical_matchup_cache_path_from_metadata(metadata, pair_key)
                    if not os.path.exists(pair_path):
                        _write_json_cache(pair_path, {
                            "metadata": metadata,
                            "pair_key": pair_key,
                            "generated_at": datetime.now(timezone.utc).isoformat(),
                            "rows": rows,
                        })
                return True
    except (OSError, json.JSONDecodeError):
        pass

    pairs = _build_all_matchup_history(games, model_profile)
    _write_matchup_history_cache_bundle(cache_path, metadata, pairs)
    return False


def cached_matchup_history(
    games: List[dict], away_team: str, home_team: str, model_profile: str = "baseline"
) -> Tuple[List[dict], bool]:
    """Return cached historical casino-line results, rebuilding when source games change."""
    metadata = _history_cache_metadata(games, model_profile)
    all_cache_path = _all_matchup_history_cache_path(games, model_profile)
    pair_key = _history_pair_key(away_team, home_team)
    pair_cache_path = _historical_matchup_cache_path(games, away_team, home_team, model_profile)
    try:
        with open(pair_cache_path, encoding="utf-8") as source:
            pair_rows = _validate_pair_matchup_history_cache(json.load(source), metadata, pair_key)
        if pair_rows is not None:
            return _selected_matchup_rows(pair_rows, away_team, home_team), True
    except (OSError, json.JSONDecodeError):
        pass

    try:
        with open(all_cache_path, encoding="utf-8") as source:
            pairs = _validate_all_matchup_history_cache(json.load(source), metadata)
        if pairs is not None:
            pair_rows = pairs.get(pair_key, [])
            _write_json_cache(pair_cache_path, {
                "metadata": metadata,
                "pair_key": pair_key,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "rows": pair_rows,
            })
            return _selected_matchup_rows(pair_rows, away_team, home_team), True
    except (OSError, json.JSONDecodeError):
        pass

    pairs = _build_all_matchup_history(games, model_profile)
    _write_matchup_history_cache_bundle(all_cache_path, metadata, pairs)
    return _selected_matchup_rows(pairs.get(pair_key, []), away_team, home_team), False


class GamesRefreshAlreadyRunning(RuntimeError):
    """Raised when a second process-local refresh overlaps the active refresh."""


def _validate_games_csv(content: bytes) -> int:
    """Reject an incomplete or non-CSV response before replacing the good cache."""
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("The nflverse games feed was not valid UTF-8.") from error

    reader = csv.DictReader(io.StringIO(text))
    missing = sorted(_REQUIRED_GAMES_COLUMNS - set(reader.fieldnames or ()))
    if missing:
        raise ValueError(f"The nflverse games feed is missing required columns: {', '.join(missing)}")
    row_count = sum(1 for row in reader if any(str(value or "").strip() for value in row.values()))
    if row_count == 0:
        raise ValueError("The nflverse games feed contained no data rows.")
    return row_count


def refresh_games(cache_path: str = DEFAULT_CACHE_PATH) -> str:
    """Atomically replace the nflverse cache after validating the downloaded CSV."""
    if not _GAMES_REFRESH_LOCK.acquire(blocking=False):
        raise GamesRefreshAlreadyRunning("An NFL data refresh is already running.")

    temporary_path = None
    try:
        cache_directory = os.path.dirname(cache_path)
        os.makedirs(cache_directory, exist_ok=True)
        with urllib.request.urlopen(GAMES_URL, timeout=60) as response:
            content = response.read()
        _validate_games_csv(content)

        with tempfile.NamedTemporaryFile(
            mode="wb",
            prefix="nfl_games_",
            suffix=".csv.tmp",
            dir=cache_directory,
            delete=False,
        ) as temporary_file:
            temporary_path = temporary_file.name
            temporary_file.write(content)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, cache_path)
        temporary_path = None
        return cache_path
    finally:
        if temporary_path and os.path.exists(temporary_path):
            os.unlink(temporary_path)
        _GAMES_REFRESH_LOCK.release()


def _to_float(value: str) -> Optional[float]:
    if value is None:
        return None
    value = str(value).strip()
    if value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _to_bool(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "t", "yes", "y"}


def _nfl_week_rollover_zone():
    configured = os.getenv("NFL_WEEK_ROLLOVER_TIMEZONE", NFL_WEEK_ROLLOVER_TIMEZONE).strip() or NFL_WEEK_ROLLOVER_TIMEZONE
    try:
        return ZoneInfo(configured)
    except ZoneInfoNotFoundError:
        return timezone.utc


def _nfl_week_rollover_hour() -> int:
    try:
        return min(23, max(0, int(os.getenv("NFL_WEEK_ROLLOVER_HOUR", str(NFL_WEEK_ROLLOVER_HOUR)))))
    except ValueError:
        return NFL_WEEK_ROLLOVER_HOUR


def _parse_gameday(value: str):
    try:
        return datetime.strptime(str(value or "").strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


def _tuesday_rollover_before(gameday, rollover_zone):
    days_since_tuesday = (gameday.weekday() - 1) % 7
    rollover_day = gameday - timedelta(days=days_since_tuesday)
    return datetime.combine(
        rollover_day,
        datetime_time(hour=_nfl_week_rollover_hour()),
        tzinfo=rollover_zone,
    )


def current_nfl_schedule_week(rows: List[dict], season: Optional[int] = None, now: Optional[datetime] = None) -> int:
    """Resolve the current NFL week from Tuesday-morning schedule rollovers."""
    target_season = season or max(int(row["season"]) for row in rows if row.get("season"))
    rollover_zone = _nfl_week_rollover_zone()
    current_time = now or datetime.now(rollover_zone)
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=rollover_zone)
    else:
        current_time = current_time.astimezone(rollover_zone)

    week_rollovers = []
    for row in rows:
        if row.get("game_type") != "REG" or int(row.get("season", 0)) != target_season or not row.get("week"):
            continue
        gameday = _parse_gameday(row.get("gameday"))
        if gameday is None:
            continue
        week_rollovers.append((int(row["week"]), _tuesday_rollover_before(gameday, rollover_zone)))

    if not week_rollovers:
        return 1

    started_weeks = [week for week, rollover_at in week_rollovers if rollover_at <= current_time]
    if started_weeks:
        return max(started_weeks)
    return min(week for week, _rollover_at in week_rollovers)


def _bounded_recent(values: List[float], value: float, limit: int = 4) -> None:
    values.append(value)
    if len(values) > limit:
        del values[0]


def _mean(values: List[float], default: float = 0.0) -> float:
    if not values:
        return default
    return statistics.mean(values)


def _optional_mean(values: List[float]) -> Optional[float]:
    clean = [value for value in values if value is not None]
    return statistics.mean(clean) if clean else None


def _cache_age_seconds(cache_path: str = DEFAULT_CACHE_PATH) -> Optional[float]:
    if not os.path.exists(cache_path):
        return None
    return max(0.0, time.time() - os.path.getmtime(cache_path))


def default_cache_ttl_seconds() -> int:
    try:
        return int(os.getenv("NFL_GAMES_CACHE_TTL_SECONDS", str(6 * 60 * 60)))
    except ValueError:
        return 6 * 60 * 60


def games_cache_info(cache_path: str = DEFAULT_CACHE_PATH, ttl_seconds: Optional[int] = None) -> dict:
    ttl_seconds = default_cache_ttl_seconds() if ttl_seconds is None else ttl_seconds
    exists = os.path.exists(cache_path)
    modified_at = None
    age_seconds = None
    if exists:
        modified_timestamp = os.path.getmtime(cache_path)
        modified_at = datetime.fromtimestamp(modified_timestamp, tz=timezone.utc).isoformat()
        age_seconds = max(0.0, time.time() - modified_timestamp)

    return {
        "path": cache_path,
        "exists": exists,
        "source": GAMES_URL,
        "last_updated_utc": modified_at,
        "age_seconds": age_seconds,
        "ttl_seconds": ttl_seconds,
        "stale": (age_seconds is None) or (ttl_seconds > 0 and age_seconds > ttl_seconds),
    }


def download_games(
    cache_path: str = DEFAULT_CACHE_PATH,
    refresh: bool = False,
    ttl_seconds: Optional[int] = None,
) -> str:
    ttl_seconds = default_cache_ttl_seconds() if ttl_seconds is None else ttl_seconds
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    age_seconds = _cache_age_seconds(cache_path)
    should_refresh = refresh or age_seconds is None or (ttl_seconds > 0 and age_seconds > ttl_seconds)
    if should_refresh:
        refresh_games(cache_path)
    return cache_path


def load_games(
    cache_path: str = DEFAULT_CACHE_PATH,
    refresh: bool = False,
    ttl_seconds: Optional[int] = None,
) -> List[dict]:
    path = download_games(cache_path=cache_path, refresh=refresh, ttl_seconds=ttl_seconds)
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    games = []
    for row in rows:
        if row.get("game_type") != "REG":
            continue

        away_score = _to_float(row.get("away_score"))
        home_score = _to_float(row.get("home_score"))
        spread_line = _to_float(row.get("spread_line"))
        total_line = _to_float(row.get("total_line"))

        if away_score is None or home_score is None:
            continue
        if spread_line is None or total_line is None:
            continue

        row["season"] = int(row["season"])
        row["week"] = int(row["week"])
        row["away_score"] = away_score
        row["home_score"] = home_score
        row["actual_margin"] = home_score - away_score
        row["actual_total"] = home_score + away_score
        row["spread_line"] = spread_line
        row["total_line"] = total_line
        row["away_rest"] = _to_float(row.get("away_rest")) or 7.0
        row["home_rest"] = _to_float(row.get("home_rest")) or 7.0
        row["div_game"] = _to_bool(row.get("div_game"))
        row["roof"] = (row.get("roof") or "").strip().lower()
        row["surface"] = (row.get("surface") or "").strip().lower()
        row["temp"] = _to_float(row.get("temp"))
        row["wind"] = _to_float(row.get("wind"))
        games.append(row)

    games.sort(key=lambda g: (g["season"], g["week"], g.get("gameday") or "", g.get("game_id") or ""))
    return games


def load_upcoming_games(season: Optional[int] = None, week: Optional[int] = None) -> List[dict]:
    """Load all scheduled regular-season games for the active football week.

    NFL display weeks roll over on Tuesday morning. Once a week is active, the
    public upcoming board should continue to show the entire scheduled week
    until the next Tuesday rollover, including games that have already been
    completed during that active week.
    """
    path = download_games()
    with open(path, newline="", encoding="utf-8-sig") as source:
        rows = list(csv.DictReader(source))

    target_season = season or max(int(row["season"]) for row in rows if row.get("season"))
    target_week = week or current_nfl_schedule_week(rows, target_season)
    upcoming = []
    for row in rows:
        if row.get("game_type") != "REG" or int(row.get("season", 0)) != target_season or int(row.get("week", 0)) != target_week:
            continue
        away_score = _to_float(row.get("away_score"))
        home_score = _to_float(row.get("home_score"))
        upcoming.append({
            "game_id": row.get("game_id"), "season": target_season, "week": target_week,
            "gameday": row.get("gameday") or "", "gametime": row.get("gametime") or "",
            "away_team": row.get("away_team") or "", "home_team": row.get("home_team") or "",
            "away_score": away_score, "home_score": home_score, "is_completed": away_score is not None and home_score is not None,
            "spread_line": _to_float(row.get("spread_line")), "total_line": _to_float(row.get("total_line")),
            "away_rest": _to_float(row.get("away_rest")) or 7.0, "home_rest": _to_float(row.get("home_rest")) or 7.0,
            "div_game": _to_bool(row.get("div_game")), "roof": (row.get("roof") or "").strip().lower(),
            "temp": _to_float(row.get("temp")), "wind": _to_float(row.get("wind")),
        })
    return upcoming


def find_upcoming_scheduled_match(
    away_team: str,
    home_team: str,
    season: Optional[int] = None,
    week: Optional[int] = None,
) -> Optional[dict]:
    away_team = (away_team or "").strip().upper()
    home_team = (home_team or "").strip().upper()
    for scheduled in load_upcoming_games(season, week):
        if scheduled.get("away_team") == away_team and scheduled.get("home_team") == home_team:
            return scheduled
    return None


def _build_upcoming_prediction_cache(games: List[dict], season: Optional[int], week: Optional[int]) -> dict:
    _set_upcoming_progress(8, "Loading the next scheduled games and starting the model run.", status="computing", ready=False)
    upcoming = load_upcoming_games(season, week)
    if not upcoming:
        payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "prediction_schema_version": UPCOMING_PREDICTION_SCHEMA_VERSION,
            "games_source_signature": _games_source_signature(),
            "availability_adjustments_signature": _availability_adjustments_signature(),
            "season": season,
            "week": week,
            "models": list(MODEL_PROFILES),
            "games": [],
            "market_note": "Market lines are included only when published in the schedule feed; no missing line is inferred.",
        }
        _set_upcoming_progress(100, "No upcoming games were found in the schedule feed.", status="ready", ready=True)
        return attach_model_signals(payload)

    current_season = max(game["season"] for game in games)
    historical_games = [game for game in games if game["season"] < current_season]
    current_season_games = [game for game in games if game["season"] == current_season]
    availability_adjustments = load_upcoming_availability_adjustments()
    total_model_steps = len(MODEL_PROFILES)
    total_game_steps = len(upcoming) * len(MODEL_PROFILES)
    progress_floor = 12
    progress_ceiling = 88
    fingerprint = _upcoming_build_fingerprint(games, upcoming, season, week)
    checkpoint = _load_upcoming_checkpoint(fingerprint)

    if checkpoint:
        trained_models = checkpoint["trained_models"]
        rows = checkpoint["rows"]
        resume_step = max(0, min(total_game_steps, int(checkpoint.get("next_step", 0))))
        _set_upcoming_progress(
            progress_floor + 30 + (resume_step / max(1, total_game_steps)) * (progress_ceiling - progress_floor - 30),
            f"Resuming forecast at step {resume_step + 1}/{total_game_steps}.",
            status="computing",
            ready=False,
        )
    else:
        trained_models = {}
        for index, model in enumerate(MODEL_PROFILES):
            if model == RSM_PROFILE:
                trained_models[model] = create_model(RSM_PROFILE)
            elif model in {"rothstein", "rothstein_plus"}:
                # These profiles intentionally model only the current season.
                trained_models[model] = train_model(current_season_games, model)
            else:
                trained_models[model] = _load_or_train_historical_model(historical_games, model)
                for game in current_season_games:
                    predicted_margin, predicted_total = trained_models[model].predict(game)
                    trained_models[model].update(game, predicted_margin, predicted_total)
            completion = progress_floor + ((index + 1) / total_model_steps) * 30
            _set_upcoming_progress(int(completion), f"Training model {index + 1} of {total_model_steps}: {model}.", status="computing", ready=False)
        rows = []
        resume_step = 0
    rows_by_game_id = {
        row["schedule"]["game_id"]: row
        for row in rows
        if isinstance(row, dict)
        and isinstance(row.get("schedule"), dict)
        and row["schedule"].get("game_id")
    }
    for game_index, scheduled in enumerate(upcoming):
        row = rows_by_game_id.setdefault(scheduled["game_id"], {"schedule": scheduled, "models": {}})
        models = row["models"]
        for model_index, model in enumerate(MODEL_PROFILES):
            step_index = (game_index * len(MODEL_PROFILES)) + model_index
            if step_index < resume_step and model in models:
                continue
            completion = progress_floor + 30 + ((step_index + 1) / max(1, total_game_steps)) * (progress_ceiling - progress_floor - 30)
            _set_upcoming_progress(
                int(completion),
                f"Scoring {scheduled['away_team']} at {scheduled['home_team']} with {model} "
                f"(game {game_index + 1}/{len(upcoming)}, step {step_index + 1}/{total_game_steps}).",
                status="computing",
                ready=False,
            )
            prediction = predict_matchup(
                games,
                scheduled["away_team"], scheduled["home_team"],
                -scheduled["spread_line"] if scheduled["spread_line"] is not None else None,
                scheduled["total_line"], model,
                scheduled["home_rest"], scheduled["away_rest"], scheduled["div_game"],
                scheduled["roof"], scheduled["temp"], scheduled["wind"],
                trained_model=trained_models[model],
                upcoming_context=True,
            )
            models[model] = apply_upcoming_availability_adjustments(prediction, scheduled, availability_adjustments)
            _write_upcoming_checkpoint(fingerprint, trained_models, list(rows_by_game_id.values()), step_index + 1)
        rows = list(rows_by_game_id.values())

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "prediction_schema_version": UPCOMING_PREDICTION_SCHEMA_VERSION,
        "games_source_signature": _games_source_signature(),
        "availability_adjustments_signature": _availability_adjustments_signature(),
        "season": upcoming[0]["season"] if upcoming else season,
        "week": upcoming[0]["week"] if upcoming else week,
        "models": list(MODEL_PROFILES),
        "games": rows,
        "market_note": "Market lines are included only when published in the schedule feed; no missing line is inferred.",
    }
    _set_upcoming_progress(100, "Forecast complete. The board is ready to view.", status="ready", ready=True)
    return attach_model_signals(payload)


def _write_upcoming_prediction_cache(cache_path: str, payload: dict) -> None:
    temporary_path = f"{cache_path}.{os.getpid()}.{time.time_ns()}.tmp"
    with open(temporary_path, "w", encoding="utf-8") as target:
        json.dump(payload, target, separators=(",", ":"))
        target.flush()
        os.fsync(target.fileno())
    os.replace(temporary_path, cache_path)


def _set_upcoming_progress(progress: int, message: str, *, status: str = "computing", ready: bool = False) -> dict:
    global _UPCOMING_PROGRESS_STATE
    _UPCOMING_PROGRESS_STATE = {
        "status": status,
        "ready": ready,
        "progress": max(0, min(100, int(progress))),
        "message": message,
    }
    return dict(_UPCOMING_PROGRESS_STATE)


def upcoming_prediction_status_snapshot() -> dict:
    return dict(_UPCOMING_PROGRESS_STATE)


def _schedule_upcoming_prediction_refresh(games: List[dict], season: Optional[int], week: Optional[int]) -> bool:
    global _UPCOMING_REFRESH_RUNNING
    with _UPCOMING_PREDICTION_LOCK:
        if _UPCOMING_REFRESH_RUNNING:
            return False
        _UPCOMING_REFRESH_RUNNING = True

    _set_upcoming_progress(10, "Scheduling the forecast refresh and preparing the weekly model run.", status="computing", ready=False)

    def _refresh_worker() -> None:
        try:
            payload = _build_upcoming_prediction_cache(games, season, week)
            _write_upcoming_prediction_cache(upcoming_prediction_cache_path(), payload)
            _clear_upcoming_checkpoint()
        except Exception:
            _set_upcoming_progress(0, f"The forecast refresh failed for season={season} week={week}. Please try again shortly.", status="computing", ready=False)
            print(f"Background upcoming cache refresh failed for season={season} week={week}")
        finally:
            global _UPCOMING_REFRESH_RUNNING
            with _UPCOMING_PREDICTION_LOCK:
                _UPCOMING_REFRESH_RUNNING = False

    threading.Thread(target=_refresh_worker, daemon=True).start()
    return True


def _empty_upcoming_status(season: Optional[int], week: Optional[int], ttl_seconds: int, message: str = "Forecast still being computed.") -> dict:
    return {
        "generated_at": None,
        "season": season,
        "week": week,
        "models": list(MODEL_PROFILES),
        "games": [],
        "cache_hit": False,
        "cache_age_seconds": None,
        "cache_ttl_seconds": ttl_seconds,
        "refresh_scheduled": False,
        "status": "computing",
        "ready": False,
        "progress": 0,
        "message": message,
    }


def _has_valid_upcoming_games(payload: dict) -> bool:
    games = payload.get("games")
    if not isinstance(games, list) or not games:
        return False
    required_schedule_fields = {"away_team", "home_team", "season", "week"}
    for game in games:
        schedule = game.get("schedule") if isinstance(game, dict) else None
        models = game.get("models") if isinstance(game, dict) else None
        if not isinstance(schedule, dict) or not required_schedule_fields.issubset(schedule):
            return False
        if not isinstance(models, dict) or any(model not in models for model in MODEL_PROFILES):
            return False
    return True


def _upcoming_response(payload: dict, **overrides) -> dict:
    response = {**payload, **overrides}
    return attach_model_signals(response)


def _resolve_upcoming_cache_target(season: Optional[int], week: Optional[int]) -> Tuple[Optional[int], Optional[int]]:
    if season is not None and week is not None:
        return season, week
    try:
        upcoming = load_upcoming_games(season, week)
    except Exception:
        return season, week
    if upcoming:
        return upcoming[0].get("season", season), upcoming[0].get("week", week)
    return season, week


def cached_upcoming_predictions(
    games: List[dict],
    season: Optional[int] = None,
    week: Optional[int] = None,
    force: bool = False,
    allow_background_refresh: bool = True,
) -> dict:
    """Return one daily weekly prediction snapshot, rebuilding it atomically when stale."""
    cache_path = upcoming_prediction_cache_path()
    ttl_seconds = upcoming_prediction_cache_ttl_seconds()
    os.makedirs(os.path.dirname(cache_path) or ".", exist_ok=True)
    cache_has_games = False
    cache_has_current_source = False
    target_season, target_week = _resolve_upcoming_cache_target(season, week)

    try:
        if os.path.exists(cache_path):
            with open(cache_path, encoding="utf-8") as source:
                cached = json.load(source)
            cache_has_games = _has_valid_upcoming_games(cached)
            cache_has_current_source = (
                cached.get("prediction_schema_version") == UPCOMING_PREDICTION_SCHEMA_VERSION
                and cached.get("games_source_signature") == _games_source_signature()
                and cached.get("availability_adjustments_signature") == _availability_adjustments_signature()
            )
            with _UPCOMING_PREDICTION_LOCK:
                cache_age = max(0.0, time.time() - os.path.getmtime(cache_path))
                same_target = (target_season is None or cached.get("season") == target_season) and (target_week is None or cached.get("week") == target_week)
                if not force and cache_age <= ttl_seconds and same_target and cache_has_games and cache_has_current_source:
                    return _upcoming_response(cached, cache_hit=True, cache_age_seconds=cache_age, cache_ttl_seconds=ttl_seconds, refresh_scheduled=False, status="ready", ready=True, progress=100, message="Forecast ready.")
                if not force and not same_target and cache_has_games:
                    refresh_scheduled = _schedule_upcoming_prediction_refresh(games, target_season, target_week) if allow_background_refresh else False
                    progress_state = upcoming_prediction_status_snapshot()
                    return _upcoming_response(
                        cached,
                        cache_hit=True,
                        cache_age_seconds=cache_age,
                        cache_ttl_seconds=ttl_seconds,
                        refresh_scheduled=refresh_scheduled,
                        cache_target_mismatch=True,
                        requested_season=target_season,
                        requested_week=target_week,
                        status=progress_state.get("status", "computing") if refresh_scheduled else "ready",
                        ready=True,
                        progress=100,
                        message=(
                            f"Showing the last valid forecast for season {cached.get('season')}, week {cached.get('week')} "
                            f"while season {target_season}, week {target_week} is rebuilt."
                            if refresh_scheduled
                            else f"Showing the last valid forecast for season {cached.get('season')}, week {cached.get('week')}; admin refresh is required to rebuild season {target_season}, week {target_week}."
                        ),
                    )
            if not force and same_target and cache_has_games and cache_has_current_source and cache_age > ttl_seconds:
                refresh_scheduled = _schedule_upcoming_prediction_refresh(games, target_season, target_week) if allow_background_refresh else False
                progress_state = upcoming_prediction_status_snapshot()
                return _upcoming_response(cached, cache_hit=True, cache_age_seconds=cache_age, cache_ttl_seconds=ttl_seconds, refresh_scheduled=refresh_scheduled, status=progress_state.get("status", "computing") if refresh_scheduled else "ready", ready=progress_state.get("ready", False) if refresh_scheduled else True, progress=progress_state.get("progress", 0) if refresh_scheduled else 100, message=progress_state.get("message", "Forecast is being refreshed in the background.") if refresh_scheduled else "Forecast ready from the last valid cache; admin refresh required to rebuild.")
            if not force and same_target and cache_has_games and cached.get("prediction_schema_version") == UPCOMING_PREDICTION_SCHEMA_VERSION:
                refresh_scheduled = _schedule_upcoming_prediction_refresh(games, target_season, target_week) if allow_background_refresh else False
                progress_state = upcoming_prediction_status_snapshot()
                return _upcoming_response(
                    cached,
                    cache_hit=True,
                    cache_age_seconds=cache_age,
                    cache_ttl_seconds=ttl_seconds,
                    refresh_scheduled=refresh_scheduled,
                    status=progress_state.get("status", "computing") if refresh_scheduled else "ready",
                    ready=True,
                    progress=100,
                    message=progress_state.get("message", "Forecast ready from the last valid cache; refreshing in the background.") if refresh_scheduled else "Forecast ready from the last valid cache; admin refresh required to rebuild.",
                )
    except (OSError, json.JSONDecodeError):
        pass

    if not force and (not os.path.exists(cache_path) or not cache_has_games or not cache_has_current_source):
        refresh_scheduled = _schedule_upcoming_prediction_refresh(games, target_season, target_week) if allow_background_refresh else False
        progress_state = upcoming_prediction_status_snapshot()
        return _upcoming_response(_empty_upcoming_status(target_season, target_week, ttl_seconds), refresh_scheduled=refresh_scheduled, status=progress_state.get("status", "computing") if refresh_scheduled else "idle", ready=progress_state.get("ready", False) if refresh_scheduled else False, progress=progress_state.get("progress", 0) if refresh_scheduled else 0, message=progress_state.get("message", "Forecast is still being computed; the board will appear once the daily model run finishes.") if refresh_scheduled else "Upcoming forecast cache is not ready. Admin refresh is required to rebuild it.")

    with _UPCOMING_PREDICTION_LOCK:
        if os.path.exists(cache_path):
            try:
                with open(cache_path, encoding="utf-8") as source:
                    cached = json.load(source)
                same_target = (target_season is None or cached.get("season") == target_season) and (target_week is None or cached.get("week") == target_week)
                if not force and same_target and _has_valid_upcoming_games(cached) and cached.get("prediction_schema_version") == UPCOMING_PREDICTION_SCHEMA_VERSION and cached.get("games_source_signature") == _games_source_signature() and cached.get("availability_adjustments_signature") == _availability_adjustments_signature():
                    cache_age = max(0.0, time.time() - os.path.getmtime(cache_path))
                    return _upcoming_response(cached, cache_hit=True, cache_age_seconds=cache_age, cache_ttl_seconds=ttl_seconds, refresh_scheduled=False, status="ready", ready=True, progress=100, message="Forecast ready.")
            except (OSError, json.JSONDecodeError):
                pass

        payload = _build_upcoming_prediction_cache(games, target_season, target_week)
        _write_upcoming_prediction_cache(cache_path, payload)
        _clear_upcoming_checkpoint()
        return _upcoming_response(payload, cache_hit=False, cache_age_seconds=0.0, cache_ttl_seconds=ttl_seconds, refresh_scheduled=False, status="ready", ready=True, progress=100, message="Forecast ready.")


@dataclass
class TeamState:
    margin_rating: float = 0.0
    home_margin_rating: float = 0.0
    away_margin_rating: float = 0.0
    offense: float = 0.0
    defense_allowed: float = 0.0
    recent_margins: List[float] = field(default_factory=list)
    recent_totals: List[float] = field(default_factory=list)
    recent_points_for: List[float] = field(default_factory=list)
    recent_points_allowed: List[float] = field(default_factory=list)
    games: int = 0


@dataclass
class RothsteinTeamState:
    season: Optional[int] = None
    points_for: float = 0.0
    points_against: float = 0.0
    games: int = 0
    qbs: List[str] = field(default_factory=list)

    def reset_for_season(self, season: int) -> None:
        if self.season != season:
            self.season = season
            self.points_for = 0.0
            self.points_against = 0.0
            self.games = 0
            self.qbs = []

    def avg_for(self, league_team_points: float) -> float:
        if self.games == 0:
            return league_team_points
        return self.points_for / self.games

    def avg_against(self, league_team_points: float) -> float:
        if self.games == 0:
            return league_team_points
        return self.points_against / self.games

    def primary_qb(self) -> Optional[str]:
        if not self.qbs:
            return None
        return Counter(self.qbs).most_common(1)[0][0]


@dataclass
class RothsteinNFLModel:
    mean_total: float = 44.0
    total_games: int = 0
    teams: Dict[str, RothsteinTeamState] = field(default_factory=dict)

    def team(self, abbr: str, season: int) -> RothsteinTeamState:
        if abbr not in self.teams:
            self.teams[abbr] = RothsteinTeamState()
        self.teams[abbr].reset_for_season(season)
        return self.teams[abbr]

    def predict(self, game: dict) -> Tuple[float, float]:
        away = self.team(game["away_team"], game["season"])
        home = self.team(game["home_team"], game["season"])
        league_team_points = self.mean_total / 2

        away_outcome = (away.avg_for(league_team_points) + home.avg_against(league_team_points)) / 2
        home_outcome = (home.avg_for(league_team_points) + away.avg_against(league_team_points)) / 2

        predicted_margin = home_outcome - away_outcome
        predicted_total = home_outcome + away_outcome
        return predicted_margin, predicted_total

    def update(self, game: dict, predicted_margin: float, predicted_total: float) -> None:
        away = self.team(game["away_team"], game["season"])
        home = self.team(game["home_team"], game["season"])

        away.points_for += game["away_score"]
        away.points_against += game["home_score"]
        away.games += 1

        home.points_for += game["home_score"]
        home.points_against += game["away_score"]
        home.games += 1
        if game.get("away_qb_name"):
            away.qbs.append(game["away_qb_name"])
            away.qbs = away.qbs[-4:]
        if game.get("home_qb_name"):
            home.qbs.append(game["home_qb_name"])
            home.qbs = home.qbs[-4:]

        self.total_games += 1
        self.mean_total += 0.01 * (game["actual_total"] - self.mean_total)


@dataclass
class OnlineNFLModel:
    hfa_margin: float = 1.6
    hfa_points: float = 0.8
    rest_weight: float = 0.08
    split_weight: float = 0.35
    recent_margin_weight: float = 0.18
    recent_total_weight: float = 0.16
    divisional_margin_adjustment: float = -0.25
    divisional_total_adjustment: float = -0.75
    open_roof_total_adjustment: float = -0.35
    dome_total_adjustment: float = 0.45
    cold_degree_weight: float = 0.05
    wind_mph_weight: float = 0.12
    margin_lr: float = 0.045
    split_margin_lr: float = 0.025
    point_lr: float = 0.035
    mean_total: float = 44.0
    total_games: int = 0
    teams: Dict[str, TeamState] = field(default_factory=dict)

    def team(self, abbr: str) -> TeamState:
        if abbr not in self.teams:
            self.teams[abbr] = TeamState()
        return self.teams[abbr]

    def predict(self, game: dict) -> Tuple[float, float]:
        away = self.team(game["away_team"])
        home = self.team(game["home_team"])

        rest_edge = game["home_rest"] - game["away_rest"]
        recent_margin_edge = _mean(home.recent_margins) - _mean(away.recent_margins)
        predicted_margin = (
            self.hfa_margin
            + home.margin_rating
            - away.margin_rating
            + self.split_weight * (home.home_margin_rating - away.away_margin_rating)
            + self.recent_margin_weight * recent_margin_edge
            + self.rest_weight * rest_edge
        )
        if game["div_game"]:
            predicted_margin += self.divisional_margin_adjustment if predicted_margin > 0 else -self.divisional_margin_adjustment

        league_team_points = self.mean_total / 2
        home_recent_offense = _mean(home.recent_points_for)
        away_recent_offense = _mean(away.recent_points_for)
        home_recent_defense = _mean(home.recent_points_allowed)
        away_recent_defense = _mean(away.recent_points_allowed)
        predicted_home_points = (
            league_team_points
            + home.offense
            + away.defense_allowed
            + self.recent_total_weight * ((home_recent_offense + away_recent_defense) / 2 - league_team_points)
            + self.hfa_points
        )
        predicted_away_points = (
            league_team_points
            + away.offense
            + home.defense_allowed
            + self.recent_total_weight * ((away_recent_offense + home_recent_defense) / 2 - league_team_points)
            - self.hfa_points
        )
        predicted_total = predicted_home_points + predicted_away_points
        predicted_total += self.weather_total_adjustment(game, home, away)

        return predicted_margin, predicted_total

    def weather_total_adjustment(self, game: dict, home: TeamState, away: TeamState) -> float:
        adjustment = 0.0
        roof = game["roof"]
        if roof in {"dome", "closed"}:
            adjustment += self.dome_total_adjustment
        elif roof in {"outdoors", "open"}:
            adjustment += self.open_roof_total_adjustment
            if game["temp"] is not None and game["temp"] < 40:
                adjustment -= (40 - game["temp"]) * self.cold_degree_weight
            if game["wind"] is not None and game["wind"] > 10:
                adjustment -= (game["wind"] - 10) * self.wind_mph_weight

        if game["div_game"]:
            adjustment += self.divisional_total_adjustment

        recent_total_context = (_mean(home.recent_totals, self.mean_total) + _mean(away.recent_totals, self.mean_total)) / 2
        adjustment += self.recent_total_weight * (recent_total_context - self.mean_total)
        return adjustment

    def update(self, game: dict, predicted_margin: float, predicted_total: float) -> None:
        away = self.team(game["away_team"])
        home = self.team(game["home_team"])

        actual_margin = game["actual_margin"]
        actual_total = game["actual_total"]
        margin_error = actual_margin - predicted_margin

        home.margin_rating += self.margin_lr * margin_error
        away.margin_rating -= self.margin_lr * margin_error
        home.home_margin_rating += self.split_margin_lr * margin_error
        away.away_margin_rating -= self.split_margin_lr * margin_error

        predicted_home_points = (predicted_total + predicted_margin) / 2
        predicted_away_points = (predicted_total - predicted_margin) / 2

        home_off_error = game["home_score"] - predicted_home_points
        away_off_error = game["away_score"] - predicted_away_points

        home.offense += self.point_lr * home_off_error
        away.defense_allowed += self.point_lr * home_off_error
        away.offense += self.point_lr * away_off_error
        home.defense_allowed += self.point_lr * away_off_error

        home.games += 1
        away.games += 1
        _bounded_recent(home.recent_margins, actual_margin)
        _bounded_recent(away.recent_margins, -actual_margin)
        _bounded_recent(home.recent_totals, actual_total)
        _bounded_recent(away.recent_totals, actual_total)
        _bounded_recent(home.recent_points_for, game["home_score"])
        _bounded_recent(home.recent_points_allowed, game["away_score"])
        _bounded_recent(away.recent_points_for, game["away_score"])
        _bounded_recent(away.recent_points_allowed, game["home_score"])
        self.total_games += 1
        self.mean_total += 0.01 * (actual_total - self.mean_total)


@dataclass
class MarketBlendNFLModel:
    """Shrink the baseline forecast toward the market's expected margin."""

    base: OnlineNFLModel = field(default_factory=lambda: OnlineNFLModel(
        rest_weight=0.04,
        margin_lr=0.065,
        split_weight=0.0,
        recent_margin_weight=0.0,
        recent_total_weight=0.0,
        divisional_margin_adjustment=0.0,
        divisional_total_adjustment=0.0,
        open_roof_total_adjustment=0.0,
        dome_total_adjustment=0.0,
        cold_degree_weight=0.0,
        wind_mph_weight=0.0,
        split_margin_lr=0.0,
    ))
    model_weight: float = 0.5
    pending_base_prediction: Optional[Tuple[float, float]] = None

    @property
    def mean_total(self) -> float:
        return self.base.mean_total

    @property
    def teams(self) -> Dict[str, TeamState]:
        return self.base.teams

    def team(self, abbr: str) -> TeamState:
        return self.base.team(abbr)

    def predict(self, game: dict) -> Tuple[float, float]:
        base_margin, base_total = self.base.predict(game)
        self.pending_base_prediction = (base_margin, base_total)
        spread_line = float(game.get("spread_line", 0.0))
        total_line = float(game.get("total_line", self.mean_total))
        predicted_margin = spread_line + self.model_weight * (base_margin - spread_line)
        predicted_total = total_line + self.model_weight * (base_total - total_line)
        return predicted_margin, predicted_total

    def update(self, game: dict, predicted_margin: float, predicted_total: float) -> None:
        if self.pending_base_prediction is None:
            self.pending_base_prediction = self.base.predict(game)
        base_margin, base_total = self.pending_base_prediction
        self.pending_base_prediction = None
        self.base.update(game, base_margin, base_total)


@dataclass
class MeanReversionTeamSeason:
    points_for: float = 0.0
    points_against: float = 0.0
    games: int = 0

    def add_game(self, points_for: float, points_against: float) -> None:
        self.points_for += float(points_for)
        self.points_against += float(points_against)
        self.games += 1

    @property
    def pf_per_game(self) -> Optional[float]:
        return self.points_for / self.games if self.games else None

    @property
    def pa_per_game(self) -> Optional[float]:
        return self.points_against / self.games if self.games else None


@dataclass
class MeanReversionNFLModel:
    """PF/PA mean-reversion model using only games known before prediction."""

    mean_total: float = 44.0
    total_games: int = 0
    hfa_points: float = 0.8
    prior_weight_start: float = 0.70
    prior_weight_floor: float = 0.25
    current_weight_start: float = 0.10
    current_weight_ceiling: float = 0.65
    league_weight: float = 0.20
    seasons: Dict[int, Dict[str, MeanReversionTeamSeason]] = field(default_factory=dict)
    league_seasons: Dict[int, MeanReversionTeamSeason] = field(default_factory=dict)

    def _team_season(self, season: int, team: str) -> MeanReversionTeamSeason:
        if season not in self.seasons:
            self.seasons[season] = {}
        if team not in self.seasons[season]:
            self.seasons[season][team] = MeanReversionTeamSeason()
        return self.seasons[season][team]

    def _league_season(self, season: int) -> MeanReversionTeamSeason:
        if season not in self.league_seasons:
            self.league_seasons[season] = MeanReversionTeamSeason()
        return self.league_seasons[season]

    def _league_team_points(self) -> float:
        return self.mean_total / 2

    def _prior_two_year_average(self, team: str, season: int, attr: str) -> Optional[float]:
        values = []
        weights = []
        for prior_season, recency_weight in ((season - 1, 2.0), (season - 2, 1.0)):
            state = self.seasons.get(prior_season, {}).get(team)
            value = getattr(state, attr) if state else None
            if value is not None:
                values.append(value * recency_weight)
                weights.append(recency_weight)
        if not weights:
            return None
        return sum(values) / sum(weights)

    def _current_season_average(self, team: str, season: int, attr: str) -> Optional[float]:
        state = self.seasons.get(season, {}).get(team)
        return getattr(state, attr) if state else None

    def _week_weights(self, week: int) -> Tuple[float, float, float]:
        completed_games_estimate = max(0, min(8, int(week or 1) - 1))
        current_weight = self.current_weight_start + (self.current_weight_ceiling - self.current_weight_start) * (completed_games_estimate / 8)
        prior_weight = self.prior_weight_start + (self.prior_weight_floor - self.prior_weight_start) * (completed_games_estimate / 8)
        league_weight = max(0.10, 1.0 - current_weight - prior_weight)
        total = current_weight + prior_weight + league_weight
        return prior_weight / total, current_weight / total, league_weight / total

    def _blended_team_rate(self, team: str, season: int, week: int, attr: str) -> float:
        prior = self._prior_two_year_average(team, season, attr)
        current = self._current_season_average(team, season, attr)
        league = self._league_team_points()
        prior_weight, current_weight, league_weight = self._week_weights(week)
        weighted_values = []
        weights = []
        if prior is not None:
            weighted_values.append(prior * prior_weight)
            weights.append(prior_weight)
        else:
            league_weight += prior_weight
        if current is not None:
            weighted_values.append(current * current_weight)
            weights.append(current_weight)
        else:
            league_weight += current_weight
        weighted_values.append(league * league_weight)
        weights.append(league_weight)
        return sum(weighted_values) / sum(weights)

    def predict(self, game: dict) -> Tuple[float, float]:
        season = int(game["season"])
        week = int(game.get("week") or 1)
        away = game["away_team"]
        home = game["home_team"]
        away_offense = self._blended_team_rate(away, season, week, "pf_per_game")
        away_defense_allowed = self._blended_team_rate(away, season, week, "pa_per_game")
        home_offense = self._blended_team_rate(home, season, week, "pf_per_game")
        home_defense_allowed = self._blended_team_rate(home, season, week, "pa_per_game")

        away_points = (away_offense + home_defense_allowed) / 2 - self.hfa_points
        home_points = (home_offense + away_defense_allowed) / 2 + self.hfa_points
        predicted_margin = home_points - away_points
        predicted_total = home_points + away_points
        return predicted_margin, _bounded(predicted_total, 30.0, 62.0)

    def update(self, game: dict, predicted_margin: float, predicted_total: float) -> None:
        season = int(game["season"])
        away = game["away_team"]
        home = game["home_team"]
        away_score = float(game["away_score"])
        home_score = float(game["home_score"])
        self._team_season(season, away).add_game(away_score, home_score)
        self._team_season(season, home).add_game(home_score, away_score)
        league = self._league_season(season)
        league.add_game(away_score, home_score)
        league.add_game(home_score, away_score)
        self.total_games += 1
        self.mean_total += 0.01 * (float(game["actual_total"]) - self.mean_total)


@lru_cache(maxsize=1)
def _rsm_artifact() -> dict:
    path = os.path.join(REPORTS_ROOT, "rsm-v2-candidate-stage7b.json")
    with open(path, encoding="utf-8") as source:
        return json.load(source)["model_a"]


@lru_cache(maxsize=1)
def _rsm_total_artifact() -> dict:
    path = os.path.join(REPORTS_ROOT, "rsm-v2-candidate-stage7b.json")
    with open(path, encoding="utf-8") as source:
        artifact = json.load(source)["total_diagnostic"]
    required = {"target", "feature_names", "means", "scales", "coefficients", "intercept"}
    if required - set(artifact) or artifact["target"] != "actual_total" or artifact["feature_names"] != _rsm_artifact()["feature_names"]:
        raise RuntimeError("Stage 7B total artifact is incompatible with the frozen margin feature adapter")
    if not all(len(artifact[key]) == len(artifact["feature_names"]) for key in ("means", "scales", "coefficients")) or any(float(scale) == 0 for scale in artifact["scales"]):
        raise RuntimeError("Stage 7B total artifact has invalid frozen preprocessing or coefficients")
    return artifact


@lru_cache(maxsize=1)
def _rsm_team_rows() -> Dict[str, dict]:
    path = os.path.join(REPORTS_ROOT, "rsm-team-ratings.csv")
    with open(path, newline="", encoding="utf-8") as source:
        return {row["team"]: row for row in csv.DictReader(source)}


@lru_cache(maxsize=1)
def _rsm_validation_rows() -> Dict[str, dict]:
    path = os.path.join(REPORTS_ROOT, "rsm-stage7c-anomaly-games.csv")
    if not os.path.exists(path):
        return {}
    with open(path, newline="", encoding="utf-8") as source:
        return {row["game_id"]: row for row in csv.DictReader(source)}


def _row_float(row: dict, key: str, default: float = 0.0) -> float:
    value = _to_float(row.get(key))
    return default if value is None else value


def _rsm_current_team_features(row: dict) -> dict:
    wr = _row_float(row, "wr_rating", 50.0)
    te = _row_float(row, "te_rating", 50.0)
    cb = _row_float(row, "cb_rating", 50.0)
    safety = _row_float(row, "safety_rating", 50.0)
    dl = _row_float(row, "dl_rating", 50.0)
    edge = _row_float(row, "edge_rating", 50.0)
    lb = _row_float(row, "lb_rating", 50.0)
    ol = _row_float(row, "ol_overall_rating", 50.0)
    return {
        "qb": _row_float(row, "qb_rating", 50.0),
        "rb": _row_float(row, "rb_rating", 50.0),
        "wr1": wr,
        "wr2": wr,
        "te1": te,
        "receiving_average": statistics.mean([wr, wr, te]),
        "receiver_replacements": 0,
        "ol_average": ol,
        "ol_weakest": ol,
        "ol_strongest": ol,
        "ol_continuity": 0.0,
        "ol_replacements": 0,
        "pass_rusher1": edge,
        "pass_rush_average": edge,
        "weakest_coverage": min(cb, safety),
        "secondary_average": statistics.mean([cb, safety]),
        "front_seven_average": statistics.mean([dl, edge, lb]),
    }


def _rsm_features(home: dict, away: dict, rest_diff: float) -> dict:
    return {
        "qb_quality_diff": home["qb"] - away["qb"],
        "qb_vs_pass_rush_matchup": (home["qb"] - away["pass_rush_average"]) - (away["qb"] - home["pass_rush_average"]),
        "qb_vs_coverage_matchup": (home["qb"] - away["secondary_average"]) - (away["qb"] - home["secondary_average"]),
        "ol_pass_vs_pass_rush_matchup": (home["ol_average"] - away["pass_rush_average"]) - (away["ol_average"] - home["pass_rush_average"]),
        "ol_run_vs_front_matchup": (home["ol_average"] - away["front_seven_average"]) - (away["ol_average"] - home["front_seven_average"]),
        "receiving_vs_secondary_matchup": (home["receiving_average"] - away["secondary_average"]) - (away["receiving_average"] - home["secondary_average"]),
        "rushing_vs_front_matchup": (home["rb"] - away["front_seven_average"]) - (away["rb"] - home["front_seven_average"]),
        "ol_weakest_diff": home["ol_weakest"] - away["ol_weakest"],
        "ol_strongest_diff": home["ol_strongest"] - away["ol_strongest"],
        "ol_continuity_diff": home["ol_continuity"] - away["ol_continuity"],
        "ol_replacement_starters_diff": home["ol_replacements"] - away["ol_replacements"],
        "wr1_diff": home["wr1"] - away["wr1"],
        "wr2_diff": home["wr2"] - away["wr2"],
        "te1_diff": home["te1"] - away["te1"],
        "receiver_replacements_diff": home["receiver_replacements"] - away["receiver_replacements"],
        "pass_rusher1_diff": home["pass_rusher1"] - away["pass_rusher1"],
        "weakest_coverage_diff": home["weakest_coverage"] - away["weakest_coverage"],
        "rest_diff": rest_diff,
    }


@dataclass
class RsmStage7CComparisonModel:
    """Committed-report adapter for the experimental RSM margin artifact."""

    mean_total: float = 44.0

    def prediction_details(self, game: dict) -> dict:
        """Return the frozen vector used for a display prediction.

        This is deliberately separate from the Stage 7C anomaly decision.  It
        gives the manual Stage 8 recorder the exact inputs used by the public
        comparison adapter without changing the artifact or its thresholds.
        """
        teams = _rsm_team_rows()
        home_row = teams.get(game["home_team"])
        away_row = teams.get(game["away_team"])
        if not home_row or not away_row:
            raise ValueError("RSM snapshot ratings are unavailable for one or both teams")
        artifact = _rsm_artifact()
        features = _rsm_features(
            _rsm_current_team_features(home_row),
            _rsm_current_team_features(away_row),
            float(game.get("home_rest", 7.0)) - float(game.get("away_rest", 7.0)),
        )
        predicted_margin = artifact["intercept"]
        for name, mean, scale, coefficient in zip(
            artifact["feature_names"],
            artifact["means"],
            artifact["scales"],
            artifact["coefficients"],
        ):
            predicted_margin += coefficient * (features[name] - mean) / scale
        total_artifact = _rsm_total_artifact()
        predicted_total = total_artifact["intercept"]
        for name, mean, scale, coefficient in zip(total_artifact["feature_names"], total_artifact["means"], total_artifact["scales"], total_artifact["coefficients"]):
            predicted_total += coefficient * (features[name] - mean) / scale
        return {
            "predicted_margin": predicted_margin,
            "predicted_total": predicted_total,
            "total_model_version": "RSM-v2 Stage7B Total diagnostic (experimental)",
            "features": features,
            "features_as_of": max(home_row["roster_timestamp"], away_row["roster_timestamp"]),
            "features_source": "reports/rsm-team-ratings.csv (frozen display snapshot)",
            "lineup_confidence": "LOW",
            "lineup_source": "RSM display snapshot; no prospective lineup verification",
        }

    def predict(self, game: dict) -> Tuple[float, Optional[float]]:
        details = self.prediction_details(game)
        return details["predicted_margin"], details["predicted_total"]

    def update(self, game: dict, predicted_margin: float, predicted_total: Optional[float]) -> None:
        return None


def create_model(profile: str):
    if profile == "baseline":
        return OnlineNFLModel(
            rest_weight=0.04,
            margin_lr=0.065,
            split_weight=0.0,
            recent_margin_weight=0.0,
            recent_total_weight=0.0,
            divisional_margin_adjustment=0.0,
            divisional_total_adjustment=0.0,
            open_roof_total_adjustment=0.0,
            dome_total_adjustment=0.0,
            cold_degree_weight=0.0,
            wind_mph_weight=0.0,
            split_margin_lr=0.0,
        )
    if profile == "enhanced":
        return OnlineNFLModel()
    if profile == "market_blend":
        return MarketBlendNFLModel()
    if profile == MEAN_REVERSION_PROFILE:
        return MeanReversionNFLModel()
    if profile in {"rothstein", "rothstein_plus"}:
        return RothsteinNFLModel()
    if profile == RSM_PROFILE:
        return RsmStage7CComparisonModel()
    raise ValueError(f"Unknown model profile: {profile}")


def default_spread_threshold(model_profile: str) -> float:
    if model_profile == RSM_PROFILE:
        # Presentation-only: every nonzero frozen-margin/market disagreement
        # receives a directional ATS projection. This is deliberately separate
        # from the frozen Stage 7C anomaly thresholds and never affects its
        # research ledger or eligibility rules.
        return 0.0
    if model_profile in {"rothstein", "rothstein_plus"}:
        return 2.0
    if model_profile == MEAN_REVERSION_PROFILE:
        return 4.0
    if model_profile == "market_blend":
        return 3.0
    return 6.0


def default_total_threshold(model_profile: str) -> float:
    if model_profile == RSM_PROFILE:
        return 999.0
    if model_profile in {"rothstein", "rothstein_plus"}:
        return 4.0
    if model_profile == MEAN_REVERSION_PROFILE:
        return 2.0
    return 1.5


def model_supports_totals(model_profile: str) -> bool:
    return model_profile not in {"rothstein_plus", RSM_PROFILE}


def model_supports_spread_picks(model_profile: str) -> bool:
    return True


def is_rothstein_plus_eligible(model: RothsteinNFLModel, game: dict) -> bool:
    away = model.team(game["away_team"], game["season"])
    home = model.team(game["home_team"], game["season"])
    if not (8 <= min(away.games, home.games) <= 9):
        return False

    away_primary_qb = away.primary_qb()
    home_primary_qb = home.primary_qb()
    away_qb = game.get("away_qb_name")
    home_qb = game.get("home_qb_name")
    if away_primary_qb and away_qb and away_primary_qb != away_qb:
        return False
    if home_primary_qb and home_qb and home_primary_qb != home_qb:
        return False
    return True


def _bounded(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def rothstein_upcoming_sample(model: RothsteinNFLModel, game: dict) -> dict:
    away = model.team(game["away_team"], game["season"])
    home = model.team(game["home_team"], game["season"])
    min_team_games = min(away.games, home.games)
    avg_team_games = (away.games + home.games) / 2
    return {
        "away_team_games": away.games,
        "home_team_games": home.games,
        "min_team_games": min_team_games,
        "avg_team_games": avg_team_games,
        "confidence": "LOW" if min_team_games < 4 else "MEDIUM" if min_team_games < 8 else "HIGH",
    }


def stabilize_rothstein_upcoming_prediction(
    prediction: dict,
    model: RothsteinNFLModel,
    game: dict,
    model_profile: str,
) -> dict:
    """Conservative display guard for same-season Rothstein upcoming forecasts.

    The Rothstein profiles intentionally train only on the current season. In
    the first few weeks, one high- or low-scoring result can produce extreme raw
    averages. This stabilizer is used only for the upcoming board/API path; it
    does not alter the model object, historical backtests, or direct raw
    predictions unless callers explicitly opt into the upcoming context.
    """
    if model_profile not in {"rothstein", "rothstein_plus"}:
        return prediction

    sample = rothstein_upcoming_sample(model, game)
    market_margin = prediction.get("market_margin")
    total_line = prediction.get("total_line")
    margin_baseline = float(market_margin) if market_margin is not None else 0.0
    total_baseline = float(total_line) if total_line is not None else float(model.mean_total or 44.0)
    reliability = _bounded((sample["min_team_games"] - 1) / 7, 0.0, 1.0)
    raw_margin = float(prediction["pred_margin"])
    raw_total = float(prediction["pred_total"]) if prediction.get("pred_total") is not None else None

    stabilized_margin = margin_baseline + reliability * (raw_margin - margin_baseline)
    max_margin_delta = 7.0 + 7.0 * reliability
    stabilized_margin = _bounded(stabilized_margin, margin_baseline - max_margin_delta, margin_baseline + max_margin_delta)
    stabilized_margin = _bounded(stabilized_margin, -24.0, 24.0)

    stabilized_total = None
    if raw_total is not None:
        stabilized_total = total_baseline + reliability * (raw_total - total_baseline)
        max_total_delta = 8.0 + 6.0 * reliability
        stabilized_total = _bounded(stabilized_total, total_baseline - max_total_delta, total_baseline + max_total_delta)
        stabilized_total = _bounded(stabilized_total, 32.0, 60.0)

    guarded = dict(prediction)
    guarded["raw_pred_margin"] = raw_margin
    guarded["raw_pred_total"] = raw_total
    guarded["pred_margin"] = stabilized_margin
    guarded["pred_total"] = stabilized_total
    guarded["rothstein_sample"] = sample
    guarded["data_confidence"] = sample["confidence"]
    guarded["upcoming_stabilized"] = (
        abs(stabilized_margin - raw_margin) > 1e-9
        or (raw_total is not None and stabilized_total is not None and abs(stabilized_total - raw_total) > 1e-9)
    )
    guarded["spread_edge"] = stabilized_margin - market_margin if market_margin is not None else None
    guarded["total_edge"] = stabilized_total - total_line if stabilized_total is not None and total_line is not None else None

    eligible = bool(guarded.get("eligible"))
    if model_profile == "rothstein_plus" and sample["confidence"] != "HIGH":
        eligible = False
        guarded["eligible"] = False
        guarded["display_suppressed"] = True

    guarded["spread_pick"] = (
        side_from_edge(guarded["spread_edge"], threshold=guarded["spread_threshold"])
        if eligible and guarded["spread_edge"] is not None and model_supports_spread_picks(model_profile)
        else None
    )
    guarded["total_pick"] = (
        total_from_edge(guarded["total_edge"], threshold=guarded["total_threshold"])
        if eligible and guarded["total_edge"] is not None and model_supports_totals(model_profile)
        else None
    )

    notes = list(guarded.get("model_notes") or [])
    if guarded["upcoming_stabilized"]:
        notes.append("Upcoming Rothstein projection is stabilized toward market/league baselines because same-season sample size is low.")
    if guarded.get("display_suppressed"):
        notes.append("Rothstein+ is hidden for this upcoming game because its eligibility/data-confidence requirements are not met.")
    guarded["model_notes"] = notes
    return guarded


def train_model(games: List[dict], model_profile: str = "baseline") -> OnlineNFLModel:
    model = create_model(model_profile)
    for game in games:
        pred_margin, pred_total = model.predict(game)
        model.update(game, pred_margin, pred_total)
    if hasattr(model, "finalize_training"):
        model.finalize_training()
    return model


def list_teams(games: List[dict], current_only: bool = False) -> List[str]:
    if current_only:
        seasons = sorted({game["season"] for game in games})
        latest_season = seasons[-1]
        latest_games = [game for game in games if game["season"] == latest_season]

        # The source loader intentionally excludes games without final scores. Early
        # in a new season that can make the latest season look like it has only two
        # active teams, which would empty most of the matchup picker and dashboard.
        # Retain the previous season's active teams until the new season has caught
        # up, while still including any teams already present in the latest data.
        if len(seasons) > 1:
            previous_season = seasons[-2]
            previous_games = [game for game in games if game["season"] == previous_season]
            latest_teams = {
                team
                for game in latest_games
                for team in (game["away_team"], game["home_team"])
            }
            previous_teams = {
                team
                for game in previous_games
                for team in (game["away_team"], game["home_team"])
            }
            games = latest_games + previous_games if len(latest_teams) < len(previous_teams) else latest_games
        else:
            games = latest_games

    teams = set()
    for game in games:
        teams.add(game["away_team"])
        teams.add(game["home_team"])
    return sorted(teams)


def dashboard_snapshot(
    games: List[dict],
    model_profile: str = "baseline",
    playoff_mode: bool = False,
    injury_team: Optional[str] = None,
    injury_impact: float = 0.0,
    injury_position: str = "general",
) -> dict:
    if model_profile == RSM_PROFILE:
        return rsm_dashboard_snapshot(games, playoff_mode, injury_team, injury_impact, injury_position)

    if model_profile in {"market_blend", MEAN_REVERSION_PROFILE, "rothstein", "rothstein_plus"}:
        model_profile = "baseline"

    latest_season = max(game["season"] for game in games)
    season_games = [game for game in games if game["season"] == latest_season]
    completed_week = max(game["week"] for game in season_games)
    model = train_model(games, model_profile=model_profile)
    teams = list_teams(games, current_only=True)
    injury_team = (injury_team or "").strip().upper()
    injury_impact = max(0.0, min(10.0, injury_impact))
    injury_position = (injury_position or "general").strip().lower()
    injury_profile = INJURY_PROFILES.get(injury_position, INJURY_PROFILES["general"])
    if injury_position not in INJURY_PROFILES:
        injury_position = "general"
    if injury_team not in teams:
        injury_team = None

    rows = []
    for team in teams:
        state = model.team(team)
        recent_margin = _mean(state.recent_margins)
        expected_points = max(12.0, min(38.0, model.mean_total / 2 + state.offense - state.defense_allowed * 0.25))
        expected_allowed = max(12.0, min(38.0, model.mean_total / 2 + state.defense_allowed - state.offense * 0.15))
        expected_point_edge = expected_points - expected_allowed
        stability = min(1.0, state.games / 17)
        injury_adjustment = injury_impact if injury_team == team else 0.0
        if injury_adjustment:
            expected_points = max(8.0, expected_points - injury_adjustment * injury_profile["offense_factor"])
            expected_allowed = min(42.0, expected_allowed + injury_adjustment * injury_profile["allowed_factor"])
            expected_point_edge = expected_points - expected_allowed

        if playoff_mode:
            strength = (
                state.margin_rating * 0.78
                + recent_margin * 1.05
                + expected_point_edge * 0.52
                + stability * 0.65
            )
        else:
            strength = state.margin_rating + 0.55 * recent_margin + 0.22 * (state.offense - state.defense_allowed)
        strength -= injury_adjustment * injury_profile["strength_factor"]
        neutral_win_probability = 1 / (1 + math.exp(-strength / 6.5))
        rows.append({
            "team": team,
            "games": state.games,
            "strength_rating": strength,
            "margin_rating": state.margin_rating,
            "offense_rating": state.offense,
            "defense_allowed_rating": state.defense_allowed,
            "recent_margin": recent_margin,
            "expected_point_edge": expected_point_edge,
            "stability": stability,
            "injury_adjustment": injury_adjustment,
            "injury_position": injury_position if injury_adjustment else None,
            "injury_label": injury_profile["label"] if injury_adjustment else None,
            "expected_points": expected_points,
            "expected_allowed": expected_allowed,
            "neutral_win_probability": neutral_win_probability,
        })

    rows.sort(key=lambda row: row["strength_rating"], reverse=True)
    if not rows:
        return {
            "season": latest_season,
            "completed_week": completed_week,
            "model": model_profile,
            "playoff_mode": playoff_mode,
            "injury": {
                "team": injury_team,
                "impact": injury_impact,
                "position": injury_position,
                "label": injury_profile["label"],
                "offense_factor": injury_profile["offense_factor"],
                "allowed_factor": injury_profile["allowed_factor"],
                "strength_factor": injury_profile["strength_factor"],
                "applied": bool(injury_team and injury_impact),
            },
            "teams": [],
            "top_teams": [],
            "league": {},
        }

    strengths = [row["strength_rating"] for row in rows]
    high = max(strengths)
    low = min(strengths)
    spread = high - low if high != low else 1.0

    for index, row in enumerate(rows, start=1):
        normalized = (row["strength_rating"] - low) / spread
        rank_factor = 1 - ((index - 1) / max(1, len(rows) - 1))
        recent_factor = max(0, min(1, 0.5 + row["recent_margin"] / 18))
        if playoff_mode:
            edge_factor = max(0, min(1, 0.5 + row["expected_point_edge"] / 18))
            playoff_odds = 0.04 + 0.58 * normalized + 0.22 * recent_factor + 0.12 * edge_factor + 0.04 * row["stability"]
        else:
            playoff_odds = 0.08 + 0.78 * normalized + 0.1 * rank_factor + 0.04 * recent_factor
        row["rank"] = index
        row["playoff_odds"] = max(0.02, min(0.98, playoff_odds))

    return {
        "season": latest_season,
        "completed_week": completed_week,
        "model": model_profile,
        "playoff_mode": playoff_mode,
        "injury": {
            "team": injury_team,
            "impact": injury_impact,
            "position": injury_position,
            "label": injury_profile["label"],
            "offense_factor": injury_profile["offense_factor"],
            "allowed_factor": injury_profile["allowed_factor"],
            "strength_factor": injury_profile["strength_factor"],
            "applied": bool(injury_team and injury_impact),
        },
        "teams": rows,
        "top_teams": rows[:8],
        "mode_notes": [
            "Neutral-site style weighting",
            "Recent form emphasized",
            "Expected point edge emphasized",
            "Injuries and live roster news are not included",
        ] if playoff_mode else [
            "Regular-season model state",
            "Season-long rating emphasized",
            "Recent form included at lower weight",
        ],
        "league": {
            "average_expected_points": statistics.mean(row["expected_points"] for row in rows),
            "average_expected_allowed": statistics.mean(row["expected_allowed"] for row in rows),
            "average_neutral_win_probability": statistics.mean(row["neutral_win_probability"] for row in rows),
            "team_count": len(rows),
        },
    }


def rsm_dashboard_snapshot(
    games: List[dict],
    playoff_mode: bool = False,
    injury_team: Optional[str] = None,
    injury_impact: float = 0.0,
    injury_position: str = "general",
) -> dict:
    latest_season = max(game["season"] for game in games)
    season_games = [game for game in games if game["season"] == latest_season]
    completed_week = max(game["week"] for game in season_games)
    rows = []
    injury_team = (injury_team or "").strip().upper()
    injury_impact = max(0.0, min(10.0, injury_impact))
    injury_profile = INJURY_PROFILES.get((injury_position or "general").strip().lower(), INJURY_PROFILES["general"])
    for team, row in _rsm_team_rows().items():
        injury_adjustment = injury_impact if injury_team == team else 0.0
        offense = _row_float(row, "offense_rating", 50.0) - injury_adjustment * injury_profile["offense_factor"]
        defense = _row_float(row, "defense_rating", 50.0) - injury_adjustment * injury_profile["allowed_factor"]
        strength = _row_float(row, "roster_rating", 50.0) - 50.0 - injury_adjustment * injury_profile["strength_factor"]
        neutral_win_probability = 1 / (1 + math.exp(-strength / 4.5))
        rows.append({
            "team": team,
            "games": None,
            "strength_rating": strength,
            "margin_rating": strength,
            "offense_rating": offense - 50.0,
            "defense_allowed_rating": 50.0 - defense,
            "recent_margin": 0.0,
            "expected_point_edge": offense - defense,
            "stability": 1.0 if row.get("lineup_confidence") == "HIGH" else 0.65,
            "injury_adjustment": injury_adjustment,
            "injury_position": injury_position if injury_adjustment else None,
            "injury_label": injury_profile["label"] if injury_adjustment else None,
            "expected_points": max(12.0, min(38.0, 22.0 + (offense - 50.0) * 0.35)),
            "expected_allowed": max(12.0, min(38.0, 22.0 - (defense - 50.0) * 0.35)),
            "neutral_win_probability": neutral_win_probability,
            "lineup_confidence": row.get("lineup_confidence"),
        })
    rows.sort(key=lambda row: row["strength_rating"], reverse=True)
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
        row["playoff_odds"] = row["neutral_win_probability"]
    return {
        "season": latest_season,
        "completed_week": completed_week,
        "model": RSM_PROFILE,
        "playoff_mode": playoff_mode,
        "injury": {
            "team": injury_team,
            "impact": injury_impact,
            "position": injury_position,
            "label": injury_profile["label"],
            "offense_factor": injury_profile["offense_factor"],
            "allowed_factor": injury_profile["allowed_factor"],
            "strength_factor": injury_profile["strength_factor"],
            "applied": bool(injury_team and injury_impact),
        },
        "teams": rows,
        "top_teams": rows[:8],
        "mode_notes": [
            "Experimental RSM roster snapshot",
            "Margin comparison only",
            "No RSM betting picks or totals",
            "Manual Stage 8 research capture is available only with an operator token",
        ],
        "league": {
            "average_expected_points": statistics.mean(row["expected_points"] for row in rows) if rows else None,
            "average_expected_allowed": statistics.mean(row["expected_allowed"] for row in rows) if rows else None,
            "average_neutral_win_probability": statistics.mean(row["neutral_win_probability"] for row in rows) if rows else None,
            "team_count": len(rows),
        },
    }


def matchup_history(games: List[dict], away_team: str, home_team: str, model_profile: str = "baseline") -> List[dict]:
    if model_profile == RSM_PROFILE:
        return rsm_matchup_history(games, away_team, home_team)

    selected = {away_team, home_team}
    model = create_model(model_profile)
    spread_threshold = default_spread_threshold(model_profile)
    total_threshold = default_total_threshold(model_profile)
    rows = []
    for game in games:
        eligible = True
        if model_profile == "rothstein_plus":
            eligible = is_rothstein_plus_eligible(model, game)

        pred_margin, pred_total = model.predict(game)

        if {game["away_team"], game["home_team"]} == selected:
            selected_home_spread = game["spread_line"] if game["home_team"] == home_team else -game["spread_line"]
            spread_edge = pred_margin - game["spread_line"]
            total_edge = pred_total - game["total_line"]
            spread_pick = side_from_edge(spread_edge, spread_threshold) if eligible and model_supports_spread_picks(model_profile) else None
            total_pick = total_from_edge(total_edge, total_threshold) if model_supports_totals(model_profile) else None

            spread_result = None
            if spread_pick:
                cover_margin = game["actual_margin"] - game["spread_line"]
                if abs(cover_margin) < 1e-9:
                    spread_result = "push"
                elif (spread_pick == "home" and cover_margin > 0) or (spread_pick == "away" and cover_margin < 0):
                    spread_result = "correct"
                else:
                    spread_result = "wrong"

            total_result = None
            if total_pick:
                total_margin = game["actual_total"] - game["total_line"]
                if abs(total_margin) < 1e-9:
                    total_result = "push"
                elif (total_pick == "over" and total_margin > 0) or (total_pick == "under" and total_margin < 0):
                    total_result = "correct"
                else:
                    total_result = "wrong"

            rows.append({
                "season": game["season"],
                "week": game["week"],
                "gameday": game.get("gameday"),
                "away_team": game["away_team"],
                "home_team": game["home_team"],
                "away_score": game["away_score"],
                "home_score": game["home_score"],
                "home_spread": game["spread_line"],
                "selected_home_spread": selected_home_spread,
                "total_line": game["total_line"],
                "actual_total": game["actual_total"],
                "home_margin": game["actual_margin"],
                "model": model_profile,
                "model_eligible": eligible,
                "pred_margin": pred_margin,
                "pred_total": pred_total,
                "spread_pick": spread_pick,
                "spread_result": spread_result,
                "total_pick": total_pick,
                "total_result": total_result,
            })

        model.update(game, pred_margin, pred_total)

    rows.sort(key=lambda row: (row["season"], row["week"], row.get("gameday") or ""))
    return rows


def rsm_matchup_history(games: List[dict], away_team: str, home_team: str) -> List[dict]:
    selected = {away_team, home_team}
    rsm_rows = _rsm_validation_rows()
    rows = []
    for game in games:
        if {game["away_team"], game["home_team"]} != selected or game.get("game_id") not in rsm_rows:
            continue
        rsm = rsm_rows[game["game_id"]]
        selected_home_spread = game["spread_line"] if game["home_team"] == home_team else -game["spread_line"]
        rows.append({
            "season": game["season"],
            "week": game["week"],
            "gameday": game.get("gameday"),
            "away_team": game["away_team"],
            "home_team": game["home_team"],
            "away_score": game["away_score"],
            "home_score": game["home_score"],
            "home_spread": game["spread_line"],
            "selected_home_spread": selected_home_spread,
            "total_line": game["total_line"],
            "actual_total": game["actual_total"],
            "home_margin": game["actual_margin"],
            "model": RSM_PROFILE,
            "model_eligible": False,
            "pred_margin": _row_float(rsm, "roster_fair_home_margin"),
            "pred_total": None,
            "spread_pick": None,
            "spread_result": None,
            "total_pick": None,
            "total_result": None,
        })
    rows.sort(key=lambda row: (row["season"], row["week"], row.get("gameday") or ""))
    return rows


def predict_matchup(
    games: List[dict],
    away_team: str,
    home_team: str,
    spread_line: Optional[float] = 0.0,
    total_line: Optional[float] = None,
    model_profile: str = "baseline",
    home_rest: float = 7.0,
    away_rest: float = 7.0,
    div_game: bool = False,
    roof: str = "",
    temp: Optional[float] = None,
    wind: Optional[float] = None,
    market_source: Optional[str] = None,
    market_observed_at: Optional[str] = None,
    trained_model=None,
    upcoming_context: bool = False,
) -> dict:
    available_teams = set(list_teams(games))
    if away_team not in available_teams:
        raise ValueError(f"Unknown away_team: {away_team}")
    if home_team not in available_teams:
        raise ValueError(f"Unknown home_team: {home_team}")
    if away_team == home_team:
        raise ValueError("away_team and home_team must be different")

    if trained_model is not None:
        model = trained_model
    elif model_profile == RSM_PROFILE:
        model = create_model(model_profile)
    elif model_profile in {"rothstein", "rothstein_plus"}:
        current_season = max(g["season"] for g in games)
        training_games = [g for g in games if g["season"] == current_season]
        model = train_model(training_games, model_profile=model_profile)
    else:
        training_games = games
        model = train_model(training_games, model_profile=model_profile)
    # nflverse stores the market as an expected home margin (home favorite is
    # positive). The public API accepts conventional sportsbook notation, where
    # a home favorite is negative, so convert it at this boundary.
    # RSM never substitutes a pick'em line when no market line was supplied.
    market_margin = -spread_line if spread_line is not None else None
    if market_margin is None and model_profile != RSM_PROFILE:
        market_margin = 0.0
    effective_total_line = total_line
    if effective_total_line is None and model_profile != RSM_PROFILE:
        effective_total_line = 44.5
    game = {
        "season": max(g["season"] for g in games),
        "week": max(g["week"] for g in games if g["season"] == max(item["season"] for item in games)) + 1,
        "away_team": away_team,
        "home_team": home_team,
        "spread_line": market_margin,
        "total_line": effective_total_line,
        "away_rest": away_rest,
        "home_rest": home_rest,
        "div_game": div_game,
        "roof": roof,
        "temp": temp,
        "wind": wind,
    }
    rsm_details = model.prediction_details(game) if model_profile == RSM_PROFILE else None
    if rsm_details:
        pred_margin, pred_total = rsm_details["predicted_margin"], rsm_details["predicted_total"]
    else:
        pred_margin, pred_total = model.predict(game)
    spread_edge = pred_margin - market_margin if market_margin is not None else None
    total_edge = pred_total - effective_total_line if pred_total is not None and effective_total_line is not None else None
    spread_threshold = default_spread_threshold(model_profile)
    total_threshold = default_total_threshold(model_profile)
    eligible = True
    if model_profile == "rothstein_plus":
        eligible = is_rothstein_plus_eligible(model, game)

    spread_pick = (
        side_from_edge(spread_edge, threshold=spread_threshold)
        if eligible and spread_edge is not None and model_supports_spread_picks(model_profile)
        else None
    )
    winner_pick = "home" if pred_margin > 0 else "away" if pred_margin < 0 else None
    rsm_notes = [
        "RSM — Experimental: winner and ATS selections are frozen-model projections, not evidence of a betting advantage.",
        "O/U projection uses the separately versioned RSM-v2 Stage7B Total diagnostic artifact; it has no established betting advantage.",
        "Stage 8 research eligibility remains separate; optional manual capture is a distinct, token-gated research workflow.",
    ]
    if market_margin is None:
        rsm_notes.append("No market spread was supplied, so no ATS selection is shown.")
    elif not market_source or not market_observed_at:
        rsm_notes.append("The supplied market line has no verified source and observation time.")
    if model_profile == RSM_PROFILE:
        rsm_notes.append("Prospective lineup confidence is unavailable for this snapshot-based display.")
        if total_line is None:
            rsm_notes.append("No bookmaker total was supplied, so total edge and O/U selection are unavailable; the independent model total remains displayed.")

    prediction = {
        "model": model_profile,
        "away_team": away_team,
        "home_team": home_team,
        "pred_margin": pred_margin,
        "pred_total": pred_total,
        "spread_line": spread_line,
        "market_margin": market_margin,
        "total_line": total_line,
        "spread_edge": spread_edge,
        "total_edge": total_edge,
        "spread_threshold": spread_threshold,
        "total_threshold": total_threshold,
        "eligible": eligible,
        "winner_pick": winner_pick,
        "spread_pick": spread_pick,
        "total_pick": total_from_edge(total_edge, threshold=0.0) if total_edge is not None and model_profile == RSM_PROFILE else (total_from_edge(total_edge, threshold=total_threshold) if total_edge is not None and model_supports_totals(model_profile) else None),
        "market_source": market_source or None,
        "market_observed_at": market_observed_at or None,
        "lineup_confidence": rsm_details["lineup_confidence"] if rsm_details else "not_applicable",
        "total_model_version": rsm_details["total_model_version"] if rsm_details else None,
        "latest_training_season": max(g["season"] for g in games),
        "model_notes": rsm_notes if model_profile == RSM_PROFILE else [],
    }
    if upcoming_context and model_profile in {"rothstein", "rothstein_plus"}:
        prediction = stabilize_rothstein_upcoming_prediction(prediction, model, game, model_profile)
    return prediction


def side_from_edge(edge: float, threshold: float) -> Optional[str]:
    if edge > threshold:
        return "home"
    if edge < -threshold:
        return "away"
    return None


def total_from_edge(edge: float, threshold: float) -> Optional[str]:
    if edge > threshold:
        return "over"
    if edge < -threshold:
        return "under"
    return None


def score_binary(correct: int, pushes: int, bets: int) -> Optional[float]:
    graded = bets - pushes
    if graded <= 0:
        return None
    return correct / graded


def wilson_interval(correct: int, attempts: int, z: float = 1.96) -> Tuple[Optional[float], Optional[float]]:
    if attempts <= 0:
        return None, None
    rate = correct / attempts
    denominator = 1 + z * z / attempts
    center = (rate + z * z / (2 * attempts)) / denominator
    margin = z * math.sqrt((rate * (1 - rate) + z * z / (4 * attempts)) / attempts) / denominator
    return center - margin, center + margin


def summarize(records: List[dict]) -> dict:
    spread_bets = [r for r in records if r["spread_pick"]]
    total_bets = [r for r in records if r["total_pick"]]

    spread_correct = sum(1 for r in spread_bets if r["spread_result"] == "win")
    spread_pushes = sum(1 for r in spread_bets if r["spread_result"] == "push")
    total_correct = sum(1 for r in total_bets if r["total_result"] == "win")
    total_pushes = sum(1 for r in total_bets if r["total_result"] == "push")
    spread_losses = len(spread_bets) - spread_correct - spread_pushes
    total_losses = len(total_bets) - total_correct - total_pushes
    spread_graded = spread_correct + spread_losses
    total_graded = total_correct + total_losses
    spread_interval = wilson_interval(spread_correct, spread_graded)
    total_interval = wilson_interval(total_correct, total_graded)
    spread_net_units = spread_correct * (100 / 110) - spread_losses
    total_net_units = total_correct * (100 / 110) - total_losses

    margin_errors = [abs(r["pred_margin"] - r["actual_margin"]) for r in records if r.get("pred_margin") is not None and r.get("actual_margin") is not None]
    total_errors = [abs(r["pred_total"] - r["actual_total"]) for r in records if r.get("pred_total") is not None and r.get("actual_total") is not None]

    return {
        "games": len(records),
        "spread_bets": len(spread_bets),
        "spread_wins": spread_correct,
        "spread_losses": spread_losses,
        "spread_pushes": spread_pushes,
        "spread_win_rate": score_binary(spread_correct, spread_pushes, len(spread_bets)),
        "spread_win_rate_ci95": spread_interval,
        "spread_net_units_at_minus_110": spread_net_units,
        "spread_roi_at_minus_110": spread_net_units / len(spread_bets) if spread_bets else None,
        "total_bets": len(total_bets),
        "total_wins": total_correct,
        "total_losses": total_losses,
        "total_pushes": total_pushes,
        "total_win_rate": score_binary(total_correct, total_pushes, len(total_bets)),
        "total_win_rate_ci95": total_interval,
        "total_net_units_at_minus_110": total_net_units,
        "total_roi_at_minus_110": total_net_units / len(total_bets) if total_bets else None,
        "margin_mae": statistics.mean(margin_errors) if margin_errors else None,
        "total_mae": statistics.mean(total_errors) if total_errors else None,
    }


def summarize_by_season(records: List[dict]) -> List[Tuple[int, dict]]:
    seasons = sorted({r["season"] for r in records})
    return [(season, summarize([r for r in records if r["season"] == season])) for season in seasons]


def _grade_spread_pick(game: dict, spread_pick: Optional[str]) -> Optional[str]:
    if not spread_pick:
        return None
    cover_margin = game["actual_margin"] - game["spread_line"]
    if abs(cover_margin) < 1e-9:
        return "push"
    if (spread_pick == "home" and cover_margin > 0) or (spread_pick == "away" and cover_margin < 0):
        return "win"
    return "loss"


def _grade_total_pick(game: dict, total_pick: Optional[str]) -> Optional[str]:
    if not total_pick:
        return None
    total_margin = game["actual_total"] - game["total_line"]
    if abs(total_margin) < 1e-9:
        return "push"
    if (total_pick == "over" and total_margin > 0) or (total_pick == "under" and total_margin < 0):
        return "win"
    return "loss"


def weekly_model_performance(games: List[dict], season: int, week: int, model_profiles: Tuple[str, ...] = MODEL_PROFILES) -> dict:
    """Grade each model on completed games for one week using chronological pregame predictions."""
    completed_week_games = [
        game for game in games
        if game["season"] == season and game["week"] == week
    ]
    rows = []
    for model_profile in model_profiles:
        model = create_model(model_profile)
        records = []
        for game in games:
            eligible = True
            if model_profile == "rothstein_plus":
                eligible = is_rothstein_plus_eligible(model, game)
            try:
                pred_margin, pred_total = model.predict(game)
            except ValueError:
                pred_margin, pred_total = None, None

            if game["season"] == season and game["week"] == week:
                spread_edge = pred_margin - game["spread_line"] if pred_margin is not None else None
                total_edge = pred_total - game["total_line"] if pred_total is not None else None
                spread_pick = side_from_edge(spread_edge, default_spread_threshold(model_profile)) if spread_edge is not None and eligible and model_supports_spread_picks(model_profile) else None
                if model_profile == RSM_PROFILE:
                    total_pick = total_from_edge(total_edge, 0.0) if total_edge is not None else None
                else:
                    total_pick = total_from_edge(total_edge, default_total_threshold(model_profile)) if total_edge is not None and eligible and model_supports_totals(model_profile) else None
                records.append({
                    "pred_margin": pred_margin,
                    "actual_margin": game["actual_margin"],
                    "pred_total": pred_total,
                    "actual_total": game["actual_total"],
                    "spread_pick": spread_pick,
                    "spread_result": _grade_spread_pick(game, spread_pick),
                    "total_pick": total_pick,
                    "total_result": _grade_total_pick(game, total_pick),
                })

            if model_profile != RSM_PROFILE and pred_margin is not None and pred_total is not None:
                model.update(game, pred_margin, pred_total)

        summary = summarize(records)
        rows.append({
            "model": model_profile,
            "completed_games": len(records),
            "spread_wins": summary["spread_wins"],
            "spread_losses": summary["spread_losses"],
            "spread_pushes": summary["spread_pushes"],
            "spread_bets": summary["spread_bets"],
            "spread_win_rate": summary["spread_win_rate"],
            "total_wins": summary["total_wins"],
            "total_losses": summary["total_losses"],
            "total_pushes": summary["total_pushes"],
            "total_bets": summary["total_bets"],
            "total_win_rate": summary["total_win_rate"],
            "margin_mae": summary["margin_mae"],
            "total_mae": summary["total_mae"],
        })
    return {
        "season": season,
        "week": week,
        "completed_games": len(completed_week_games),
        "models": rows,
    }


def _weekly_performance_trend_cache_root() -> str:
    return os.getenv("NFL_PERFORMANCE_CACHE_DIR", "").strip() or os.path.dirname(upcoming_prediction_cache_path())


def _weekly_performance_cache_metadata(games: List[dict], season: int, week: int, model_profiles: Tuple[str, ...]) -> dict:
    return {
        "schema_version": WEEKLY_PERFORMANCE_TREND_SCHEMA_VERSION,
        "season": season,
        "week": week,
        "model_profiles": list(model_profiles),
        "games_fingerprint": _history_games_fingerprint(games),
        "games_source_signature": _games_source_signature(),
        "thresholds": {
            profile: {
                "spread_threshold": default_spread_threshold(profile),
                "total_threshold": default_total_threshold(profile),
            }
            for profile in model_profiles
        },
    }


def _weekly_performance_cache_path(games: List[dict], season: int, week: int, model_profiles: Tuple[str, ...]) -> str:
    metadata = _weekly_performance_cache_metadata(games, season, week, model_profiles)
    fingerprint = hashlib.sha256(json.dumps(metadata, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:20]
    return os.path.join(_weekly_performance_trend_cache_root(), f"nfl_weekly_performance_all_{season}_{week}_{fingerprint}.json")


def cached_weekly_model_performance(
    games: List[dict],
    season: int,
    week: int,
    model_profiles: Tuple[str, ...] = MODEL_PROFILES,
) -> Tuple[dict, bool]:
    metadata = _weekly_performance_cache_metadata(games, season, week, model_profiles)
    cache_path = _weekly_performance_cache_path(games, season, week, model_profiles)
    try:
        with open(cache_path, encoding="utf-8") as source:
            cached = json.load(source)
        if cached.get("metadata") == metadata and isinstance(cached.get("performance"), dict):
            performance = cached["performance"]
            performance["generated_at"] = cached.get("generated_at")
            return performance, True
    except (OSError, TypeError, json.JSONDecodeError):
        pass

    performance = weekly_model_performance(games, season, week, model_profiles)
    generated_at = datetime.now(timezone.utc).isoformat()
    performance["generated_at"] = generated_at
    os.makedirs(os.path.dirname(cache_path) or ".", exist_ok=True)
    _write_json_cache(cache_path, {
        "metadata": metadata,
        "performance": performance,
        "generated_at": generated_at,
    })
    return performance, False


def _weekly_performance_trend_metadata(games: List[dict], season: int, model_profile: str) -> dict:
    return {
        "schema_version": WEEKLY_PERFORMANCE_TREND_SCHEMA_VERSION,
        "model_profile": model_profile,
        "season": season,
        "games_fingerprint": _history_games_fingerprint(games),
        "games_source_signature": _games_source_signature(),
        "spread_threshold": default_spread_threshold(model_profile),
        "total_threshold": default_total_threshold(model_profile),
    }


def _weekly_performance_trend_cache_path(games: List[dict], season: int, model_profile: str) -> str:
    metadata = _weekly_performance_trend_metadata(games, season, model_profile)
    fingerprint = hashlib.sha256(json.dumps(metadata, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:20]
    return os.path.join(_weekly_performance_trend_cache_root(), f"nfl_weekly_performance_{model_profile}_{season}_{fingerprint}.json")


def _model_week_records(games: List[dict], season: int, model_profile: str) -> Dict[int, List[dict]]:
    model = create_model(model_profile)
    records_by_week: Dict[int, List[dict]] = {}
    for game in games:
        eligible = True
        if model_profile == "rothstein_plus":
            eligible = is_rothstein_plus_eligible(model, game)
        try:
            pred_margin, pred_total = model.predict(game)
        except ValueError:
            pred_margin, pred_total = None, None

        if game["season"] == season:
            spread_edge = pred_margin - game["spread_line"] if pred_margin is not None else None
            total_edge = pred_total - game["total_line"] if pred_total is not None else None
            spread_pick = side_from_edge(spread_edge, default_spread_threshold(model_profile)) if spread_edge is not None and eligible and model_supports_spread_picks(model_profile) else None
            if model_profile == RSM_PROFILE:
                total_pick = total_from_edge(total_edge, 0.0) if total_edge is not None else None
            else:
                total_pick = total_from_edge(total_edge, default_total_threshold(model_profile)) if total_edge is not None and eligible and model_supports_totals(model_profile) else None
            records_by_week.setdefault(game["week"], []).append({
                "pred_margin": pred_margin,
                "actual_margin": game["actual_margin"],
                "pred_total": pred_total,
                "actual_total": game["actual_total"],
                "spread_pick": spread_pick,
                "spread_result": _grade_spread_pick(game, spread_pick),
                "total_pick": total_pick,
                "total_result": _grade_total_pick(game, total_pick),
            })

        if model_profile != RSM_PROFILE and pred_margin is not None and pred_total is not None:
            model.update(game, pred_margin, pred_total)
    return records_by_week


def weekly_model_performance_trend(games: List[dict], season: int, model_profile: str) -> dict:
    if model_profile not in MODEL_PROFILES:
        raise ValueError(f"Unknown model profile: {model_profile}")
    records_by_week = _model_week_records(games, season, model_profile)
    weeks = []
    for week in sorted(records_by_week):
        records = records_by_week[week]
        summary = summarize(records)
        weeks.append({
            "week": week,
            "completed_games": len(records),
            "spread_wins": summary["spread_wins"],
            "spread_losses": summary["spread_losses"],
            "spread_pushes": summary["spread_pushes"],
            "spread_bets": summary["spread_bets"],
            "spread_win_rate": summary["spread_win_rate"],
            "total_wins": summary["total_wins"],
            "total_losses": summary["total_losses"],
            "total_pushes": summary["total_pushes"],
            "total_bets": summary["total_bets"],
            "total_win_rate": summary["total_win_rate"],
            "margin_mae": summary["margin_mae"],
            "total_mae": summary["total_mae"],
        })
    return {
        "season": season,
        "model": model_profile,
        "weeks": weeks,
    }


def cached_weekly_model_performance_trend(games: List[dict], season: int, model_profile: str) -> Tuple[dict, bool]:
    if model_profile not in MODEL_PROFILES:
        raise ValueError(f"Unknown model profile: {model_profile}")
    metadata = _weekly_performance_trend_metadata(games, season, model_profile)
    cache_path = _weekly_performance_trend_cache_path(games, season, model_profile)
    try:
        with open(cache_path, encoding="utf-8") as source:
            cached = json.load(source)
        if cached.get("metadata") == metadata and isinstance(cached.get("trend"), dict):
            trend = cached["trend"]
            trend["generated_at"] = cached.get("generated_at")
            return trend, True
    except (OSError, TypeError, json.JSONDecodeError):
        pass

    trend = weekly_model_performance_trend(games, season, model_profile)
    generated_at = datetime.now(timezone.utc).isoformat()
    trend["generated_at"] = generated_at
    os.makedirs(os.path.dirname(cache_path) or ".", exist_ok=True)
    _write_json_cache(cache_path, {
        "metadata": metadata,
        "trend": trend,
        "generated_at": generated_at,
    })
    return trend, False


def run_backtest(
    games: List[dict],
    seasons_to_test: int,
    spread_threshold: Optional[float] = None,
    total_threshold: Optional[float] = None,
    model_profile: str = "baseline",
) -> Tuple[dict, List[dict]]:
    if model_profile == RSM_PROFILE:
        records = rsm_backtest_records(games, seasons_to_test)
        return summarize(records), records

    if spread_threshold is None:
        spread_threshold = default_spread_threshold(model_profile)
    if total_threshold is None:
        total_threshold = default_total_threshold(model_profile)

    completed_seasons = sorted({g["season"] for g in games})
    test_seasons = set(completed_seasons[-seasons_to_test:])

    model = create_model(model_profile)
    records = []

    for game in games:
        eligible = True
        if model_profile == "rothstein_plus":
            eligible = is_rothstein_plus_eligible(model, game)

        pred_margin, pred_total = model.predict(game)

        if game["season"] in test_seasons:
            spread_edge = pred_margin - game["spread_line"]
            total_edge = pred_total - game["total_line"]
            spread_pick = side_from_edge(spread_edge, spread_threshold) if eligible and model_supports_spread_picks(model_profile) else None
            total_pick = total_from_edge(total_edge, total_threshold) if model_supports_totals(model_profile) else None

            spread_result = None
            if spread_pick:
                cover_margin = game["actual_margin"] - game["spread_line"]
                if abs(cover_margin) < 1e-9:
                    spread_result = "push"
                elif (spread_pick == "home" and cover_margin > 0) or (spread_pick == "away" and cover_margin < 0):
                    spread_result = "win"
                else:
                    spread_result = "loss"

            total_result = None
            if total_pick:
                total_margin = game["actual_total"] - game["total_line"]
                if abs(total_margin) < 1e-9:
                    total_result = "push"
                elif (total_pick == "over" and total_margin > 0) or (total_pick == "under" and total_margin < 0):
                    total_result = "win"
                else:
                    total_result = "loss"

            records.append({
                "season": game["season"],
                "week": game["week"],
                "game_id": game["game_id"],
                "model": model_profile,
                "away_team": game["away_team"],
                "home_team": game["home_team"],
                "pred_margin": pred_margin,
                "actual_margin": game["actual_margin"],
                "spread_line": game["spread_line"],
                "spread_edge": spread_edge,
                "spread_pick": spread_pick,
                "spread_result": spread_result,
                "pred_total": pred_total,
                "actual_total": game["actual_total"],
                "total_line": game["total_line"],
                "total_edge": total_edge,
                "total_pick": total_pick,
                "total_result": total_result,
            })

        model.update(game, pred_margin, pred_total)

    return summarize(records), records


def _backtest_cache_path(games: List[dict], seasons_to_test: int, spread_threshold: float, total_threshold: float, model_profile: str) -> str:
    cache_root = os.getenv("NFL_BACKTEST_CACHE_DIR", "").strip() or os.path.dirname(upcoming_prediction_cache_path())
    fingerprint_source = {
        "schema_version": 2,
        "seasons": seasons_to_test,
        "spread_threshold": spread_threshold,
        "total_threshold": total_threshold,
        "model": model_profile,
        "games": [
            (
                game.get("season"), game.get("week"), game.get("game_id"),
                game.get("away_team"), game.get("home_team"), game.get("away_score"),
                game.get("home_score"), game.get("spread_line"), game.get("total_line"),
            )
            for game in games
        ],
    }
    fingerprint = hashlib.sha256(json.dumps(fingerprint_source, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:20]
    return os.path.join(cache_root, f"nfl_backtest_{model_profile}_{seasons_to_test}_{fingerprint}.json")


def cached_backtest(
    games: List[dict],
    seasons_to_test: int,
    spread_threshold: float,
    total_threshold: float,
    model_profile: str,
) -> Tuple[dict, List[Tuple[int, dict]], bool]:
    """Return a cached backtest summary and season breakdown when inputs match."""
    cache_path = _backtest_cache_path(games, seasons_to_test, spread_threshold, total_threshold, model_profile)
    try:
        with open(cache_path, encoding="utf-8") as source:
            cached = json.load(source)
        if isinstance(cached.get("summary"), dict) and isinstance(cached.get("by_season"), list):
            return cached["summary"], [(row["season"], row["summary"]) for row in cached["by_season"]], True
    except (OSError, KeyError, TypeError, json.JSONDecodeError):
        pass

    summary, records = run_backtest(games, seasons_to_test, spread_threshold, total_threshold, model_profile)
    by_season = summarize_by_season(records)
    payload = {
        "summary": summary,
        "by_season": [{"season": season, "summary": season_summary} for season, season_summary in by_season],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    os.makedirs(os.path.dirname(cache_path) or ".", exist_ok=True)
    _write_json_cache(cache_path, payload)
    return summary, by_season, False


def rsm_backtest_records(games: List[dict], seasons_to_test: int) -> List[dict]:
    validation = _rsm_validation_rows()
    completed_seasons = sorted({g["season"] for g in games})
    test_seasons = set(completed_seasons[-seasons_to_test:])
    records = []
    for game in games:
        rsm = validation.get(game.get("game_id"))
        if not rsm or game["season"] not in test_seasons:
            continue
        records.append({
            "season": game["season"],
            "week": game["week"],
            "game_id": game["game_id"],
            "model": RSM_PROFILE,
            "away_team": game["away_team"],
            "home_team": game["home_team"],
            "pred_margin": _row_float(rsm, "roster_fair_home_margin"),
            "actual_margin": game["actual_margin"],
            "spread_line": game["spread_line"],
            "spread_edge": _row_float(rsm, "market_disagreement"),
            "spread_pick": None,
            "spread_result": None,
            "pred_total": None,
            "actual_total": None,
            "total_line": game["total_line"],
            "total_edge": None,
            "total_pick": None,
            "total_result": None,
        })
    return records


def format_pct(value: Optional[float]) -> str:
    if value is None:
        return "n/a"
    return f"{value * 100:.1f}%"


def print_summary(label: str, summary: dict) -> None:
    print(f"\n{label}")
    print("-" * len(label))
    print(f"Games tested:     {summary['games']}")
    print(f"Spread bets:      {summary['spread_bets']} ({summary['spread_wins']} wins, {summary['spread_pushes']} pushes)")
    print(f"Spread win rate:  {format_pct(summary['spread_win_rate'])}")
    spread_ci = summary["spread_win_rate_ci95"]
    if spread_ci[0] is not None:
        print(f"Spread 95% CI:    {format_pct(spread_ci[0])}-{format_pct(spread_ci[1])}")
        print(f"Spread ROI -110:  {format_pct(summary['spread_roi_at_minus_110'])}")
    print(f"Total bets:       {summary['total_bets']} ({summary['total_wins']} wins, {summary['total_pushes']} pushes)")
    print(f"Total win rate:   {format_pct(summary['total_win_rate'])}")
    total_ci = summary["total_win_rate_ci95"]
    if total_ci[0] is not None:
        print(f"Total 95% CI:     {format_pct(total_ci[0])}-{format_pct(total_ci[1])}")
        print(f"Total ROI -110:   {format_pct(summary['total_roi_at_minus_110'])}")
    print(f"Margin MAE:       {summary['margin_mae']:.2f}")
    print(f"Total MAE:        {summary['total_mae']:.2f}")


def print_season_table(records: List[dict]) -> None:
    print("\nSeason breakdown")
    print("----------------")
    print("Season  Games  Spread   Totals    Margin MAE  Total MAE")
    for season, summary in summarize_by_season(records):
        print(
            f"{season:<7} "
            f"{summary['games']:<6} "
            f"{format_pct(summary['spread_win_rate']):<8} "
            f"{format_pct(summary['total_win_rate']):<8} "
            f"{summary['margin_mae']:<10.2f} "
            f"{summary['total_mae']:.2f}"
        )


def print_threshold_sweep(games: List[dict], thresholds: List[float], model_profile: str) -> None:
    print("\nThreshold sweep")
    print("---------------")
    print("Edge  Window  Spread bets  Spread win  Total bets  Total win")
    for threshold in thresholds:
        for seasons in (5, 10):
            summary, _ = run_backtest(
                games,
                seasons_to_test=seasons,
                spread_threshold=threshold,
                total_threshold=threshold,
                model_profile=model_profile,
            )
            print(
                f"{threshold:<5g} "
                f"{seasons:<7} "
                f"{summary['spread_bets']:<12} "
                f"{format_pct(summary['spread_win_rate']):<11} "
                f"{summary['total_bets']:<10} "
                f"{format_pct(summary['total_win_rate'])}"
            )


def write_records(path: str, records: List[dict]) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    fieldnames = [
        "season",
        "week",
        "game_id",
        "model",
        "away_team",
        "home_team",
        "pred_margin",
        "actual_margin",
        "spread_line",
        "spread_edge",
        "spread_pick",
        "spread_result",
        "pred_total",
        "actual_total",
        "total_line",
        "total_edge",
        "total_pick",
        "total_result",
    ]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)


def main() -> None:
    parser = argparse.ArgumentParser(description="Backtest NFL spread and totals predictions.")
    parser.add_argument("--refresh", action="store_true", help="Re-download nflverse games.csv")
    parser.add_argument("--seasons", type=int, nargs="+", default=[5, 10], help="Backtest windows to run")
    parser.add_argument("--model", choices=MODEL_PROFILES, default="baseline", help="Model profile to backtest")
    parser.add_argument("--spread-threshold", type=float)
    parser.add_argument("--total-threshold", type=float)
    parser.add_argument("--by-season", action="store_true", help="Print per-season results for each window")
    parser.add_argument("--sweep", action="store_true", help="Print a threshold sweep for 5- and 10-year windows")
    parser.add_argument("--compare-models", action="store_true", help="Compare baseline and enhanced model profiles")
    parser.add_argument("--export", help="Write the largest backtest window to a CSV file")
    args = parser.parse_args()

    games = load_games(refresh=args.refresh)
    print(f"Loaded {len(games)} regular-season games with scores, spread_line, and total_line.")
    print(f"Data source: {GAMES_URL}")
    print(f"Seasons: {min(g['season'] for g in games)}-{max(g['season'] for g in games)}")
    print(f"Model profile: {args.model}")
    active_spread_threshold = args.spread_threshold if args.spread_threshold is not None else default_spread_threshold(args.model)
    active_total_threshold = args.total_threshold if args.total_threshold is not None else default_total_threshold(args.model)
    print(f"Spread pick threshold: {active_spread_threshold:.1f} points")
    print(f"Total pick threshold:  {active_total_threshold:.1f} points")

    if args.compare_models:
        print("\nModel comparison")
        print("----------------")
        print("Model            Window  Spread bets  Spread win  Total bets  Total win  Margin MAE  Total MAE")
        for profile in MODEL_PROFILES:
            for seasons in args.seasons:
                summary, _ = run_backtest(
                    games,
                    seasons_to_test=seasons,
                    spread_threshold=args.spread_threshold,
                    total_threshold=args.total_threshold,
                    model_profile=profile,
                )
                print(
                    f"{profile:<16} "
                    f"{seasons:<7} "
                    f"{summary['spread_bets']:<12} "
                    f"{format_pct(summary['spread_win_rate']):<11} "
                    f"{summary['total_bets']:<10} "
                    f"{format_pct(summary['total_win_rate']):<10} "
                    f"{summary['margin_mae']:<10.2f} "
                    f"{summary['total_mae']:.2f}"
                )

    largest_window_records = []
    for seasons in args.seasons:
        summary, records = run_backtest(
            games,
            seasons_to_test=seasons,
            spread_threshold=args.spread_threshold,
            total_threshold=args.total_threshold,
            model_profile=args.model,
        )
        print_summary(f"Last {seasons} completed seasons", summary)
        if args.by_season:
            print_season_table(records)
        if seasons == max(args.seasons):
            largest_window_records = records

    if args.export:
        write_records(args.export, largest_window_records)
        print(f"\nExported {len(largest_window_records)} prediction rows to {args.export}")

    if args.sweep:
        print_threshold_sweep(games, thresholds=[0, 1, 1.5, 2, 3, 4, 5, 7, 10], model_profile=args.model)


if __name__ == "__main__":
    main()
