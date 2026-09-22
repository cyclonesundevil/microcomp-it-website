import csv
import json

from parallel_models.backtest import evaluate_drive_models, write_drive_model_backtest


def _write_csv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def test_evaluate_drive_models_uses_validation_season_only(tmp_path):
    games = tmp_path / "games.csv"
    drives = tmp_path / "drives.csv"
    _write_csv(games, [
        {
            "game_id": "2024_01_A_B",
            "season": "2024",
            "game_type": "REG",
            "week": "1",
            "gameday": "2024-09-08",
            "gametime": "13:00",
            "away_team": "A",
            "away_score": "10",
            "home_team": "B",
            "home_score": "20",
            "away_rest": "7",
            "home_rest": "7",
            "spread_line": "-3",
            "total_line": "44",
        },
        {
            "game_id": "2025_02_A_B",
            "season": "2025",
            "game_type": "REG",
            "week": "2",
            "gameday": "2025-09-14",
            "gametime": "13:00",
            "away_team": "A",
            "away_score": "14",
            "home_team": "B",
            "home_score": "21",
            "away_rest": "7",
            "home_rest": "7",
            "spread_line": "-2.5",
            "total_line": "42.5",
        },
    ])
    _write_csv(drives, [
        {
            "game_id": "2025_01_B_A",
            "season": "2025",
            "season_type": "REG",
            "week": "1",
            "drive": "1",
            "offense": "B",
            "defense": "A",
            "plays": "6",
            "epa": "2.0",
            "points": "7.0",
            "result": "TOUCHDOWN",
            "start_yardline_100": "75",
            "red_zone_entry": "True",
        },
        {
            "game_id": "2025_02_A_B",
            "season": "2025",
            "season_type": "REG",
            "week": "2",
            "drive": "1",
            "offense": "A",
            "defense": "B",
            "plays": "6",
            "epa": "100.0",
            "points": "7.0",
            "result": "TOUCHDOWN",
            "start_yardline_100": "75",
            "red_zone_entry": "True",
        },
    ])

    result = evaluate_drive_models(games_path=games, drive_summaries_path=drives)

    assert result["games_evaluated"] == 1
    assert result["prediction_rows"] == 2
    assert {record["season"] for record in result["records"]} == {2025}
    assert {metric["model_name"] for metric in result["metrics"]} == {"dsm", "prm"}
    assert all(metric["games"] == 1 for metric in result["metrics"])


def test_write_drive_model_backtest_writes_machine_readable_artifacts(tmp_path):
    games = tmp_path / "games.csv"
    drives = tmp_path / "drives.csv"
    output = tmp_path / "reports"
    _write_csv(games, [
        {
            "game_id": "2025_02_A_B",
            "season": "2025",
            "game_type": "REG",
            "week": "2",
            "gameday": "2025-09-14",
            "gametime": "13:00",
            "away_team": "A",
            "away_score": "14",
            "home_team": "B",
            "home_score": "21",
            "away_rest": "7",
            "home_rest": "7",
            "spread_line": "-2.5",
            "total_line": "42.5",
        },
    ])
    _write_csv(drives, [
        {
            "game_id": "2025_01_B_A",
            "season": "2025",
            "season_type": "REG",
            "week": "1",
            "drive": "1",
            "offense": "B",
            "defense": "A",
            "plays": "6",
            "epa": "2.0",
            "points": "7.0",
            "result": "TOUCHDOWN",
            "start_yardline_100": "75",
            "red_zone_entry": "True",
        },
    ])

    result = write_drive_model_backtest(games_path=games, drive_summaries_path=drives, output_dir=output)

    assert (output / "dsm-prm-validation-predictions.csv").exists()
    assert (output / "dsm-prm-validation-metrics.json").exists()
    assert (output / "dsm-prm-validation-summary.md").exists()
    stored = json.loads((output / "dsm-prm-validation-metrics.json").read_text(encoding="utf-8"))
    assert stored["prediction_rows"] == 2
    assert "records" not in stored
    assert result["summary_markdown"].endswith("dsm-prm-validation-summary.md")
