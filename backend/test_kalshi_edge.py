import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest


BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

from app import app
from experimental import kalshi_edge


def test_normalize_kalshi_snapshot_moneyline_mid_price():
    row = kalshi_edge.normalize_kalshi_snapshot({
        "season": 2026,
        "week": 4,
        "away_team": "JAX",
        "home_team": "CIN",
        "team": "CIN",
        "bid": 56,
        "ask": 58,
        "observed_at": "2026-10-04T17:26:00Z",
    })

    assert row["market_type"] == "moneyline"
    assert row["contract_side"] == "home_win"
    assert row["kalshi_mid_price"] == pytest.approx(0.57)
    assert row["kalshi_implied_probability"] == pytest.approx(0.57)


def test_calibrate_margin_to_win_uses_historical_records():
    records = []
    for margin in range(-14, 15):
        records.append({
            "model": "current_season_matrix",
            "pred_margin": margin,
            "actual_margin": margin + (1 if margin >= 0 else -1),
        })

    calibration = kalshi_edge.calibrate_margin_to_win(records, "current_season_matrix", min_sample=10)

    assert calibration["sample_size"] == 29
    assert calibration["fallback_used"] is False
    assert calibration["scale"] > 0
    assert calibration["log_loss"] is not None


def test_kalshi_edge_rows_calculate_threshold_and_profit():
    upcoming = {
        "season": 2026,
        "week": 4,
        "games": [{
            "schedule": {
                "season": 2026,
                "week": 4,
                "game_id": "2026_04_JAX_CIN",
                "away_team": "JAX",
                "home_team": "CIN",
                "home_score": 27,
                "away_score": 20,
            },
            "models": {
                "current_season_matrix": {"pred_margin": 4.0},
            },
        }],
    }
    snapshots = [{
        "season": 2026,
        "week": 4,
        "game_id": "2026_04_JAX_CIN",
        "away_team": "JAX",
        "home_team": "CIN",
        "market_type": "moneyline",
        "contract_side": "home_win",
        "kalshi_implied_probability": 0.52,
        "observed_at": "2026-10-04T17:26:00Z",
    }]
    rows = kalshi_edge.kalshi_edge_rows(
        upcoming,
        snapshots,
        {"current_season_matrix": {"scale": 6.5, "sample_size": 100, "confidence": "high"}},
        thresholds=(0.03,),
        models=("current_season_matrix",),
    )

    assert len(rows) == 1
    assert rows[0]["recommended_side"] == "home_win"
    assert rows[0]["recommended_team"] == "CIN"
    assert rows[0]["simulated_profit"] == pytest.approx(0.48)


def test_import_kalshi_snapshots_uses_local_store(tmp_path, monkeypatch):
    monkeypatch.setattr(kalshi_edge, "kalshi_data_root", lambda: tmp_path)

    result = kalshi_edge.import_kalshi_snapshots({
        "snapshots": [{
            "season": 2026,
            "week": 4,
            "away_team": "ARI",
            "home_team": "NYG",
            "contract_side": "away_win",
            "price": 0.70,
        }]
    })

    assert result["imported"] == 1
    assert kalshi_edge.read_kalshi_snapshots()[0]["contract_side"] == "away_win"


def test_generate_kalshi_snapshots_from_api_markets_matches_schedule():
    schedule = [{
        "season": 2026,
        "week": 5,
        "game_id": "2026_05_BAL_ATL",
        "away_team": "BAL",
        "home_team": "ATL",
    }]
    markets = [
        {
            "ticker": "KXNFLGAME-26OCT11BALATL-BAL",
            "event_ticker": "KXNFLGAME-26OCT11BALATL",
            "title": "Baltimore wins",
            "yes_sub_title": "Baltimore",
            "expiration_value": "winner",
            "yes_bid_dollars": "0.6500",
            "yes_ask_dollars": "0.6600",
            "last_price_dollars": "0.6500",
            "volume_fp": "100.00",
            "liquidity_dollars": "200.00",
            "occurrence_datetime": "2026-10-11T17:00:00Z",
        },
        {
            "ticker": "KXNFLGAME-26OCT11BALATL-ATL",
            "event_ticker": "KXNFLGAME-26OCT11BALATL",
            "title": "Atlanta wins",
            "yes_sub_title": "Atlanta",
            "expiration_value": "winner",
            "yes_bid_dollars": "0.3400",
            "yes_ask_dollars": "0.3600",
            "last_price_dollars": "0.3500",
        },
    ]

    result = kalshi_edge.generate_kalshi_snapshots_from_api(schedule, markets=markets)

    assert result["generated_snapshots"] == 2
    by_side = {row["contract_side"]: row for row in result["snapshots"]}
    assert by_side["away_win"]["market_id"] == "KXNFLGAME-26OCT11BALATL-BAL"
    assert by_side["home_win"]["kalshi_mid_price"] == pytest.approx(0.35)


def test_refresh_kalshi_snapshots_from_api_imports_generated_rows(tmp_path, monkeypatch):
    monkeypatch.setattr(kalshi_edge, "kalshi_data_root", lambda: tmp_path)
    monkeypatch.setattr(kalshi_edge, "fetch_kalshi_nfl_game_markets", lambda: [{
        "ticker": "KXNFLGAME-26OCT11CHIGB-GB",
        "event_ticker": "KXNFLGAME-26OCT11CHIGB",
        "title": "Green Bay wins",
        "yes_sub_title": "Green Bay",
        "expiration_value": "winner",
        "yes_bid_dollars": "0.4100",
        "yes_ask_dollars": "0.4200",
    }, {
        "ticker": "KXNFLGAME-26OCT11CHIGB-CHI",
        "event_ticker": "KXNFLGAME-26OCT11CHIGB",
        "title": "Chicago wins",
        "yes_sub_title": "Chicago",
        "expiration_value": "winner",
        "yes_bid_dollars": "0.5800",
        "yes_ask_dollars": "0.5900",
    }])

    result = kalshi_edge.refresh_kalshi_snapshots_from_api([{
        "season": 2026,
        "week": 5,
        "game_id": "2026_05_CHI_GB",
        "away_team": "CHI",
        "home_team": "GB",
    }])

    assert result["generated_snapshots"] == 2
    assert result["imported"] == 2
    assert len(kalshi_edge.read_kalshi_snapshots()) == 2


@pytest.mark.anyio
async def test_kalshi_edge_import_route_is_admin_protected(tmp_path, monkeypatch):
    previous_secret = os.environ.get("ADMIN_SECRET")
    os.environ["ADMIN_SECRET"] = "test-admin-secret"
    monkeypatch.setattr(kalshi_edge, "kalshi_data_root", lambda: tmp_path)
    client = app.test_client()
    try:
        blocked = await client.post("/api/nfl/experimental/kalshi-edge/import", json={})
        allowed = await client.post(
            "/api/nfl/experimental/kalshi-edge/import?secret=test-admin-secret",
            json={"snapshots": [{"season": 2026, "week": 4, "away_team": "GB", "home_team": "TB", "contract_side": "away_win", "price": 0.71}]},
        )
        payload = await allowed.get_json()
    finally:
        if previous_secret is None:
            os.environ.pop("ADMIN_SECRET", None)
        else:
            os.environ["ADMIN_SECRET"] = previous_secret

    assert blocked.status_code == 403
    assert allowed.status_code == 200
    assert payload["imported"] == 1


@pytest.mark.anyio
async def test_kalshi_edge_refresh_route_generates_snapshots(monkeypatch):
    previous_secret = os.environ.get("ADMIN_SECRET")
    os.environ["ADMIN_SECRET"] = "test-admin-secret"
    client = app.test_client()
    games = [{"season": 2026, "week": 5}]
    snapshot = {
        "season": 2026,
        "week": 5,
        "games": [{
            "schedule": {"season": 2026, "week": 5, "game_id": "2026_05_BAL_ATL", "away_team": "BAL", "home_team": "ATL"},
            "models": {},
        }],
    }
    try:
        with patch.object(__import__("app"), "load_nfl_games_for_request", new=AsyncMock(return_value=(games, {}))), \
            patch.object(__import__("app"), "cached_upcoming_predictions", return_value=snapshot), \
            patch("nfl_routes.refresh_kalshi_snapshots_from_api", return_value={"success": True, "fetched_markets": 2, "generated_snapshots": 2, "imported": 2}):
            response = await client.post("/api/nfl/experimental/kalshi-edge/refresh?secret=test-admin-secret")
            payload = await response.get_json()
    finally:
        if previous_secret is None:
            os.environ.pop("ADMIN_SECRET", None)
        else:
            os.environ["ADMIN_SECRET"] = previous_secret

    assert response.status_code == 200
    assert payload["imported"] == 2


@pytest.mark.anyio
async def test_kalshi_edge_report_route_does_not_change_models(monkeypatch):
    previous_secret = os.environ.get("ADMIN_SECRET")
    os.environ["ADMIN_SECRET"] = "test-admin-secret"
    client = app.test_client()
    games = [{"season": 2026, "week": 4, "actual_margin": 1, "spread_line": 0, "total_line": 40}]
    snapshot = {
        "season": 2026,
        "week": 4,
        "games": [{
            "schedule": {"season": 2026, "week": 4, "game_id": "2026_04_GB_TB", "away_team": "GB", "home_team": "TB"},
            "models": {"current_season_matrix": {"pred_margin": -1.0}},
        }],
    }
    snapshots = [kalshi_edge.normalize_kalshi_snapshot({
        "season": 2026,
        "week": 4,
        "game_id": "2026_04_GB_TB",
        "away_team": "GB",
        "home_team": "TB",
        "contract_side": "away_win",
        "price": 0.71,
    })]
    try:
        with patch("nfl_routes.run_backtest", return_value=({}, [])), \
            patch("nfl_routes.kalshi_edge_report", wraps=lambda upcoming, history: kalshi_edge.kalshi_edge_report(upcoming, history, snapshots=snapshots)), \
            patch.object(__import__("app"), "load_nfl_games_for_request", new=AsyncMock(return_value=(games, {}))), \
            patch.object(__import__("app"), "cached_upcoming_predictions", return_value=snapshot), \
            patch.object(__import__("app"), "upcoming_predictions_for_roster_basis", return_value=snapshot):
            response = await client.get("/api/nfl/experimental/kalshi-edge?secret=test-admin-secret")
            payload = await response.get_json()
    finally:
        if previous_secret is None:
            os.environ.pop("ADMIN_SECRET", None)
        else:
            os.environ["ADMIN_SECRET"] = previous_secret

    assert response.status_code == 200
    assert payload["experimental"] is True
    assert payload["rows"][0]["model"] == "current_season_matrix"
