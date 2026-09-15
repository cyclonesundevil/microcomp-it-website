import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch


BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

import app as app_module
from app import app
from nfl_predictor import GamesRefreshAlreadyRunning


class NflRefreshRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = app.test_client()
        self.previous_token = os.environ.get("NFL_DATA_REFRESH_TOKEN")
        os.environ["NFL_DATA_REFRESH_TOKEN"] = "test-refresh-token"

    async def asyncTearDown(self):
        if self.previous_token is None:
            os.environ.pop("NFL_DATA_REFRESH_TOKEN", None)
        else:
            os.environ["NFL_DATA_REFRESH_TOKEN"] = self.previous_token

    async def test_refresh_requires_server_side_token(self):
        response = await self.client.post("/api/nfl/refresh")
        self.assertEqual(response.status_code, 403)

    async def test_refresh_returns_updated_provenance(self):
        games = [
            {"season": 2025, "week": 18},
            {"season": 2026, "week": 1},
            {"season": 2026, "week": 2},
        ]
        cache = {"last_updated_utc": "2026-09-15T13:00:00+00:00", "stale": False}
        with patch.object(app_module, "load_games", return_value=games), patch.object(app_module, "games_cache_info", return_value=cache):
            response = await self.client.post(
                "/api/nfl/refresh",
                headers={"X-NFL-Refresh-Token": "test-refresh-token"},
            )
        payload = await response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["success"])
        self.assertEqual(payload["graded_regular_season_games"], 3)
        self.assertEqual(payload["latest_season"], 2026)
        self.assertEqual(payload["latest_week"], 2)

    async def test_overlapping_refresh_returns_conflict(self):
        with patch.object(app_module, "load_games", side_effect=GamesRefreshAlreadyRunning("An NFL data refresh is already running.")):
            response = await self.client.post(
                "/api/nfl/refresh",
                headers={"X-NFL-Refresh-Token": "test-refresh-token"},
            )
        self.assertEqual(response.status_code, 409)

    async def test_upcoming_runs_every_model_for_each_scheduled_game(self):
        games = [{"season": 2026, "week": 1, "away_team": "KC", "home_team": "PHI"}]
        scheduled = [{
            "season": 2026, "week": 2, "away_team": "DAL", "home_team": "NYG",
            "spread_line": None, "total_line": None, "home_rest": 7.0, "away_rest": 7.0,
            "div_game": True, "roof": "outdoors", "temp": None, "wind": None,
            "game_id": "2026_02_DAL_NYG", "gameday": "2026-09-20", "gametime": "13:00",
        }]
        with patch.object(app_module, "load_nfl_games_for_request", new=AsyncMock(return_value=(games, {"stale": False}))), \
                patch.object(app_module, "load_upcoming_games", return_value=scheduled), \
                patch.object(app_module, "predict_matchup", side_effect=lambda *args: {"model": args[5]}):
            response = await self.client.get("/api/nfl/upcoming")
        payload = await response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(payload["games"]), 1)
        self.assertEqual(set(payload["games"][0]["models"]), set(app_module.MODEL_PROFILES))


if __name__ == "__main__":
    unittest.main()
