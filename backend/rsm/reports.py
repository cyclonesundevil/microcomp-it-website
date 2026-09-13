import csv
import json
from dataclasses import asdict
from pathlib import Path
from typing import Dict, Iterable, List

from .config import RSMConfig
from .schema import PlayerRating, TeamRating


TEAM_FIELDS = [
    "team", "qb_rating", "rb_rating", "wr_rating", "te_rating",
    "ol_pass_rating", "ol_run_rating", "ol_overall_rating",
    "pass_offense_rating", "run_offense_rating", "offense_rating",
    "dl_rating", "edge_rating", "lb_rating", "cb_rating", "safety_rating",
    "pass_defense_rating", "run_defense_rating", "defense_rating",
    "kicker_rating", "roster_rating", "offense_rank", "defense_rank",
    "roster_rank", "lineup_confidence", "roster_timestamp", "model_version",
]


def _ranks(teams: List[TeamRating], attribute: str) -> Dict[str, int]:
    ordered = sorted(teams, key=lambda team: getattr(team, attribute), reverse=True)
    return {team.team: rank for rank, team in enumerate(ordered, start=1)}


def write_team_report(path: Path, teams: Iterable[TeamRating], config: RSMConfig) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = list(teams)
    offense_ranks = _ranks(rows, "offense_rating")
    defense_ranks = _ranks(rows, "defense_rating")
    roster_ranks = _ranks(rows, "roster_rating")
    with path.open("w", newline="", encoding="utf-8") as destination:
        writer = csv.DictWriter(destination, fieldnames=TEAM_FIELDS)
        writer.writeheader()
        for team in sorted(rows, key=lambda row: roster_ranks[row.team]):
            row = {field: getattr(team, field) for field in TEAM_FIELDS if hasattr(team, field)}
            row.update({
                "offense_rank": offense_ranks[team.team],
                "defense_rank": defense_ranks[team.team],
                "roster_rank": roster_ranks[team.team],
                "model_version": config.model_version,
            })
            writer.writerow(row)


def write_player_report(path: Path, ratings: Dict[str, PlayerRating], config: RSMConfig) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "player_id", "name", "team", "position", "rating", "uncertainty",
        "seasons_used", "opportunities", "data_confidence", "as_of_season",
        "as_of_week", "model_version", "explanation",
    ]
    with path.open("w", newline="", encoding="utf-8") as destination:
        writer = csv.DictWriter(destination, fieldnames=fields)
        writer.writeheader()
        for rating in sorted(ratings.values(), key=lambda row: (row.team, row.position, -row.rating, row.name)):
            row = asdict(rating)
            row["model_version"] = config.model_version
            row["explanation"] = json.dumps(row["explanation"], sort_keys=True, separators=(",", ":"))
            writer.writerow(row)


def write_snapshot(path: Path, teams: Iterable[TeamRating], source_manifest: dict, config: RSMConfig) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "model_version": config.model_version,
        "config_digest": config.digest(),
        "data_timestamp": source_manifest.get("created_at"),
        "roster_version": next(iter(teams)).roster_timestamp if teams else None,
        "source_manifest": source_manifest,
        "teams": [asdict(team) for team in teams],
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def write_data_quality_report(
    path: Path,
    roster_rows: List[dict],
    depth_rows: List[dict],
    ratings: Dict[str, PlayerRating],
    teams: List[TeamRating],
    roster_timestamp: str,
    config: RSMConfig,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    starter_rows = [player for team in teams for player in team.starters]
    known_starters = [player for player in starter_rows if player.player_id in ratings]
    low_confidence = [rating for rating in ratings.values() if rating.data_confidence == "LOW"]
    rookies = [row for row in roster_rows if int(float(row.get("years_exp") or 0)) == 0]
    team_count = len({row.get("team") for row in roster_rows})
    content = f"""# RSM Data Quality Report

Generated for `{config.model_version}` using the depth-chart snapshot `{roster_timestamp}`.

| Measure | Value |
|---|---:|
| Teams in current roster | {team_count} |
| Teams with generated ratings | {len(teams)} |
| Current roster players | {len(roster_rows)} |
| Players with stable GSIS IDs and ratings | {len(ratings)} |
| Depth-chart records in selected snapshot | {len(depth_rows)} |
| Expected starter slots selected | {len(starter_rows)} |
| Starter slots joined to a player rating | {len(known_starters)} ({(100 * len(known_starters) / len(starter_rows)) if starter_rows else 0:.1f}%) |
| Low-confidence player ratings | {len(low_confidence)} |
| Rookies on current roster | {len(rookies)} |
| Historical injury coverage after 2024 | unavailable from selected source |
| Individual OL block-quality coverage | unavailable from selected source |

## Missingness policy

Missing player history is represented by the configured replacement prior and high uncertainty. It is not filled with future statistics. Unavailable injury and OL block-quality fields are reported above and are not silently synthesized.

## Confidence warning

Checkpoint-one ratings are structural priors for sanity checking. They are not yet calibrated expected points, ATS probabilities, or betting recommendations.
"""
    path.write_text(content, encoding="utf-8")
