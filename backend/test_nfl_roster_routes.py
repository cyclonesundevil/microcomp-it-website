import sys
import unittest
from pathlib import Path
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

import app as app_module
import nfl_routes
from app import app


class NflRosterRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_matchup_prediction_includes_roster_context(self):
        client = app.test_client()
        games = [{"season": 2026, "week": 1, "away_team": "GB", "home_team": "TB"}]

        async def fake_load_games():
            return games, {"cache_hit": True}

        def fake_predict(*_args, **_kwargs):
            return {
                "model": "current_season_matrix",
                "away_team": "GB",
                "home_team": "TB",
                "pred_margin": 1.0,
                "pred_total": 41.0,
                "spread_edge": 0.5,
                "total_edge": -2.0,
                "winner_pick": "home",
                "spread_pick": None,
                "total_pick": "under",
                "latest_training_season": 2026,
            }

        roster_context = {
            "teams": ["GB", "TB"],
            "events": [{
                "event_type": "QB1_OUT",
                "team": "TB",
                "player": "Baker Mayfield",
                "position": "QB",
                "description": "TB QB Baker Mayfield is unavailable or did not practice.",
                "source_type": "official_injury_report",
                "confidence": "high",
            }],
            "summary": ["TB QB Baker Mayfield is unavailable or did not practice. Source: official_injury_report; confidence: high."],
        }

        with patch.object(app_module, "load_nfl_games_for_request", side_effect=fake_load_games), \
            patch.object(app_module, "predict_matchup", side_effect=fake_predict), \
            patch.object(nfl_routes, "find_upcoming_scheduled_match", return_value=None), \
            patch.object(nfl_routes, "roster_context_for_teams", return_value=roster_context):
            response = await client.get("/api/nfl/predict?away_team=GB&home_team=TB&model=current_season_matrix")

        payload = await response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["success"])
        self.assertEqual(payload["prediction"]["roster_context"]["events"][0]["event_type"], "QB1_OUT")
        self.assertIn("Baker Mayfield", payload["prediction"]["roster_context"]["summary"][0])

    async def test_upcoming_board_includes_roster_context(self):
        client = app.test_client()
        games = [{"season": 2026, "week": 1, "away_team": "GB", "home_team": "TB"}]
        upcoming_payload = {
            "ready": True,
            "status": "ready",
            "season": 2026,
            "week": 4,
            "games": [{
                "schedule": {
                    "game_id": "2026_04_GB_TB",
                    "away_team": "GB",
                    "home_team": "TB",
                    "spread_line": 2.5,
                    "total_line": 43.5,
                },
                "models": {},
            }],
        }
        roster_context = {
            "teams": ["GB", "TB"],
            "generated_at": "2026-10-02T12:00:00Z",
            "cache_age_seconds": 60,
            "cache_ttl_seconds": 1800,
            "events": [{
                "event_type": "QB1_OUT",
                "team": "TB",
                "player": "Baker Mayfield",
                "position": "QB",
                "description": "TB QB Baker Mayfield is unavailable or did not practice.",
                "source_type": "official_injury_report",
                "confidence": "high",
            }],
        }

        async def fake_load_games():
            return games, {"cache_hit": True}

        with patch.object(app_module, "load_nfl_games_for_request", side_effect=fake_load_games), \
            patch.object(app_module, "cached_upcoming_predictions", return_value=upcoming_payload), \
            patch.object(nfl_routes, "roster_context_for_teams", return_value=roster_context):
            response = await client.get("/api/nfl/upcoming?scope=upcoming")

        payload = await response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["success"])
        self.assertEqual(payload["roster_context"]["teams"], ["GB", "TB"])
        self.assertEqual(payload["roster_context"]["events"][0]["event_type"], "QB1_OUT")
