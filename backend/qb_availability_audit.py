import argparse
import json
import os
from datetime import datetime, timezone
from typing import List, Optional

from nfl_predictor import load_upcoming_games


DEFAULT_JSON_REPORT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "reports", "nfl-qb-availability-audit.json"))
DEFAULT_MD_REPORT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "reports", "nfl-qb-availability-audit.md"))
DEFAULT_MNF_JSON_REPORT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "reports", "nfl-monday-night-roster-audit.json"))
DEFAULT_MNF_MD_REPORT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "reports", "nfl-monday-night-roster-audit.md"))
DEFAULT_AVAILABILITY_ADJUSTMENTS = os.path.abspath(os.path.join(os.path.dirname(__file__), "config", "nfl_upcoming_availability_adjustments.json"))


def _candidate(team: str, season: int, week: int, game_id: str, opponent: str, venue: str, game: Optional[dict] = None) -> dict:
    return {
        "season": season,
        "week": week,
        "game_id": game_id,
        "gameday": (game or {}).get("gameday") or "",
        "gametime": (game or {}).get("gametime") or "",
        "team": team,
        "opponent": opponent,
        "venue": venue,
        "expected_starter": None,
        "current_starter": None,
        "qb1_status": "UNKNOWN",
        "qb2_status": "UNKNOWN",
        "depth_change": "UNREVIEWED",
        "recommended_margin_delta": 0.0,
        "recommended_total_delta": 0.0,
        "confidence": "UNREVIEWED",
        "source": None,
        "review_notes": "Human review required before creating an availability overlay.",
        "overlay_ready": False,
        "review_scope": "QB, offensive skill players, offensive line, defensive impact inactives, and final inactive list.",
        "injury_report_status": "UNREVIEWED",
        "inactive_or_limited": [],
        "skill_position_notes": "",
        "offensive_line_notes": "",
        "defensive_inactive_notes": "",
        "final_inactives_checked": False,
        "market_recheck_required": True,
    }


def _game_id(game: dict) -> str:
    return game.get("game_id") or f"{game['season']}_{game['week']:02d}_{game['away_team']}_{game['home_team']}"


def _is_monday_game(game: dict) -> bool:
    gameday = (game.get("gameday") or "").strip()
    if not gameday:
        return False
    try:
        return datetime.strptime(gameday, "%Y-%m-%d").weekday() == 0
    except ValueError:
        return False


def _candidate_rows(games: List[dict]) -> List[dict]:
    candidates: List[dict] = []
    for game in games:
        game_id = _game_id(game)
        candidates.append(_candidate(game["away_team"], game["season"], game["week"], game_id, game["home_team"], "away", game))
        candidates.append(_candidate(game["home_team"], game["season"], game["week"], game_id, game["away_team"], "home", game))
    return candidates


def _build_audit_report(games: List[dict], season: Optional[int], week: Optional[int], audit_type: str, purpose: str, instructions: List[str]) -> dict:
    generated_at = datetime.now(timezone.utc).isoformat()
    return {
        "schema_version": 2,
        "audit_type": audit_type,
        "generated_at": generated_at,
        "season": games[0]["season"] if games else season,
        "week": games[0]["week"] if games else week,
        "games_reviewed": len(games),
        "purpose": purpose,
        "instructions": instructions,
        "candidate_overlays": _candidate_rows(games),
    }


def build_qb_availability_audit(season: Optional[int] = None, week: Optional[int] = None) -> dict:
    games = load_upcoming_games(season, week)
    return _build_audit_report(
        games,
        season,
        week,
        "weekly_qb_availability",
        "Semi-automated review artifact. It inventories upcoming teams for QB availability review but does not create active overlays automatically.",
        [
            "Fill expected_starter/current_starter/status/source fields from verified pregame sources.",
            "Set recommended deltas only when a material QB availability/depth-chart change is confirmed.",
            "Copy only human-approved records into backend/config/nfl_upcoming_availability_adjustments.json.",
        ],
    )


def build_monday_night_roster_audit(season: Optional[int] = None, week: Optional[int] = None) -> dict:
    games = [game for game in load_upcoming_games(season, week) if _is_monday_game(game)]
    return _build_audit_report(
        games,
        season,
        week,
        "monday_night_roster_availability",
        "Semi-automated Monday-night roster review artifact. It inventories both teams in Monday games for QB, skill-position, offensive-line, defensive-impact, and final-inactives review. It does not change predictions by itself.",
        [
            "Review both teams against verified pregame injury reports, beat reports, depth charts, and final inactive lists.",
            "Fill roster note fields and set final_inactives_checked only after official inactives are available.",
            "Set recommended deltas only when a material availability/depth-chart change is confirmed.",
            "Copy only human-approved records into backend/config/nfl_upcoming_availability_adjustments.json.",
        ],
    )


def write_json_report(report: dict, path: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as target:
        json.dump(report, target, indent=2)
        target.write("\n")


def _ready_adjustment_from_candidate(row: dict) -> Optional[dict]:
    if row.get("overlay_ready") is not True:
        return None
    margin_delta = float(row.get("recommended_margin_delta", 0.0) or 0.0)
    total_delta = float(row.get("recommended_total_delta", 0.0) or 0.0)
    if margin_delta == 0.0 and total_delta == 0.0:
        return None
    source = str(row.get("source") or "").strip()
    if not source:
        return None
    label = str(row.get("review_notes") or "").strip() or "Monday-night roster availability adjustment"
    return {
        "season": int(row["season"]),
        "week": int(row["week"]),
        "game_id": str(row["game_id"]).strip(),
        "team": str(row["team"]).strip().upper(),
        "margin_delta": margin_delta,
        "total_delta": total_delta,
        "label": label,
        "source": source,
    }


def _adjustment_key(record: dict) -> tuple:
    return (
        record.get("season"),
        record.get("week"),
        record.get("game_id"),
        record.get("team"),
    )


REVIEW_FIELD_NAMES = (
    "expected_starter",
    "current_starter",
    "qb1_status",
    "qb2_status",
    "depth_change",
    "recommended_margin_delta",
    "recommended_total_delta",
    "confidence",
    "source",
    "review_notes",
    "overlay_ready",
    "injury_report_status",
    "inactive_or_limited",
    "skill_position_notes",
    "offensive_line_notes",
    "defensive_inactive_notes",
    "final_inactives_checked",
    "market_recheck_required",
)


def read_json_report(path: str) -> Optional[dict]:
    try:
        with open(path, encoding="utf-8") as source:
            payload = json.load(source)
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def merge_existing_review_fields(report: dict, existing_report: Optional[dict]) -> dict:
    if not existing_report:
        return report
    existing_by_key = {
        _adjustment_key(row): row
        for row in existing_report.get("candidate_overlays") or []
        if isinstance(row, dict)
    }
    merged_rows = []
    for row in report.get("candidate_overlays") or []:
        merged = dict(row)
        previous = existing_by_key.get(_adjustment_key(row))
        if previous:
            for field in REVIEW_FIELD_NAMES:
                if field in previous:
                    merged[field] = previous[field]
        merged_rows.append(merged)
    merged_report = dict(report)
    merged_report["candidate_overlays"] = merged_rows
    return merged_report


def apply_ready_availability_adjustments(report: dict, path: str = DEFAULT_AVAILABILITY_ADJUSTMENTS) -> dict:
    """Upsert approved audit rows into the live upcoming availability adjustment config."""
    ready = []
    for row in report.get("candidate_overlays") or []:
        adjustment = _ready_adjustment_from_candidate(row)
        if adjustment:
            ready.append(adjustment)

    try:
        with open(path, encoding="utf-8") as source:
            payload = json.load(source)
    except (OSError, json.JSONDecodeError):
        payload = {}

    existing = payload.get("adjustments", []) if isinstance(payload, dict) else []
    if not isinstance(existing, list):
        existing = []

    by_key = {
        _adjustment_key(record): dict(record)
        for record in existing
        if isinstance(record, dict) and record.get("team")
    }
    inserted = 0
    updated = 0
    unchanged = 0
    for adjustment in ready:
        key = _adjustment_key(adjustment)
        previous = by_key.get(key)
        if previous == adjustment:
            unchanged += 1
        elif previous:
            updated += 1
        else:
            inserted += 1
        by_key[key] = adjustment

    merged = sorted(
        by_key.values(),
        key=lambda record: (
            record.get("season") or 0,
            record.get("week") or 0,
            record.get("game_id") or "",
            record.get("team") or "",
        ),
    )
    next_payload = {
        "schema_version": 1,
        "description": "Manual upcoming-only availability overlays applied after core NFL model projections. Positive margin_delta helps the listed team; negative hurts it. total_delta adjusts projected game total. Historical backtests and core model formulas are unchanged.",
        "adjustments": merged,
    }
    if ready:
        write_json_report(next_payload, path)
    return {
        "ready_adjustments": len(ready),
        "inserted": inserted,
        "updated": updated,
        "unchanged": unchanged,
        "path": path,
    }


def write_markdown_report(report: dict, path: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    rows = report["candidate_overlays"]
    title = "NFL Monday Night Roster Audit" if report.get("audit_type") == "monday_night_roster_availability" else "NFL QB Availability Audit"
    with open(path, "w", encoding="utf-8") as target:
        target.write(f"# {title}\n\n")
        target.write(f"Generated: {report['generated_at']}\n\n")
        target.write(f"Season: {report.get('season')}  \n")
        target.write(f"Week: {report.get('week')}\n\n")
        target.write(f"Games reviewed: {report.get('games_reviewed', 0)}\n\n")
        target.write("This is a semi-automated review artifact. It does not change predictions by itself.\n\n")
        target.write("To activate an overlay, manually review sources and copy an approved record into `backend/config/nfl_upcoming_availability_adjustments.json`.\n\n")
        target.write("| Game | Date | Time | Team | Venue | Expected QB | Current QB | QB1 | QB2 | Injury report | Final inactives | Recommended margin | Recommended total | Confidence | Source | Notes |\n")
        target.write("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- |\n")
        for row in rows:
            target.write(
                f"| {row['game_id']} | {row.get('gameday', '')} | {row.get('gametime', '')} | {row['team']} | {row['venue']} | "
                f"{row['expected_starter'] or ''} | {row['current_starter'] or ''} | "
                f"{row['qb1_status']} | {row['qb2_status']} | "
                f"{row.get('injury_report_status', 'UNREVIEWED')} | {row.get('final_inactives_checked') is True} | "
                f"{row['recommended_margin_delta']:.1f} | {row['recommended_total_delta']:.1f} | "
                f"{row['confidence']} | {row['source'] or ''} | {row['review_notes']} |\n"
            )


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a semi-automated NFL QB availability review artifact.")
    parser.add_argument("--season", type=int)
    parser.add_argument("--week", type=int)
    parser.add_argument("--monday-night-only", action="store_true", help="Limit the artifact to Monday games and include broader roster-review fields")
    parser.add_argument("--apply-ready-adjustments", action="store_true", help="Upsert overlay_ready rows with nonzero deltas into the live availability-adjustments config")
    parser.add_argument("--json", help="JSON report path")
    parser.add_argument("--markdown", help="Markdown report path")
    args = parser.parse_args()

    if args.monday_night_only:
        report = build_monday_night_roster_audit(args.season, args.week)
        json_path = args.json or DEFAULT_MNF_JSON_REPORT
        markdown_path = args.markdown or DEFAULT_MNF_MD_REPORT
    else:
        report = build_qb_availability_audit(args.season, args.week)
        json_path = args.json or DEFAULT_JSON_REPORT
        markdown_path = args.markdown or DEFAULT_MD_REPORT
    write_json_report(report, json_path)
    write_markdown_report(report, markdown_path)
    apply_result = apply_ready_availability_adjustments(report) if args.apply_ready_adjustments else None
    print(f"Wrote {len(report['candidate_overlays'])} {report['audit_type']} review rows.")
    print(f"JSON: {json_path}")
    print(f"Markdown: {markdown_path}")
    if apply_result:
        print(f"Applied {apply_result['ready_adjustments']} ready availability adjustments to {apply_result['path']}.")


if __name__ == "__main__":
    main()
