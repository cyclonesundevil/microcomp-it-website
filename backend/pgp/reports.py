from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Mapping


DEFAULT_REPORTS_DIR = Path(__file__).resolve().parents[2] / "reports" / "pgp"


def write_evaluation_outputs(result: Mapping[str, object], output_dir: Path = DEFAULT_REPORTS_DIR) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / "pgp-evaluation-games.csv"
    json_path = output_dir / "pgp-evaluation-summary.json"
    md_path = output_dir / "pgp-evaluation-summary.md"

    records = list(result.get("records") or [])
    if records:
        with csv_path.open("w", newline="", encoding="utf-8") as target:
            writer = csv.DictWriter(target, fieldnames=list(records[0]))
            writer.writeheader()
            writer.writerows(records)
    else:
        csv_path.write_text("", encoding="utf-8")

    payload = {key: value for key, value in result.items() if key != "records"}
    payload["prediction_csv"] = str(csv_path)
    json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    md_path.write_text(_render_markdown(payload), encoding="utf-8")
    return {
        **payload,
        "summary_json": str(json_path),
        "summary_markdown": str(md_path),
    }


def _render_markdown(payload: Mapping[str, object]) -> str:
    lines = [
        "# PGP Evaluation Summary",
        "",
        "Research-only Pre-Game Predictability evaluation. These results are not betting recommendations.",
        "",
        f"Train through: `{payload['train_through']}`",
        f"Test season: `{payload['test_season']}`",
        f"Game type: `{payload['game_type']}`",
        f"Prior source: `{payload.get('prior_source', payload.get('configuration', {}).get('prior_source', 'score'))}`",
        f"Games evaluated: {payload['games_evaluated']}",
        f"Prediction rows: {payload['prediction_rows']}",
        "",
        "| Tier | Games | Score MAE | Margin MAE | Total MAE | Home win Brier | Total 80% coverage | Margin 80% coverage |",
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for metric in payload.get("metrics", []):
        lines.append(
            "| {tier} | {games} | {score_mae} | {margin_mae} | {total_mae} | {home_win_brier} | {total_interval_80_coverage} | {margin_interval_80_coverage} |".format(
                tier=metric["tier"],
                games=metric["games"],
                score_mae=_fmt(metric["score_mae"]),
                margin_mae=_fmt(metric["margin_mae"]),
                total_mae=_fmt(metric["total_mae"]),
                home_win_brier=_fmt(metric["home_win_brier"]),
                total_interval_80_coverage=_fmt(metric["total_interval_80_coverage"]),
                margin_interval_80_coverage=_fmt(metric["margin_interval_80_coverage"]),
            )
        )
    lines.extend([
        "",
        "Current scope:",
        "",
        "- Tier 0 uses league-only historical priors.",
        "- Tier 1 uses rolling team scoring/drive and allowed-scoring/drive priors.",
        "- No market, roster, injury, or weather inputs are used.",
    ])
    return "\n".join(lines) + "\n"


def _fmt(value: object) -> str:
    if value is None:
        return "-"
    return f"{float(value):.3f}"
