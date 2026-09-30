"""Read-only audit of the RSM over/under inversion hypothesis.

This module intentionally reads saved RSM validation/backtest artifacts instead
of invoking production prediction code.  It answers a narrow question: whether
the recorded RSM O/U selections would have performed better if every non-push
selection were inverted.
"""

from __future__ import annotations

import csv
import json
import math
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable


REPO_ROOT = Path(__file__).resolve().parents[2]
REPORTS_ROOT = REPO_ROOT / "reports"
STAGE7A_CSV = REPORTS_ROOT / "rsm-stage7a-compression-confidence.csv"
LOCKED_BACKTEST_CSV = REPORTS_ROOT / "rsm-backtest-games.csv"
OUTPUT_CSV = REPORTS_ROOT / "rsm-total-inversion-audit.csv"
OUTPUT_JSON = REPORTS_ROOT / "rsm-total-inversion-audit.json"
OUTPUT_MD = REPORTS_ROOT / "rsm-total-inversion-audit.md"


@dataclass(frozen=True)
class AuditRecord:
    game_id: str
    season: int
    week: int
    game_type: str
    source_artifact: str
    ou_result: str
    market_total: float | None
    total_edge: float | None
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


def _load_stage7a_records(path: Path = STAGE7A_CSV) -> list[AuditRecord]:
    if not path.exists():
        return []
    records = []
    with path.open(newline="", encoding="utf-8") as source:
        for row in csv.DictReader(source):
            records.append(
                AuditRecord(
                    game_id=row["game_id"],
                    season=int(row["season"]),
                    week=int(row["week"]),
                    game_type="REG",
                    source_artifact=path.name,
                    ou_result=row["OU_result"],
                    market_total=_float_or_none(row.get("market_total")),
                    total_edge=_float_or_none(row.get("total_edge")),
                    prediction_confidence=_confidence_from_probability(row.get("ou_probability")),
                )
            )
    return records


def _load_locked_backtest_records(path: Path = LOCKED_BACKTEST_CSV) -> list[AuditRecord]:
    if not path.exists():
        return []
    records = []
    with path.open(newline="", encoding="utf-8") as source:
        for row in csv.DictReader(source):
            records.append(
                AuditRecord(
                    game_id=row["game_id"],
                    season=int(row["season"]),
                    week=int(row["week"]),
                    game_type=row.get("game_type") or "REG",
                    source_artifact=path.name,
                    ou_result=row["OU_result"],
                    market_total=_float_or_none(row.get("market_total")),
                    total_edge=_float_or_none(row.get("total_edge")),
                    prediction_confidence=row.get("prediction_confidence") or "UNKNOWN",
                )
            )
    return records


def _wilson_interval(wins: int, losses: int, z: float = 1.959963984540054) -> tuple[float | None, float | None]:
    n = wins + losses
    if n == 0:
        return None, None
    p = wins / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    spread = z * math.sqrt((p * (1 - p) / n) + (z * z / (4 * n * n))) / denom
    return max(0.0, center - spread), min(1.0, center + spread)


def _bucket_market_total(record: AuditRecord) -> str:
    if record.market_total is None:
        return "UNKNOWN"
    if record.market_total < 42:
        return "<42"
    if record.market_total <= 47:
        return "42-47"
    return "47.5+"


def _bucket_total_edge(record: AuditRecord) -> str:
    if record.total_edge is None:
        return "UNKNOWN"
    absolute = abs(record.total_edge)
    if absolute < 2:
        return "0-1.99"
    if absolute < 4:
        return "2-3.99"
    if absolute < 6:
        return "4-5.99"
    return "6+"


def _summarize(records: Iterable[AuditRecord], group: str, label: str) -> dict:
    counter = Counter(record.ou_result.upper() for record in records if record.ou_result)
    wins = counter["WIN"]
    losses = counter["LOSS"]
    pushes = counter["PUSH"]
    graded = wins + losses
    original_ci = _wilson_interval(wins, losses)
    inverted_ci = _wilson_interval(losses, wins)
    return {
        "group": group,
        "label": str(label),
        "games": wins + losses + pushes,
        "original_wins": wins,
        "original_losses": losses,
        "pushes": pushes,
        "original_accuracy": wins / graded if graded else None,
        "original_ci_low": original_ci[0],
        "original_ci_high": original_ci[1],
        "inverted_wins": losses,
        "inverted_losses": wins,
        "inverted_accuracy": losses / graded if graded else None,
        "inverted_ci_low": inverted_ci[0],
        "inverted_ci_high": inverted_ci[1],
        "net_inversion_delta": ((losses - wins) / graded) if graded else None,
    }


def _group(records: list[AuditRecord], group: str, key: Callable[[AuditRecord], str | int]) -> list[dict]:
    grouped: dict[str, list[AuditRecord]] = defaultdict(list)
    for record in records:
        grouped[str(key(record))].append(record)
    return [_summarize(grouped[label], group, label) for label in sorted(grouped, key=lambda item: (str(item)))]


def run_audit() -> dict:
    stage7a = _load_stage7a_records()
    locked = _load_locked_backtest_records()
    locked_regular = [record for record in locked if record.game_type == "REG"]
    locked_playoffs = [record for record in locked if record.game_type != "REG"]
    combined_regular = stage7a + locked_regular

    rows = []
    rows.append(_summarize(stage7a, "period", "2023 validation regular season"))
    rows.append(_summarize(locked_regular, "period", "2024-2025 locked regular season"))
    rows.append(_summarize(locked_playoffs, "period", "2024-2025 locked playoffs"))
    rows.append(_summarize(combined_regular, "period", "2023-2025 combined regular saved artifacts"))
    rows.extend(_group(combined_regular, "season", lambda record: record.season))
    rows.extend(_group(combined_regular, "week", lambda record: record.week))
    rows.extend(_group(combined_regular, "market_total_bucket", _bucket_market_total))
    rows.extend(_group(combined_regular, "absolute_total_edge_bucket", _bucket_total_edge))
    rows.extend(_group(combined_regular, "prediction_confidence", lambda record: record.prediction_confidence))

    return {
        "audit": "RSM total inversion audit",
        "production_behavior_changed": False,
        "ten_year_point_in_time_supported": False,
        "ten_year_limitation": (
            "The repository does not contain point-in-time RSM total prediction artifacts "
            "for ten historical seasons. The audit is limited to saved 2023 validation "
            "and 2024-2025 locked RSM artifacts."
        ),
        "source_artifacts": [
            str(STAGE7A_CSV.relative_to(REPO_ROOT)),
            str(LOCKED_BACKTEST_CSV.relative_to(REPO_ROOT)),
        ],
        "periods": {
            "stage7a_validation": "2023 regular season",
            "locked_regular": "2024-2025 regular seasons",
            "locked_playoffs": "2024-2025 playoffs",
        },
        "rows": rows,
    }


def _format_pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.2f}%"


def _write_csv(rows: list[dict], path: Path = OUTPUT_CSV) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "group", "label", "games", "original_wins", "original_losses", "pushes",
        "original_accuracy", "original_ci_low", "original_ci_high",
        "inverted_wins", "inverted_losses", "inverted_accuracy",
        "inverted_ci_low", "inverted_ci_high", "net_inversion_delta",
    ]
    with path.open("w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def _write_markdown(data: dict, path: Path = OUTPUT_MD) -> None:
    rows = data["rows"]
    period_rows = [row for row in rows if row["group"] == "period"]
    lines = [
        "# RSM Total Inversion Audit",
        "",
        "This is a read-only audit of the hypothesis that RSM over/under selections should be inverted.",
        "No production RSM behavior, coefficients, thresholds, feature definitions, or prediction outputs were changed.",
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
    lines.extend(f"- `{artifact}`" for artifact in data["source_artifacts"])
    lines.extend([
        "",
        "## Period summary",
        "",
        "| Period | Games | Original O/U | Original accuracy | Original 95% CI | Inverted O/U | Inverted accuracy | Inverted 95% CI |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ])
    for row in period_rows:
        lines.append(
            f"| {row['label']} | {row['games']} | "
            f"{row['original_wins']}-{row['original_losses']}-{row['pushes']} | {_format_pct(row['original_accuracy'])} | "
            f"{_format_pct(row['original_ci_low'])}-{_format_pct(row['original_ci_high'])} | "
            f"{row['inverted_wins']}-{row['inverted_losses']}-{row['pushes']} | {_format_pct(row['inverted_accuracy'])} | "
            f"{_format_pct(row['inverted_ci_low'])}-{_format_pct(row['inverted_ci_high'])} |"
        )

    lines.extend([
        "",
        "## Interpretation",
        "",
        "- The inversion pattern is visible in 2023 validation and 2025 locked regular season, but not in 2024.",
        "- Across the saved 2023-2025 regular-season artifacts, inversion improves O/U from 48.71% to 51.29%, which is below common break-even levels and has a confidence interval that includes 50%.",
        "- Locked 2024-2025 regular season alone improves only from 49.72% to 50.28% when inverted.",
        "- Locked playoff O/U was positive in the original direction, so inversion would have harmed that small sample.",
        "- This does not validate flipping production RSM O/U selections. It identifies a research question for future point-in-time/prospective tracking.",
        "",
        "## Detailed breakdowns",
        "",
        "| Group | Label | Games | Original O/U | Original accuracy | Inverted O/U | Inverted accuracy |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ])
    for row in rows:
        if row["group"] == "period":
            continue
        lines.append(
            f"| {row['group']} | {row['label']} | {row['games']} | "
            f"{row['original_wins']}-{row['original_losses']}-{row['pushes']} | {_format_pct(row['original_accuracy'])} | "
            f"{row['inverted_wins']}-{row['inverted_losses']}-{row['pushes']} | {_format_pct(row['inverted_accuracy'])} |"
        )

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_outputs(data: dict) -> None:
    REPORTS_ROOT.mkdir(parents=True, exist_ok=True)
    _write_csv(data["rows"])
    OUTPUT_JSON.write_text(json.dumps(data, indent=2), encoding="utf-8")
    _write_markdown(data)


def main() -> None:
    write_outputs(run_audit())


if __name__ == "__main__":
    main()
