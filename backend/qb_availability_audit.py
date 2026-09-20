import argparse
import json
import os
from datetime import datetime, timezone
from typing import List, Optional

from nfl_predictor import load_upcoming_games


DEFAULT_JSON_REPORT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "reports", "nfl-qb-availability-audit.json"))
DEFAULT_MD_REPORT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "reports", "nfl-qb-availability-audit.md"))


def _candidate(team: str, season: int, week: int, game_id: str, opponent: str, venue: str) -> dict:
    return {
        "season": season,
        "week": week,
        "game_id": game_id,
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
    }


def build_qb_availability_audit(season: Optional[int] = None, week: Optional[int] = None) -> dict:
    games = load_upcoming_games(season, week)
    generated_at = datetime.now(timezone.utc).isoformat()
    candidates: List[dict] = []
    for game in games:
        game_id = game.get("game_id") or f"{game['season']}_{game['week']:02d}_{game['away_team']}_{game['home_team']}"
        candidates.append(_candidate(game["away_team"], game["season"], game["week"], game_id, game["home_team"], "away"))
        candidates.append(_candidate(game["home_team"], game["season"], game["week"], game_id, game["away_team"], "home"))
    return {
        "schema_version": 1,
        "generated_at": generated_at,
        "season": games[0]["season"] if games else season,
        "week": games[0]["week"] if games else week,
        "purpose": "Semi-automated review artifact. It inventories upcoming teams for QB availability review but does not create active overlays automatically.",
        "instructions": [
            "Fill expected_starter/current_starter/status/source fields from verified pregame sources.",
            "Set recommended deltas only when a material QB availability/depth-chart change is confirmed.",
            "Copy only human-approved records into backend/config/nfl_upcoming_availability_adjustments.json.",
        ],
        "candidate_overlays": candidates,
    }


def write_json_report(report: dict, path: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as target:
        json.dump(report, target, indent=2)
        target.write("\n")


def write_markdown_report(report: dict, path: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    rows = report["candidate_overlays"]
    with open(path, "w", encoding="utf-8") as target:
        target.write("# NFL QB Availability Audit\n\n")
        target.write(f"Generated: {report['generated_at']}\n\n")
        target.write(f"Season: {report.get('season')}  \n")
        target.write(f"Week: {report.get('week')}\n\n")
        target.write("This is a semi-automated review artifact. It does not change predictions by itself.\n\n")
        target.write("To activate an overlay, manually review sources and copy an approved record into `backend/config/nfl_upcoming_availability_adjustments.json`.\n\n")
        target.write("| Game | Team | Venue | Expected QB | Current QB | QB1 | QB2 | Recommended margin | Recommended total | Confidence | Source | Notes |\n")
        target.write("| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- |\n")
        for row in rows:
            target.write(
                f"| {row['game_id']} | {row['team']} | {row['venue']} | "
                f"{row['expected_starter'] or ''} | {row['current_starter'] or ''} | "
                f"{row['qb1_status']} | {row['qb2_status']} | "
                f"{row['recommended_margin_delta']:.1f} | {row['recommended_total_delta']:.1f} | "
                f"{row['confidence']} | {row['source'] or ''} | {row['review_notes']} |\n"
            )


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a semi-automated NFL QB availability review artifact.")
    parser.add_argument("--season", type=int)
    parser.add_argument("--week", type=int)
    parser.add_argument("--json", default=DEFAULT_JSON_REPORT, help="JSON report path")
    parser.add_argument("--markdown", default=DEFAULT_MD_REPORT, help="Markdown report path")
    args = parser.parse_args()

    report = build_qb_availability_audit(args.season, args.week)
    write_json_report(report, args.json)
    write_markdown_report(report, args.markdown)
    print(f"Wrote {len(report['candidate_overlays'])} QB availability review rows.")
    print(f"JSON: {args.json}")
    print(f"Markdown: {args.markdown}")


if __name__ == "__main__":
    main()
