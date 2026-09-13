from collections import defaultdict
from typing import Dict, Iterable, List, Tuple

from .config import DEFAULT_CONFIG, RSMConfig, normalize_position, normalize_team
from .schema import LineupPlayer, PlayerRating


def _number(value: object) -> float:
    try:
        text = str(value).strip()
        return float(text) if text else 0.0
    except (TypeError, ValueError):
        return 0.0


def _eligible_snap_rows(rows: Iterable[dict], season: int, week: int) -> List[dict]:
    return [
        row for row in rows
        if row.get("game_type") == "REG"
        and (
            int(row.get("season") or 0) < season
            or (int(row.get("season") or 0) == season and int(row.get("week") or 0) < week)
        )
    ]


def infer_expected_lineups(
    roster_rows: Iterable[dict],
    snap_rows: Iterable[dict],
    ratings: Dict[str, PlayerRating],
    season: int,
    week: int,
    game_id: str,
    config: RSMConfig = DEFAULT_CONFIG,
) -> Dict[str, List[LineupPlayer]]:
    """Infer starters solely from roster identity and participation before kickoff.

    Same-game and future snap rows are explicitly excluded. Weekly roster status is
    intentionally not used because historical status timing is not sufficiently
    precise to prove that it preceded kickoff.
    """
    roster = list(roster_rows)
    eligible = _eligible_snap_rows(snap_rows, season, week)
    by_pfr = {(row.get("pfr_id") or "").strip(): row for row in roster if (row.get("pfr_id") or "").strip()}
    player_games: Dict[str, List[Tuple[int, int, float]]] = defaultdict(list)
    for row in eligible:
        pfr_id = (row.get("pfr_player_id") or "").strip()
        roster_player = by_pfr.get(pfr_id)
        if not roster_player:
            continue
        position = normalize_position(
            roster_player.get("depth_chart_position") or roster_player.get("position") or row.get("position") or ""
        )
        snap_value = _number(row.get("defense_snaps") if position in {"DL", "EDGE", "LB", "CB", "S"} else row.get("offense_snaps"))
        if position == "K":
            snap_value = _number(row.get("st_snaps"))
        player_games[(roster_player.get("gsis_id") or "").strip()].append((
            int(row.get("season") or 0), int(row.get("week") or 0), snap_value,
        ))

    usage: Dict[str, float] = {}
    for player_id, games in player_games.items():
        recent = sorted(games, reverse=True)[:config.lineup_lookback_games]
        usage[player_id] = sum(
            snaps * (config.lineup_recency_decay ** index)
            for index, (_, _, snaps) in enumerate(recent)
        )

    candidates: Dict[Tuple[str, str], List[dict]] = defaultdict(list)
    for row in roster:
        player_id = (row.get("gsis_id") or "").strip()
        if not player_id:
            continue
        team = normalize_team(row.get("team", ""))
        position = normalize_position(row.get("depth_chart_position") or row.get("position") or "")
        if position not in config.historical_starter_counts:
            continue
        candidates[(team, position)].append(row)

    result: Dict[str, List[LineupPlayer]] = defaultdict(list)
    for (team, position), players in sorted(candidates.items()):
        count = config.historical_starter_counts[position]
        players.sort(key=lambda row: (
            -usage.get((row.get("gsis_id") or "").strip(), 0.0),
            -_number(row.get("years_exp")),
            row.get("gsis_id") or "",
        ))
        chosen = players[:count]
        if position == "OL":
            chosen = _choose_offensive_line(players, usage, count)
        for index, player in enumerate(chosen, 1):
            player_id = (player.get("gsis_id") or "").strip()
            raw_slot = (player.get("depth_chart_position") or position).upper()
            slot = raw_slot if raw_slot in {"LT", "LG", "C", "RG", "RT"} else f"{position}{index}"
            result[team].append(LineupPlayer(
                game_id=game_id,
                team=team,
                player_id=player_id,
                name=player.get("full_name") or player.get("football_name") or player_id,
                position=position,
                slot=slot,
                starter=True,
                expected_starter=True,
                actual_starter=None,
                availability=1.0,
            ))
    return result


def _choose_offensive_line(players: List[dict], usage: Dict[str, float], count: int) -> List[dict]:
    selected: List[dict] = []
    for slot in ("LT", "LG", "C", "RG", "RT"):
        options = [
            row for row in players
            if (row.get("depth_chart_position") or "").upper() == slot and row not in selected
        ]
        if options:
            selected.append(max(options, key=lambda row: usage.get((row.get("gsis_id") or "").strip(), 0.0)))
    remaining = sorted(
        (row for row in players if row not in selected),
        key=lambda row: (-usage.get((row.get("gsis_id") or "").strip(), 0.0), row.get("gsis_id") or ""),
    )
    return (selected + remaining)[:count]
