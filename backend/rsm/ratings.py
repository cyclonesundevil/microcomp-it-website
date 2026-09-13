import math
import statistics
from collections import defaultdict
from typing import Dict, Iterable, List, Optional, Tuple

from .config import DEFAULT_CONFIG, RSMConfig, normalize_position, normalize_team
from .schema import LineupPlayer, PlayerRating, TeamRating


COUNTING_FIELDS = {
    "completions", "attempts", "passing_yards", "passing_tds", "passing_interceptions",
    "sacks_suffered", "passing_first_downs", "passing_epa", "carries", "rushing_yards",
    "rushing_tds", "rushing_first_downs", "rushing_epa", "rushing_fumbles_lost",
    "receptions", "targets", "receiving_yards", "receiving_tds", "receiving_first_downs",
    "receiving_epa", "receiving_20", "receiving_fumbles_lost", "def_tackles_solo",
    "def_tackle_assists", "def_tackles_for_loss", "def_fumbles_forced", "def_sacks",
    "def_qb_hits", "def_interceptions", "def_pass_defended", "fg_made", "fg_att",
    "fg_made_50_59", "fg_made_60_", "pat_made", "pat_att",
}


def _number(value, default: float = 0.0) -> float:
    if value is None:
        return default
    text = str(value).strip().replace("%", "")
    if not text:
        return default
    try:
        return float(text)
    except ValueError:
        return default


def _divide(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator > 0 else 0.0


def _weighted_average(values: Iterable[Tuple[float, float]], default: float = 50.0) -> float:
    entries = [(value, weight) for value, weight in values if weight > 0]
    total = sum(weight for _, weight in entries)
    return sum(value * weight for value, weight in entries) / total if total else default


def aggregate_player_stats(rows: Iterable[dict]) -> Dict[Tuple[str, int], dict]:
    aggregates: Dict[Tuple[str, int], dict] = {}
    update_player_stat_aggregates(aggregates, rows)
    return aggregates


def update_player_stat_aggregates(aggregates: Dict[Tuple[str, int], dict], rows: Iterable[dict]) -> None:
    for row in rows:
        player_id = (row.get("player_id") or "").strip()
        if not player_id:
            continue
        season = int(row.get("season") or 0)
        key = (player_id, season)
        aggregate = aggregates.setdefault(key, {
            "player_id": player_id,
            "season": season,
            "name": row.get("player_display_name") or row.get("player_name") or player_id,
            "team": normalize_team(row.get("team", "")),
            "position": normalize_position(row.get("position", "")),
            "games": 0.0,
        })
        aggregate["games"] += 1.0
        aggregate["team"] = normalize_team(row.get("team", ""))
        for field in COUNTING_FIELDS:
            aggregate[field] = aggregate.get(field, 0.0) + _number(row.get(field))


def aggregate_snap_counts(rows: Iterable[dict]) -> Dict[Tuple[str, int], dict]:
    aggregates: Dict[Tuple[str, int], dict] = {}
    update_snap_aggregates(aggregates, rows)
    return aggregates


def update_snap_aggregates(aggregates: Dict[Tuple[str, int], dict], rows: Iterable[dict]) -> None:
    for row in rows:
        player_id = (row.get("pfr_player_id") or "").strip()
        if not player_id:
            continue
        season = int(row.get("season") or 0)
        aggregate = aggregates.setdefault((player_id, season), {
            "offense_snaps": 0.0,
            "defense_snaps": 0.0,
            "st_snaps": 0.0,
            "games": 0.0,
        })
        aggregate["offense_snaps"] += _number(row.get("offense_snaps"))
        aggregate["defense_snaps"] += _number(row.get("defense_snaps"))
        aggregate["st_snaps"] += _number(row.get("st_snaps"))
        aggregate["games"] += 1.0


def _components(position: str, stats: dict, snaps: dict, experience: float) -> Tuple[Dict[str, float], float]:
    if position == "QB":
        dropbacks = stats.get("attempts", 0.0) + stats.get("sacks_suffered", 0.0)
        carries = stats.get("carries", 0.0)
        return {
            "epa": _divide(stats.get("passing_epa", 0.0), dropbacks),
            "yards": _divide(stats.get("passing_yards", 0.0), stats.get("attempts", 0.0)),
            "td": _divide(stats.get("passing_tds", 0.0), dropbacks),
            "int": _divide(stats.get("passing_interceptions", 0.0), dropbacks),
            "sack": _divide(stats.get("sacks_suffered", 0.0), dropbacks),
            "rush_epa": _divide(stats.get("rushing_epa", 0.0), carries),
        }, dropbacks
    if position == "RB":
        carries = stats.get("carries", 0.0)
        targets = stats.get("targets", 0.0)
        touches = carries + targets
        return {
            "rush_epa": _divide(stats.get("rushing_epa", 0.0), carries),
            "yards": _divide(stats.get("rushing_yards", 0.0), carries),
            "first_down": _divide(stats.get("rushing_first_downs", 0.0), carries),
            "receive_epa": _divide(stats.get("receiving_epa", 0.0), targets),
            "fumble": _divide(stats.get("rushing_fumbles_lost", 0.0) + stats.get("receiving_fumbles_lost", 0.0), touches),
        }, touches
    if position in {"WR", "TE"}:
        targets = stats.get("targets", 0.0)
        result = {
            "receive_epa": _divide(stats.get("receiving_epa", 0.0), targets),
            "yards": _divide(stats.get("receiving_yards", 0.0), targets),
            "first_down": _divide(stats.get("receiving_first_downs", 0.0), targets),
            "explosive": _divide(stats.get("receiving_20", 0.0), targets),
            "td": _divide(stats.get("receiving_tds", 0.0), targets),
        }
        if position == "TE":
            result["snap"] = min(1.0, _divide(snaps.get("offense_snaps", 0.0), snaps.get("games", 0.0) * 65.0))
        return result, max(targets, snaps.get("offense_snaps", 0.0) / 6.0)
    if position == "OL":
        opportunity = snaps.get("offense_snaps", 0.0)
        return {
            "snap_share": min(1.0, _divide(opportunity, snaps.get("games", 0.0) * 65.0)),
            "experience": min(1.0, experience / 8.0),
        }, opportunity
    if position in {"DL", "EDGE", "LB", "CB", "S"}:
        defensive_snaps = snaps.get("defense_snaps", 0.0)
        if defensive_snaps <= 0:
            defensive_snaps = max(1.0, stats.get("games", 0.0) * 35.0)
        return {
            "sack": 100.0 * _divide(stats.get("def_sacks", 0.0), defensive_snaps),
            "hit": 100.0 * _divide(stats.get("def_qb_hits", 0.0), defensive_snaps),
            "tfl": 100.0 * _divide(stats.get("def_tackles_for_loss", 0.0), defensive_snaps),
            "coverage": 100.0 * _divide(stats.get("def_pass_defended", 0.0), defensive_snaps),
            "turnover": 100.0 * _divide(stats.get("def_interceptions", 0.0) + stats.get("def_fumbles_forced", 0.0), defensive_snaps),
            "tackle": 100.0 * _divide(stats.get("def_tackles_solo", 0.0) + stats.get("def_tackle_assists", 0.0), defensive_snaps),
        }, defensive_snaps
    if position == "K":
        attempts = stats.get("fg_att", 0.0)
        pat_attempts = stats.get("pat_att", 0.0)
        return {
            "fg": _divide(stats.get("fg_made", 0.0), attempts),
            "long": _divide(stats.get("fg_made_50_59", 0.0) + stats.get("fg_made_60_", 0.0), attempts),
            "pat": _divide(stats.get("pat_made", 0.0), pat_attempts),
            "volume": math.log1p(attempts),
        }, attempts + pat_attempts
    opportunity = max(snaps.get("offense_snaps", 0.0), snaps.get("defense_snaps", 0.0), snaps.get("st_snaps", 0.0))
    return {"usage": opportunity}, opportunity


def _metric_weight_group(position: str) -> str:
    return "DEF" if position in {"DL", "EDGE", "LB", "CB", "S"} else position


def build_player_ratings(
    roster_rows: Iterable[dict],
    stat_rows: Iterable[dict],
    snap_rows: Iterable[dict],
    config: RSMConfig = DEFAULT_CONFIG,
    stat_aggregates: Optional[Dict[Tuple[str, int], dict]] = None,
    snap_aggregates: Optional[Dict[Tuple[str, int], dict]] = None,
) -> Dict[str, PlayerRating]:
    roster = list(roster_rows)
    stats = stat_aggregates if stat_aggregates is not None else aggregate_player_stats(stat_rows)
    snaps = snap_aggregates if snap_aggregates is not None else aggregate_snap_counts(snap_rows)
    candidates = []
    for player in roster:
        player_id = (player.get("gsis_id") or "").strip()
        if not player_id:
            continue
        position = normalize_position(player.get("depth_chart_position") or player.get("position") or "")
        pfr_id = (player.get("pfr_id") or "").strip()
        experience = _number(player.get("years_exp"))
        for season in range(config.current_season - config.history_seasons + 1, config.current_season + 1):
            player_stats = stats.get((player_id, season), {})
            player_snaps = snaps.get((pfr_id, season), {}) if pfr_id else {}
            components, opportunities = _components(position, player_stats, player_snaps, experience)
            if opportunities <= 0:
                continue
            candidates.append({
                "player_id": player_id,
                "season": season,
                "position": position,
                "components": components,
                "opportunities": opportunities,
            })

    populations: Dict[Tuple[int, str, str], List[float]] = defaultdict(list)
    for candidate in candidates:
        for metric, value in candidate["components"].items():
            populations[(candidate["season"], candidate["position"], metric)].append(value)

    scored_candidates = []
    for candidate in candidates:
        position = candidate["position"]
        metric_weights = config.metric_weights.get(_metric_weight_group(position), {"usage": 1.0})
        weighted_z = []
        for metric, weight in metric_weights.items():
            values = populations.get((candidate["season"], position, metric), [])
            value = candidate["components"].get(metric, 0.0)
            deviation = statistics.pstdev(values) if len(values) > 1 else 0.0
            z_score = (value - statistics.mean(values)) / deviation if deviation > 1e-9 else 0.0
            weighted_z.append((max(-3.0, min(3.0, z_score)), abs(weight), 1.0 if weight >= 0 else -1.0))
        weight_total = sum(weight for _, weight, _ in weighted_z) or 1.0
        composite_z = sum(z * weight * sign for z, weight, sign in weighted_z) / weight_total
        scored_candidates.append({**candidate, "raw_composite_z": composite_z})

    composite_populations: Dict[Tuple[int, str], List[float]] = defaultdict(list)
    for candidate in scored_candidates:
        composite_populations[(candidate["season"], candidate["position"])].append(candidate["raw_composite_z"])

    by_player: Dict[str, List[dict]] = defaultdict(list)
    for candidate in scored_candidates:
        composite_values = composite_populations[(candidate["season"], candidate["position"])]
        deviation = statistics.pstdev(composite_values) if len(composite_values) > 1 else 0.0
        composite_z = (
            (candidate["raw_composite_z"] - statistics.mean(composite_values)) / deviation
            if deviation > 1e-9 else 0.0
        )
        composite_z = max(-3.0, min(3.0, composite_z))
        minimum = config.minimum_opportunities.get(candidate["position"], config.minimum_opportunities["OTHER"])
        reliability = candidate["opportunities"] / (candidate["opportunities"] + minimum)
        unshrunk = config.starter_rating + config.rating_z_scale * composite_z
        season_rating = config.replacement_rating + reliability * (unshrunk - config.replacement_rating)
        by_player[candidate["player_id"]].append({
            **candidate,
            "rating": max(25.0, min(99.0, season_rating)),
            "reliability": reliability,
            "composite_z": composite_z,
        })

    ratings: Dict[str, PlayerRating] = {}
    for player in roster:
        player_id = (player.get("gsis_id") or "").strip()
        if not player_id:
            continue
        position = normalize_position(player.get("depth_chart_position") or player.get("position") or "")
        seasons = sorted(by_player.get(player_id, []), key=lambda row: row["season"], reverse=True)
        weighted = []
        for index, season_row in enumerate(seasons):
            age = config.current_season - season_row["season"]
            if 0 <= age < len(config.season_weights):
                weighted.append((season_row["rating"], config.season_weights[age]))
        rating = _weighted_average(weighted, config.replacement_rating)
        opportunities = sum(row["opportunities"] for row in seasons)
        reliability = _weighted_average(
            [(row["reliability"], config.season_weights[config.current_season - row["season"]]) for row in seasons],
            0.0,
        ) if seasons else 0.0
        confidence = "HIGH" if reliability >= 0.65 and len(seasons) >= 2 else "MEDIUM" if reliability >= 0.35 else "LOW"
        if position == "OL":
            confidence = "LOW"
        ratings[player_id] = PlayerRating(
            player_id=player_id,
            name=player.get("full_name") or player.get("football_name") or player_id,
            team=normalize_team(player.get("team", "")),
            position=position,
            rating=round(rating, 2),
            uncertainty=round(12.0 * (1.0 - reliability), 2),
            seasons_used=len(seasons),
            opportunities=round(opportunities, 1),
            data_confidence=confidence,
            as_of_season=config.current_season,
            as_of_week=config.current_week,
            explanation={
                "replacement_prior": config.replacement_rating,
                "weighted_observed_rating": round(_weighted_average(weighted, config.replacement_rating), 2),
                "sample_reliability": round(reliability, 4),
                "season_count": float(len(seasons)),
            },
        )
    return ratings


OFFENSE_POSITIONS = {"QB", "RB", "WR", "TE", "OL"}
DEFENSE_POSITIONS = {"DL", "EDGE", "LB", "CB", "S"}


def _formation_category(rows: List[dict]) -> str:
    positions = [normalize_position(row.get("pos_abb") or "") for row in rows]
    offense = sum(position in OFFENSE_POSITIONS for position in positions)
    defense = sum(position in DEFENSE_POSITIONS for position in positions)
    if offense > defense:
        return "offense"
    if defense > offense:
        return "defense"
    return "special"


def expected_lineups(
    depth_rows: Iterable[dict],
    roster_rows: Iterable[dict],
    ratings: Dict[str, PlayerRating],
) -> Dict[str, List[LineupPlayer]]:
    roster_by_id = {(row.get("gsis_id") or "").strip(): row for row in roster_rows}
    formations: Dict[Tuple[str, str], List[dict]] = defaultdict(list)
    for row in depth_rows:
        formations[(normalize_team(row.get("team", "")), row.get("pos_grp") or "unknown")].append(row)

    selected_formations: Dict[Tuple[str, str], List[dict]] = {}
    grouped: Dict[Tuple[str, str], List[Tuple[str, List[dict]]]] = defaultdict(list)
    for (team, name), rows in formations.items():
        grouped[(team, _formation_category(rows))].append((name, rows))
    for key, choices in grouped.items():
        category = key[1]
        target = 11 if category in {"offense", "defense"} else 3
        choices.sort(key=lambda item: (abs(len({row.get("pos_slot") for row in item[1]}) - target), "base" not in item[0].lower(), item[0]))
        selected_formations[key] = choices[0][1]

    lineups: Dict[str, List[LineupPlayer]] = defaultdict(list)
    for (team, category), rows in selected_formations.items():
        by_slot: Dict[str, List[dict]] = defaultdict(list)
        for row in rows:
            by_slot[row.get("pos_slot") or row.get("pos_abb") or "unknown"].append(row)
        for slot_rows in by_slot.values():
            slot_rows.sort(key=lambda row: int(row.get("pos_rank") or 99))
            chosen = None
            for candidate in slot_rows:
                roster_row = roster_by_id.get((candidate.get("gsis_id") or "").strip(), {})
                if (roster_row.get("status") or "").upper() == "ACT":
                    chosen = candidate
                    break
            chosen = chosen or slot_rows[0]
            player_id = (chosen.get("gsis_id") or "").strip()
            roster_row = roster_by_id.get(player_id, {})
            status = (roster_row.get("status") or "UNKNOWN").upper()
            availability = 1.0 if status == "ACT" else 0.0
            position = normalize_position(chosen.get("pos_abb") or roster_row.get("depth_chart_position") or "")
            if category == "special" and position != "K":
                continue
            lineups[team].append(LineupPlayer(
                game_id="CURRENT",
                team=team,
                player_id=player_id,
                name=chosen.get("player_name") or roster_row.get("full_name") or player_id,
                position=position,
                slot=(chosen.get("pos_abb") or position).upper(),
                starter=True,
                expected_starter=True,
                actual_starter=None,
                availability=availability,
            ))
    return lineups


def _group_rating(starters: List[LineupPlayer], ratings: Dict[str, PlayerRating], position: str, replacement: float) -> float:
    values = [ratings[player.player_id].rating for player in starters if player.position == position and player.player_id in ratings]
    return statistics.mean(values) if values else replacement


def build_team_ratings(
    roster_rows: Iterable[dict],
    depth_rows: Iterable[dict],
    player_ratings: Dict[str, PlayerRating],
    roster_timestamp: str,
    config: RSMConfig = DEFAULT_CONFIG,
    lineups_override: Optional[Dict[str, List[LineupPlayer]]] = None,
) -> List[TeamRating]:
    roster = list(roster_rows)
    lineups = lineups_override or expected_lineups(depth_rows, roster, player_ratings)
    results = []
    for team in sorted(lineups):
        starters = lineups[team]
        group = {position: _group_rating(starters, player_ratings, position, config.replacement_rating)
                 for position in OFFENSE_POSITIONS | DEFENSE_POSITIONS | {"K"}}
        ol_entries = []
        for player in starters:
            if player.position != "OL" or player.player_id not in player_ratings:
                continue
            slot = player.slot if player.slot in config.ol_position_weights else "C"
            ol_entries.append((player_ratings[player.player_id].rating, config.ol_position_weights.get(slot, 0.18)))
        ol_mean = _weighted_average(ol_entries, config.replacement_rating)
        ol_min = min((value for value, _ in ol_entries), default=config.replacement_rating)
        ol_overall = ol_mean - config.ol_weakest_link_weight * max(0.0, ol_mean - ol_min)
        offense = _weighted_average([
            (group["QB"], config.offense_weights["QB"]),
            (ol_overall, config.offense_weights["OL"]),
            (group["WR"], config.offense_weights["WR"]),
            (group["TE"], config.offense_weights["TE"]),
            (group["RB"], config.offense_weights["RB"]),
            (config.replacement_rating, config.offense_weights["OTHER"]),
        ])
        defense = _weighted_average([(group[position], weight) for position, weight in config.defense_weights.items()])
        kicker = group["K"]
        roster_rating = _weighted_average([
            (offense, config.roster_weights["offense"]),
            (defense, config.roster_weights["defense"]),
            (kicker, config.roster_weights["kicking"]),
        ])
        known = [player for player in starters if player.player_id in player_ratings]
        high_or_medium = [player for player in known if player_ratings[player.player_id].data_confidence != "LOW"]
        confidence_ratio = len(high_or_medium) / len(starters) if starters else 0.0
        lineup_confidence = "HIGH" if confidence_ratio >= 0.75 else "MEDIUM" if confidence_ratio >= 0.45 else "LOW"
        results.append(TeamRating(
            team=team, season=config.current_season, week=config.current_week,
            roster_timestamp=roster_timestamp,
            qb_rating=round(group["QB"], 2), rb_rating=round(group["RB"], 2),
            wr_rating=round(group["WR"], 2), te_rating=round(group["TE"], 2),
            ol_pass_rating=round(ol_overall, 2), ol_run_rating=round(ol_overall, 2),
            ol_overall_rating=round(ol_overall, 2), dl_rating=round(group["DL"], 2),
            edge_rating=round(group["EDGE"], 2), lb_rating=round(group["LB"], 2),
            cb_rating=round(group["CB"], 2), safety_rating=round(group["S"], 2),
            pass_offense_rating=round(_weighted_average([
                (group["QB"], config.pass_offense_weights["QB"]),
                (group["WR"], config.pass_offense_weights["WR"]),
                (group["TE"], config.pass_offense_weights["TE"]),
                (ol_overall, config.pass_offense_weights["OL"]),
            ]), 2),
            run_offense_rating=round(_weighted_average([
                (ol_overall, config.run_offense_weights["OL"]),
                (group["RB"], config.run_offense_weights["RB"]),
                (group["TE"], config.run_offense_weights["TE"]),
            ]), 2),
            offense_rating=round(offense, 2),
            pass_defense_rating=round(_weighted_average([
                (group["EDGE"], config.pass_defense_weights["EDGE"]),
                (group["CB"], config.pass_defense_weights["CB"]),
                (group["S"], config.pass_defense_weights["S"]),
                (group["LB"], config.pass_defense_weights["LB"]),
            ]), 2),
            run_defense_rating=round(_weighted_average([
                (group["DL"], config.run_defense_weights["DL"]),
                (group["EDGE"], config.run_defense_weights["EDGE"]),
                (group["LB"], config.run_defense_weights["LB"]),
                (group["S"], config.run_defense_weights["S"]),
            ]), 2),
            defense_rating=round(defense, 2), kicker_rating=round(kicker, 2),
            roster_rating=round(roster_rating, 2), lineup_confidence=lineup_confidence,
            starters=starters,
        ))
    return results
