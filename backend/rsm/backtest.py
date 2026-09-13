import csv
import json
import math
import statistics
from dataclasses import replace
from pathlib import Path
from typing import Dict, Iterable, List, Sequence

from .config import DEFAULT_CONFIG, RSMConfig
from .data import (
    DEFAULT_DATA_ROOT,
    enrich_roster_ids,
    load_games,
    load_player_stats,
    load_roster_snapshot_rows,
    load_snap_counts,
    read_csv,
    update_backtest_sources,
)
from .historical_lineups import infer_expected_lineups
from .ratings import (
    aggregate_player_stats,
    aggregate_snap_counts,
    build_player_ratings,
    build_team_ratings,
    update_player_stat_aggregates,
    update_snap_aggregates,
)
from .schema import Game
from .score_model import predict_score


def _metrics(records: Iterable[dict]) -> dict:
    rows = list(records)
    if not rows:
        return {"games": 0, "score_mae": None, "margin_mae": None, "total_mae": None, "score_rmse": None}
    score_errors = [error for row in rows for error in (row["home_error"], row["away_error"])]
    margin_errors = [row["predicted_margin"] - row["actual_margin"] for row in rows]
    total_errors = [row["predicted_total"] - row["actual_total"] for row in rows]
    return {
        "games": len(rows),
        "score_mae": round(statistics.mean(abs(value) for value in score_errors), 3),
        "margin_mae": round(statistics.mean(abs(value) for value in margin_errors), 3),
        "total_mae": round(statistics.mean(abs(value) for value in total_errors), 3),
        "score_rmse": round(math.sqrt(statistics.mean(value * value for value in score_errors)), 3),
    }


def evaluate_games(
    games: Iterable[Game],
    ratings: Dict[str, object],
    config: RSMConfig = DEFAULT_CONFIG,
) -> List[dict]:
    records = []
    for game in games:
        home = ratings.get(game.home_team)
        away = ratings.get(game.away_team)
        if home is None or away is None or game.home_score is None or game.away_score is None:
            continue
        prediction = predict_score(home, away, config)
        actual_margin = game.home_score - game.away_score
        actual_total = game.home_score + game.away_score
        records.append({
            "game_id": game.game_id,
            "season": game.season,
            "week": game.week,
            "game_type": game.game_type,
            "away_team": game.away_team,
            "home_team": game.home_team,
            "expected_away_points": prediction.expected_away_points,
            "expected_home_points": prediction.expected_home_points,
            "away_score": game.away_score,
            "home_score": game.home_score,
            "predicted_margin": prediction.predicted_margin,
            "actual_margin": actual_margin,
            "predicted_total": prediction.predicted_total,
            "actual_total": actual_total,
            "home_qb_rating": home.qb_rating,
            "away_qb_rating": away.qb_rating,
            "home_ol_rating": home.ol_overall_rating,
            "away_ol_rating": away.ol_overall_rating,
            "home_receiving_rating": round((home.wr_rating + home.te_rating) / 2.0, 3),
            "away_receiving_rating": round((away.wr_rating + away.te_rating) / 2.0, 3),
            "home_pass_offense_rating": home.pass_offense_rating,
            "away_pass_offense_rating": away.pass_offense_rating,
            "home_run_offense_rating": home.run_offense_rating,
            "away_run_offense_rating": away.run_offense_rating,
            "home_pass_defense_rating": home.pass_defense_rating,
            "away_pass_defense_rating": away.pass_defense_rating,
            "home_run_defense_rating": home.run_defense_rating,
            "away_run_defense_rating": away.run_defense_rating,
            "home_kicker_rating": home.kicker_rating,
            "away_kicker_rating": away.kicker_rating,
            "home_error": prediction.expected_home_points - game.home_score,
            "away_error": prediction.expected_away_points - game.away_score,
            "market_spread": game.market_spread,
            "market_total": game.market_total,
        })
    return records


def run_checkpoint_two(
    seasons: Sequence[int] = (2024, 2025),
    data_root: Path = DEFAULT_DATA_ROOT,
    reports_root: Path | None = None,
    refresh: bool = False,
    config: RSMConfig = DEFAULT_CONFIG,
    report_stem: str = "rsm-v0",
) -> tuple[List[dict], dict]:
    targets = sorted(set(seasons))
    v0_config = replace(config, model_version="RSM-v0-checkpoint2")
    reports_root = reports_root or Path(__file__).resolve().parents[2] / "reports"
    manifest_path = data_root / "backtest-source-manifest.json"
    required_weekly_rosters = [data_root / "raw" / f"weekly_roster_{season}.csv" for season in targets]
    existing_manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    manifest_targets = set(existing_manifest.get("target_seasons", []))
    if (
        refresh
        or not manifest_path.exists()
        or any(not path.exists() for path in required_weekly_rosters)
        or not set(targets).issubset(manifest_targets)
    ):
        manifest = update_backtest_sources(targets, config.history_seasons, data_root, refresh=refresh)
    else:
        manifest = existing_manifest

    raw = data_root / "raw"
    first_history = min(targets) - config.history_seasons + 1
    history_years = range(first_history, max(targets) + 1)
    stat_paths = [raw / f"stats_{year}.csv" for year in history_years]
    snap_paths = [raw / f"snaps_{year}.csv" for year in history_years]
    # Load once; each weekly cutoff below filters this immutable source pool.
    all_stats = load_player_stats(stat_paths, max(targets) + 1, 1)
    all_snaps = load_snap_counts(snap_paths, max(targets) + 1, 1)
    games = [game for game in load_games(data_root.parent / "nfl_games.csv", targets) if game.game_type == "REG"]

    records: List[dict] = []
    for season in targets:
        season_games = [game for game in games if game.season == season]
        roster_path = raw / f"weekly_roster_{season}.csv"
        season_rosters = enrich_roster_ids(read_csv(roster_path), raw / "players.csv")
        history_stats = [row for row in all_stats if int(row.get("season") or 0) < season]
        history_snaps = [row for row in all_snaps if int(row.get("season") or 0) < season]
        stat_aggregates = aggregate_player_stats(history_stats)
        snap_aggregates = aggregate_snap_counts(history_snaps)
        eligible_snaps = list(history_snaps)
        processed_week = 0
        for week in sorted({game.week for game in season_games}):
            new_stats = [
                row for row in all_stats
                if int(row.get("season") or 0) == season
                and processed_week < int(row.get("week") or 0) < week
            ]
            new_snaps = [
                row for row in all_snaps
                if int(row.get("season") or 0) == season
                and processed_week < int(row.get("week") or 0) < week
            ]
            update_player_stat_aggregates(stat_aggregates, new_stats)
            update_snap_aggregates(snap_aggregates, new_snaps)
            eligible_snaps.extend(new_snaps)
            processed_week = week - 1
            week_games = [game for game in season_games if game.week == week]
            roster = load_roster_snapshot_rows(season_rosters, week)
            week_config = replace(v0_config, current_season=season, current_week=week)
            players = build_player_ratings(
                roster, [], [], week_config,
                stat_aggregates=stat_aggregates, snap_aggregates=snap_aggregates,
            )
            lineups = infer_expected_lineups(
                roster, eligible_snaps, players, season, week, f"{season}_W{week}_PREGAME", week_config,
            )
            team_rows = build_team_ratings(
                roster, [], players, f"{season}-W{week}-pregame-proxy", week_config, lineups_override=lineups,
            )
            records.extend(evaluate_games(week_games, {row.team: row for row in team_rows}, week_config))

    if len(records) != len(games):
        predicted_ids = {row["game_id"] for row in records}
        missing_ids = [game.game_id for game in games if game.game_id not in predicted_ids]
        raise RuntimeError(
            f"Checkpoint two refused partial coverage: predicted {len(records)} of {len(games)} games; "
            f"missing {', '.join(missing_ids[:10])}"
        )

    summary = {
        "model_version": "RSM-v0-checkpoint2",
        "target_seasons": targets,
        "config_digest": v0_config.digest(),
        "source_manifest_created_at": manifest.get("created_at"),
        "overall": _metrics(records),
        "by_season": {str(season): _metrics(row for row in records if row["season"] == season) for season in targets},
        "eligible_games": len(games),
        "predicted_games": len(records),
    }
    _write_checkpoint_two_reports(reports_root, records, summary, report_stem)
    return records, summary


def _write_checkpoint_two_reports(
    reports_root: Path,
    records: List[dict],
    summary: dict,
    report_stem: str = "rsm-v0",
) -> None:
    reports_root.mkdir(parents=True, exist_ok=True)
    csv_path = reports_root / f"{report_stem}-predictions.csv"
    if records:
        with csv_path.open("w", newline="", encoding="utf-8") as destination:
            writer = csv.DictWriter(destination, fieldnames=list(records[0]))
            writer.writeheader()
            writer.writerows(records)
    lines = [
        "# RSM-v0 Checkpoint Two",
        "",
        "This is an unoptimized, market-independent score baseline. Market columns are retained only for later comparison and are not inputs to `predict_score`.",
        "",
        "Historical starters are pregame proxies inferred from the target week's roster identity and snap participation strictly before that game. Historical injury status is not used.",
        "",
        "| Split | Games | Score MAE | Margin MAE | Total MAE | Score RMSE |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for label, metrics in [("Overall", summary["overall"]), *summary["by_season"].items()]:
        lines.append(
            f"| {label} | {metrics['games']} | {metrics['score_mae']} | {metrics['margin_mae']} | "
            f"{metrics['total_mae']} | {metrics['score_rmse']} |"
        )
    lines += [
        "",
        f"Eligible regular-season games: {summary['eligible_games']}",
        f"Predicted regular-season games: {summary['predicted_games']}",
        "",
        "Known limitation: weekly nflverse rosters identify the available player pool, but their publication timestamp is not precise enough to use retrospective injury/status fields without leakage risk. Checkpoint two therefore uses identity/team/position only.",
    ]
    (reports_root / f"{report_stem}-backtest.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (reports_root / f"{report_stem}-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
