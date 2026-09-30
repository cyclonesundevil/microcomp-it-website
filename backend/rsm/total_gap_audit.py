"""Read-only audit of market-total-vs-RSM-total gap behavior.

This module tests the hypothesis:

    total_gap = market_total - rsm_predicted_total

If market totals are materially above RSM totals, historical games may lean
Under.  The audit reads only saved RSM artifacts and writes reports; it does not
modify production model behavior.
"""

from __future__ import annotations

import csv
import json
import math
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable


REPO_ROOT = Path(__file__).resolve().parents[2]
REPORTS_ROOT = REPO_ROOT / "reports"
STAGE7A_CSV = REPORTS_ROOT / "rsm-stage7a-compression-confidence.csv"
LOCKED_BACKTEST_CSV = REPORTS_ROOT / "rsm-backtest-games.csv"
OUTPUT_CSV = REPORTS_ROOT / "rsm-total-gap-audit.csv"
OUTPUT_JSON = REPORTS_ROOT / "rsm-total-gap-audit.json"
OUTPUT_MD = REPORTS_ROOT / "rsm-total-gap-audit.md"


@dataclass(frozen=True)
class TotalGapRecord:
    game_id: str
    season: int
    week: int
    game_type: str
    source_artifact: str
    rsm_predicted_total: float
    market_total: float
    actual_total: float
    total_gap: float
    original_ou_pick: str
    original_ou_result: str
    prediction_confidence: str


def _float_or_none(value: str | None) -> float | None:
    try:
        if value is None or str(value).strip() == "":
            return None
        return float(value)
    except ValueError:
        return None


def _confidence_from_probability(value: str | None) -> str:
    probability = _float_or_none(value)
    if probability is None:
        return "UNKNOWN"
    if probability < 0.55:
        return "LOW"
    if probability < 0.65:
        return "MEDIUM"
    return "HIGH"


def _original_pick_from_edge(edge: float | None) -> str:
    if edge is None:
        return "NONE"
    if edge > 0:
        return "OVER"
    if edge < 0:
        return "UNDER"
    return "NONE"


def _load_stage7a_records(path: Path = STAGE7A_CSV) -> list[TotalGapRecord]:
    if not path.exists():
        return []
    records = []
    with path.open(newline="", encoding="utf-8") as source:
        for row in csv.DictReader(source):
            predicted_total = _float_or_none(row.get("raw_total"))
            market_total = _float_or_none(row.get("market_total"))
            actual_home = _float_or_none(row.get("actual_home"))
            actual_away = _float_or_none(row.get("actual_away"))
            if predicted_total is None or market_total is None or actual_home is None or actual_away is None:
                continue
            total_edge = _float_or_none(row.get("total_edge"))
            records.append(
                TotalGapRecord(
                    game_id=row["game_id"],
                    season=int(row["season"]),
                    week=int(row["week"]),
                    game_type="REG",
                    source_artifact=path.name,
                    rsm_predicted_total=predicted_total,
                    market_total=market_total,
                    actual_total=actual_home + actual_away,
                    total_gap=market_total - predicted_total,
                    original_ou_pick=_original_pick_from_edge(total_edge),
                    original_ou_result=row.get("OU_result") or "",
                    prediction_confidence=_confidence_from_probability(row.get("ou_probability")),
                )
            )
    return records


def _load_locked_backtest_records(path: Path = LOCKED_BACKTEST_CSV) -> list[TotalGapRecord]:
    if not path.exists():
        return []
    records = []
    with path.open(newline="", encoding="utf-8") as source:
        for row in csv.DictReader(source):
            predicted_total = _float_or_none(row.get("predicted_total"))
            market_total = _float_or_none(row.get("market_total"))
            actual_away = _float_or_none(row.get("actual_away_score"))
            actual_home = _float_or_none(row.get("actual_home_score"))
            if predicted_total is None or market_total is None or actual_away is None or actual_home is None:
                continue
            records.append(
                TotalGapRecord(
                    game_id=row["game_id"],
                    season=int(row["season"]),
                    week=int(row["week"]),
                    game_type=row.get("game_type") or "REG",
                    source_artifact=path.name,
                    rsm_predicted_total=predicted_total,
                    market_total=market_total,
                    actual_total=actual_away + actual_home,
                    total_gap=market_total - predicted_total,
                    original_ou_pick=row.get("OU_pick") or _original_pick_from_edge(_float_or_none(row.get("total_edge"))),
                    original_ou_result=row.get("OU_result") or "",
                    prediction_confidence=row.get("prediction_confidence") or "UNKNOWN",
                )
            )
    return records


def load_primary_records() -> list[TotalGapRecord]:
    """Load the saved 2023 validation plus 2024-2025 locked RSM artifacts."""
    return _load_stage7a_records() + _load_locked_backtest_records()


def _wilson_interval(wins: int, losses: int, z: float = 1.959963984540054) -> tuple[float | None, float | None]:
    n = wins + losses
    if n == 0:
        return None, None
    p = wins / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    spread = z * math.sqrt((p * (1 - p) / n) + (z * z / (4 * n * n))) / denom
    return max(0.0, center - spread), min(1.0, center + spread)


def _total_result(record: TotalGapRecord) -> str:
    margin = record.actual_total - record.market_total
    if abs(margin) < 1e-9:
        return "PUSH"
    return "OVER" if margin > 0 else "UNDER"


def total_gap_bucket(record: TotalGapRecord) -> str:
    gap = record.total_gap
    if gap < 0:
        return "market below RSM"
    if gap < 1.5:
        return "0 to +1.5"
    if gap < 3.5:
        return "+1.5 to +3.5"
    if gap < 5.5:
        return "+3.5 to +5.5"
    return "+5.5 or greater"


def is_under_watch(record: TotalGapRecord) -> bool:
    """Frozen research flag from the saved-artifact audit; not a production pick."""
    return 0 <= record.total_gap < 1.5


def _market_total_bucket(record: TotalGapRecord) -> str:
    if record.market_total < 42:
        return "<42"
    if record.market_total <= 47:
        return "42-47"
    return "47.5+"


def _mean(values: Iterable[float]) -> float | None:
    collected = list(values)
    return statistics.mean(collected) if collected else None


def summarize_records(records: Iterable[TotalGapRecord], group: str, label: str) -> dict:
    records = list(records)
    result_counts = Counter(_total_result(record) for record in records)
    over_wins = result_counts["OVER"]
    under_wins = result_counts["UNDER"]
    pushes = result_counts["PUSH"]
    ci_low, ci_high = _wilson_interval(under_wins, over_wins)
    return {
        "group": group,
        "label": str(label),
        "games": len(records),
        "over_wins": over_wins,
        "under_wins": under_wins,
        "pushes": pushes,
        "under_accuracy": under_wins / (under_wins + over_wins) if (under_wins + over_wins) else None,
        "under_ci_low": ci_low,
        "under_ci_high": ci_high,
        "average_market_total": _mean(record.market_total for record in records),
        "average_rsm_total": _mean(record.rsm_predicted_total for record in records),
        "average_actual_total": _mean(record.actual_total for record in records),
        "average_total_gap": _mean(record.total_gap for record in records),
        "total_mae": _mean(abs(record.rsm_predicted_total - record.actual_total) for record in records),
    }


def _group(records: list[TotalGapRecord], group: str, key: Callable[[TotalGapRecord], str | int]) -> list[dict]:
    grouped: dict[str, list[TotalGapRecord]] = defaultdict(list)
    for record in records:
        grouped[str(key(record))].append(record)
    return [summarize_records(grouped[label], group, label) for label in sorted(grouped, key=lambda item: str(item))]


def _primary_regular(records: list[TotalGapRecord]) -> list[TotalGapRecord]:
    return [record for record in records if record.game_type == "REG"]


def _blind_inversion_reference() -> dict:
    path = REPORTS_ROOT / "rsm-total-inversion-audit.json"
    if not path.exists():
        return {
            "available": False,
            "note": "Prior blind inversion audit artifact was not found.",
        }
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = [
        row for row in data.get("rows", [])
        if row.get("group") == "period" and row.get("label") == "2023-2025 combined regular saved artifacts"
    ]
    if not rows:
        return {
            "available": False,
            "note": "Prior blind inversion audit did not contain the comparable combined regular row.",
        }
    row = rows[0]
    return {
        "available": True,
        "label": row["label"],
        "original_accuracy": row["original_accuracy"],
        "inverted_accuracy": row["inverted_accuracy"],
        "original_record": f"{row['original_wins']}-{row['original_losses']}-{row['pushes']}",
        "inverted_record": f"{row['inverted_wins']}-{row['inverted_losses']}-{row['pushes']}",
    }


def run_audit() -> dict:
    records = load_primary_records()
    regular = _primary_regular(records)
    playoff = [record for record in records if record.game_type != "REG"]

    rows = []
    rows.append(summarize_records(regular, "period", "2023-2025 regular saved artifacts"))
    rows.append(summarize_records(playoff, "period", "2024-2025 playoffs"))
    rows.extend(_group(regular, "total_gap_bucket", total_gap_bucket))
    rows.extend(_group(regular, "season", lambda record: record.season))
    rows.extend(_group(regular, "week", lambda record: record.week))
    rows.extend(_group(regular, "market_total_bucket", _market_total_bucket))
    rows.extend(_group(regular, "rsm_original_ou_pick", lambda record: record.original_ou_pick))
    rows.extend(_group(regular, "prediction_confidence", lambda record: record.prediction_confidence))
    rows.extend(_group(regular, "rsm_under_watch", lambda record: "UNDER_WATCH" if is_under_watch(record) else "NOT_UNDER_WATCH"))
    rows.extend(_group(records, "game_type", lambda record: record.game_type))

    return {
        "audit": "RSM total gap audit",
        "production_behavior_changed": False,
        "ten_year_point_in_time_supported": False,
        "ten_year_limitation": (
            "The repository does not contain point-in-time RSM total prediction artifacts "
            "for ten historical seasons. This audit is limited to saved 2023 validation "
            "and 2024-2025 locked RSM artifacts."
        ),
        "signal": "total_gap = market_total - rsm_predicted_total",
        "bucket_definitions": {
            "market below RSM": "total_gap < 0",
            "0 to +1.5": "0 <= total_gap < 1.5",
            "+1.5 to +3.5": "1.5 <= total_gap < 3.5",
            "+3.5 to +5.5": "3.5 <= total_gap < 5.5",
            "+5.5 or greater": "total_gap >= 5.5",
        },
        "frozen_research_watchlist_rule": {
            "label": "RSM_UNDER_WATCH",
            "definition": "0 <= market_total - rsm_predicted_total < 1.5",
            "status": "hypothesis-generating research flag only",
            "production_signal": False,
            "notes": [
                "This condition was identified after reviewing saved artifacts.",
                "It must be tracked prospectively before any production use is considered.",
                "It is not a betting recommendation, confidence pick, or wagering signal.",
            ],
        },
        "source_artifacts": [
            {
                "path": str(STAGE7A_CSV.relative_to(REPO_ROOT)),
                "supports": ["RSM predicted total", "market total", "actual total", "season/week/game metadata", "O/U result"],
                "period": "2023 regular validation",
            },
            {
                "path": str(LOCKED_BACKTEST_CSV.relative_to(REPO_ROOT)),
                "supports": ["RSM predicted total", "market total", "actual total", "season/week/game metadata", "O/U result", "prediction confidence", "game type"],
                "period": "2024-2025 locked regular season and playoffs",
            },
        ],
        "blind_inversion_reference": _blind_inversion_reference(),
        "rows": rows,
    }


def _format_pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.2f}%"


def _format_number(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.2f}"


def _write_csv(rows: list[dict], path: Path = OUTPUT_CSV) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "group", "label", "games", "over_wins", "under_wins", "pushes",
        "under_accuracy", "under_ci_low", "under_ci_high", "average_market_total",
        "average_rsm_total", "average_actual_total", "average_total_gap", "total_mae",
    ]
    with path.open("w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def _write_markdown(data: dict, path: Path = OUTPUT_MD) -> None:
    rows = data["rows"]
    period_rows = [row for row in rows if row["group"] == "period"]
    gap_rows = [row for row in rows if row["group"] == "total_gap_bucket"]
    watch_rows = [row for row in rows if row["group"] == "rsm_under_watch" and row["label"] == "UNDER_WATCH"]
    ordered_gap_labels = ["market below RSM", "0 to +1.5", "+1.5 to +3.5", "+3.5 to +5.5", "+5.5 or greater"]
    gap_rows.sort(key=lambda row: ordered_gap_labels.index(row["label"]) if row["label"] in ordered_gap_labels else 999)
    reference = data["blind_inversion_reference"]

    lines = [
        "# RSM Total Gap Audit",
        "",
        "This is a read-only audit of whether games with `market_total > rsm_predicted_total` lean Under.",
        "No production RSM behavior, coefficients, thresholds, feature definitions, prediction outputs, UI, or APIs were changed.",
        "",
        "## Ten-year support status",
        "",
        f"Ten-year point-in-time RSM total audit supported by current artifacts: **{data['ten_year_point_in_time_supported']}**.",
        "",
        data["ten_year_limitation"],
        "",
        "## Source artifacts",
        "",
    ]
    for artifact in data["source_artifacts"]:
        supports = ", ".join(artifact["supports"])
        lines.append(f"- `{artifact['path']}` ({artifact['period']}): {supports}.")

    lines.extend([
        "",
        "## Period summary",
        "",
        "| Period | Games | Over wins | Under wins | Pushes | Under accuracy | 95% CI | Avg market total | Avg RSM total | Avg actual total | Avg total gap | Total MAE |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ])
    for row in period_rows:
        lines.append(_markdown_row(row))

    lines.extend([
        "",
        "## Total-gap buckets",
        "",
        "`total_gap = market_total - rsm_predicted_total`.",
        "",
        "| Bucket | Games | Over wins | Under wins | Pushes | Under accuracy | 95% CI | Avg market total | Avg RSM total | Avg actual total | Avg gap | Total MAE |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ])
    for row in gap_rows:
        lines.append(_markdown_row(row, label_key="label"))

    lines.extend([
        "",
        "## Comparison with blind inversion audit",
        "",
    ])
    if reference.get("available"):
        lines.extend([
            f"- Blind inversion comparable period: {reference['label']}.",
            f"- Original O/U: {reference['original_record']} ({_format_pct(reference['original_accuracy'])}).",
            f"- Fully inverted O/U: {reference['inverted_record']} ({_format_pct(reference['inverted_accuracy'])}).",
        ])
    else:
        lines.append(f"- {reference['note']}")

    lines.extend([
        "",
        "## Frozen research watchlist",
        "",
        "**RSM_UNDER_WATCH** is defined as `0 <= market_total - rsm_predicted_total < 1.5`.",
        "",
        "This is a hypothesis-generating research flag only. It is not a production signal, betting recommendation, confidence pick, or wagering instruction.",
        "",
    ])
    if watch_rows:
        row = watch_rows[0]
        lines.extend([
            "| Flag | Games | Over wins | Under wins | Pushes | Under accuracy | 95% CI | Avg gap |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
            (
                f"| RSM_UNDER_WATCH | {row['games']} | {row['over_wins']} | {row['under_wins']} | {row['pushes']} | "
                f"{_format_pct(row['under_accuracy'])} | {_format_pct(row['under_ci_low'])}-{_format_pct(row['under_ci_high'])} | "
                f"{_format_number(row['average_total_gap'])} |"
            ),
            "",
        ])
    else:
        lines.append("No saved-artifact games matched the watchlist condition.")
        lines.append("")

    lines.extend([
        "",
        "## Interpretation",
        "",
        "- The broad regular-season `market_total > RSM total` condition is not an Under edge in the saved artifacts.",
        "- The only positive-gap bucket above 50% Under is the narrow 0 to +1.5 bucket, now labeled `RSM_UNDER_WATCH` for prospective research; wider positive gaps skew Over, not Under.",
        "- The +5.5 or greater bucket has the lowest Under rate among the positive-gap buckets, so larger market-above-RSM gaps contradict the proposed Under-ceiling hypothesis in these artifacts.",
        "- Compared with blind inversion, total-gap bucketing is more interpretable but still not validated as a betting edge.",
        "- Because the watchlist condition was identified after looking at these artifacts, it must be frozen and evaluated prospectively before any use beyond research.",
        "- A true ten-year point-in-time RSM total test is unavailable from current artifacts.",
        "",
        "## Detailed breakdowns",
        "",
        "| Group | Label | Games | Over wins | Under wins | Pushes | Under accuracy | Avg gap | Total MAE |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ])
    for row in rows:
        if row["group"] in {"period", "total_gap_bucket"}:
            continue
        lines.append(
            f"| {row['group']} | {row['label']} | {row['games']} | {row['over_wins']} | "
            f"{row['under_wins']} | {row['pushes']} | {_format_pct(row['under_accuracy'])} | "
            f"{_format_number(row['average_total_gap'])} | {_format_number(row['total_mae'])} |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _markdown_row(row: dict, label_key: str = "label") -> str:
    return (
        f"| {row[label_key]} | {row['games']} | {row['over_wins']} | {row['under_wins']} | {row['pushes']} | "
        f"{_format_pct(row['under_accuracy'])} | {_format_pct(row['under_ci_low'])}-{_format_pct(row['under_ci_high'])} | "
        f"{_format_number(row['average_market_total'])} | {_format_number(row['average_rsm_total'])} | "
        f"{_format_number(row['average_actual_total'])} | {_format_number(row['average_total_gap'])} | "
        f"{_format_number(row['total_mae'])} |"
    )


def write_outputs(data: dict) -> None:
    REPORTS_ROOT.mkdir(parents=True, exist_ok=True)
    _write_csv(data["rows"])
    OUTPUT_JSON.write_text(json.dumps(data, indent=2), encoding="utf-8")
    _write_markdown(data)


def main() -> None:
    write_outputs(run_audit())


if __name__ == "__main__":
    main()
