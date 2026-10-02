import argparse
import copy
import csv
import errno
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
from datetime import datetime, timezone
from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Dict, List, Optional, Tuple
from cache_io import atomic_write_json, atomic_write_pickle
from nfl_week import (
    NFL_WEEK_ROLLOVER_HOUR,
    NFL_WEEK_ROLLOVER_TIMEZONE,
    current_nfl_schedule_week as _current_nfl_schedule_week,
    nfl_week_rollover_hour as _nfl_week_rollover_hour,
    nfl_week_rollover_zone as _nfl_week_rollover_zone,
    parse_gameday as _parse_gameday,
    tuesday_rollover_before as _tuesday_rollover_before,
)


GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
DEFAULT_CACHE_PATH = os.path.join(os.path.dirname(__file__), "data", "nfl_games.csv")
RSM_PROFILE = "rsm_stage7c"
RSM_PLUS_PROFILE = "rsm_plus"
MEAN_REVERSION_PROFILE = "mean_reversion"
CURRENT_SEASON_MATRIX_PROFILE = "current_season_matrix"
MODEL_PROFILES = ("baseline", "enhanced", "market_blend", MEAN_REVERSION_PROFILE, CURRENT_SEASON_MATRIX_PROFILE, "rothstein", "rothstein_plus", RSM_PROFILE, RSM_PLUS_PROFILE)
MATCHUP_HISTORY_WARMUP_PROFILES = tuple(model for model in MODEL_PROFILES if model != CURRENT_SEASON_MATRIX_PROFILE)
ATS_CONSENSUS_SHADOW_MODELS = ("baseline", "enhanced", "market_blend", MEAN_REVERSION_PROFILE, CURRENT_SEASON_MATRIX_PROFILE, "rothstein")
ATS_CONSENSUS_MIN_PARTICIPANTS = 4
ATS_CONSENSUS_MIN_AGREE = 3
ATS_CONSENSUS_MIN_AVG_EDGE = 5.0
UPCOMING_PREDICTION_SCHEMA_VERSION = 7
WEEKLY_PERFORMANCE_TREND_SCHEMA_VERSION = 1
EXPERIMENTAL_PROBABILITY_SCHEMA_VERSION = 1
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
_UPCOMING_PREDICTION_LOCK = threading.RLock()
_UPCOMING_REFRESH_RUNNING = False
_UPCOMING_PROGRESS_STATE = {
    "status": "idle",
    "ready": False,
    "progress": 0,
    "message": "Forecast idle.",
}
_MODEL_RESIDUAL_SCALE_CACHE = {}
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
    CURRENT_SEASON_MATRIX_PROFILE: "Experimental",
    "rothstein": "Production",
    "rothstein_plus": "Experimental",
    RSM_PROFILE: "Experimental",
    RSM_PLUS_PROFILE: "Experimental",
    "dsm": "Research only",
    "prm": "Research only",
}
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


def _upcoming_progress_path() -> str:
    return f"{upcoming_prediction_cache_path()}.progress.json"


def _upcoming_checkpoint_enabled() -> bool:
    return os.getenv("NFL_UPCOMING_CHECKPOINTS", "").strip().lower() in {"1", "true", "yes"}


def _upcoming_full_history_training_enabled() -> bool:
    return os.getenv("NFL_UPCOMING_FULL_HISTORY", "").strip().lower() in {"1", "true", "yes"}


def _upcoming_build_fingerprint(games: List[dict], upcoming: List[dict], season: Optional[int], week: Optional[int]) -> str:
    source = {
        "schema_version": UPCOMING_PREDICTION_SCHEMA_VERSION,
        "season": season,
        "week": week,
        "full_history_training": _upcoming_full_history_training_enabled(),
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
        if adjusted["total_edge"] is not None and _is_rsm_family(adjusted["model"])
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


def _rsm_roster_event_adjustment(event: dict) -> Optional[dict]:
    event_type = event.get("event_type")
    position = str(event.get("position") or "").upper()
    source_type = str(event.get("source_type") or "")
    if source_type not in {"official_injury_report", "official_transaction"}:
        return None
    if event_type == "QB1_OUT":
        return {"margin_delta": -4.0, "total_delta": -1.5, "reason": "QB unavailable"}
    if event_type == "LIMITED_TO_DNP" and position == "QB":
        return {"margin_delta": -2.0, "total_delta": -0.75, "reason": "QB downgraded to DNP"}
    if event_type == "UNIT_CLUSTER_INJURY":
        unit = position.lower()
        if unit == "ol":
            return {"margin_delta": -1.0, "total_delta": -0.5, "reason": "offensive line cluster injury"}
        if unit in {"front", "secondary"}:
            return {"margin_delta": -0.75, "total_delta": 0.0, "reason": f"{unit} cluster injury"}
        return {"margin_delta": -0.5, "total_delta": -0.25, "reason": "unit cluster injury"}
    if event_type == "PLAYER_TO_IR" and source_type == "official_transaction":
        if position == "QB":
            return {"margin_delta": -4.0, "total_delta": -1.5, "reason": "QB moved to IR"}
        if position in {"WR", "RB", "TE", "OT", "OL", "C", "G"}:
            return {"margin_delta": -0.75, "total_delta": -0.35, "reason": "offensive contributor moved to IR"}
        if position in {"CB", "S", "SAF", "DB", "EDGE", "DE", "DT", "DL", "LB", "OLB"}:
            return {"margin_delta": -0.5, "total_delta": 0.0, "reason": "defensive contributor moved to IR"}
    return None


def apply_rsm_roster_context_overlay(prediction: dict, scheduled: dict, roster_context: Optional[dict]) -> dict:
    """Apply prospective roster-intelligence events to RSM-family display projections only."""
    if not prediction or not _is_rsm_family(prediction.get("model")):
        return prediction
    if prediction.get("pred_margin") is None and prediction.get("pred_total") is None:
        return prediction
    events = roster_context.get("events", []) if isinstance(roster_context, dict) else []
    if not events:
        return prediction

    teams = {scheduled.get("away_team"), scheduled.get("home_team")}
    margin_delta = 0.0
    total_delta = 0.0
    applied_events = []
    for event in events:
        team = event.get("team")
        if team not in teams:
            continue
        adjustment = _rsm_roster_event_adjustment(event)
        if not adjustment:
            continue
        team_delta = adjustment["margin_delta"]
        if team == scheduled.get("home_team"):
            margin_delta += team_delta
        elif team == scheduled.get("away_team"):
            margin_delta -= team_delta
        total_delta += adjustment["total_delta"]
        applied_events.append({
            "event_type": event.get("event_type"),
            "team": team,
            "player": event.get("player"),
            "position": event.get("position"),
            "source_type": event.get("source_type"),
            "confidence": event.get("confidence"),
            "reason": adjustment["reason"],
            "team_margin_delta": team_delta,
            "total_delta": adjustment["total_delta"],
        })

    if not applied_events:
        return prediction

    adjusted = dict(prediction)
    adjusted["raw_pred_margin_before_rsm_roster_overlay"] = prediction.get("pred_margin")
    adjusted["raw_pred_total_before_rsm_roster_overlay"] = prediction.get("pred_total")
    adjusted["pred_margin"] = prediction["pred_margin"] + margin_delta if prediction.get("pred_margin") is not None else None
    adjusted["pred_total"] = prediction["pred_total"] + total_delta if prediction.get("pred_total") is not None else None
    adjusted["rsm_roster_overlay_applied"] = True
    adjusted["rsm_roster_margin_delta"] = margin_delta
    adjusted["rsm_roster_total_delta"] = total_delta
    adjusted["rsm_roster_events"] = applied_events

    market_margin = adjusted.get("market_margin")
    total_line = adjusted.get("total_line")
    adjusted["spread_edge"] = adjusted["pred_margin"] - market_margin if adjusted.get("pred_margin") is not None and market_margin is not None else None
    adjusted["total_edge"] = adjusted["pred_total"] - total_line if adjusted.get("pred_total") is not None and total_line is not None else None
    pred_margin = adjusted.get("pred_margin")
    adjusted["winner_pick"] = "home" if pred_margin is not None and pred_margin > 0 else "away" if pred_margin is not None and pred_margin < 0 else None
    adjusted["spread_pick"] = side_from_edge(adjusted["spread_edge"], threshold=adjusted["spread_threshold"]) if adjusted.get("spread_edge") is not None else None
    adjusted["total_pick"] = total_from_edge(adjusted["total_edge"], threshold=0.0) if adjusted.get("total_edge") is not None else None
    notes = list(adjusted.get("model_notes") or [])
    notes.append("RSM roster overlay applied from official roster intelligence events; market-aware non-RSM models are unchanged.")
    adjusted["model_notes"] = notes
    adjusted["lineup_confidence"] = "MEDIUM" if any(event.get("confidence") == "high" for event in applied_events) else adjusted.get("lineup_confidence", "LOW")
    return adjusted


def upcoming_availability_adjustment_count(season: Optional[int] = None, week: Optional[int] = None) -> int:
    count = 0
    for adjustment in load_upcoming_availability_adjustments():
        if season is not None and adjustment.get("season") not in {None, season}:
            continue
        if week is not None and adjustment.get("week") not in {None, week}:
            continue
        count += 1
    return count


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
    spread_market_gap = _max_abs_gap(margins, market_margin)
    total_market_gap = _max_abs_gap(totals, market_total)
    opportunity_tier, opportunity_label, opportunity_score = _opportunity_summary(
        spread_market_gap,
        total_market_gap,
    )
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
        opportunity_label=opportunity_label,
        spread_market_gap=spread_market_gap,
        total_market_gap=total_market_gap,
        favorite_count=favorite_count,
        underdog_count=underdog_count,
        model_count=model_count,
        missing_count=missing_count,
    )
    ats_consensus_shadow = build_ats_consensus_shadow_signal(upcoming_row)
    return {
        "schema_version": 2,
        "disclaimer": "Model Signals are matchup comparison tools, not betting recommendations.",
        "agreement_label": agreement_label,
        "market_alignment_label": market_alignment_label,
        "total_outlook_label": total_outlook_label,
        "opportunity_label": opportunity_label,
        "opportunity_tier": opportunity_tier,
        "opportunity_score": opportunity_score,
        "model_spread_range": spread_range,
        "model_total_range": total_range,
        "max_spread_market_gap": spread_market_gap,
        "max_total_market_gap": total_market_gap,
        "models_favoring_market_favorite": favorite_count,
        "models_favoring_market_underdog": underdog_count,
        "models_without_output": missing_count,
        "model_count": model_count,
        "model_statuses": model_status_labels(model_profiles),
        "included_models": usable,
        "missing_models": missing_models,
        "ats_consensus_shadow": ats_consensus_shadow,
        "story": story,
    }


def build_ats_consensus_shadow_signal(upcoming_row: dict) -> dict:
    models = upcoming_row.get("models") or {}
    participants = []
    for model in ATS_CONSENSUS_SHADOW_MODELS:
        prediction = models.get(model)
        if not isinstance(prediction, dict) or prediction.get("display_suppressed"):
            continue
        pick = prediction.get("spread_pick")
        edge = _to_float(prediction.get("spread_edge"))
        if pick not in {"home", "away"} or edge is None:
            continue
        participants.append({
            "model": model,
            "pick": pick,
            "edge": edge,
            "abs_edge": abs(edge),
        })

    pick_counts = Counter(item["pick"] for item in participants)
    if pick_counts:
        side, agree_count = pick_counts.most_common(1)[0]
        tied = list(pick_counts.values()).count(agree_count) > 1
    else:
        side, agree_count, tied = None, 0, False
    agreeing = [item for item in participants if item["pick"] == side]
    avg_edge = statistics.mean(item["abs_edge"] for item in agreeing) if agreeing else None
    qualified = (
        side is not None
        and not tied
        and len(participants) >= ATS_CONSENSUS_MIN_PARTICIPANTS
        and agree_count >= ATS_CONSENSUS_MIN_AGREE
        and avg_edge is not None
        and avg_edge >= ATS_CONSENSUS_MIN_AVG_EDGE
    )
    watch = (
        side is not None
        and not tied
        and len(participants) >= ATS_CONSENSUS_MIN_PARTICIPANTS
        and agree_count >= ATS_CONSENSUS_MIN_AGREE
        and not qualified
    )
    return {
        "name": "ATS Consensus Edge - Shadow",
        "status": "qualified_shadow" if qualified else "watch" if watch else "no_signal",
        "qualified": qualified,
        "market": "ATS",
        "side": side,
        "participants": len(participants),
        "agreement_count": agree_count,
        "min_participants": ATS_CONSENSUS_MIN_PARTICIPANTS,
        "min_agreement": ATS_CONSENSUS_MIN_AGREE,
        "average_agreeing_edge": avg_edge,
        "min_average_edge": ATS_CONSENSUS_MIN_AVG_EDGE,
        "models": participants,
        "disclaimer": "Shadow research signal only; not a betting recommendation.",
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


def _max_abs_gap(values: List[float], market_value: Optional[float]) -> Optional[float]:
    if market_value is None or not values:
        return None
    return max(abs(value - market_value) for value in values)


def _opportunity_summary(
    spread_gap: Optional[float],
    total_gap: Optional[float],
) -> Tuple[str, str, float]:
    spread_score = spread_gap if spread_gap is not None else 0.0
    total_score = total_gap if total_gap is not None else 0.0
    score = max(spread_score, total_score)
    if score >= 6:
        return "high", "High market divergence", score
    if score >= 3:
        return "moderate", "Explore market divergence", score
    if spread_gap is None and total_gap is None:
        return "none", "No market comparison", score
    return "low", "Market-tracking profile", score


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


def _normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def _residual_scale(values: List[float], fallback: float) -> float:
    finite = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    if len(finite) < 2:
        return fallback
    scale = statistics.pstdev(finite)
    return scale if scale > 0 else fallback


def model_residual_scales(
    games: List[dict],
    model_profile: str,
    seasons_to_test: int = 5,
) -> dict:
    """Estimate model-specific probability scales from historical residuals."""
    cache_key = (
        model_profile,
        seasons_to_test,
        _games_source_signature(),
        len(games),
        max((game.get("season", 0) for game in games), default=0),
    )
    if cache_key in _MODEL_RESIDUAL_SCALE_CACHE:
        return dict(_MODEL_RESIDUAL_SCALE_CACHE[cache_key])
    fallback_margin = 13.0
    fallback_total = 14.0
    try:
        _summary, records = run_backtest(
            games,
            seasons_to_test=seasons_to_test,
            spread_threshold=default_spread_threshold(model_profile),
            total_threshold=default_total_threshold(model_profile),
            model_profile=model_profile,
        )
    except Exception:
        records = []
    margin_errors = [
        row["actual_margin"] - row["pred_margin"]
        for row in records
        if row.get("actual_margin") is not None and row.get("pred_margin") is not None
    ]
    total_errors = [
        row["actual_total"] - row["pred_total"]
        for row in records
        if row.get("actual_total") is not None and row.get("pred_total") is not None
    ]
    scales = {
        "model": model_profile,
        "seasons": seasons_to_test,
        "games": len(records),
        "margin_residual_sd": _residual_scale(margin_errors, fallback_margin),
        "total_residual_sd": _residual_scale(total_errors, fallback_total),
        "fallback_used": len(margin_errors) < 2 or len(total_errors) < 2,
    }
    _MODEL_RESIDUAL_SCALE_CACHE[cache_key] = dict(scales)
    return scales


def _probability_from_edge(edge: Optional[float], scale: Optional[float]) -> Optional[float]:
    if edge is None or scale is None:
        return None
    try:
        edge_value = float(edge)
        scale_value = float(scale)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(edge_value) or not math.isfinite(scale_value) or scale_value <= 0:
        return None
    return _normal_cdf(edge_value / scale_value)


def _market_favorite_for_schedule(schedule: dict) -> dict:
    spread_line = schedule.get("spread_line")
    if spread_line is None:
        return {"team": None, "side": None, "display_spread": None}
    try:
        market_home_margin = float(spread_line)
    except (TypeError, ValueError):
        return {"team": None, "side": None, "display_spread": None}
    if market_home_margin > 0:
        return {"team": schedule.get("home_team"), "side": "home", "display_spread": -abs(market_home_margin)}
    if market_home_margin < 0:
        return {"team": schedule.get("away_team"), "side": "away", "display_spread": -abs(market_home_margin)}
    return {"team": None, "side": None, "display_spread": 0.0}


def experimental_market_probabilities(
    upcoming_payload: dict,
    games: List[dict],
    model_profiles: Tuple[str, ...],
    seasons_to_test: int = 5,
) -> dict:
    """Summarize current-week favorite ATS and total probabilities for selected models."""
    scale_by_model = {
        model: model_residual_scales(games, model, seasons_to_test)
        for model in model_profiles
    }
    rows = []
    for game in upcoming_payload.get("games", []) if isinstance(upcoming_payload, dict) else []:
        schedule = game.get("schedule") if isinstance(game, dict) else {}
        models = game.get("models") if isinstance(game, dict) else {}
        schedule = schedule if isinstance(schedule, dict) else {}
        models = models if isinstance(models, dict) else {}
        favorite = _market_favorite_for_schedule(schedule)
        market_home_margin = schedule.get("spread_line")
        market_total = schedule.get("total_line")
        for model in model_profiles:
            prediction = models.get(model) if isinstance(models.get(model), dict) else {}
            scales = scale_by_model.get(model, {})
            home_cover_probability = _probability_from_edge(
                prediction.get("spread_edge"),
                scales.get("margin_residual_sd"),
            )
            favorite_cover_probability = None
            if home_cover_probability is not None:
                favorite_cover_probability = (
                    home_cover_probability
                    if favorite.get("side") == "home"
                    else 1.0 - home_cover_probability
                    if favorite.get("side") == "away"
                    else None
                )
            over_probability = _probability_from_edge(
                prediction.get("total_edge"),
                scales.get("total_residual_sd"),
            )
            rows.append({
                "game_id": schedule.get("game_id"),
                "season": schedule.get("season"),
                "week": schedule.get("week"),
                "gameday": schedule.get("gameday"),
                "gametime": schedule.get("gametime"),
                "away_team": schedule.get("away_team"),
                "home_team": schedule.get("home_team"),
                "model": model,
                "eligible": prediction.get("eligible"),
                "display_suppressed": bool(prediction.get("display_suppressed")),
                "market_home_margin": market_home_margin,
                "market_total": market_total,
                "favorite_team": favorite.get("team"),
                "favorite_side": favorite.get("side"),
                "favorite_spread": favorite.get("display_spread"),
                "predicted_home_margin": prediction.get("pred_margin"),
                "predicted_total": prediction.get("pred_total"),
                "spread_edge": prediction.get("spread_edge"),
                "total_edge": prediction.get("total_edge"),
                "favorite_cover_probability": favorite_cover_probability,
                "over_probability": over_probability,
                "under_probability": 1.0 - over_probability if over_probability is not None else None,
                "probability_scales": scales,
                "availability_adjusted": bool(prediction.get("availability_adjusted")),
                "notes": prediction.get("model_notes") or [],
            })
    return {
        "schema_version": EXPERIMENTAL_PROBABILITY_SCHEMA_VERSION,
        "season": upcoming_payload.get("season") if isinstance(upcoming_payload, dict) else None,
        "week": upcoming_payload.get("week") if isinstance(upcoming_payload, dict) else None,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_generated_at": upcoming_payload.get("generated_at") if isinstance(upcoming_payload, dict) else None,
        "models": list(model_profiles),
        "scale_method": f"Normal CDF of model-market edge using each model's last {seasons_to_test} completed-season residual standard deviation.",
        "rows": rows,
    }


def _model_signal_story(
    *,
    away_team: Optional[str],
    home_team: Optional[str],
    market_margin: Optional[float],
    market_total: Optional[float],
    agreement_label: str,
    market_alignment_label: str,
    total_outlook_label: str,
    opportunity_label: str,
    spread_market_gap: Optional[float],
    total_market_gap: Optional[float],
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
    gap_parts = []
    if spread_market_gap is not None:
        gap_parts.append(f"largest spread gap is {spread_market_gap:.1f}")
    if total_market_gap is not None:
        gap_parts.append(f"largest total gap is {total_market_gap:.1f}")
    opportunity_text = f"{opportunity_label}"
    if gap_parts:
        opportunity_text += f" ({'; '.join(gap_parts)})"
    coverage_text = f"{model_count} models returned comparison values"
    if missing_count:
        coverage_text += f"; {missing_count} did not return a displayable output"
    return (
        f"{matchup}: {market_text} {total_text} "
        f"{coverage_text}. {agreement_label}. {market_alignment_label}; {total_outlook_label}. "
        f"{opportunity_text}. "
        f"Model count relative to the market favorite: {favorite_count} aligned, {underdog_count} opposite."
    )


def _write_pickle_cache(cache_path: str, payload) -> None:
    atomic_write_pickle(cache_path, payload)


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


def _prune_historical_model_cache(root: str, keep: int = 8) -> int:
    try:
        entries = [
            os.path.join(root, name)
            for name in os.listdir(root)
            if name.startswith("nfl_") and ("_historical_model_" in name or name.endswith(".tmp"))
        ]
    except OSError:
        return 0
    entries = [path for path in entries if os.path.isfile(path)]
    entries.sort(key=lambda path: os.path.getmtime(path), reverse=True)
    removed = 0
    for path in entries[max(0, keep):]:
        try:
            os.remove(path)
            removed += 1
        except OSError:
            pass
    return removed


def _prune_generated_nfl_cache(root: str, keep: int = 24, protected_paths: Tuple[str, ...] = ()) -> int:
    protected = {os.path.abspath(path) for path in protected_paths}
    generated_prefixes = (
        "nfl_history_",
        "nfl_weekly_performance",
        "nfl_backtest",
    )
    generated_markers = (
        "_historical_model_",
        ".checkpoint.",
        ".progress.",
    )
    try:
        entries = []
        for name in os.listdir(root):
            path = os.path.join(root, name)
            if os.path.abspath(path) in protected or not os.path.isfile(path):
                continue
            is_temporary = name.endswith(".tmp") or ".tmp." in name
            is_generated = (
                name.startswith(generated_prefixes)
                or any(marker in name for marker in generated_markers)
            )
            if is_temporary or is_generated:
                entries.append(path)
    except OSError:
        return 0

    entries.sort(key=lambda path: os.path.getmtime(path) if os.path.exists(path) else 0, reverse=True)
    removed = 0
    for path in entries[max(0, keep):]:
        try:
            os.remove(path)
            removed += 1
        except OSError:
            pass
    return removed


def _write_model_cache(cache_path: str, model) -> None:
    atomic_write_pickle(cache_path, model)


def _load_or_train_historical_model(games: List[dict], profile: str):
    if not games:
        return create_model(profile)

    cache_path = _historical_model_cache_path(profile, games)
    try:
        with open(cache_path, "rb") as source:
            return pickle.load(source)
    except (OSError, EOFError, AttributeError, pickle.PickleError, ValueError):
        model = train_model(games, profile)
        root = os.path.dirname(cache_path) or "."
        try:
            os.makedirs(root, exist_ok=True)
            _prune_historical_model_cache(root)
            _write_model_cache(cache_path, model)
        except OSError as error:
            if getattr(error, "errno", None) == errno.ENOSPC:
                _prune_historical_model_cache(root, keep=2)
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
        "schema_version": 4,
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
    atomic_write_json(cache_path, payload, separators=(",", ":"))


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
        "model_available": pred_margin is not None or pred_total is not None,
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
            rsm = rsm_rows.get(game.get("game_id"))
            row = _cacheable_matchup_row(
                game,
                RSM_PROFILE,
                False,
                _row_float(rsm, "roster_fair_home_margin") if rsm else None,
                None,
            )
            pairs.setdefault(_history_pair_key(game["away_team"], game["home_team"]), []).append(row)
        for pair_rows in pairs.values():
            pair_rows.sort(key=lambda row: (row["season"], row["week"], row.get("gameday") or ""))
        return pairs
    if model_profile == CURRENT_SEASON_MATRIX_PROFILE:
        seasons = sorted({int(game["season"]) for game in games})
        for row in _cs_matrix_flat_records(games, seasons, history_years=5):
            history_row = _cacheable_matchup_row(
                row,
                CURRENT_SEASON_MATRIX_PROFILE,
                True,
                row.get("pred_margin"),
                row.get("pred_total"),
            )
            pairs.setdefault(_history_pair_key(row["away_team"], row["home_team"]), []).append(history_row)
        for pair_rows in pairs.values():
            pair_rows.sort(key=lambda row: (row["season"], row["week"], row.get("gameday") or ""))
        return pairs

    model = create_model(model_profile)
    for game in games:
        eligible = True
        if model_profile == "rothstein_plus":
            eligible = is_rothstein_plus_eligible(model, game)

        try:
            pred_margin, pred_total = model.predict(game)
        except ValueError:
            pred_margin, pred_total = None, None
        row = _cacheable_matchup_row(game, model_profile, eligible, pred_margin, pred_total)
        pairs.setdefault(_history_pair_key(game["away_team"], game["home_team"]), []).append(row)
        if pred_margin is not None or pred_total is not None:
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


def current_nfl_schedule_week(rows: List[dict], season: Optional[int] = None, now: Optional[datetime] = None) -> int:
    if now is None:
        now = datetime.now(_nfl_week_rollover_zone())
    return _current_nfl_schedule_week(rows, season, now)


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

    NFL display weeks roll over at the configured Tuesday evening time. Once a week is active, the
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
        _set_upcoming_progress(95, "No upcoming games were found in the schedule feed; finalizing forecast cache.", status="computing", ready=False)
        return attach_model_signals(payload)

    current_season = max(game["season"] for game in games)
    current_season_games = [game for game in games if game["season"] == current_season]
    full_history_training = _upcoming_full_history_training_enabled()
    historical_games = [game for game in games if game["season"] < current_season] if full_history_training else current_season_games
    availability_adjustments = load_upcoming_availability_adjustments()
    total_model_steps = len(MODEL_PROFILES)
    total_game_steps = len(upcoming) * len(MODEL_PROFILES)
    progress_floor = 12
    progress_ceiling = 88
    fingerprint = _upcoming_build_fingerprint(games, upcoming, season, week)
    checkpoint_enabled = _upcoming_checkpoint_enabled()
    if not checkpoint_enabled:
        _clear_upcoming_checkpoint()
    checkpoint = _load_upcoming_checkpoint(fingerprint) if checkpoint_enabled else None

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
            if _is_rsm_family(model):
                trained_models[model] = create_model(model)
            elif model in {"rothstein", "rothstein_plus"}:
                # These profiles intentionally model only the current season.
                trained_models[model] = train_model(current_season_games, model)
            else:
                if full_history_training:
                    trained_models[model] = _load_or_train_historical_model(historical_games, model)
                    for game in current_season_games:
                        predicted_margin, predicted_total = trained_models[model].predict(game)
                        trained_models[model].update(game, predicted_margin, predicted_total)
                else:
                    trained_models[model] = train_model(current_season_games, model)
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
        row = rows_by_game_id.setdefault(scheduled["game_id"], {"schedule": scheduled, "models": {}, "static_models": {}})
        models = row["models"]
        static_models = row.setdefault("static_models", {})
        if not static_models and models:
            static_models.update(copy.deepcopy(models))
        for model_index, model in enumerate(MODEL_PROFILES):
            step_index = (game_index * len(MODEL_PROFILES)) + model_index
            if step_index < resume_step and model in models and model in static_models:
                continue
            completion = progress_floor + 30 + ((step_index + 1) / max(1, total_game_steps)) * (progress_ceiling - progress_floor - 30)
            _set_upcoming_progress(
                int(completion),
                f"Scoring {scheduled['away_team']} at {scheduled['home_team']} with {model} "
                f"(game {game_index + 1}/{len(upcoming)}, step {step_index + 1}/{total_game_steps}).",
                status="computing",
                ready=False,
            )
            prediction = predict_upcoming_with_trained_model(scheduled, model, trained_models[model])
            static_models[model] = prediction
            models[model] = apply_upcoming_availability_adjustments(prediction, scheduled, availability_adjustments)
            if checkpoint_enabled:
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
    _set_upcoming_progress(95, "Forecast scored; finalizing forecast cache.", status="computing", ready=False)
    return attach_model_signals(payload)


def _write_upcoming_prediction_cache(cache_path: str, payload: dict) -> None:
    root = os.path.dirname(cache_path) or "."
    os.makedirs(root, exist_ok=True)
    _prune_generated_nfl_cache(root, protected_paths=(cache_path,))
    try:
        _write_json_cache(cache_path, payload)
    except OSError as error:
        if getattr(error, "errno", None) != errno.ENOSPC:
            raise
        _prune_generated_nfl_cache(root, keep=0, protected_paths=(cache_path,))
        _write_json_cache(cache_path, payload)


_UPCOMING_SCORE_REFRESH_STABLE_FIELDS = (
    "game_id", "season", "week", "gameday", "gametime", "away_team", "home_team",
    "spread_line", "total_line", "away_rest", "home_rest", "div_game", "roof",
    "temp", "wind",
)


def _schedule_values_match(left, right) -> bool:
    if isinstance(left, float) or isinstance(right, float):
        if left is None or right is None:
            return left is None and right is None
        return math.isclose(float(left), float(right), rel_tol=0.0, abs_tol=1e-9)
    return left == right


def refresh_upcoming_final_scores_in_cache() -> dict:
    """Update final-score fields in the existing upcoming cache without rerunning models."""
    cache_path = upcoming_prediction_cache_path()
    with _UPCOMING_PREDICTION_LOCK:
        try:
            with open(cache_path, encoding="utf-8") as source:
                payload = json.load(source)
        except (OSError, json.JSONDecodeError):
            return {
                "success": False,
                "updated_games": 0,
                "reason": "upcoming cache is missing or malformed",
                "requires_full_rebuild": True,
            }

        if not _has_valid_upcoming_games(payload):
            return {
                "success": False,
                "updated_games": 0,
                "reason": "upcoming cache has no valid games",
                "requires_full_rebuild": True,
            }

        season = payload.get("season")
        week = payload.get("week")
        current_schedule = {
            game.get("game_id"): game
            for game in load_upcoming_games(season, week)
            if game.get("game_id")
        }
        if not current_schedule:
            return {
                "success": False,
                "updated_games": 0,
                "season": season,
                "week": week,
                "reason": "no matching active-week games found in refreshed source",
                "requires_full_rebuild": True,
            }

        updated_games = 0
        unsafe_games = []
        for game in payload.get("games", []):
            schedule = game.get("schedule") or {}
            game_id = schedule.get("game_id")
            refreshed = current_schedule.get(game_id)
            if not refreshed:
                unsafe_games.append(game_id or f"{schedule.get('away_team')}@{schedule.get('home_team')}")
                continue

            stable_changed = any(
                not _schedule_values_match(schedule.get(field), refreshed.get(field))
                for field in _UPCOMING_SCORE_REFRESH_STABLE_FIELDS
            )
            if stable_changed:
                unsafe_games.append(game_id)
                continue

            changed = False
            for field in ("away_score", "home_score", "is_completed"):
                if schedule.get(field) != refreshed.get(field):
                    schedule[field] = refreshed.get(field)
                    changed = True
            if changed:
                updated_games += 1

        refreshed_at = datetime.now(timezone.utc).isoformat()
        payload["final_scores_refreshed_at"] = refreshed_at
        payload["final_score_refresh_source"] = GAMES_URL
        payload["final_score_refresh_updated_games"] = updated_games
        payload["final_score_refresh_requires_full_rebuild"] = bool(unsafe_games)
        if unsafe_games:
            payload["final_score_refresh_unsafe_games"] = unsafe_games
        else:
            payload.pop("final_score_refresh_unsafe_games", None)
            payload["games_source_signature"] = _games_source_signature()

        _write_upcoming_prediction_cache(cache_path, payload)
        return {
            "success": True,
            "updated_games": updated_games,
            "season": season,
            "week": week,
            "refreshed_at": refreshed_at,
            "requires_full_rebuild": bool(unsafe_games),
            "unsafe_games": unsafe_games,
        }


def _set_upcoming_progress(progress: int, message: str, *, status: str = "computing", ready: bool = False, allow_backward: bool = False) -> dict:
    global _UPCOMING_PROGRESS_STATE
    progress_path = _upcoming_progress_path()
    normalized_progress = max(0, min(100, int(progress)))
    previous = None
    try:
        with open(progress_path, encoding="utf-8") as source:
            loaded = json.load(source)
        previous = loaded if isinstance(loaded, dict) else None
    except (OSError, json.JSONDecodeError):
        previous = None

    previous_updated_at = _parse_progress_timestamp(previous.get("updated_at")) if previous else None
    previous_is_fresh = (
        previous_updated_at is not None
        and (datetime.now(timezone.utc) - previous_updated_at).total_seconds() <= 10 * 60
    )
    if (
        previous
        and previous.get("status") == "computing"
        and status == "computing"
        and not allow_backward
        and previous_is_fresh
        and int(previous.get("progress", 0) or 0) >= normalized_progress
    ):
        _UPCOMING_PROGRESS_STATE = dict(previous)
        return dict(_UPCOMING_PROGRESS_STATE)

    next_state = {
        "status": status,
        "ready": ready,
        "progress": normalized_progress,
        "message": message,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
    }
    _UPCOMING_PROGRESS_STATE = next_state
    try:
        os.makedirs(os.path.dirname(progress_path) or ".", exist_ok=True)
        _write_json_cache(progress_path, next_state)
    except OSError:
        pass
    return dict(_UPCOMING_PROGRESS_STATE)


def _parse_progress_timestamp(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def upcoming_prediction_status_snapshot() -> dict:
    try:
        with open(_upcoming_progress_path(), encoding="utf-8") as source:
            payload = json.load(source)
        if isinstance(payload, dict) and payload.get("status"):
            if payload.get("status") == "computing":
                updated_at = _parse_progress_timestamp(payload.get("updated_at"))
                if updated_at is not None and (datetime.now(timezone.utc) - updated_at).total_seconds() > 10 * 60:
                    stale = dict(payload)
                    stale["status"] = "failed"
                    stale["ready"] = False
                    stale["message"] = "Forecast generation stalled before completion. Please refresh to restart the rebuild."
                    return stale
            return payload
    except (OSError, json.JSONDecodeError):
        pass
    return dict(_UPCOMING_PROGRESS_STATE)


def _recent_upcoming_refresh_in_progress(max_age_seconds: int = 10 * 60) -> bool:
    progress = upcoming_prediction_status_snapshot()
    if progress.get("status") != "computing":
        return False
    progress_pid = progress.get("pid")
    if progress_pid is None:
        return False
    try:
        progress_pid = int(progress_pid)
        if progress_pid == os.getpid() and not _UPCOMING_REFRESH_RUNNING:
            return False
        if progress_pid != os.getpid():
            try:
                os.kill(progress_pid, 0)
            except OSError:
                return False
    except (TypeError, ValueError):
        return False
    updated_at = _parse_progress_timestamp(progress.get("updated_at"))
    if updated_at is None:
        return True
    return (datetime.now(timezone.utc) - updated_at).total_seconds() <= max_age_seconds


def _schedule_upcoming_prediction_refresh(games: List[dict], season: Optional[int], week: Optional[int]) -> bool:
    global _UPCOMING_REFRESH_RUNNING
    with _UPCOMING_PREDICTION_LOCK:
        if _UPCOMING_REFRESH_RUNNING:
            return True
        if _recent_upcoming_refresh_in_progress():
            return True
        _UPCOMING_REFRESH_RUNNING = True

    _set_upcoming_progress(10, "Scheduling the forecast refresh and preparing the weekly model run.", status="computing", ready=False, allow_backward=True)

    def _refresh_worker() -> None:
        try:
            payload = _build_upcoming_prediction_cache(games, season, week)
            _write_upcoming_prediction_cache(upcoming_prediction_cache_path(), payload)
            _clear_upcoming_checkpoint()
            _set_upcoming_progress(100, "Forecast complete. The board is ready to view.", status="ready", ready=True)
        except Exception:
            _set_upcoming_progress(0, f"The forecast refresh failed for season={season} week={week}. Please try again shortly.", status="failed", ready=False)
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
    return _has_displayable_upcoming_games(payload)


def _has_displayable_upcoming_games(payload: dict) -> bool:
    games = payload.get("games")
    if not isinstance(games, list) or not games:
        return False
    required_schedule_fields = {"away_team", "home_team", "season", "week"}
    for game in games:
        schedule = game.get("schedule") if isinstance(game, dict) else None
        models = game.get("models") if isinstance(game, dict) else None
        if not isinstance(schedule, dict) or not required_schedule_fields.issubset(schedule):
            return False
        if not isinstance(models, dict) or not any(model in models for model in MODEL_PROFILES):
            return False
    return True


def _has_all_upcoming_models(payload: dict) -> bool:
    games = payload.get("games")
    if not isinstance(games, list) or not games:
        return False
    for game in games:
        models = game.get("models") if isinstance(game, dict) else None
        if not isinstance(models, dict) or any(model not in models for model in MODEL_PROFILES):
            return False
    return True


def _upcoming_response(payload: dict, **overrides) -> dict:
    response = {**payload, **overrides}
    return attach_model_signals(response)


def _prediction_value(prediction: Optional[dict], field: str):
    if not isinstance(prediction, dict) or prediction.get("display_suppressed"):
        return None
    return prediction.get(field)


def _prediction_delta(active: Optional[dict], static: Optional[dict], field: str) -> Optional[float]:
    active_value = _prediction_value(active, field)
    static_value = _prediction_value(static, field)
    if active_value is None or static_value is None:
        return None
    return float(active_value) - float(static_value)


def _pick_changed(active: Optional[dict], static: Optional[dict], field: str) -> bool:
    active_pick = _prediction_value(active, field)
    static_pick = _prediction_value(static, field)
    return active_pick is not None and static_pick is not None and active_pick != static_pick


def _game_adjustment_details(game: dict) -> List[dict]:
    details = []
    for prediction in (game.get("models") or {}).values():
        for adjustment in prediction.get("availability_adjustments") or [] if isinstance(prediction, dict) else []:
            key = (
                adjustment.get("team"),
                adjustment.get("margin_delta"),
                adjustment.get("total_delta"),
                adjustment.get("label"),
                adjustment.get("source"),
            )
            if key not in {
                (
                    existing.get("team"),
                    existing.get("margin_delta"),
                    existing.get("total_delta"),
                    existing.get("label"),
                    existing.get("source"),
                )
                for existing in details
            }:
                details.append(dict(adjustment))
    return details


def _upcoming_roster_comparison_rows(payload: dict) -> List[dict]:
    rows = []
    for game in payload.get("games") or []:
        schedule = game.get("schedule") or {}
        active_models = game.get("models") or {}
        static_models = game.get("static_models") or {}
        adjustments = _game_adjustment_details(game)
        for model in MODEL_PROFILES:
            active = active_models.get(model)
            static = static_models.get(model)
            rows.append({
                "matchup": f"{schedule.get('away_team', '')} at {schedule.get('home_team', '')}".strip(),
                "game_id": schedule.get("game_id"),
                "schedule": schedule,
                "model": model,
                "static_margin": _prediction_value(static, "pred_margin"),
                "active_margin": _prediction_value(active, "pred_margin"),
                "margin_delta": _prediction_delta(active, static, "pred_margin"),
                "static_total": _prediction_value(static, "pred_total"),
                "active_total": _prediction_value(active, "pred_total"),
                "total_delta": _prediction_delta(active, static, "pred_total"),
                "static_ats_pick": _prediction_value(static, "spread_pick"),
                "active_ats_pick": _prediction_value(active, "spread_pick"),
                "ats_pick_changed": _pick_changed(active, static, "spread_pick"),
                "static_ou_pick": _prediction_value(static, "total_pick"),
                "active_ou_pick": _prediction_value(active, "total_pick"),
                "ou_pick_changed": _pick_changed(active, static, "total_pick"),
                "adjustments": adjustments,
            })
    return rows


def upcoming_predictions_for_roster_basis(payload: dict, roster_basis: str = "active") -> dict:
    basis = (roster_basis or "active").strip().lower()
    if basis not in {"static", "active", "comparison"}:
        raise ValueError("roster_basis must be one of: static, active, comparison")

    response = copy.deepcopy(payload)
    season = response.get("season")
    week = response.get("week")
    adjustment_count = upcoming_availability_adjustment_count(season, week)
    response["roster_basis"] = basis
    response["availability_adjustment_count"] = adjustment_count
    response["availability_adjustments_signature"] = _availability_adjustments_signature()

    if response.get("ready") is False and not response.get("games"):
        response["availability_adjustments_applied"] = False
        if basis == "comparison":
            response["comparison_rows"] = []
        return response

    if basis == "static":
        for game in response.get("games") or []:
            if isinstance(game, dict) and isinstance(game.get("static_models"), dict):
                game["models"] = copy.deepcopy(game["static_models"])
        response["availability_adjustments_applied"] = False
        response["message"] = "Forecast ready with pregame static roster projections."
        return attach_model_signals(response)

    if basis == "comparison":
        response["availability_adjustments_applied"] = adjustment_count > 0
        response["comparison_rows"] = _upcoming_roster_comparison_rows(response)
        response["message"] = "Forecast ready with static vs known active roster comparison."
        return response

    response["availability_adjustments_applied"] = True
    response["message"] = "Forecast ready with approved roster/inactive adjustments applied."
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
                and _has_all_upcoming_models(cached)
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
                        progress=progress_state.get("progress", 10) if refresh_scheduled else 100,
                        message=(
                            progress_state.get("message")
                            or f"Showing the last valid forecast for season {cached.get('season')}, week {cached.get('week')} "
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
                if not force and same_target and _has_valid_upcoming_games(cached) and cached.get("prediction_schema_version") == UPCOMING_PREDICTION_SCHEMA_VERSION and _has_all_upcoming_models(cached) and cached.get("games_source_signature") == _games_source_signature() and cached.get("availability_adjustments_signature") == _availability_adjustments_signature():
                    cache_age = max(0.0, time.time() - os.path.getmtime(cache_path))
                    return _upcoming_response(cached, cache_hit=True, cache_age_seconds=cache_age, cache_ttl_seconds=ttl_seconds, refresh_scheduled=False, status="ready", ready=True, progress=100, message="Forecast ready.")
            except (OSError, json.JSONDecodeError):
                pass

        payload = _build_upcoming_prediction_cache(games, target_season, target_week)
        _write_upcoming_prediction_cache(cache_path, payload)
        _clear_upcoming_checkpoint()
        _set_upcoming_progress(100, "Forecast complete. The board is ready to view.", status="ready", ready=True)
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


@dataclass
class CurrentSeasonMatrixNFLModel:
    """Current-season opponent-adjusted model with market lines as context."""

    mean_total: float = 44.0
    total_games: int = 0
    hfa_margin: float = 1.4
    hfa_points: float = 0.7
    market_margin_weight: float = 0.28
    market_total_weight: float = 0.22
    opponent_weight: float = 0.36
    max_iterations: int = 16
    convergence_tolerance: float = 0.001
    completed_games: List[dict] = field(default_factory=list)
    teams: Dict[str, TeamState] = field(default_factory=dict)
    last_iterations: int = 0
    last_converged: bool = True
    last_max_delta: float = 0.0
    _last_refresh_key: Optional[Tuple[int, int]] = None

    def team(self, abbr: str) -> TeamState:
        if abbr not in self.teams:
            self.teams[abbr] = TeamState()
        return self.teams[abbr]

    def _team_margin(self, game: dict, team: str) -> float:
        margin = float(game["actual_margin"])
        return margin if team == game["home_team"] else -margin

    def _team_market_margin(self, game: dict, team: str) -> float:
        spread = _to_float(game.get("spread_line"))
        if spread is None:
            return 0.0
        return spread if team == game["home_team"] else -spread

    def _team_points(self, game: dict, team: str) -> Tuple[float, float]:
        if team == game["home_team"]:
            return float(game["home_score"]), float(game["away_score"])
        return float(game["away_score"]), float(game["home_score"])

    def _prior_metrics(self, team: str, season: int) -> dict:
        rows = [game for game in self.completed_games if int(game.get("season", 0)) < season and team in {game.get("away_team"), game.get("home_team")}]
        if not rows:
            return {"strength": 0.0, "offense": 0.0, "defense_allowed": 0.0, "games": 0}
        weighted_strength = 0.0
        weighted_offense = 0.0
        weighted_defense = 0.0
        total_weight = 0.0
        league_team_points = self.mean_total / 2
        for game in rows:
            age = max(1, season - int(game.get("season", season - 1)))
            weight = 1.0 / age
            margin = self._team_margin(game, team)
            market_perf = margin - self._team_market_margin(game, team)
            points_for, points_against = self._team_points(game, team)
            weighted_strength += weight * (0.45 * margin + 0.25 * market_perf)
            weighted_offense += weight * (points_for - league_team_points)
            weighted_defense += weight * (points_against - league_team_points)
            total_weight += weight
        return {
            "strength": _bounded(weighted_strength / total_weight, -12.0, 12.0),
            "offense": _bounded(weighted_offense / total_weight, -10.0, 10.0),
            "defense_allowed": _bounded(weighted_defense / total_weight, -10.0, 10.0),
            "games": len(rows),
        }

    def _current_rows(self, season: int) -> List[dict]:
        return [game for game in self.completed_games if int(game.get("season", 0)) == season]

    def _season_teams(self, rows: List[dict], season: int) -> List[str]:
        teams = set(self.teams)
        for game in rows:
            teams.add(game["away_team"])
            teams.add(game["home_team"])
        for game in self.completed_games:
            if int(game.get("season", 0)) < season:
                teams.add(game["away_team"])
                teams.add(game["home_team"])
        return sorted(teams)

    def _rows_by_team(self, rows: List[dict]) -> Dict[str, List[dict]]:
        by_team: Dict[str, List[dict]] = {}
        for game in rows:
            by_team.setdefault(game["away_team"], []).append(game)
            by_team.setdefault(game["home_team"], []).append(game)
        return by_team

    def _refresh_team_states(self, season: int) -> None:
        rows = self._current_rows(season)
        refresh_key = (season, len(rows))
        if self._last_refresh_key == refresh_key:
            return
        teams = self._season_teams(rows, season)
        if not teams:
            return
        rows_by_team = self._rows_by_team(rows)
        priors = {team: self._prior_metrics(team, season) for team in teams}
        ratings = {team: priors[team]["strength"] for team in teams}
        league_team_points = self.mean_total / 2
        self.last_converged = False
        self.last_iterations = 0
        self.last_max_delta = 0.0

        for iteration in range(1, self.max_iterations + 1):
            next_ratings = {}
            max_delta = 0.0
            for team in teams:
                team_rows = rows_by_team.get(team, [])
                prior = priors[team]
                if not team_rows:
                    next_ratings[team] = prior["strength"]
                    continue
                wins = 0
                margins = []
                market_performances = []
                opponent_ratings = []
                for game in team_rows:
                    margin = self._team_margin(game, team)
                    opponent = game["away_team"] if team == game["home_team"] else game["home_team"]
                    wins += 1 if margin > 0 else 0
                    margins.append(margin)
                    market_performances.append(margin - self._team_market_margin(game, team))
                    opponent_ratings.append(ratings.get(opponent, priors.get(opponent, {}).get("strength", 0.0)))
                games_played = len(team_rows)
                record_score = ((wins / games_played) - 0.5) * 12.0
                raw_strength = (
                    record_score
                    + 0.34 * statistics.mean(margins)
                    + 0.24 * statistics.mean(market_performances)
                    + self.opponent_weight * statistics.mean(opponent_ratings)
                )
                prior_weight = max(0.18, min(0.65, 1.0 / (games_played + 1)))
                next_value = _bounded(prior_weight * prior["strength"] + (1.0 - prior_weight) * raw_strength, -18.0, 18.0)
                next_ratings[team] = next_value
                max_delta = max(max_delta, abs(next_value - ratings.get(team, 0.0)))
            ratings = next_ratings
            self.last_iterations = iteration
            self.last_max_delta = max_delta
            if max_delta <= self.convergence_tolerance:
                self.last_converged = True
                break

        for team in teams:
            team_rows = rows_by_team.get(team, [])
            prior = priors[team]
            state = self.team(team)
            state.margin_rating = ratings.get(team, prior["strength"])
            state.home_margin_rating = state.margin_rating
            state.away_margin_rating = state.margin_rating
            state.games = len(team_rows)
            if team_rows:
                points_for = []
                points_against = []
                recent_margins = []
                recent_totals = []
                for game in sorted(team_rows, key=lambda row: (int(row.get("week", 0)), row.get("gameday") or "", row.get("game_id") or "")):
                    pf, pa = self._team_points(game, team)
                    points_for.append(pf)
                    points_against.append(pa)
                    recent_margins.append(self._team_margin(game, team))
                    recent_totals.append(float(game["actual_total"]))
                games_played = len(team_rows)
                prior_weight = max(0.18, min(0.65, 1.0 / (games_played + 1)))
                state.offense = prior_weight * prior["offense"] + (1.0 - prior_weight) * (statistics.mean(points_for) - league_team_points)
                state.defense_allowed = prior_weight * prior["defense_allowed"] + (1.0 - prior_weight) * (statistics.mean(points_against) - league_team_points)
                state.recent_margins = recent_margins[-4:]
                state.recent_totals = recent_totals[-4:]
                state.recent_points_for = points_for[-4:]
                state.recent_points_allowed = points_against[-4:]
            else:
                state.offense = prior["offense"]
                state.defense_allowed = prior["defense_allowed"]
                state.recent_margins = []
                state.recent_totals = []
                state.recent_points_for = []
                state.recent_points_allowed = []
        self._last_refresh_key = refresh_key

    def predict(self, game: dict) -> Tuple[float, float]:
        season = int(game["season"])
        self._refresh_team_states(season)
        away = self.team(game["away_team"])
        home = self.team(game["home_team"])
        rest_diff = float(game.get("home_rest", 7.0) or 7.0) - float(game.get("away_rest", 7.0) or 7.0)
        div_adjustment = -0.25 if game.get("div_game") else 0.0
        model_margin = self.hfa_margin + home.margin_rating - away.margin_rating + 0.04 * rest_diff + div_adjustment
        market_margin = _to_float(game.get("spread_line"))
        if market_margin is not None:
            predicted_margin = market_margin + (1.0 - self.market_margin_weight) * (model_margin - market_margin)
        else:
            predicted_margin = model_margin

        model_total = self.mean_total + home.offense + away.offense + home.defense_allowed + away.defense_allowed
        total_line = _to_float(game.get("total_line"))
        if total_line is not None:
            predicted_total = total_line + (1.0 - self.market_total_weight) * (model_total - total_line)
        else:
            predicted_total = model_total
        return predicted_margin, _bounded(predicted_total, 30.0, 62.0)

    def update(self, game: dict, predicted_margin: float, predicted_total: float) -> None:
        self.completed_games.append(dict(game))
        self.total_games += 1
        actual_total = _to_float(game.get("actual_total"))
        if actual_total is not None:
            self.mean_total += 0.01 * (actual_total - self.mean_total)
        self._last_refresh_key = None

    def fit_completed_games(self, games: List[dict]) -> None:
        self.completed_games = []
        self.teams = {}
        self.mean_total = 44.0
        self.total_games = 0
        self._last_refresh_key = None
        for game in games:
            self.completed_games.append(dict(game))
            self.total_games += 1
            actual_total = _to_float(game.get("actual_total"))
            if actual_total is not None:
                self.mean_total += 0.01 * (actual_total - self.mean_total)
        self.finalize_training()

    def finalize_training(self) -> None:
        if self.completed_games:
            self._refresh_team_states(max(int(game["season"]) for game in self.completed_games))

    def model_notes(self, game: dict) -> List[str]:
        season = int(game["season"])
        current_games = [row for row in self._current_rows(season) if game.get("away_team") in {row.get("away_team"), row.get("home_team")} or game.get("home_team") in {row.get("away_team"), row.get("home_team")}]
        notes = [
            "Current Season Matrix uses completed current-season games, opponent-adjusted iterative ratings, and market spread/total context.",
        ]
        if not current_games:
            notes.append("Week 1/zero current-season sample: using historical priors and league baseline until completed games are available.")
        elif len(current_games) < 6:
            notes.append("Early-season sample is small, so ratings are more volatile.")
        notes.append(f"Strength matrix {'converged' if self.last_converged else 'stopped at max iterations'} after {self.last_iterations} iterations.")
        return notes


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


def _rsm_plus_signal(feature_value: float, weight: float) -> float:
    return weight * math.tanh(float(feature_value) / 8.0)


def _rsm_plus_explanation(label: str, value: float, home_team: str, away_team: str) -> Optional[str]:
    if abs(value) < 2.0:
        return None
    favored = home_team if value > 0 else away_team
    if label == "qb_pressure":
        return f"QB/pass-rush matchup favors {favored}; opposing pressure risk is the primary mismatch flag."
    if label == "qb_coverage":
        return f"QB vs coverage/secondary matchup favors {favored}."
    if label == "ol_pass":
        return f"Offensive line pass-protection vs pass-rush matchup favors {favored}."
    if label == "ol_run":
        return f"Offensive line run-game vs front-seven matchup favors {favored}."
    if label == "receiving":
        return f"Receiving/TE group vs opponent secondary matchup favors {favored}."
    if label == "rushing":
        return f"Rushing/RB group vs opponent front seven matchup favors {favored}."
    if label == "weakest_coverage":
        return f"Weakest-link coverage comparison favors {favored}."
    return f"Unit mismatch favors {favored}."


def _rsm_plus_matchup_layer(details: dict, game: dict) -> dict:
    features = details.get("features") or {}
    signals = [
        ("qb_pressure", "qb_vs_pass_rush_matchup", 0.35),
        ("qb_coverage", "qb_vs_coverage_matchup", 0.25),
        ("ol_pass", "ol_pass_vs_pass_rush_matchup", 0.30),
        ("ol_run", "ol_run_vs_front_matchup", 0.20),
        ("receiving", "receiving_vs_secondary_matchup", 0.30),
        ("rushing", "rushing_vs_front_matchup", 0.15),
        ("weakest_coverage", "weakest_coverage_diff", 0.15),
        ("receiving", "te1_diff", 0.10),
        ("receiving", "wr1_diff", 0.08),
        ("receiving", "wr2_diff", 0.08),
        ("ol_pass", "ol_weakest_diff", 0.10),
        ("qb_pressure", "pass_rusher1_diff", 0.10),
    ]
    raw_adjustment = 0.0
    explanations = []
    contributions = []
    for label, feature_name, weight in signals:
        value = _to_float(features.get(feature_name))
        if value is None:
            continue
        contribution = _rsm_plus_signal(value, weight)
        raw_adjustment += contribution
        contributions.append({
            "label": label,
            "feature": feature_name,
            "value": value,
            "contribution": contribution,
        })
        explanation = _rsm_plus_explanation(label, value, game["home_team"], game["away_team"])
        if explanation and explanation not in explanations:
            explanations.append(explanation)

    adjustment = _bounded(raw_adjustment, -2.5, 2.5)
    notes = [
        "RSM+ is experimental and additive; it leaves the frozen RSM model unchanged.",
        "RSM+ uses coarse unit-vs-unit roster mismatch features, not verified player-vs-player speed, route, alignment, or coverage assignments.",
        "RSM+ margin adjustment is conservatively capped at +/- 2.5 points and is not tuned for ATS or O/U performance.",
    ]
    if not explanations:
        explanations.append("No strong unit-mismatch flag exceeded the conservative display threshold.")
    return {
        "base_rsm_margin": details["predicted_margin"],
        "matchup_adjustment": adjustment,
        "raw_matchup_adjustment": raw_adjustment,
        "matchup_explanations": explanations[:6],
        "matchup_contributions": sorted(contributions, key=lambda item: abs(item["contribution"]), reverse=True)[:8],
        "data_confidence": "LOW",
        "model_notes": notes,
    }


@dataclass
class RsmPlusMatchupModel:
    """Experimental RSM+ adapter: frozen RSM plus bounded unit-mismatch layer."""

    base_model: RsmStage7CComparisonModel = field(default_factory=RsmStage7CComparisonModel)

    def prediction_details(self, game: dict) -> dict:
        details = dict(self.base_model.prediction_details(game))
        layer = _rsm_plus_matchup_layer(details, game)
        details.update(layer)
        details["predicted_margin"] = details["predicted_margin"] + layer["matchup_adjustment"]
        details["lineup_confidence"] = layer["data_confidence"]
        details["model_version"] = "RSM+ experimental unit-mismatch layer v0.1"
        return details

    def predict(self, game: dict) -> Tuple[float, Optional[float]]:
        details = self.prediction_details(game)
        return details["predicted_margin"], details["predicted_total"]

    def update(self, game: dict, predicted_margin: float, predicted_total: Optional[float]) -> None:
        return None


def _is_rsm_family(model_profile: str) -> bool:
    return model_profile in {RSM_PROFILE, RSM_PLUS_PROFILE}


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
    if profile == CURRENT_SEASON_MATRIX_PROFILE:
        return CurrentSeasonMatrixNFLModel()
    if profile in {"rothstein", "rothstein_plus"}:
        return RothsteinNFLModel()
    if profile == RSM_PROFILE:
        return RsmStage7CComparisonModel()
    if profile == RSM_PLUS_PROFILE:
        return RsmPlusMatchupModel()
    raise ValueError(f"Unknown model profile: {profile}")


def default_spread_threshold(model_profile: str) -> float:
    if _is_rsm_family(model_profile):
        # Presentation-only: every nonzero frozen-margin/market disagreement
        # receives a directional ATS projection. This is deliberately separate
        # from the frozen Stage 7C anomaly thresholds and never affects its
        # research ledger or eligibility rules.
        return 0.0
    if model_profile in {"rothstein", "rothstein_plus"}:
        return 2.0
    if model_profile == MEAN_REVERSION_PROFILE:
        return 4.0
    if model_profile == CURRENT_SEASON_MATRIX_PROFILE:
        return 3.0
    if model_profile == "market_blend":
        return 3.0
    return 6.0


def default_total_threshold(model_profile: str) -> float:
    if _is_rsm_family(model_profile):
        return 999.0
    if model_profile in {"rothstein", "rothstein_plus"}:
        return 4.0
    if model_profile == MEAN_REVERSION_PROFILE:
        return 2.0
    if model_profile == CURRENT_SEASON_MATRIX_PROFILE:
        return 2.0
    return 1.5


def model_supports_totals(model_profile: str) -> bool:
    return model_profile not in {"rothstein_plus", RSM_PROFILE, RSM_PLUS_PROFILE}


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


def _current_season_matrix_training_games(
    games: List[dict],
    target_season: Optional[int] = None,
    history_years: int = 5,
) -> List[dict]:
    if not games:
        return []
    if target_season is None:
        target_season = max(int(game["season"]) for game in games)
    history_floor = target_season - history_years
    return [
        game for game in games
        if history_floor <= int(game.get("season", 0)) <= target_season
    ]


def train_model(games: List[dict], model_profile: str = "baseline") -> OnlineNFLModel:
    model = create_model(model_profile)
    if model_profile == CURRENT_SEASON_MATRIX_PROFILE:
        model.fit_completed_games(games)
        return model
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
    if model_profile == CURRENT_SEASON_MATRIX_PROFILE:
        return current_season_matrix_dashboard_snapshot(games, playoff_mode, injury_team, injury_impact, injury_position)

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


def current_season_matrix_dashboard_snapshot(
    games: List[dict],
    playoff_mode: bool = False,
    injury_team: Optional[str] = None,
    injury_impact: float = 0.0,
    injury_position: str = "general",
) -> dict:
    latest_season = max(game["season"] for game in games)
    season_games = [game for game in games if game["season"] == latest_season]
    completed_week = max(game["week"] for game in season_games)
    model = CurrentSeasonMatrixNFLModel()
    model.fit_completed_games(_current_season_matrix_training_games(games, latest_season, history_years=5))
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
        league_team_points = model.mean_total / 2
        expected_points = max(12.0, min(38.0, league_team_points + state.offense - state.defense_allowed * 0.20))
        expected_allowed = max(12.0, min(38.0, league_team_points + state.defense_allowed - state.offense * 0.12))
        expected_point_edge = expected_points - expected_allowed
        stability = min(1.0, state.games / max(1, completed_week))
        injury_adjustment = injury_impact if injury_team == team else 0.0
        if injury_adjustment:
            expected_points = max(8.0, expected_points - injury_adjustment * injury_profile["offense_factor"])
            expected_allowed = min(42.0, expected_allowed + injury_adjustment * injury_profile["allowed_factor"])
            expected_point_edge = expected_points - expected_allowed
        if playoff_mode:
            strength = state.margin_rating * 0.82 + recent_margin * 0.85 + expected_point_edge * 0.40 + stability * 0.45
        else:
            strength = state.margin_rating + 0.42 * recent_margin + 0.18 * (state.offense - state.defense_allowed)
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
    if rows:
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
                playoff_odds = 0.04 + 0.58 * normalized + 0.20 * recent_factor + 0.12 * edge_factor + 0.06 * row["stability"]
            else:
                playoff_odds = 0.08 + 0.78 * normalized + 0.1 * rank_factor + 0.04 * recent_factor
            row["rank"] = index
            row["playoff_odds"] = max(0.02, min(0.98, playoff_odds))

    return {
        "season": latest_season,
        "completed_week": completed_week,
        "model": CURRENT_SEASON_MATRIX_PROFILE,
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
            "CS Matrix current-season ratings",
            "Opponent-adjusted iterative strength",
            "Market-line context included",
            "Early-season sample can be volatile",
        ],
        "league": {
            "average_expected_points": statistics.mean(row["expected_points"] for row in rows) if rows else None,
            "average_expected_allowed": statistics.mean(row["expected_allowed"] for row in rows) if rows else None,
            "average_neutral_win_probability": statistics.mean(row["neutral_win_probability"] for row in rows) if rows else None,
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
    if model_profile == CURRENT_SEASON_MATRIX_PROFILE:
        selected = {away_team, home_team}
        seasons = sorted({
            int(game["season"])
            for game in games
            if {game["away_team"], game["home_team"]} == selected
        })
        rows = []
        for row in _cs_matrix_flat_records(games, seasons, history_years=5):
            if {row["away_team"], row["home_team"]} != selected:
                continue
            selected_home_spread = row["spread_line"] if row["home_team"] == home_team else -row["spread_line"]
            history_row = _cacheable_matchup_row(
                row,
                CURRENT_SEASON_MATRIX_PROFILE,
                True,
                row.get("pred_margin"),
                row.get("pred_total"),
            )
            history_row["selected_home_spread"] = selected_home_spread
            rows.append(history_row)
        rows.sort(key=lambda item: (item["season"], item["week"], item.get("gameday") or ""))
        return rows

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
                "model_available": pred_margin is not None or pred_total is not None,
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
        if {game["away_team"], game["home_team"]} != selected:
            continue
        rsm = rsm_rows.get(game.get("game_id"))
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
            "model_available": rsm is not None,
            "model_eligible": False,
            "pred_margin": _row_float(rsm, "roster_fair_home_margin") if rsm else None,
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

    latest_season = max(int(g["season"]) for g in games)
    latest_week = max(int(g["week"]) for g in games if int(g["season"]) == latest_season)

    if trained_model is not None:
        model = trained_model
    elif _is_rsm_family(model_profile):
        model = create_model(model_profile)
    elif model_profile == CURRENT_SEASON_MATRIX_PROFILE:
        model = train_model(
            _current_season_matrix_training_games(games, latest_season, history_years=5),
            model_profile=model_profile,
        )
    elif model_profile in {"rothstein", "rothstein_plus"}:
        training_games = [g for g in games if int(g["season"]) == latest_season]
        model = train_model(training_games, model_profile=model_profile)
    else:
        training_games = games
        model = train_model(training_games, model_profile=model_profile)
    # nflverse stores the market as an expected home margin (home favorite is
    # positive). The public API accepts conventional sportsbook notation, where
    # a home favorite is negative, so convert it at this boundary.
    # RSM never substitutes a pick'em line when no market line was supplied.
    market_margin = -spread_line if spread_line is not None else None
    if market_margin is None and not _is_rsm_family(model_profile):
        market_margin = 0.0
    effective_total_line = total_line
    if effective_total_line is None and not _is_rsm_family(model_profile):
        effective_total_line = 44.5
    game = {
        "season": latest_season,
        "week": latest_week + 1,
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
    rsm_details = model.prediction_details(game) if _is_rsm_family(model_profile) else None
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
    if _is_rsm_family(model_profile):
        rsm_notes.append("Prospective lineup confidence is unavailable for this snapshot-based display.")
        if total_line is None:
            rsm_notes.append("No bookmaker total was supplied, so total edge and O/U selection are unavailable; the independent model total remains displayed.")

    if model_profile == RSM_PLUS_PROFILE and rsm_details:
        rsm_plus_notes = list(rsm_details.get("model_notes", []))
        rsm_plus_notes.extend(
            note for note in rsm_notes
            if note not in rsm_plus_notes
            and note.startswith(("No market", "The supplied", "Prospective", "No bookmaker"))
        )
        rsm_notes = rsm_plus_notes
    elif model_profile != RSM_PROFILE:
        rsm_notes = []
    model_notes = rsm_notes if _is_rsm_family(model_profile) else []
    if hasattr(model, "model_notes"):
        model_notes = model.model_notes(game)

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
        "total_pick": total_from_edge(total_edge, threshold=0.0) if total_edge is not None and _is_rsm_family(model_profile) else (total_from_edge(total_edge, threshold=total_threshold) if total_edge is not None and model_supports_totals(model_profile) else None),
        "market_source": market_source or None,
        "market_observed_at": market_observed_at or None,
        "lineup_confidence": rsm_details["lineup_confidence"] if rsm_details else "not_applicable",
        "total_model_version": rsm_details["total_model_version"] if rsm_details else None,
        "latest_training_season": latest_season,
        "model_notes": model_notes,
    }
    if model_profile == RSM_PLUS_PROFILE and rsm_details:
        prediction.update({
            "base_rsm_margin": rsm_details.get("base_rsm_margin"),
            "matchup_adjustment": rsm_details.get("matchup_adjustment"),
            "raw_matchup_adjustment": rsm_details.get("raw_matchup_adjustment"),
            "matchup_explanations": rsm_details.get("matchup_explanations", []),
            "matchup_contributions": rsm_details.get("matchup_contributions", []),
            "data_confidence": rsm_details.get("data_confidence", "LOW"),
            "model_version": rsm_details.get("model_version"),
        })
    if upcoming_context and model_profile in {"rothstein", "rothstein_plus"}:
        prediction = stabilize_rothstein_upcoming_prediction(prediction, model, game, model_profile)
    return prediction


def predict_upcoming_with_trained_model(
    scheduled: dict,
    model_profile: str,
    trained_model,
) -> dict:
    market_margin = scheduled.get("spread_line")
    total_line = scheduled.get("total_line")
    game = {
        "season": scheduled.get("season"),
        "week": scheduled.get("week"),
        "away_team": scheduled.get("away_team"),
        "home_team": scheduled.get("home_team"),
        "spread_line": market_margin,
        "total_line": total_line,
        "away_rest": scheduled.get("away_rest", 7.0),
        "home_rest": scheduled.get("home_rest", 7.0),
        "div_game": scheduled.get("div_game", False),
        "roof": scheduled.get("roof", ""),
        "temp": scheduled.get("temp"),
        "wind": scheduled.get("wind"),
    }
    rsm_details = trained_model.prediction_details(game) if _is_rsm_family(model_profile) else None
    if rsm_details:
        pred_margin, pred_total = rsm_details["predicted_margin"], rsm_details["predicted_total"]
    else:
        pred_margin, pred_total = trained_model.predict(game)
    spread_edge = pred_margin - market_margin if market_margin is not None else None
    total_edge = pred_total - total_line if pred_total is not None and total_line is not None else None
    spread_threshold = default_spread_threshold(model_profile)
    total_threshold = default_total_threshold(model_profile)
    eligible = True
    if model_profile == "rothstein_plus":
        eligible = is_rothstein_plus_eligible(trained_model, game)
    model_notes = []
    if hasattr(trained_model, "model_notes"):
        model_notes = trained_model.model_notes(game)
    prediction = {
        "model": model_profile,
        "away_team": scheduled.get("away_team"),
        "home_team": scheduled.get("home_team"),
        "pred_margin": pred_margin,
        "pred_total": pred_total,
        "spread_line": -market_margin if market_margin is not None else None,
        "market_margin": market_margin,
        "total_line": total_line,
        "spread_edge": spread_edge,
        "total_edge": total_edge,
        "spread_threshold": spread_threshold,
        "total_threshold": total_threshold,
        "eligible": eligible,
        "winner_pick": "home" if pred_margin > 0 else "away" if pred_margin < 0 else None,
        "spread_pick": (
            side_from_edge(spread_edge, threshold=spread_threshold)
            if eligible and spread_edge is not None and model_supports_spread_picks(model_profile)
            else None
        ),
        "total_pick": (
            total_from_edge(total_edge, threshold=0.0)
            if total_edge is not None and _is_rsm_family(model_profile)
            else (
                total_from_edge(total_edge, threshold=total_threshold)
                if eligible and total_edge is not None and model_supports_totals(model_profile)
                else None
            )
        ),
        "market_source": None,
        "market_observed_at": None,
        "lineup_confidence": rsm_details["lineup_confidence"] if rsm_details else "not_applicable",
        "total_model_version": rsm_details["total_model_version"] if rsm_details else None,
        "latest_training_season": scheduled.get("season"),
        "model_notes": model_notes,
    }
    if model_profile == RSM_PLUS_PROFILE and rsm_details:
        prediction.update({
            "base_rsm_margin": rsm_details.get("base_rsm_margin"),
            "matchup_adjustment": rsm_details.get("matchup_adjustment"),
            "raw_matchup_adjustment": rsm_details.get("raw_matchup_adjustment"),
            "matchup_explanations": rsm_details.get("matchup_explanations", []),
            "matchup_contributions": rsm_details.get("matchup_contributions", []),
            "data_confidence": rsm_details.get("data_confidence", "LOW"),
            "model_version": rsm_details.get("model_version"),
        })
    if model_profile in {"rothstein", "rothstein_plus"}:
        prediction = stabilize_rothstein_upcoming_prediction(prediction, trained_model, game, model_profile)
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


def betting_record(wins: int, losses: int, pushes: int = 0) -> dict:
    graded = wins + losses
    bets = graded + pushes
    win_rate = wins / graded if graded > 0 else None
    net_units = wins * (100 / 110) - losses
    return {
        "wins": wins,
        "losses": losses,
        "pushes": pushes,
        "bets": bets,
        "graded_bets": graded,
        "win_rate": win_rate,
        "net_units_at_minus_110": net_units,
        "roi_at_minus_110": net_units / graded if graded > 0 else None,
    }


def postgame_signal_label(win_rate: Optional[float], completed_picks: int) -> str:
    if win_rate is None or completed_picks <= 0:
        return "Neutral"
    if win_rate > 0.55:
        return "Positive"
    if win_rate < 0.45:
        return "Contrary Positive"
    return "Neutral"


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


def _opposite_pick(pick: Optional[str]) -> Optional[str]:
    return {
        "home": "away",
        "away": "home",
        "over": "under",
        "under": "over",
    }.get(pick)


def _edge_bucket(edge: Optional[float]) -> str:
    if edge is None:
        return "unknown"
    value = abs(float(edge))
    if value < 1.5:
        return "0-1.5"
    if value < 3.0:
        return "1.5-3"
    if value < 5.0:
        return "3-5"
    return "5+"


def _market_spread_bucket(spread_line: Optional[float]) -> str:
    if spread_line is None:
        return "unknown"
    value = abs(float(spread_line))
    if value < 3.0:
        return "short"
    if value < 7.0:
        return "medium"
    return "large"


def _total_line_bucket(total_line: Optional[float]) -> str:
    if total_line is None:
        return "unknown"
    value = float(total_line)
    if value < 42.0:
        return "low"
    if value < 47.0:
        return "medium"
    return "high"


def _predicted_total_bucket(predicted_total: Optional[float]) -> str:
    if predicted_total is None:
        return "unknown"
    value = float(predicted_total)
    if value < 42.0:
        return "low_pred"
    if value < 47.0:
        return "mid_pred"
    return "high_pred"


def _ats_pick_context(row: dict) -> str:
    pick = row.get("spread_pick")
    spread_line = row.get("spread_line")
    if not pick or spread_line is None:
        return "unknown"
    market_home_favored = float(spread_line) > 0
    if abs(float(spread_line)) < 1e-9:
        return "pickem"
    pick_is_home = pick == "home"
    pick_is_favorite = pick_is_home == market_home_favored
    return "favorite" if pick_is_favorite else "underdog"


def _week_phase(week: Optional[int]) -> str:
    try:
        value = int(week)
    except (TypeError, ValueError):
        return "unknown"
    if value <= 4:
        return "early"
    if value <= 12:
        return "mid"
    return "late"


def _operator_bucket_key(row: dict, market: str) -> Tuple[str, ...]:
    if market == "ATS":
        return (
            str(row.get("spread_pick") or "none"),
            _ats_pick_context(row),
            _edge_bucket(row.get("spread_edge")),
            _market_spread_bucket(row.get("spread_line")),
            _week_phase(row.get("week")),
        )
    return (
        str(row.get("total_pick") or "none"),
        _edge_bucket(row.get("total_edge")),
        _total_line_bucket(row.get("total_line")),
        _predicted_total_bucket(row.get("pred_total")),
        _week_phase(row.get("week")),
    )


def _market_result(row: dict, market: str, pick: Optional[str]) -> Optional[str]:
    if market == "ATS":
        game = {
            "actual_margin": row.get("actual_margin"),
            "spread_line": row.get("spread_line"),
        }
        return _grade_spread_pick(game, pick)
    game = {
        "actual_total": row.get("actual_total"),
        "total_line": row.get("total_line"),
    }
    return _grade_total_pick(game, pick)


def _operator_summary(rows: List[dict], market: str) -> dict:
    if market == "ATS":
        wins = sum(1 for row in rows if row.get("spread_result") == "win")
        losses = sum(1 for row in rows if row.get("spread_result") == "loss")
        pushes = sum(1 for row in rows if row.get("spread_result") == "push")
    else:
        wins = sum(1 for row in rows if row.get("total_result") == "win")
        losses = sum(1 for row in rows if row.get("total_result") == "loss")
        pushes = sum(1 for row in rows if row.get("total_result") == "push")
    return betting_record(wins, losses, pushes)


def _bucket_stats(rows: List[dict], market: str, min_bucket_games: int) -> Dict[Tuple[str, ...], dict]:
    grouped: Dict[Tuple[str, ...], List[dict]] = {}
    for row in rows:
        pick = row.get("spread_pick") if market == "ATS" else row.get("total_pick")
        if pick:
            grouped.setdefault(_operator_bucket_key(row, market), []).append(row)

    stats = {}
    for key, bucket_rows in grouped.items():
        record = _operator_summary(bucket_rows, market)
        supported = record["graded_bets"] >= min_bucket_games and record["win_rate"] is not None
        stats[key] = {
            **record,
            "supported": supported,
            "operator": (
                "keep" if supported and record["win_rate"] >= 0.5
                else "invert" if supported
                else "untrained"
            ),
        }
    return stats


def _apply_market_operator(row: dict, market: str, mode: str, rule: Optional[dict]) -> dict:
    output = dict(row)
    pick_field = "spread_pick" if market == "ATS" else "total_pick"
    result_field = "spread_result" if market == "ATS" else "total_result"
    raw_pick = output.get(pick_field)
    action = rule.get("operator") if rule else "untrained"

    if not raw_pick:
        output[pick_field] = None
        output[result_field] = None
        output["operator_action"] = "no_pick"
        return output

    if mode == "raw":
        output["operator_action"] = "raw"
        return output

    if mode == "thresholded":
        if action == "keep":
            output["operator_action"] = "kept"
        else:
            output[pick_field] = None
            output[result_field] = None
            output["operator_action"] = "skipped_untrained" if action == "untrained" else "skipped_negative_bucket"
        return output

    if mode == "contrarian" and action == "invert":
        flipped = _opposite_pick(raw_pick)
        output[pick_field] = flipped
        output[result_field] = _market_result(row, market, flipped)
        output["operator_action"] = "inverted"
        return output

    output["operator_action"] = "kept" if action == "keep" else "kept_untrained"
    return output


def _cs_matrix_records_by_season(games: List[dict], seasons: List[int], history_years: Optional[int] = None) -> Dict[int, List[dict]]:
    records_by_season = {}
    for season in seasons:
        model = CurrentSeasonMatrixNFLModel()
        history_floor = season - history_years if history_years else None
        prior_games = [
            game for game in games
            if int(game.get("season", 0)) < season
            and (history_floor is None or int(game.get("season", 0)) >= history_floor)
        ]
        model.fit_completed_games(prior_games)
        season_rows = []
        for week in sorted({int(game["week"]) for game in games if game["season"] == season}):
            week_games = [game for game in games if game["season"] == season and int(game["week"]) == week]
            for game in week_games:
                try:
                    pred_margin, pred_total = model.predict(game)
                except ValueError:
                    pred_margin, pred_total = None, None
                spread_edge = pred_margin - game["spread_line"] if pred_margin is not None else None
                total_edge = pred_total - game["total_line"] if pred_total is not None else None
                spread_pick = side_from_edge(spread_edge, default_spread_threshold(CURRENT_SEASON_MATRIX_PROFILE)) if spread_edge is not None else None
                total_pick = total_from_edge(total_edge, default_total_threshold(CURRENT_SEASON_MATRIX_PROFILE)) if total_edge is not None else None
                season_rows.append({
                    "season": game["season"],
                    "week": game["week"],
                    "game_id": game["game_id"],
                    "model": CURRENT_SEASON_MATRIX_PROFILE,
                    "away_team": game["away_team"],
                    "home_team": game["home_team"],
                    "gameday": game.get("gameday"),
                    "away_score": game["away_score"],
                    "home_score": game["home_score"],
                    "pred_margin": pred_margin,
                    "actual_margin": game["actual_margin"],
                    "spread_line": game["spread_line"],
                    "spread_edge": spread_edge,
                    "spread_pick": spread_pick,
                    "spread_result": _grade_spread_pick(game, spread_pick),
                    "pred_total": pred_total,
                    "actual_total": game["actual_total"],
                    "total_line": game["total_line"],
                    "total_edge": total_edge,
                    "total_pick": total_pick,
                    "total_result": _grade_total_pick(game, total_pick),
                })
            for game in week_games:
                model.update(game, 0.0, 44.0)
        records_by_season[season] = season_rows
    return records_by_season


def _cs_matrix_flat_records(games: List[dict], seasons: List[int], history_years: Optional[int] = None) -> List[dict]:
    records_by_season = _cs_matrix_records_by_season(games, seasons, history_years=history_years)
    return [
        row
        for season in seasons
        for row in records_by_season.get(season, [])
    ]


def current_season_matrix_operator_audit(
    games: List[dict],
    seasons_to_test: int = 5,
    min_bucket_games: int = 20,
) -> dict:
    """Walk-forward audit for thresholding or inverting CS Matrix ATS/O/U picks."""
    completed_seasons = sorted({game["season"] for game in games})
    target_seasons = completed_seasons[-seasons_to_test:]
    records_by_season = _cs_matrix_records_by_season(games, completed_seasons)
    modes = ("raw", "thresholded", "contrarian")
    markets = ("ATS", "O/U")
    output = {
        "model": CURRENT_SEASON_MATRIX_PROFILE,
        "seasons_tested": target_seasons,
        "min_bucket_games": min_bucket_games,
        "markets": {},
    }

    for market in markets:
        mode_rows = {mode: [] for mode in modes}
        rule_rows = []
        for season in target_seasons:
            training_rows = [
                row
                for prior_season in completed_seasons
                if prior_season < season
                for row in records_by_season.get(prior_season, [])
            ]
            rules = _bucket_stats(training_rows, market, min_bucket_games)
            season_rows = records_by_season.get(season, [])
            for row in season_rows:
                key = _operator_bucket_key(row, market)
                rule = rules.get(key)
                if row.get("spread_pick" if market == "ATS" else "total_pick"):
                    rule_rows.append({
                        "season": season,
                        "key": key,
                        "operator": rule.get("operator") if rule else "untrained",
                        "prior_graded_bets": rule.get("graded_bets", 0) if rule else 0,
                        "prior_win_rate": rule.get("win_rate") if rule else None,
                    })
                for mode in modes:
                    mode_rows[mode].append(_apply_market_operator(row, market, mode, rule))

        output["markets"][market] = {
            "modes": {
                mode: _operator_summary(rows, market)
                for mode, rows in mode_rows.items()
            },
            "rule_actions": dict(Counter(row["operator"] for row in rule_rows)),
            "rules_sampled": len(rule_rows),
        }
    return output


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


def _is_before_week(game: dict, season: int, week: int) -> bool:
    game_season = int(game.get("season", 0))
    game_week = int(game.get("week", 0))
    return game_season < season or (game_season == season and game_week < week)


def _train_model_before_week(games: List[dict], season: int, week: int, model_profile: str):
    training_games = [game for game in games if _is_before_week(game, season, week)]
    if _is_rsm_family(model_profile):
        return create_model(model_profile)
    if model_profile == CURRENT_SEASON_MATRIX_PROFILE:
        model = create_model(model_profile)
        model.fit_completed_games(_current_season_matrix_training_games(training_games, season, history_years=5))
        return model
    return train_model(training_games, model_profile)


def weekly_model_performance(games: List[dict], season: int, week: int, model_profiles: Tuple[str, ...] = MODEL_PROFILES) -> dict:
    """Grade each model on completed games for one week using chronological pregame predictions."""
    completed_week_games = [
        game for game in games
        if game["season"] == season and game["week"] == week
    ]
    rows = []
    for model_profile in model_profiles:
        model = _train_model_before_week(games, season, week, model_profile)
        records = []
        for game in completed_week_games:
            eligible = True
            if model_profile == "rothstein_plus":
                eligible = is_rothstein_plus_eligible(model, game)
            try:
                pred_margin, pred_total = model.predict(game)
            except ValueError:
                pred_margin, pred_total = None, None

            spread_edge = pred_margin - game["spread_line"] if pred_margin is not None else None
            total_edge = pred_total - game["total_line"] if pred_total is not None else None
            spread_pick = side_from_edge(spread_edge, default_spread_threshold(model_profile)) if spread_edge is not None and eligible and model_supports_spread_picks(model_profile) else None
            if _is_rsm_family(model_profile):
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


def _prune_weekly_performance_cache(root: str, keep: int = 24) -> int:
    try:
        entries = [
            os.path.join(root, name)
            for name in os.listdir(root)
            if name.startswith("nfl_weekly_performance") and (name.endswith(".json") or ".json." in name)
        ]
    except OSError:
        return 0
    entries.sort(key=lambda path: os.path.getmtime(path) if os.path.exists(path) else 0, reverse=True)
    removed = 0
    for path in entries[keep:]:
        try:
            os.remove(path)
            removed += 1
        except OSError:
            pass
    return removed


def _write_weekly_performance_cache(cache_path: str, payload: dict) -> bool:
    root = os.path.dirname(cache_path) or "."
    os.makedirs(root, exist_ok=True)
    _prune_weekly_performance_cache(root)
    try:
        _write_json_cache(cache_path, payload)
        return True
    except OSError as error:
        if error.errno == errno.ENOSPC:
            _prune_weekly_performance_cache(root, keep=4)
            try:
                _write_json_cache(cache_path, payload)
                return True
            except OSError:
                return False
        return False


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
    _write_weekly_performance_cache(cache_path, {
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
    if model_profile == CURRENT_SEASON_MATRIX_PROFILE:
        records_by_week: Dict[int, List[dict]] = {}
        season_weeks = sorted({int(game["week"]) for game in games if game["season"] == season})
        for target_week in season_weeks:
            model = _train_model_before_week(games, season, target_week, model_profile)
            for game in [row for row in games if row["season"] == season and row["week"] == target_week]:
                try:
                    pred_margin, pred_total = model.predict(game)
                except ValueError:
                    pred_margin, pred_total = None, None
                spread_edge = pred_margin - game["spread_line"] if pred_margin is not None else None
                total_edge = pred_total - game["total_line"] if pred_total is not None else None
                spread_pick = side_from_edge(spread_edge, default_spread_threshold(model_profile)) if spread_edge is not None and model_supports_spread_picks(model_profile) else None
                total_pick = total_from_edge(total_edge, default_total_threshold(model_profile)) if total_edge is not None and model_supports_totals(model_profile) else None
                records_by_week.setdefault(target_week, []).append({
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
                    "pred_total": pred_total,
                    "actual_total": game["actual_total"],
                    "total_line": game["total_line"],
                    "total_edge": total_edge,
                    "spread_pick": spread_pick,
                    "spread_result": _grade_spread_pick(game, spread_pick),
                    "total_pick": total_pick,
                    "total_result": _grade_total_pick(game, total_pick),
                })
        return records_by_week

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
            if _is_rsm_family(model_profile):
                total_pick = total_from_edge(total_edge, 0.0) if total_edge is not None else None
            else:
                total_pick = total_from_edge(total_edge, default_total_threshold(model_profile)) if total_edge is not None and eligible and model_supports_totals(model_profile) else None
            records_by_week.setdefault(game["week"], []).append({
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
                "pred_total": pred_total,
                "actual_total": game["actual_total"],
                "total_line": game["total_line"],
                "total_edge": total_edge,
                "spread_pick": spread_pick,
                "spread_result": _grade_spread_pick(game, spread_pick),
                "total_pick": total_pick,
                "total_result": _grade_total_pick(game, total_pick),
            })

        if not _is_rsm_family(model_profile) and pred_margin is not None and pred_total is not None:
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
    _write_weekly_performance_cache(cache_path, {
        "metadata": metadata,
        "trend": trend,
        "generated_at": generated_at,
    })
    return trend, False


def _empty_market_totals() -> dict:
    return {"wins": 0, "losses": 0, "pushes": 0}


def _add_market_week(totals: dict, week_row: dict, market: str) -> None:
    prefix = "spread" if market == "ATS" else "total"
    totals["wins"] += int(week_row.get(f"{prefix}_wins") or 0)
    totals["losses"] += int(week_row.get(f"{prefix}_losses") or 0)
    totals["pushes"] += int(week_row.get(f"{prefix}_pushes") or 0)


def _market_record_from_weeks(weeks: List[dict], market: str) -> dict:
    totals = _empty_market_totals()
    for week_row in weeks:
        _add_market_week(totals, week_row, market)
    return betting_record(totals["wins"], totals["losses"], totals["pushes"])


def postgame_grading_summary(
    games: List[dict],
    season: int,
    week: int,
    scheduled_games: Optional[List[dict]] = None,
    model_profiles: Tuple[str, ...] = MODEL_PROFILES,
) -> dict:
    weekly_performance, weekly_cache_hit = cached_weekly_model_performance(games, season, week, model_profiles)
    scheduled_week_games = scheduled_games if scheduled_games is not None else []
    scheduled_count = len(scheduled_week_games)
    completed_games = int(weekly_performance.get("completed_games") or 0)
    partial_week = scheduled_count > completed_games if scheduled_count else False
    rows = []
    algorithm_rows = []
    trend_cache_hits = {}

    for model_profile in model_profiles:
        trend, trend_cache_hit = cached_weekly_model_performance_trend(games, season, model_profile)
        trend_cache_hits[model_profile] = trend_cache_hit
        trend_weeks = [
            row for row in trend.get("weeks", [])
            if int(row.get("week") or 0) <= week
        ]
        week_rows = [row for row in trend_weeks if int(row.get("week") or 0) == week]
        week_row = week_rows[0] if week_rows else {}
        last_three_weeks = trend_weeks[-3:]
        algorithm_row = {"model": model_profile, "indicators": {}}
        for market in ("ATS", "O/U"):
            week_record = _market_record_from_weeks([week_row] if week_row else [], market)
            season_record = _market_record_from_weeks(trend_weeks, market)
            last_three_record = _market_record_from_weeks(last_three_weeks, market)
            indicator = {
                "market": market,
                "week": week_record,
                "season": season_record,
                "last_3_weeks": last_three_record,
                "completed_picks": season_record["graded_bets"],
                "signal": postgame_signal_label(season_record["win_rate"], season_record["graded_bets"]),
            }
            rows.append({
                "model": model_profile,
                **indicator,
            })
            algorithm_row["indicators"]["ats" if market == "ATS" else "over_under"] = indicator
        algorithm_rows.append(algorithm_row)

    return {
        "season": season,
        "week": week,
        "completed_games": completed_games,
        "scheduled_games": scheduled_count or None,
        "partial_week": partial_week,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "weekly_cache_hit": weekly_cache_hit,
        "trend_cache_hits": trend_cache_hits,
        "rows": rows,
        "algorithms": algorithm_rows,
    }


def postgame_game_results(
    games: List[dict],
    season: int,
    week: int,
    model_profiles: Tuple[str, ...] = MODEL_PROFILES,
) -> List[dict]:
    target_games = [
        game for game in games
        if game["season"] == season and game["week"] == week
    ]
    by_game = {
        game["game_id"]: {
            "game_id": game["game_id"],
            "season": game["season"],
            "week": game["week"],
            "gameday": game.get("gameday"),
            "away_team": game["away_team"],
            "home_team": game["home_team"],
            "away_score": game["away_score"],
            "home_score": game["home_score"],
            "spread_line": game["spread_line"],
            "total_line": game["total_line"],
            "models": {},
        }
        for game in target_games
    }
    target_ids = set(by_game)

    for model_profile in model_profiles:
        model = _train_model_before_week(games, season, week, model_profile)
        for game in target_games:
            eligible = True
            if model_profile == "rothstein_plus":
                eligible = is_rothstein_plus_eligible(model, game)
            try:
                pred_margin, pred_total = model.predict(game)
            except ValueError:
                pred_margin, pred_total = None, None

            spread_edge = pred_margin - game["spread_line"] if pred_margin is not None else None
            total_edge = pred_total - game["total_line"] if pred_total is not None else None
            spread_pick = side_from_edge(spread_edge, default_spread_threshold(model_profile)) if spread_edge is not None and eligible and model_supports_spread_picks(model_profile) else None
            if _is_rsm_family(model_profile):
                total_pick = total_from_edge(total_edge, 0.0) if total_edge is not None else None
            else:
                total_pick = total_from_edge(total_edge, default_total_threshold(model_profile)) if total_edge is not None and eligible and model_supports_totals(model_profile) else None
            by_game[game["game_id"]]["models"][model_profile] = {
                "spread_pick": spread_pick,
                "spread_result": _grade_spread_pick(game, spread_pick),
                "total_pick": total_pick,
                "total_result": _grade_total_pick(game, total_pick),
                "pred_margin": pred_margin,
                "pred_total": pred_total,
            }

    return list(by_game.values())


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
    if model_profile == CURRENT_SEASON_MATRIX_PROFILE:
        completed_seasons = sorted({g["season"] for g in games})
        test_seasons = completed_seasons[-seasons_to_test:]
        records = _cs_matrix_flat_records(games, test_seasons, history_years=5)
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


def print_cs_matrix_operator_audit(audit: dict) -> None:
    print("\nCS Matrix operator audit")
    print("------------------------")
    print(f"Test seasons: {', '.join(str(season) for season in audit['seasons_tested'])}")
    print(f"Minimum prior bucket support: {audit['min_bucket_games']} graded picks")
    for market, market_audit in audit["markets"].items():
        print(f"\n{market}")
        print("Mode         Bets  Graded  W-L-P       Win rate  ROI -110")
        for mode, record in market_audit["modes"].items():
            print(
                f"{mode:<12} "
                f"{record['bets']:<5} "
                f"{record['graded_bets']:<7} "
                f"{record['wins']}-{record['losses']}-{record['pushes']:<7} "
                f"{format_pct(record['win_rate']):<9} "
                f"{format_pct(record['roi_at_minus_110'])}"
            )
        print(f"Walk-forward rule actions: {market_audit['rule_actions']}")


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
    parser.add_argument("--cs-operator-audit", action="store_true", help="Audit raw, thresholded, and contrarian CS Matrix operators")
    parser.add_argument("--operator-min-bucket", type=int, default=20, help="Minimum prior graded picks per operator bucket")
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

    if args.cs_operator_audit and not any((args.compare_models, args.sweep, args.export, args.by_season)):
        audit = current_season_matrix_operator_audit(
            games,
            seasons_to_test=max(args.seasons),
            min_bucket_games=args.operator_min_bucket,
        )
        print_cs_matrix_operator_audit(audit)
        return

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

    if args.cs_operator_audit:
        audit = current_season_matrix_operator_audit(
            games,
            seasons_to_test=max(args.seasons),
            min_bucket_games=args.operator_min_bucket,
        )
        print_cs_matrix_operator_audit(audit)


if __name__ == "__main__":
    main()
