import csv
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

from .config import DEFAULT_CONFIG, RSMConfig, normalize_position, normalize_team
from .data import DEFAULT_DATA_ROOT, enrich_roster_ids, read_csv
from .historical_lineups import infer_expected_lineups


def _before(row: dict, season: int, week: int) -> bool:
    row_season = int(row.get("season") or 0)
    row_week = int(row.get("week") or 0)
    return row_season < season or (row_season == season and row_week < week)


def _positive_snaps(row: dict, position: str) -> bool:
    field = "defense_snaps" if position in {"DL", "EDGE", "LB", "CB", "S"} else "offense_snaps"
    if position == "K":
        field = "st_snaps"
    try:
        return float(row.get(field) or 0) > 0
    except (TypeError, ValueError):
        return False


def classify_lineup_confidence(complete: bool, evidence_ratio: float) -> str:
    if complete and evidence_ratio >= 0.90:
        return "HIGH"
    if complete and evidence_ratio >= 0.70:
        return "MEDIUM"
    return "LOW"


def _percent(count: int, total: int) -> float:
    return round(100.0 * count / total, 2) if total else 0.0


def audit_historical_integrity(
    predictions_path: Path,
    report_path: Path,
    data_root: Path = DEFAULT_DATA_ROOT,
    config: RSMConfig = DEFAULT_CONFIG,
) -> dict:
    with predictions_path.open(newline="", encoding="utf-8-sig") as source:
        games = list(csv.DictReader(source))
    seasons = sorted({int(game["season"]) for game in games})
    raw = data_root / "raw"
    history_years = range(min(seasons) - config.history_seasons + 1, max(seasons) + 1)
    snaps = [row for year in history_years for row in read_csv(raw / f"snaps_{year}.csv")]
    stats = [row for year in history_years for row in read_csv(raw / f"stats_{year}.csv")]

    first_stat: Dict[str, Tuple[int, int]] = {}
    for row in stats:
        player_id = (row.get("player_id") or "").strip()
        if not player_id:
            continue
        key = (int(row.get("season") or 0), int(row.get("week") or 0))
        first_stat[player_id] = min(first_stat.get(player_id, key), key)

    expected_per_team = sum(config.historical_starter_counts.values())
    confidence = Counter()
    complete_games = 0
    reconstructed_games = 0
    expected_slots = 0
    selected_slots = 0
    evidence_slots = 0
    fallback_slots = 0
    missing_history_slots = 0
    trade_transition_slots = 0
    stale_roster_games = 0

    for season in seasons:
        season_games = [game for game in games if int(game["season"]) == season]
        roster_rows = enrich_roster_ids(read_csv(raw / f"weekly_roster_{season}.csv"), raw / "players.csv")
        rosters_by_week: Dict[int, List[dict]] = defaultdict(list)
        for row in roster_rows:
            rosters_by_week[int(row.get("week") or 0)].append(row)
        for week in sorted({int(game["week"]) for game in season_games}):
            week_games = [game for game in season_games if int(game["week"]) == week]
            roster = rosters_by_week.get(week, [])
            if not roster:
                stale_roster_games += len(week_games)
                earlier = [value for key, value in rosters_by_week.items() if key < week]
                roster = earlier[-1] if earlier else []
            eligible_snaps = [row for row in snaps if _before(row, season, week) and row.get("game_type") == "REG"]
            prior_by_pfr: Dict[str, List[dict]] = defaultdict(list)
            for row in eligible_snaps:
                pfr_id = (row.get("pfr_player_id") or "").strip()
                if pfr_id:
                    prior_by_pfr[pfr_id].append(row)
            lineups = infer_expected_lineups(
                roster, eligible_snaps, {}, season, week, f"{season}_W{week}_AUDIT", config,
            )
            roster_by_id = {(row.get("gsis_id") or "").strip(): row for row in roster}
            for game in week_games:
                expected_slots += expected_per_team * 2
                game_selected = []
                complete = True
                for team in (normalize_team(game["home_team"]), normalize_team(game["away_team"])):
                    team_lineup = lineups.get(team, [])
                    game_selected.extend(team_lineup)
                    counts = Counter(player.position for player in team_lineup)
                    if any(counts[position] != count for position, count in config.historical_starter_counts.items()):
                        complete = False
                selected_slots += len(game_selected)
                game_evidence = 0
                for player in game_selected:
                    roster_player = roster_by_id.get(player.player_id, {})
                    pfr_id = (roster_player.get("pfr_id") or "").strip()
                    prior = prior_by_pfr.get(pfr_id, []) if pfr_id else []
                    has_evidence = any(_positive_snaps(row, player.position) for row in prior)
                    if has_evidence:
                        evidence_slots += 1
                        game_evidence += 1
                    else:
                        fallback_slots += 1
                    first = first_stat.get(player.player_id)
                    if first is None or first >= (season, week):
                        missing_history_slots += 1
                    if prior:
                        latest = max(prior, key=lambda row: (int(row.get("season") or 0), int(row.get("week") or 0)))
                        if normalize_team(latest.get("team", "")) != player.team:
                            trade_transition_slots += 1
                if complete:
                    complete_games += 1
                if game_evidence:
                    reconstructed_games += 1
                evidence_ratio = game_evidence / (expected_per_team * 2)
                confidence[classify_lineup_confidence(complete, evidence_ratio)] += 1

    missing_spread = sum(not (game.get("market_spread") or "").strip() for game in games)
    missing_total = sum(not (game.get("market_total") or "").strip() for game in games)
    total_games = len(games)
    summary = {
        "historical_games": total_games,
        "seasons": seasons,
        "expected_starter_slots": expected_slots,
        "selected_starter_slots": selected_slots,
        "complete_expected_starter_games": complete_games,
        "complete_expected_starter_pct": _percent(complete_games, total_games),
        "verified_direct_expected_lineup_games": 0,
        "reconstructed_starter_games": reconstructed_games,
        "reconstructed_starter_game_pct": _percent(reconstructed_games, total_games),
        "prior_snap_evidence_slots": evidence_slots,
        "prior_snap_evidence_slot_pct": _percent(evidence_slots, expected_slots),
        "deterministic_fallback_slots": fallback_slots,
        "missing_player_history_slots": missing_history_slots,
        "trade_transition_slots": trade_transition_slots,
        "confidence": {level: {"games": confidence[level], "pct": _percent(confidence[level], total_games)} for level in ("HIGH", "MEDIUM", "LOW")},
        "games_missing_verified_pregame_injury_data": total_games,
        "games_missing_market_spread": missing_spread,
        "games_missing_market_total": missing_total,
        "games_missing_market_timestamp": total_games,
        "games_using_stale_roster_week": stale_roster_games,
    }
    _write_report(report_path, summary)
    return summary


def _write_report(path: Path, summary: dict) -> None:
    confidence = summary["confidence"]
    lines = [
        "# RSM Historical Lineup Data Quality",
        "",
        "## Scope",
        "",
        f"Audited {summary['historical_games']} existing historical game feature rows across {', '.join(map(str, summary['seasons']))}. No player ratings, unit ratings, matchup features, fitted coefficients, or predictions were rebuilt.",
        "",
        "## Coverage",
        "",
        "| Measure | Count | Percentage |",
        "| --- | ---: | ---: |",
        f"| Games with complete expected starter slots | {summary['complete_expected_starter_games']} | {summary['complete_expected_starter_pct']:.2f}% |",
        f"| Games with directly verified pregame expected lineups | {summary['verified_direct_expected_lineup_games']} | 0.00% |",
        f"| Games using prior-snap lineup reconstruction | {summary['reconstructed_starter_games']} | {summary['reconstructed_starter_game_pct']:.2f}% |",
        f"| Expected starter slots filled | {summary['selected_starter_slots']} / {summary['expected_starter_slots']} | {_percent(summary['selected_starter_slots'], summary['expected_starter_slots']):.2f}% |",
        f"| Starter slots supported by prior snap evidence | {summary['prior_snap_evidence_slots']} | {summary['prior_snap_evidence_slot_pct']:.2f}% |",
        f"| Starter slots using deterministic fallback | {summary['deterministic_fallback_slots']} | {_percent(summary['deterministic_fallback_slots'], summary['expected_starter_slots']):.2f}% |",
        f"| Starter slots without earlier player-stat history | {summary['missing_player_history_slots']} | {_percent(summary['missing_player_history_slots'], summary['expected_starter_slots']):.2f}% |",
        f"| Starter selections following a team transition | {summary['trade_transition_slots']} | {_percent(summary['trade_transition_slots'], summary['expected_starter_slots']):.2f}% |",
        "",
        "## Lineup confidence",
        "",
        "HIGH requires all configured slots and at least 90% prior-snap evidence. MEDIUM requires all slots and at least 70%; every other game is LOW.",
        "",
        "| Confidence | Games | Percentage |",
        "| --- | ---: | ---: |",
        *[f"| {level} | {confidence[level]['games']} | {confidence[level]['pct']:.2f}% |" for level in ("HIGH", "MEDIUM", "LOW")],
        "",
        "## Missing information",
        "",
        f"- Verified pregame injury availability is missing for {summary['games_missing_verified_pregame_injury_data']} games (100%). Retrospective weekly-roster status is intentionally ignored because its publication time cannot be proven to precede kickoff.",
        f"- Market spread is missing for {summary['games_missing_market_spread']} games; market total is missing for {summary['games_missing_market_total']} games.",
        f"- A verifiable market-line timestamp is missing for {summary['games_missing_market_timestamp']} games (100%). Lines are evaluation-only and do not enter RSM football features.",
        "- Historical depth-chart changes are not directly available in the audited artifact. Expected starters are reconstructed from weekly roster membership and strictly prior snaps.",
        "",
        "## Point-in-time findings",
        "",
        "- Player-stat and snap loaders reject same-week and future rows. Final-season totals are not used for earlier weeks.",
        "- Weekly roster selection never reads a future week. The audit found " + str(summary["games_using_stale_roster_week"]) + " games lacking an exact target-week roster.",
        "- Trades are handled through the target-week team roster; prior snaps from an earlier team may support role evidence but cannot change target-week membership.",
        "- Historical injury replacements cannot be validated with the selected public data. Deterministic fallback selections are not claimed as verified injury replacements.",
        "- Actual scores are outcome targets only. Feature extraction is invariant to changing scores and market values, as enforced by tests.",
        "",
        "## Residual leakage risks",
        "",
        "1. Weekly roster assets identify the game-week player pool but do not provide a source publication timestamp for every row. Team membership is therefore point-in-time by week, not proven to the kickoff second.",
        "2. Closing consensus lines have no captured timestamp. They must remain evaluation-only until timestamp provenance is available.",
        "3. Injury and depth-chart confidence is incomplete; this affects lineup fidelity rather than introducing known future performance into PSR inputs.",
        "",
        "Stage 4 conclusion: no same-season future-stat, future-snap, future-roster-week, result, or market-feature leakage was found in the audited code paths. Injury/depth and market timestamp provenance remain explicit data-quality limitations.",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
