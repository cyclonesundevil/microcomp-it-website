import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

from cache_io import atomic_write_json, read_json_or_none
from experimental.kalshi_edge import latest_moneyline_pairs, latest_total_markets, read_kalshi_snapshots
from nfl_roster_monitor import canonical_team_code


PREGAME_LEDGER_SCHEMA_VERSION = 1
EDGE_BUCKETS = (
    (0.0, 1.0, "0 to 1"),
    (1.0, 2.0, "1 to 2"),
    (2.0, 3.0, "2 to 3"),
    (3.0, None, "3+"),
)
AGREEMENT_GROUPS = (
    ("CS Matrix + RSM", ("current_season_matrix", "rsm_stage7c")),
    ("RSM + RSM+", ("rsm_stage7c", "rsm_plus")),
    ("CS Matrix + RSM + RSM+", ("current_season_matrix", "rsm_stage7c", "rsm_plus")),
)
DEFAULT_LEDGER_MODELS = ("current_season_matrix", "rsm_stage7c", "rsm_plus", "market_blend", "rothstein_plus")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _to_float(value) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _bool(value) -> bool:
    return bool(value) and str(value).strip().lower() not in {"0", "false", "none", "null"}


def pregame_ledger_data_root() -> Path:
    configured = os.getenv("NFL_PREGAME_LEDGER_DATA_DIR", "").strip()
    if configured:
        return Path(configured)
    data_root = Path("/data") if os.path.isdir("/data") else Path(__file__).resolve().parents[1] / "cache"
    return data_root / "pregame_edge_ledger"


def pregame_ledger_store_path() -> Path:
    return pregame_ledger_data_root() / "pregame_edge_ledger.json"


def read_pregame_ledger() -> list[dict]:
    payload = read_json_or_none(pregame_ledger_store_path())
    if not isinstance(payload, dict):
        return []
    rows = payload.get("rows")
    return rows if isinstance(rows, list) else []


def _write_pregame_ledger(rows: list[dict]) -> None:
    rows = sorted(rows, key=lambda row: (
        row.get("season") or 0,
        row.get("week") or 0,
        row.get("gameday") or "",
        row.get("game_id") or "",
        row.get("model") or "",
        row.get("market_type") or "",
        row.get("observed_at") or "",
    ))
    atomic_write_json(pregame_ledger_store_path(), {
        "schema_version": PREGAME_LEDGER_SCHEMA_VERSION,
        "updated_at": utc_now_iso(),
        "rows": rows,
    }, indent=2, sort_keys=True)


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


def _minutes_to_kickoff(observed_at: str, gameday: str, gametime: str) -> Optional[float]:
    if not gameday:
        return None
    try:
        observed = datetime.fromisoformat(str(observed_at).replace("Z", "+00:00"))
        kickoff = datetime.fromisoformat(f"{gameday}T{gametime or '00:00'}:00+00:00")
        return (kickoff - observed).total_seconds() / 60.0
    except ValueError:
        return None


def _roster_summary(game: dict, prediction: dict) -> tuple[int, str]:
    details = prediction.get("rsm_roster_overlay_details") or prediction.get("availability_adjustment_details") or []
    if isinstance(details, list) and details:
        reasons = [str(item.get("reason") or item.get("event_type") or "").strip() for item in details if isinstance(item, dict)]
        reasons = [reason for reason in reasons if reason]
        return len(details), "; ".join(reasons[:3])
    signals = game.get("model_signals") or {}
    label = str(signals.get("opportunity_label") or signals.get("agreement_label") or "").strip()
    return 0, label


def _latest_kalshi_context(upcoming_snapshot: dict) -> tuple[dict, dict]:
    snapshots = read_kalshi_snapshots()
    return (
        latest_moneyline_pairs(snapshots, upcoming_snapshot.get("season"), upcoming_snapshot.get("week")),
        latest_total_markets(snapshots, upcoming_snapshot.get("season"), upcoming_snapshot.get("week")),
    )


def _kalshi_probability_for_row(row: dict, moneyline_pairs: dict, total_markets: dict) -> tuple[Optional[float], Optional[float]]:
    key = _game_key(row)
    pick = row.get("model_pick")
    if row.get("market_type") == "OU":
        market = total_markets.get(key)
        if not market or pick not in {"over", "under"}:
            return None, None
        implied = _to_float(market.get("kalshi_implied_probability"))
        if implied is None:
            return None, None
        over_probability = implied if market.get("contract_side") == "over" else 1.0 - implied
        pick_probability = over_probability if pick == "over" else 1.0 - over_probability
        return pick_probability, None
    pair = moneyline_pairs.get(key)
    if not pair or pick not in {"home", "away"}:
        return None, None
    home = pair.get("home_win")
    away = pair.get("away_win")
    home_probability = _to_float(home.get("kalshi_implied_probability")) if home else None
    if home_probability is None and away:
        away_probability = _to_float(away.get("kalshi_implied_probability"))
        home_probability = 1.0 - away_probability if away_probability is not None else None
    if home_probability is None:
        return None, None
    pick_probability = home_probability if pick == "home" else 1.0 - home_probability
    return pick_probability, None


def normalize_ledger_row(row: dict) -> Optional[dict]:
    market_type = str(row.get("market_type") or "").upper()
    if market_type not in {"ATS", "OU"}:
        return None
    model_edge = _to_float(row.get("model_edge"))
    market_line = _to_float(row.get("market_line"))
    model_projection = _to_float(row.get("model_projection"))
    if model_edge is None or market_line is None or model_projection is None:
        return None
    model_pick = str(row.get("model_pick") or "").strip().lower()
    if market_type == "ATS" and model_pick not in {"home", "away"}:
        return None
    if market_type == "OU" and model_pick not in {"over", "under"}:
        return None
    observed_at = str(row.get("observed_at") or utc_now_iso())
    normalized = {
        "schema_version": PREGAME_LEDGER_SCHEMA_VERSION,
        "season": _to_int(row.get("season")),
        "week": _to_int(row.get("week")),
        "game_id": str(row.get("game_id") or ""),
        "gameday": str(row.get("gameday") or ""),
        "gametime": str(row.get("gametime") or ""),
        "away_team": canonical_team_code(row.get("away_team")),
        "home_team": canonical_team_code(row.get("home_team")),
        "model": str(row.get("model") or ""),
        "market_type": market_type,
        "market_line": market_line,
        "model_projection": model_projection,
        "model_edge": model_edge,
        "model_pick": model_pick,
        "threshold": _to_float(row.get("threshold")),
        "roster_overlay_applied": _bool(row.get("roster_overlay_applied")),
        "roster_alert_count": _to_int(row.get("roster_alert_count")) or 0,
        "roster_context_summary": str(row.get("roster_context_summary") or ""),
        "kalshi_probability": _to_float(row.get("kalshi_probability")),
        "kalshi_edge": _to_float(row.get("kalshi_edge")),
        "source_view": str(row.get("source_view") or "unknown"),
        "observed_at": observed_at,
        "kickoff_at": str(row.get("kickoff_at") or ""),
        "minutes_to_kickoff": _to_float(row.get("minutes_to_kickoff")),
        "cache_build_id": str(row.get("cache_build_id") or ""),
    }
    if normalized["minutes_to_kickoff"] is None:
        normalized["minutes_to_kickoff"] = _minutes_to_kickoff(observed_at, normalized["gameday"], normalized["gametime"])
    return normalized if normalized["season"] and normalized["week"] and normalized["game_id"] and normalized["model"] else None


def snapshots_from_upcoming(
    upcoming_snapshot: dict,
    source_view: str = "upcoming_week",
    models: Iterable[str] = DEFAULT_LEDGER_MODELS,
    observed_at: Optional[str] = None,
) -> list[dict]:
    observed_at = observed_at or utc_now_iso()
    model_set = set(models or [])
    moneyline_pairs, total_markets = _latest_kalshi_context(upcoming_snapshot)
    rows = []
    for game in upcoming_snapshot.get("games", []) or []:
        schedule = game.get("schedule") or game
        models_payload = game.get("models") or {}
        for model, prediction in models_payload.items():
            if model_set and model not in model_set:
                continue
            if not isinstance(prediction, dict):
                continue
            roster_count, roster_summary = _roster_summary(game, prediction)
            common = {
                "season": schedule.get("season") or upcoming_snapshot.get("season"),
                "week": schedule.get("week") or upcoming_snapshot.get("week"),
                "game_id": schedule.get("game_id") or "",
                "gameday": schedule.get("gameday") or "",
                "gametime": schedule.get("gametime") or "",
                "away_team": schedule.get("away_team"),
                "home_team": schedule.get("home_team"),
                "model": model,
                "roster_overlay_applied": prediction.get("rsm_roster_overlay_applied") or prediction.get("availability_adjusted"),
                "roster_alert_count": roster_count,
                "roster_context_summary": roster_summary,
                "source_view": source_view,
                "observed_at": observed_at,
                "kickoff_at": str(schedule.get("kickoff") or ""),
                "cache_build_id": upcoming_snapshot.get("generated_at") or "",
            }
            ats = normalize_ledger_row({
                **common,
                "market_type": "ATS",
                "market_line": prediction.get("market_margin", schedule.get("spread_line")),
                "model_projection": prediction.get("pred_margin"),
                "model_edge": prediction.get("spread_edge"),
                "model_pick": prediction.get("spread_pick"),
                "threshold": prediction.get("spread_threshold"),
            })
            if ats:
                ats["kalshi_probability"], ats["kalshi_edge"] = _kalshi_probability_for_row(ats, moneyline_pairs, total_markets)
                rows.append(ats)
            ou = normalize_ledger_row({
                **common,
                "market_type": "OU",
                "market_line": prediction.get("total_line", schedule.get("total_line")),
                "model_projection": prediction.get("pred_total"),
                "model_edge": prediction.get("total_edge"),
                "model_pick": prediction.get("total_pick"),
                "threshold": prediction.get("total_threshold"),
            })
            if ou:
                ou["kalshi_probability"], ou["kalshi_edge"] = _kalshi_probability_for_row(ou, moneyline_pairs, total_markets)
                rows.append(ou)
    return rows


def import_ledger_rows(rows: Iterable[dict]) -> dict:
    normalized = [row for row in (normalize_ledger_row(row) for row in rows or []) if row]
    existing = read_pregame_ledger()
    by_key = {}
    for row in existing + normalized:
        key = (
            row.get("season"),
            row.get("week"),
            row.get("game_id"),
            row.get("model"),
            row.get("market_type"),
            row.get("observed_at"),
        )
        by_key[key] = row
    merged = list(by_key.values())
    _write_pregame_ledger(merged)
    return {
        "success": True,
        "imported": len(normalized),
        "total_rows": len(merged),
        "store_path": str(pregame_ledger_store_path()),
    }


def snapshot_current_board(upcoming_snapshot: dict, source_view: str = "upcoming_week") -> dict:
    rows = snapshots_from_upcoming(upcoming_snapshot, source_view=source_view)
    result = import_ledger_rows(rows)
    return {
        **result,
        "created_rows": len(rows),
        "season": upcoming_snapshot.get("season"),
        "week": upcoming_snapshot.get("week"),
        "observed_at": rows[0]["observed_at"] if rows else utc_now_iso(),
    }


def grade_ledger_rows(rows: Iterable[dict], completed_games: Iterable[dict]) -> list[dict]:
    games_by_key = {_game_key(game): game for game in completed_games or []}
    graded = []
    for row in rows or []:
        output = dict(row)
        game = games_by_key.get(_game_key(row))
        if not game:
            graded.append(output)
            continue
        home_score = _to_float(game.get("home_score"))
        away_score = _to_float(game.get("away_score"))
        actual_margin = _to_float(game.get("actual_margin"))
        if actual_margin is None and home_score is not None and away_score is not None:
            actual_margin = home_score - away_score
        actual_total = _to_float(game.get("actual_total"))
        if actual_total is None and home_score is not None and away_score is not None:
            actual_total = home_score + away_score
        output["actual_margin"] = actual_margin
        output["actual_total"] = actual_total
        if row.get("market_type") == "ATS" and actual_margin is not None:
            cover_margin = actual_margin - row["market_line"]
            output["margin_error"] = actual_margin - row["model_projection"]
            output["projection_error"] = output["margin_error"]
            if abs(cover_margin) < 1e-9:
                output["result"] = "push"
            elif (row["model_pick"] == "home" and cover_margin > 0) or (row["model_pick"] == "away" and cover_margin < 0):
                output["result"] = "win"
            else:
                output["result"] = "loss"
        if row.get("market_type") == "OU" and actual_total is not None:
            total_margin = actual_total - row["market_line"]
            output["total_error"] = actual_total - row["model_projection"]
            output["projection_error"] = output["total_error"]
            if abs(total_margin) < 1e-9:
                output["result"] = "push"
            elif (row["model_pick"] == "over" and total_margin > 0) or (row["model_pick"] == "under" and total_margin < 0):
                output["result"] = "win"
            else:
                output["result"] = "loss"
        graded.append(output)
    return graded


def edge_bucket(edge: Optional[float]) -> str:
    value = abs(edge or 0.0)
    for lower, upper, label in EDGE_BUCKETS:
        if value >= lower and (upper is None or value < upper):
            return label
    return "unknown"


def _record_summary(rows: list[dict]) -> dict:
    graded = [row for row in rows if row.get("result") in {"win", "loss", "push"}]
    wins = sum(1 for row in graded if row.get("result") == "win")
    losses = sum(1 for row in graded if row.get("result") == "loss")
    pushes = sum(1 for row in graded if row.get("result") == "push")
    decisions = wins + losses
    invested = decisions
    profit = wins * (100 / 110) - losses
    projection_errors = [abs(row.get("projection_error")) for row in graded if row.get("projection_error") is not None]
    minutes = [row.get("minutes_to_kickoff") for row in rows if row.get("minutes_to_kickoff") is not None]
    return {
        "bets": len(graded),
        "wins": wins,
        "losses": losses,
        "pushes": pushes,
        "win_rate": wins / decisions if decisions else None,
        "roi_at_minus_110": profit / invested if invested else None,
        "average_edge": sum(abs(row.get("model_edge") or 0.0) for row in rows) / len(rows) if rows else None,
        "average_projection_error": sum(projection_errors) / len(projection_errors) if projection_errors else None,
        "average_minutes_to_kickoff": sum(minutes) / len(minutes) if minutes else None,
    }


def edge_bucket_analysis(graded_rows: list[dict]) -> list[dict]:
    grouped = defaultdict(list)
    for row in graded_rows:
        grouped[(row.get("market_type"), row.get("model"), edge_bucket(row.get("model_edge")))].append(row)
    return [
        {
            "market_type": market_type,
            "model": model,
            "edge_bucket": bucket,
            **_record_summary(rows),
        }
        for (market_type, model, bucket), rows in sorted(grouped.items())
    ]


def _confidence(sample_size: int) -> str:
    if sample_size >= 100:
        return "high"
    if sample_size >= 30:
        return "medium"
    return "low"


def model_agreement_analysis(graded_rows: list[dict]) -> list[dict]:
    by_game_market = defaultdict(dict)
    for row in graded_rows:
        if row.get("model_pick"):
            by_game_market[(_game_key(row), row.get("market_type"))][row.get("model")] = row
    output = []
    for group_label, models in AGREEMENT_GROUPS:
        for market_type in ("ATS", "OU"):
            agreed_rows = []
            for model_rows in by_game_market.values():
                candidates = [model_rows.get(model) for model in models]
                if any(row is None or row.get("market_type") != market_type for row in candidates):
                    continue
                picks = {row.get("model_pick") for row in candidates}
                if len(picks) == 1:
                    agreed_rows.extend(candidates)
            summary = _record_summary(agreed_rows)
            output.append({
                "group": group_label,
                "models": list(models),
                "market_type": market_type,
                "sample_size": summary["bets"],
                "confidence": _confidence(summary["bets"]),
                **summary,
            })
    return output


def apply_clv(rows: list[dict]) -> list[dict]:
    latest_line = {}
    for row in rows:
        key = (_game_key(row), row.get("market_type"))
        existing = latest_line.get(key)
        if existing is None or str(row.get("observed_at") or "") >= str(existing.get("observed_at") or ""):
            latest_line[key] = row
    output = []
    for row in rows:
        updated = dict(row)
        closing = latest_line.get((_game_key(row), row.get("market_type")))
        if closing and closing.get("observed_at") != row.get("observed_at"):
            updated["closing_line"] = closing.get("market_line")
            updated["line_movement"] = (closing.get("market_line") or 0) - (row.get("market_line") or 0)
            if row.get("market_type") == "ATS":
                updated["clv"] = row["market_line"] - closing["market_line"] if row.get("model_pick") == "home" else closing["market_line"] - row["market_line"]
            else:
                updated["clv"] = closing["market_line"] - row["market_line"] if row.get("model_pick") == "over" else row["market_line"] - closing["market_line"]
        else:
            updated["closing_line"] = None
            updated["line_movement"] = None
            updated["clv"] = None
        output.append(updated)
    return output


def clv_summary(rows: list[dict]) -> list[dict]:
    with_clv = [row for row in rows if row.get("clv") is not None]
    grouped = defaultdict(list)
    for row in with_clv:
        grouped[(row.get("market_type"), row.get("model"))].append(row)
    return [
        {
            "market_type": market_type,
            "model": model,
            "rows": len(items),
            "average_clv": sum(row.get("clv") or 0.0 for row in items) / len(items),
            "positive_clv_rate": sum(1 for row in items if (row.get("clv") or 0.0) > 0) / len(items),
        }
        for (market_type, model), items in sorted(grouped.items())
    ]


def ledger_metadata(rows: list[dict]) -> dict:
    games = {(row.get("season"), row.get("week"), row.get("game_id")) for row in rows}
    return {
        "row_count": len(rows),
        "game_count": len(games),
        "latest_observed_at": max((row.get("observed_at") or "" for row in rows), default=None),
        "store_path": str(pregame_ledger_store_path()),
    }


def edge_quality_report(completed_games: Iterable[dict], rows: Optional[list[dict]] = None) -> dict:
    rows = read_pregame_ledger() if rows is None else rows
    graded = apply_clv(grade_ledger_rows(rows, completed_games))
    return {
        "success": True,
        "experimental": True,
        "warning": "Research only. Pregame ledger analysis does not alter production model math.",
        "metadata": ledger_metadata(rows),
        "edge_buckets": edge_bucket_analysis(graded),
        "agreement_groups": model_agreement_analysis(graded),
        "clv_summary": clv_summary(graded),
        "graded_rows": graded,
    }
