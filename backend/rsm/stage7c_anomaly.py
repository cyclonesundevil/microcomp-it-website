import csv
import json
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

from .config import DEFAULT_CONFIG, normalize_team
from .data import DEFAULT_DATA_ROOT, enrich_roster_ids, read_csv
from .historical_lineups import infer_expected_lineups
from .integrity_audit import classify_lineup_confidence
from .locked_backtest import grade_ats, wilson_interval
from .stage7a_diagnostics import percentile
from .stage7b_candidate import CandidateArtifact


TRAINING_SEASONS = (2021, 2022)
VALIDATION_SEASONS = (2023,)
COVERAGE_BANDS = (0.20, 0.10, 0.05)
MINIMUM_SUPPORTING_GROUPS = 2
MINIMUM_GROUP_CONTRIBUTION = 0.25
CONFIDENCE_WEIGHTS = {"HIGH": 1.0, "MEDIUM": 0.75, "LOW": 0.0}
MODEL_VERSION = "RSM-v2-candidate-stage7c-anomaly-experimental"


FEATURE_LABELS = {
    "qb_quality_diff": ("QB_DIFFERENCE", "QB difference"),
    "qb_vs_pass_rush_matchup": ("QB_VS_PASS_RUSH", "QB versus pass rush"),
    "qb_vs_coverage_matchup": ("QB_VS_COVERAGE", "QB versus coverage"),
    "ol_pass_vs_pass_rush_matchup": ("OL_VS_PASS_RUSH", "OL versus pass rush"),
    "ol_run_vs_front_matchup": ("OL_RUN_VS_FRONT", "OL run blocking versus front"),
    "receiving_vs_secondary_matchup": ("RECEIVERS_VS_SECONDARY", "receivers versus secondary"),
    "rushing_vs_front_matchup": ("RUSHING_VS_FRONT", "rushing versus front"),
    "ol_weakest_diff": ("OL_WEAKEST_LINK", "weakest-link OL difference"),
    "ol_strongest_diff": ("OL_STRONGEST_PLAYER", "strongest OL difference"),
    "ol_continuity_diff": ("OL_CONTINUITY", "OL continuity"),
    "ol_replacement_starters_diff": ("OL_REPLACEMENTS", "OL replacement starters"),
    "wr1_diff": ("WR1_DIFFERENCE", "WR1 difference"),
    "wr2_diff": ("WR2_DIFFERENCE", "WR2 difference"),
    "te1_diff": ("TE1_DIFFERENCE", "TE1 difference"),
    "receiver_replacements_diff": ("RECEIVER_REPLACEMENTS", "receiver replacements"),
    "pass_rusher1_diff": ("PASS_RUSH_DEPTH", "lead pass-rusher difference"),
    "pass_rusher2_diff": ("PASS_RUSH_DEPTH", "second pass-rusher difference"),
    "weakest_coverage_diff": ("COVERAGE_WEAKEST_LINK", "weakest-link coverage difference"),
    "secondary_average_diff": ("SECONDARY_DIFFERENCE", "secondary difference"),
    "front_seven_average_diff": ("FRONT_SEVEN_DIFFERENCE", "front-seven difference"),
    "rest_diff": ("REST_DIFFERENTIAL", "rest differential"),
}


FEATURE_GROUPS = {
    "QB": {"qb_quality_diff", "qb_vs_pass_rush_matchup", "qb_vs_coverage_matchup"},
    "OL": {"ol_pass_vs_pass_rush_matchup", "ol_run_vs_front_matchup", "ol_weakest_diff", "ol_strongest_diff", "ol_continuity_diff", "ol_replacement_starters_diff"},
    "RECEIVERS": {"receiving_vs_secondary_matchup", "wr1_diff", "wr2_diff", "te1_diff", "receiver_replacements_diff"},
    "RUSHING": {"rushing_vs_front_matchup"},
    "PASS_RUSH": {"pass_rusher1_diff", "pass_rusher2_diff"},
    "SECONDARY": {"weakest_coverage_diff", "secondary_average_diff"},
    "FRONT_SEVEN": {"front_seven_average_diff"},
    "REST": {"rest_diff"},
}


CSV_FIELDS = (
    "season", "week", "game_id", "kickoff", "away_team", "home_team",
    "actual_margin", "roster_fair_home_margin", "market_implied_home_margin",
    "market_disagreement", "absolute_market_disagreement", "model_side",
    "market_favorite", "disagreement_direction", "market_spread", "sportsbook",
    "line_timestamp", "lineup_confidence", "supporting_group_count",
    "opposing_group_count", "anomaly_score", "flagged", "flag_rule", "ATS_result",
    "top_reason_1", "top_reason_2", "top_reason_3", "model_version",
)


def sportsbook_home_spread_to_margin(conventional_home_spread: float) -> float:
    """Convert sportsbook Home -3 notation to positive-three home margin."""
    return -float(conventional_home_spread)


def disagreement_direction(disagreement: float) -> str:
    if disagreement > 0:
        return "MODEL_MORE_HOME"
    if disagreement < 0:
        return "MODEL_MORE_AWAY"
    return "AGREES"


def model_side(disagreement: float) -> str:
    if disagreement > 0:
        return "HOME"
    if disagreement < 0:
        return "AWAY"
    return "NONE"


def market_favorite(market_home_margin: float) -> str:
    if market_home_margin > 0:
        return "HOME"
    if market_home_margin < 0:
        return "AWAY"
    return "PICKEM"


def _number(row: dict, field: str, default: float = 0.0) -> float:
    try:
        value = str(row.get(field, "")).strip()
        return float(value) if value else default
    except (TypeError, ValueError):
        return default


def _load_model(path: Path) -> CandidateArtifact:
    payload = json.loads(path.read_text(encoding="utf-8"))["model_a"]
    for field in ("feature_names", "means", "scales", "coefficients", "training_seasons"):
        payload[field] = tuple(payload[field])
    artifact = CandidateArtifact(**payload)
    if artifact.training_seasons != TRAINING_SEASONS:
        raise ValueError("Stage 7C requires the frozen 2021-2022 Stage 7B Model A artifact")
    return artifact


def feature_contributions(row: dict, artifact: CandidateArtifact) -> List[dict]:
    contributions = []
    for feature, mean, scale, coefficient in zip(
        artifact.feature_names, artifact.means, artifact.scales, artifact.coefficients,
    ):
        contribution = coefficient * (_number(row, feature) - mean) / scale
        code, label = FEATURE_LABELS.get(feature, (feature.upper(), feature.replace("_", " ")))
        contributions.append({
            "feature": feature,
            "reason_code": code,
            "label": label,
            "contribution": contribution,
        })
    return sorted(contributions, key=lambda item: (-abs(item["contribution"]), item["feature"]))


def _group_contributions(contributions: Sequence[dict]) -> Dict[str, float]:
    values = {group: 0.0 for group in FEATURE_GROUPS}
    for item in contributions:
        for group, features in FEATURE_GROUPS.items():
            if item["feature"] in features:
                values[group] += item["contribution"]
                break
    return values


def _feature_group(feature: str) -> str:
    for group, features in FEATURE_GROUPS.items():
        if feature in features:
            return group
    return "OTHER"


def _explanation_reasons(contributions: Sequence[dict]) -> List[dict]:
    """Keep the strongest driver and the strongest opposite-sign counterweight."""
    if not contributions:
        return []
    selected = [contributions[0]]
    primary_sign = math.copysign(1.0, contributions[0]["contribution"])
    counterweight = next(
        (
            item for item in contributions[1:]
            if item["contribution"] and math.copysign(1.0, item["contribution"]) != primary_sign
        ),
        None,
    )
    if counterweight:
        selected.append(counterweight)
    selected.extend(item for item in contributions if item not in selected)
    return selected[:3]


def _reason_text(item: dict) -> str:
    return f"{item['reason_code']}: {item['label']} {item['contribution']:+.3f} points"


def score_market_disagreement(row: dict, artifact: CandidateArtifact, lineup_confidence: str, schedule: dict) -> dict:
    fair_margin = artifact.predict(row)
    market_margin = _number(row, "market_spread")
    disagreement = fair_margin - market_margin
    direction = 1.0 if disagreement > 0 else -1.0 if disagreement < 0 else 0.0
    contributions = feature_contributions(row, artifact)
    grouped = _group_contributions(contributions)
    supporting = sum(
        abs(value) >= MINIMUM_GROUP_CONTRIBUTION and value * direction > 0
        for value in grouped.values()
    )
    opposing = sum(
        abs(value) >= MINIMUM_GROUP_CONTRIBUTION and value * direction < 0
        for value in grouped.values()
    )
    active = supporting + opposing
    agreement = supporting / active if active else 0.0
    confidence_weight = CONFIDENCE_WEIGHTS.get(lineup_confidence, 0.0)
    anomaly_score = abs(disagreement) * confidence_weight * (0.5 + 0.5 * agreement)
    reasons = _explanation_reasons(contributions)
    primary = contributions[0] if contributions else None
    kickoff = ""
    if schedule.get("gameday"):
        kickoff = schedule["gameday"] + (f"T{schedule['gametime']}" if schedule.get("gametime") else "")
    side = model_side(disagreement)
    return {
        "season": int(row["season"]),
        "week": int(row["week"]),
        "game_id": row["game_id"],
        "kickoff": kickoff,
        "away_team": row["away_team"],
        "home_team": row["home_team"],
        "actual_margin": _number(row, "actual_margin"),
        "roster_fair_home_margin": fair_margin,
        "market_implied_home_margin": market_margin,
        "market_disagreement": disagreement,
        "absolute_market_disagreement": abs(disagreement),
        "model_side": side,
        "market_favorite": market_favorite(market_margin),
        "disagreement_direction": disagreement_direction(disagreement),
        "market_spread": market_margin,
        "sportsbook": "",
        "line_timestamp": "",
        "lineup_confidence": lineup_confidence,
        "supporting_group_count": supporting,
        "opposing_group_count": opposing,
        "structurally_supported": supporting >= MINIMUM_SUPPORTING_GROUPS,
        "anomaly_score": anomaly_score,
        "flagged": False,
        "flag_rule": "",
        "ATS_result": grade_ats(side, _number(row, "actual_margin"), market_margin) if side != "NONE" else "PUSH",
        "top_reason_1": _reason_text(reasons[0]) if len(reasons) > 0 else "",
        "top_reason_2": _reason_text(reasons[1]) if len(reasons) > 1 else "",
        "top_reason_3": _reason_text(reasons[2]) if len(reasons) > 2 else "",
        "primary_reason_code": primary["reason_code"] if primary else "NONE",
        "primary_reason_group": _feature_group(primary["feature"]) if primary else "OTHER",
        "model_version": MODEL_VERSION,
    }


def freeze_thresholds(development_rows: Sequence[dict]) -> List[dict]:
    """Fit coverage cutoffs from pre-outcome anomaly inputs in 2021-2022 only."""
    if not development_rows or {int(row["season"]) for row in development_rows} - set(TRAINING_SEASONS):
        raise ValueError("Threshold selection accepts only 2021-2022 development rows")
    eligible = [
        row for row in development_rows
        if row["lineup_confidence"] != "LOW" and row["structurally_supported"]
    ]
    scores = [float(row["anomaly_score"]) for row in eligible]
    if not scores:
        raise ValueError("No structurally supported development games are available")
    rules = []
    for coverage in COVERAGE_BANDS:
        threshold = percentile(scores, 1.0 - coverage)
        rules.append({
            "name": f"TOP_{int(coverage * 100)}_PERCENT",
            "target_coverage": coverage,
            "threshold": threshold,
            "minimum_lineup_confidence": "MEDIUM",
            "minimum_supporting_groups": MINIMUM_SUPPORTING_GROUPS,
            "development_eligible_games": len(eligible),
            "development_flagged_games": sum(score >= threshold for score in scores),
            "development_total_games": len(development_rows),
            "development_total_coverage": sum(score >= threshold for score in scores) / len(development_rows),
        })
    return rules


def apply_frozen_rules(row: dict, rules: Sequence[dict]) -> dict:
    if row["lineup_confidence"] == "LOW" or not row["structurally_supported"]:
        return {**row, "flagged": False, "flag_rule": ""}
    matching = [rule for rule in rules if row["anomaly_score"] >= rule["threshold"]]
    if not matching:
        return {**row, "flagged": False, "flag_rule": ""}
    most_selective = min(matching, key=lambda rule: rule["target_coverage"])
    return {**row, "flagged": True, "flag_rule": most_selective["name"]}


def _before(row: dict, season: int, week: int) -> bool:
    row_season = int(row.get("season") or 0)
    row_week = int(row.get("week") or 0)
    return row_season < season or (row_season == season and row_week < week)


def _positive_snaps(row: dict, position: str) -> bool:
    field = "defense_snaps" if position in {"DL", "EDGE", "LB", "CB", "S"} else "offense_snaps"
    if position == "K":
        field = "st_snaps"
    return _number(row, field) > 0


def lineup_confidence_by_game(feature_rows: Sequence[dict], data_root: Path = DEFAULT_DATA_ROOT) -> Dict[str, str]:
    """Reconstruct Stage 4 confidence using only target-week rosters and prior snaps."""
    seasons = sorted({int(row["season"]) for row in feature_rows})
    if set(seasons) - set((*TRAINING_SEASONS, *VALIDATION_SEASONS)):
        raise ValueError("Stage 7C lineup confidence is limited to development and validation seasons")
    raw = data_root / "raw"
    history_years = range(min(seasons) - DEFAULT_CONFIG.history_seasons + 1, max(seasons) + 1)
    snaps = [row for year in history_years for row in read_csv(raw / f"snaps_{year}.csv")]
    expected_per_game = 2 * sum(DEFAULT_CONFIG.historical_starter_counts.values())
    confidence = {}
    for season in seasons:
        season_rows = [row for row in feature_rows if int(row["season"]) == season]
        roster_rows = enrich_roster_ids(read_csv(raw / f"weekly_roster_{season}.csv"), raw / "players.csv")
        rosters_by_week: Dict[int, List[dict]] = defaultdict(list)
        for roster_row in roster_rows:
            rosters_by_week[int(roster_row.get("week") or 0)].append(roster_row)
        for week in sorted({int(row["week"]) for row in season_rows}):
            roster = rosters_by_week.get(week, [])
            eligible_snaps = [row for row in snaps if _before(row, season, week) and row.get("game_type") == "REG"]
            lineups = infer_expected_lineups(roster, eligible_snaps, {}, season, week, f"{season}_W{week}_STAGE7C")
            roster_by_id = {(row.get("gsis_id") or "").strip(): row for row in roster}
            prior_by_pfr: Dict[str, List[dict]] = defaultdict(list)
            for snap in eligible_snaps:
                pfr_id = (snap.get("pfr_player_id") or "").strip()
                if pfr_id:
                    prior_by_pfr[pfr_id].append(snap)
            for game in (row for row in season_rows if int(row["week"]) == week):
                selected = []
                complete = bool(roster)
                for team in (normalize_team(game["home_team"]), normalize_team(game["away_team"])):
                    team_lineup = lineups.get(team, [])
                    selected.extend(team_lineup)
                    counts = Counter(player.position for player in team_lineup)
                    if any(counts[position] != count for position, count in DEFAULT_CONFIG.historical_starter_counts.items()):
                        complete = False
                evidence = 0
                for player in selected:
                    pfr_id = (roster_by_id.get(player.player_id, {}).get("pfr_id") or "").strip()
                    if any(_positive_snaps(snap, player.position) for snap in prior_by_pfr.get(pfr_id, [])):
                        evidence += 1
                confidence[game["game_id"]] = classify_lineup_confidence(complete, evidence / expected_per_game)
    return confidence


def _availability_matrix(schedule_rows: Sequence[dict]) -> List[dict]:
    total = len(schedule_rows)
    specifications = [
        ("Single stored consensus spread", "spread_line", "AVAILABLE", "Internal positive-home-margin convention; temporal status unverified"),
        ("Spread prices", "home_spread_odds", "AVAILABLE", "Home and away prices exist; sportsbook identity absent"),
        ("Opening spread", None, "UNAVAILABLE", "No opening-line field"),
        ("Closing spread classification", None, "UNAVAILABLE", "Stored line is not labeled opening/current/closing"),
        ("Individual sportsbook lines", None, "UNAVAILABLE", "No per-book records"),
        ("Sportsbook identifier", None, "UNAVAILABLE", "No sportsbook field"),
        ("Retrieved/line timestamp", None, "UNAVAILABLE", "No retrieval or line timestamp"),
        ("Line movement/history", None, "UNAVAILABLE", "Only one line observation per game"),
        ("Pregame provenance", None, "UNAVAILABLE", "No timestamp proves the line preceded kickoff"),
        ("Scheduled kickoff date", "gameday", "AVAILABLE", "Date present for all scoped games"),
        ("Scheduled kickoff time", "gametime", "AVAILABLE", "Clock time present; timezone provenance absent"),
    ]
    output = []
    for item, field, status, note in specifications:
        present = sum(bool((row.get(field) or "").strip()) for row in schedule_rows) if field else 0
        if item == "Spread prices":
            present = sum(bool((row.get("home_spread_odds") or "").strip()) and bool((row.get("away_spread_odds") or "").strip()) for row in schedule_rows)
        output.append({"item": item, "status": status, "present_games": present, "total_games": total, "note": note})
    return output


def _summary(rows: Sequence[dict]) -> dict:
    counts = Counter(row["ATS_result"] for row in rows)
    attempts = counts["WIN"] + counts["LOSS"]
    low, high = wilson_interval(counts["WIN"], attempts)
    disagreements = [row["absolute_market_disagreement"] for row in rows]
    return {
        "games": len(rows),
        "wins": counts["WIN"], "losses": counts["LOSS"], "pushes": counts["PUSH"],
        "ats_accuracy": counts["WIN"] / attempts if attempts else None,
        "wilson_95_low": low, "wilson_95_high": high,
        "average_absolute_disagreement": statistics.mean(disagreements) if disagreements else None,
        "median_absolute_disagreement": statistics.median(disagreements) if disagreements else None,
    }


def _group_summary(rows: Sequence[dict], key) -> List[dict]:
    groups = defaultdict(list)
    for row in rows:
        groups[key(row)].append(row)
    return [{"bucket": label, **_summary(group)} for label, group in sorted(groups.items())]


def _size_bucket(row: dict) -> str:
    value = row["absolute_market_disagreement"]
    if value < 3:
        return "0-3"
    if value < 5:
        return "3-5"
    if value < 7:
        return "5-7"
    return "7+"


def _favorite_bucket(row: dict) -> str:
    favorite = row["market_favorite"]
    if favorite == "PICKEM" or row["model_side"] == "NONE":
        return "PICKEM"
    return "FAVORITE" if row["model_side"] == favorite else "UNDERDOG"


def _evaluate_rule(rows: Sequence[dict], rule: dict) -> dict:
    flagged = [
        row for row in rows
        if row["lineup_confidence"] != "LOW"
        and row["structurally_supported"]
        and row["anomaly_score"] >= rule["threshold"]
    ]
    return {
        "rule": rule["name"], "threshold": rule["threshold"],
        "target_development_coverage": rule["target_coverage"],
        "validation_coverage": len(flagged) / len(rows) if rows else 0.0,
        **_summary(flagged),
        "by_model_side": _group_summary(flagged, lambda row: row["model_side"]),
        "by_favorite_underdog": _group_summary(flagged, _favorite_bucket),
        "by_lineup_confidence": _group_summary(flagged, lambda row: row["lineup_confidence"]),
        "by_disagreement_size": _group_summary(flagged, _size_bucket),
        "by_primary_reason": _group_summary(flagged, lambda row: row["primary_reason_code"]),
        "by_primary_feature_group": _group_summary(flagged, lambda row: row["primary_reason_group"]),
    }


def _write_csv(path: Path, rows: Sequence[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as destination:
        writer = csv.DictWriter(destination, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows({field: row.get(field, "") for field in CSV_FIELDS} for row in rows)


def _pct(value: float | None) -> str:
    return "N/A" if value is None else f"{100.0 * value:.2f}%"


def _write_group_table(lines: List[str], title: str, rows: Sequence[dict]) -> None:
    lines += ["", f"### {title}", "", "| Bucket | Games | W-L-P | ATS | 95% Wilson CI | Avg. disagreement |", "| --- | ---: | ---: | ---: | ---: | ---: |"]
    for row in rows:
        interval = "N/A" if row["wilson_95_low"] is None else f"{_pct(row['wilson_95_low'])}-{_pct(row['wilson_95_high'])}"
        average = "N/A" if row["average_absolute_disagreement"] is None else f"{row['average_absolute_disagreement']:.3f}"
        lines.append(f"| {row['bucket']} | {row['games']} | {row['wins']}-{row['losses']}-{row['pushes']} | {_pct(row['ats_accuracy'])} | {interval} | {average} |")


def _write_report(path: Path, data: dict) -> None:
    validation_rule_summary = ", ".join(
        f"{item['games']} games ({_pct(item['validation_coverage'])})"
        for item in data["validation"]["rules"]
    )
    lines = [
        "# Stage 7C - Selective Market-Anomaly Framework",
        "",
        "This report evaluates explainable market disagreement, not a validated betting advantage. Rules were frozen from 2021-2022 inputs before 2023 outcomes were evaluated. RSM-v1 and the Stage 7B roster-only margin artifact were not refit, and 2024-2025 results were not read.",
        "",
        "## Exact scope",
        "",
        f"- Development/model selection: {data['scope']['development_start']} through {data['scope']['development_end']} ({data['scope']['development_games']} regular-season games).",
        f"- Untouched rule validation: {data['scope']['validation_start']} through {data['scope']['validation_end']} ({data['scope']['validation_games']} regular-season games).",
        "- The stored spread uses expected home margin: +3 means the market favors the home team by three. Conventional sportsbook Home -3 converts explicitly to +3.",
        "",
        "## Market-data availability",
        "",
        "| Item | Status | Present games | Notes |", "| --- | --- | ---: | --- |",
    ]
    for row in data["market_data"]["availability_matrix"]:
        lines.append(f"| {row['item']} | {row['status']} | {row['present_games']} / {row['total_games']} | {row['note']} |")
    lines += [
        "",
        "The data support comparison with one stored consensus line only. They do not support true individual-sportsbook anomaly detection, detection-time analysis, line movement, or closing-line-value measurement.",
        "",
        "### Required future multi-book contract",
        "",
        "`game_id`, `sportsbook`, `retrieved_timestamp` (timezone-aware), `line_type`, `spread`, `spread_convention`, `total`, `price_or_odds`, `line_stage` (`opening`/`current`/`closing`), `scheduled_kickoff` (timezone-aware), and `source`.",
        "",
        "## Frozen anomaly definition",
        "",
        "`market_disagreement = roster_fair_home_margin - market_implied_home_margin`.",
        "",
        "The anomaly score multiplies absolute disagreement by a lineup-confidence weight and a structural-agreement factor. A candidate anomaly additionally requires at least two independently grouped feature contributions of at least 0.25 points aligned with the disagreement and MEDIUM-or-better reconstructed-lineup confidence. Missing verified injuries and market timestamps are not treated as known inputs.",
        "Each game record preserves the strongest absolute fair-line driver, the strongest available opposite-sign counterweight, and the next-largest contribution so explanations expose both positive and negative pressure when both exist.",
        f"Reconstructed-lineup confidence is HIGH/LOW for {data['lineup_confidence']['development'].get('HIGH', 0)}/{data['lineup_confidence']['development'].get('LOW', 0)} development games and {data['lineup_confidence']['validation'].get('HIGH', 0)}/{data['lineup_confidence']['validation'].get('LOW', 0)} validation games; there are no MEDIUM games. This is prior-snap evidence confidence, not verified injury confidence.",
        "",
        "| Rule | Development threshold | Development eligible | Development flagged | Development total coverage | Validation flagged | Validation coverage | W-L-P | ATS | 95% Wilson CI | Avg. disagreement | Median disagreement |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    evaluations = data["validation"]["rules"]
    for rule, result in zip(data["frozen_rules"], evaluations):
        interval = "N/A" if result["wilson_95_low"] is None else f"{_pct(result['wilson_95_low'])}-{_pct(result['wilson_95_high'])}"
        lines.append(
            f"| {rule['name']} | {rule['threshold']:.3f} | {rule['development_eligible_games']} | {rule['development_flagged_games']} | {_pct(rule['development_total_coverage'])} | {result['games']} | {_pct(result['validation_coverage'])} | {result['wins']}-{result['losses']}-{result['pushes']} | {_pct(result['ats_accuracy'])} | {interval} | {result['average_absolute_disagreement']:.3f} | {result['median_absolute_disagreement']:.3f} |"
        )
    lines += [
        "",
        f"All eligible 2023 roster-only disagreements: {data['validation']['all_games']['wins']}-{data['validation']['all_games']['losses']}-{data['validation']['all_games']['pushes']} ({_pct(data['validation']['all_games']['ats_accuracy'])}). Constant benchmark: 50.00%. Stage 7B all-game residual result: {_pct(data['validation']['stage7b_residual_ats'])}.",
        "",
        f"Nested top-20%, top-10%, and top-5% accuracy is {'monotonically nondecreasing' if data['validation']['larger_scores_monotonic'] else 'not monotonically improving'} as selectivity increases. These nested samples are descriptive and were not used to choose a rule.",
        "",
        "## Flagged-game diagnostics",
    ]
    primary = evaluations[0]
    _write_group_table(lines, "Home/away model side", primary["by_model_side"])
    _write_group_table(lines, "Favorite/underdog", primary["by_favorite_underdog"])
    _write_group_table(lines, "Lineup confidence", primary["by_lineup_confidence"])
    _write_group_table(lines, "Disagreement size", primary["by_disagreement_size"])
    _write_group_table(lines, "Primary feature group", primary["by_primary_feature_group"])
    _write_group_table(lines, "Primary reason code", primary["by_primary_reason"])
    lines += [
        "",
        "## Interpretation",
        "",
        "1. The current data can support retrospective consensus-line market-disagreement analysis, subject to missing timestamp provenance.",
        "2. It cannot support true individual-sportsbook comparison because book identifiers and line histories are absent.",
        f"3. Frozen rules flag {validation_rule_summary} from least to most selective.",
        f"4. Larger anomaly scores {'produce monotonically better outcomes in this one validation season' if data['validation']['larger_scores_monotonic'] else 'do not produce monotonically better 2023 outcomes'}.",
        "5. One validation season and small nested samples are not stable enough to justify actionable use; continued prospective observation is reasonable only as research.",
        f"6. The most frequent primary feature groups among top-20% candidate anomalies are: {', '.join(item['bucket'] for item in sorted(primary['by_primary_feature_group'], key=lambda row: row['games'], reverse=True)[:3])}.",
        "7. Actionable treatment requires timestamped multi-book lines, line-stage labels and movement, verified pregame injuries/lineups, and materially better OL, pass-rush, and coverage grades, followed by independent prospective validation.",
        "",
        "No result in this report is labeled a betting opportunity. The output consists of market disagreements and rule-qualified candidate anomalies only.",
        "",
        "STOP: Stage 8, deployment, O/U anomaly modeling, confidence calibration, and 2024-2025 evaluation were not performed.",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def run_stage7c(reports_root: Path, data_root: Path = DEFAULT_DATA_ROOT) -> dict:
    feature_rows = list(read_csv(reports_root / "rsm-v2-candidate-direct-features.csv"))
    if len(feature_rows) != 815:
        raise ValueError("Stage 7C requires the frozen 815-game Stage 7B direct-feature artifact")
    artifact = _load_model(reports_root / "rsm-v2-candidate-stage7b.json")
    schedule_path = data_root.parent / "nfl_games.csv"
    schedule_rows = [
        row for row in read_csv(schedule_path)
        if int(row.get("season") or 0) in (*TRAINING_SEASONS, *VALIDATION_SEASONS) and row.get("game_type") == "REG"
    ]
    schedule = {row["game_id"]: row for row in schedule_rows}
    confidence = lineup_confidence_by_game(feature_rows, data_root)
    scored = [score_market_disagreement(row, artifact, confidence.get(row["game_id"], "LOW"), schedule.get(row["game_id"], {})) for row in feature_rows]
    development = [row for row in scored if row["season"] in TRAINING_SEASONS]
    validation = [row for row in scored if row["season"] in VALIDATION_SEASONS]
    rules = freeze_thresholds(development)
    validation_with_flags = [apply_frozen_rules(row, rules) for row in validation]
    evaluations = [_evaluate_rule(validation, rule) for rule in rules]
    accuracies = [result["ats_accuracy"] for result in evaluations]
    monotonic = all(later >= earlier for earlier, later in zip(accuracies, accuracies[1:]))
    stage7b = json.loads((reports_root / "rsm-stage7b-v2-architecture.json").read_text(encoding="utf-8"))
    training_schedule = [row for row in schedule_rows if int(row["season"]) in TRAINING_SEASONS]
    validation_schedule = [row for row in schedule_rows if int(row["season"]) in VALIDATION_SEASONS]
    output = {
        "scope": {
            "development_seasons": list(TRAINING_SEASONS), "development_games": len(development),
            "development_start": min(row["gameday"] for row in training_schedule),
            "development_end": max(row["gameday"] for row in training_schedule),
            "validation_seasons": list(VALIDATION_SEASONS), "validation_games": len(validation),
            "validation_start": min(row["gameday"] for row in validation_schedule),
            "validation_end": max(row["gameday"] for row in validation_schedule),
            "locked_seasons_used": False,
        },
        "market_data": {
            "source": str(schedule_path),
            "source_retrieval_metadata_available": False,
            "availability_matrix": _availability_matrix(schedule_rows),
            "multi_book_supported": False,
            "closing_line_value_supported": False,
        },
        "anomaly_definition": {
            "formula": "roster_fair_home_margin - market_implied_home_margin",
            "confidence_weights": CONFIDENCE_WEIGHTS,
            "minimum_supporting_groups": MINIMUM_SUPPORTING_GROUPS,
            "minimum_group_contribution": MINIMUM_GROUP_CONTRIBUTION,
            "development_outcomes_used_for_thresholds": False,
            "validation_outcomes_used_for_thresholds": False,
        },
        "lineup_confidence": {
            "definition": "Stage 4 completeness and strictly prior-snap evidence; not verified injury availability",
            "development": dict(Counter(row["lineup_confidence"] for row in development)),
            "validation": dict(Counter(row["lineup_confidence"] for row in validation)),
        },
        "frozen_rules": rules,
        "validation": {
            "all_games": _summary(validation),
            "constant_benchmark": 0.5,
            "stage7b_residual_ats": stage7b["model_b"]["ats"]["accuracy"],
            "rules": evaluations,
            "larger_scores_monotonic": monotonic,
        },
        "model_version": MODEL_VERSION,
        "production_ready": False,
    }
    _write_csv(reports_root / "rsm-stage7c-anomaly-games.csv", validation_with_flags)
    (reports_root / "rsm-stage7c-anomaly-analysis.json").write_text(json.dumps(output, indent=2), encoding="utf-8")
    _write_report(reports_root / "rsm-stage7c-anomaly-analysis.md", output)
    return output
