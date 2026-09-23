import json
import os
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch


BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

import app as app_module
import nfl_predictor
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
        with patch.object(app_module, "load_games", return_value=games), patch.object(app_module, "games_cache_info", return_value=cache), patch.object(app_module, "cached_upcoming_predictions", return_value={"generated_at": "2026-09-15T13:00:00+00:00"}), patch.object(app_module, "schedule_history_cache_warmup", return_value=True):
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
        self.assertTrue(payload["history_cache_warmup_scheduled"])

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
        snapshot = {
            "generated_at": "2026-09-15T13:00:00+00:00", "season": 2026, "week": 2,
            "models": list(app_module.MODEL_PROFILES), "games": [{"schedule": scheduled[0], "models": {model: {"model": model} for model in app_module.MODEL_PROFILES}}],
            "cache_hit": False, "cache_age_seconds": 0.0, "cache_ttl_seconds": 86400,
        }
        with patch.object(app_module, "load_nfl_games_for_request", new=AsyncMock(return_value=(games, {"stale": False}))), \
            patch.object(app_module, "cached_upcoming_predictions", return_value=snapshot) as cached:
            response = await self.client.get("/api/nfl/upcoming")
        payload = await response.get_json()

        self.assertEqual(response.status_code, 200)
        cached.assert_called_once_with(games, None, None, False, True)
        self.assertEqual(len(payload["games"]), 1)
        self.assertEqual(set(payload["games"][0]["models"]), set(app_module.MODEL_PROFILES))

    async def test_mobile_upcoming_uses_cache_without_background_rebuild_and_normalizes_shape(self):
        games = [{"season": 2026, "week": 1, "away_team": "KC", "home_team": "PHI"}]
        scheduled = {
            "season": 2026, "week": 3, "away_team": "SEA", "home_team": "ARI",
            "spread_line": -3.5, "total_line": 40.5, "home_rest": 7.0, "away_rest": 7.0,
            "div_game": True, "roof": "outdoors", "temp": None, "wind": None,
            "game_id": "2026_03_SEA_ARI", "gameday": "2026-09-20", "gametime": "16:25",
            "away_score": 31.0, "home_score": 7.0, "is_completed": True,
        }
        snapshot = {
            "generated_at": "2026-09-15T13:00:00+00:00",
            "season": 2026,
            "week": 3,
            "models": list(app_module.MODEL_PROFILES),
            "games": [{
                "schedule": scheduled,
                "models": {
                    model: {
                        "model": model,
                        "eligible": True,
                        "pred_margin": -4.0,
                        "pred_total": 42.0,
                        "spread_edge": -0.5,
                        "total_edge": 1.5,
                        "model_notes": [],
                    }
                    for model in app_module.MODEL_PROFILES
                },
                "model_signals": {"agreement_label": "Strong agreement"},
            }],
            "cache_hit": True,
            "ready": True,
            "status": "ready",
            "cache_age_seconds": 5.0,
            "cache_ttl_seconds": 86400,
        }
        with patch.object(app_module, "load_nfl_games_for_request", new=AsyncMock(return_value=(games, {"stale": False}))), \
            patch.object(app_module, "cached_upcoming_predictions", return_value=snapshot) as cached:
            response = await self.client.get("/api/v1/nfl/mobile/upcoming")
        payload = await response.get_json()

        self.assertEqual(response.status_code, 200)
        cached.assert_called_once_with(games, None, None, False, False)
        self.assertEqual(payload["client_contract"], "nfl-mobile-1")
        self.assertEqual(payload["season"], 2026)
        self.assertEqual(payload["week"], 3)
        self.assertEqual(payload["football_week_start"], "2026-09-15")
        self.assertEqual(payload["last_rebuild_at"], "2026-09-15T13:00:00+00:00")
        game = payload["games"][0]
        self.assertEqual(game["game_status"], "final")
        self.assertEqual(game["market"]["favorite"]["team"], "SEA")
        self.assertEqual(game["algorithms"]["baseline"]["market_favorite_relative_spread"], -4.0)
        self.assertIn("rsm_stage7c", game["algorithms"])
        self.assertIn("spread_sign_convention", payload)

    async def test_mobile_model_signals_returns_display_only_cached_signals(self):
        games = [{"season": 2026, "week": 1}]
        snapshot = {
            "generated_at": "2026-09-15T13:00:00+00:00",
            "season": 2026,
            "week": 3,
            "games": [{
                "schedule": {
                    "season": 2026, "week": 3, "away_team": "SEA", "home_team": "ARI",
                    "spread_line": -3.5, "total_line": 40.5,
                    "game_id": "2026_03_SEA_ARI", "gameday": "2026-09-20", "gametime": "16:25",
                },
                "models": {},
                "model_signals": {
                    "agreement_label": "Mixed signals",
                    "market_alignment_label": "Models split from market",
                    "story": "Display-only story.",
                },
            }],
            "cache_hit": True,
            "ready": True,
            "status": "ready",
        }
        with patch.object(app_module, "load_nfl_games_for_request", new=AsyncMock(return_value=(games, {"stale": False}))), \
            patch.object(app_module, "cached_upcoming_predictions", return_value=snapshot) as cached:
            response = await self.client.get("/api/v1/nfl/mobile/model-signals")
        payload = await response.get_json()

        self.assertEqual(response.status_code, 200)
        cached.assert_called_once_with(games, None, None, False, False)
        self.assertEqual(payload["disclaimer"], "Model Signals are matchup comparison tools, not betting recommendations.")
        self.assertEqual(payload["games"][0]["model_signals"]["agreement_label"], "Mixed signals")
        self.assertNotIn("algorithms", payload["games"][0])

    async def test_mobile_weekly_and_algorithm_performance_shapes_are_stable(self):
        games = [{"season": 2026, "week": 1}, {"season": 2026, "week": 2}]
        performance = {
            "season": 2026,
            "week": 2,
            "completed_games": 16,
            "generated_at": "2026-09-22T05:00:00+00:00",
            "models": [{
                "model": "baseline",
                "completed_games": 16,
                "spread_wins": 9,
                "spread_losses": 7,
                "spread_pushes": 0,
                "spread_bets": 16,
                "spread_win_rate": 0.5625,
                "total_wins": 8,
                "total_losses": 8,
                "total_pushes": 0,
                "total_bets": 16,
                "total_win_rate": 0.5,
                "margin_mae": 8.5,
                "total_mae": 9.5,
            }],
        }
        trend = {
            "season": 2026,
            "model": "baseline",
            "generated_at": "2026-09-22T05:05:00+00:00",
            "weeks": [{
                "week": 1,
                "completed_games": 16,
                "spread_wins": 8,
                "spread_losses": 8,
                "spread_pushes": 0,
                "spread_bets": 16,
                "spread_win_rate": 0.5,
                "total_wins": 7,
                "total_losses": 9,
                "total_pushes": 0,
                "total_bets": 16,
                "total_win_rate": 0.4375,
                "margin_mae": 10.0,
                "total_mae": 11.0,
            }],
        }
        with patch.object(app_module, "load_nfl_games_for_request", new=AsyncMock(return_value=(games, {"stale": False}))), \
            patch.object(app_module, "cached_weekly_model_performance", return_value=(performance, True)), \
            patch.object(app_module, "cached_weekly_model_performance_trend", return_value=(trend, True)):
            weekly_response = await self.client.get("/api/v1/nfl/mobile/weekly-performance?season=2026&week=2")
            trend_response = await self.client.get("/api/v1/nfl/mobile/algorithm-performance/baseline?season=2026")
        weekly_payload = await weekly_response.get_json()
        trend_payload = await trend_response.get_json()

        self.assertEqual(weekly_response.status_code, 200)
        self.assertEqual(weekly_payload["performance"]["models"][0]["spread_mae"], 8.5)
        self.assertEqual(weekly_payload["performance"]["models"][0]["total_score_mae"], 9.5)
        self.assertNotIn("margin_mae", weekly_payload["performance"]["models"][0])
        self.assertEqual(trend_response.status_code, 200)
        self.assertEqual(trend_payload["trend"]["weeks"][0]["spread_mae"], 10.0)
        self.assertEqual(trend_payload["trend"]["weeks"][0]["total_score_mae"], 11.0)

    async def test_upcoming_rejects_non_upcoming_scope(self):
        response = await self.client.get("/api/nfl/upcoming?scope=all")

        self.assertEqual(response.status_code, 400)
        payload = await response.get_json()
        self.assertIn("upcoming-week scope", payload["error"])

        def test_upcoming_cache_without_current_source_signature_is_rebuilt(self):
            cache_file = BACKEND_DIR / "data" / "nfl_upcoming_predictions_old_source.json"
            snapshot = {
                "season": 2026, "week": 2, "games_source_signature": "old-source",
                "games": [{
                    "schedule": {"away_team": "DAL", "home_team": "NYG", "season": 2026, "week": 2},
                    "models": {model: {} for model in app_module.MODEL_PROFILES},
                }],
            }
            cache_file.write_text(json.dumps(snapshot), encoding="utf-8")
            nfl_predictor._UPCOMING_REFRESH_RUNNING = False
            with patch.object(nfl_predictor, "upcoming_prediction_cache_path", return_value=str(cache_file)), \
                patch.object(nfl_predictor.threading, "Thread") as mock_thread:
                result = nfl_predictor.cached_upcoming_predictions([], season=2026, week=2)

            self.assertEqual(result["status"], "computing")
            self.assertFalse(result["ready"])
            self.assertTrue(result["refresh_scheduled"])
            self.assertEqual(mock_thread.call_count, 1)
            nfl_predictor._UPCOMING_REFRESH_RUNNING = False
            cache_file.unlink(missing_ok=True)
    def test_stale_upcoming_cache_is_served_without_blocking_and_schedules_background_refresh(self):
        stale_snapshot = {
            "generated_at": "2026-09-15T13:00:00+00:00",
            "prediction_schema_version": nfl_predictor.UPCOMING_PREDICTION_SCHEMA_VERSION,
            "games_source_signature": nfl_predictor._games_source_signature(),
            "availability_adjustments_signature": nfl_predictor._availability_adjustments_signature(),
            "season": 2026,
            "week": 2,
            "models": list(app_module.MODEL_PROFILES), "games": [{
                "schedule": {"away_team": "DAL", "home_team": "NYG", "season": 2026, "week": 2},
                "models": {model: {} for model in app_module.MODEL_PROFILES},
            }],
        }
        cache_file = BACKEND_DIR / "data" / "nfl_upcoming_predictions_stale.json"
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(stale_snapshot), encoding="utf-8")
        stale_time = time.time() - 10
        os.utime(cache_file, (stale_time, stale_time))

        nfl_predictor._UPCOMING_REFRESH_RUNNING = False
        with patch.object(nfl_predictor, "upcoming_prediction_cache_path", return_value=str(cache_file)), \
            patch.object(nfl_predictor, "upcoming_prediction_cache_ttl_seconds", return_value=1), \
            patch.object(nfl_predictor, "_build_upcoming_prediction_cache", side_effect=AssertionError("should not rebuild a stale cache in the request path")), \
            patch.object(nfl_predictor.threading, "Thread") as mock_thread:
            result = nfl_predictor.cached_upcoming_predictions([], season=2026, week=2)

        self.assertTrue(result["cache_hit"])
        self.assertTrue(result["refresh_scheduled"])
        self.assertEqual(mock_thread.call_count, 1)
        nfl_predictor._UPCOMING_REFRESH_RUNNING = False
        cache_file.unlink(missing_ok=True)

    def test_malformed_upcoming_cache_is_not_served(self):
        cache_file = BACKEND_DIR / "data" / "nfl_upcoming_predictions_malformed.json"
        cache_file.write_text(json.dumps({"season": 2026, "week": 2, "games": [{"schedule": {}, "models": {}}]}), encoding="utf-8")

        nfl_predictor._UPCOMING_REFRESH_RUNNING = False
        with patch.object(nfl_predictor, "upcoming_prediction_cache_path", return_value=str(cache_file)), \
            patch.object(nfl_predictor, "upcoming_prediction_cache_ttl_seconds", return_value=86400), \
            patch.object(nfl_predictor.threading, "Thread") as mock_thread:
            result = nfl_predictor.cached_upcoming_predictions([], season=2026, week=2)

        self.assertEqual(result["status"], "computing")
        self.assertFalse(result["ready"])
        self.assertTrue(result["refresh_scheduled"])
        self.assertEqual(mock_thread.call_count, 1)
        nfl_predictor._UPCOMING_REFRESH_RUNNING = False
        cache_file.unlink(missing_ok=True)

    def test_empty_upcoming_cache_is_rebuilt_in_background(self):
        cache_file = BACKEND_DIR / "data" / "nfl_upcoming_predictions_empty.json"
        cache_file.write_text(json.dumps({"season": 2026, "week": 2, "games": []}), encoding="utf-8")

        nfl_predictor._UPCOMING_REFRESH_RUNNING = False
        with patch.object(nfl_predictor, "upcoming_prediction_cache_path", return_value=str(cache_file)), \
            patch.object(nfl_predictor, "upcoming_prediction_cache_ttl_seconds", return_value=86400), \
            patch.object(nfl_predictor, "_build_upcoming_prediction_cache", side_effect=AssertionError("should rebuild in the background")), \
            patch.object(nfl_predictor.threading, "Thread") as mock_thread:
            result = nfl_predictor.cached_upcoming_predictions([], season=2026, week=2)

        self.assertEqual(result["status"], "computing")
        self.assertFalse(result["ready"])
        self.assertTrue(result["refresh_scheduled"])
        self.assertEqual(mock_thread.call_count, 1)
        nfl_predictor._UPCOMING_REFRESH_RUNNING = False

    def test_historical_model_cache_reuses_trained_model(self):
        games = [{
            "season": 2025, "week": 1, "game_id": "2025_01_A_B",
            "away_score": 10.0, "home_score": 20.0,
        }]
        cache_path = BACKEND_DIR / "data" / "test_model_cache.pkl"
        cache_path.unlink(missing_ok=True)
        with patch.object(nfl_predictor, "train_model", return_value="trained") as train, \
            patch.object(nfl_predictor, "_historical_model_cache_path", return_value=str(cache_path)):
            self.assertEqual(nfl_predictor._load_or_train_historical_model(games, "baseline"), "trained")
            train.assert_called_once()

        with patch.object(nfl_predictor, "train_model", side_effect=AssertionError("cached model should be reused")), \
            patch.object(nfl_predictor, "_historical_model_cache_path", return_value=str(cache_path)):
            self.assertEqual(nfl_predictor._load_or_train_historical_model(games, "baseline"), "trained")

        cache_path.unlink(missing_ok=True)

    def test_historical_matchup_cache_reuses_computed_rows(self):
        games = [{
            "season": 2025, "week": 1, "game_id": "2025_01_A_B",
            "away_team": "A", "home_team": "B", "away_score": 10.0,
            "home_score": 20.0, "actual_margin": 10.0, "actual_total": 30.0,
            "spread_line": -3.0, "total_line": 44.5,
        }]
        rows = [{
            "season": 2025, "week": 1, "away_team": "A", "home_team": "B",
            "home_spread": -3.0,
        }]
        cache_path = BACKEND_DIR / "data" / "test_history_cache.json"
        pair_cache_path = BACKEND_DIR / "data" / "test_history_pair_a_b.json"
        cache_path.unlink(missing_ok=True)
        pair_cache_path.unlink(missing_ok=True)

        def pair_cache_path_for_test(_metadata, _pair_key):
            return str(pair_cache_path)

        with patch.object(nfl_predictor, "_all_matchup_history_cache_path", return_value=str(cache_path)), \
            patch.object(nfl_predictor, "_history_cache_metadata", return_value={"test": "metadata", "model_profile": "baseline"}), \
            patch.object(nfl_predictor, "_historical_matchup_cache_path", return_value=str(pair_cache_path)), \
            patch.object(nfl_predictor, "_historical_matchup_cache_path_from_metadata", side_effect=pair_cache_path_for_test), \
            patch.object(nfl_predictor, "_build_all_matchup_history", return_value={"A__B": rows}) as history:
            first_rows, first_hit = nfl_predictor.cached_matchup_history(games, "A", "B")
            second_rows, second_hit = nfl_predictor.cached_matchup_history(games, "A", "B")

        self.assertEqual(first_rows[0]["selected_home_spread"], -3.0)
        self.assertFalse(first_hit)
        self.assertEqual(second_rows[0]["selected_home_spread"], -3.0)
        self.assertTrue(second_hit)
        history.assert_called_once()
        cache_path.unlink(missing_ok=True)
        pair_cache_path.unlink(missing_ok=True)

    def test_upcoming_build_resumes_after_checkpointed_step(self):
        games = [{"season": 2026, "week": 1}]
        upcoming = [
            {"game_id": "game-1", "season": 2026, "week": 2, "away_team": "A", "home_team": "B", "spread_line": None, "total_line": None, "home_rest": 7.0, "away_rest": 7.0, "div_game": False, "roof": "", "temp": None, "wind": None},
            {"game_id": "game-2", "season": 2026, "week": 2, "away_team": "C", "home_team": "D", "spread_line": None, "total_line": None, "home_rest": 7.0, "away_rest": 7.0, "div_game": False, "roof": "", "temp": None, "wind": None},
        ]
        checkpoint_rows = [{"schedule": upcoming[0], "models": {model: {"model": model} for model in app_module.MODEL_PROFILES[:5]}}]
        checkpoint = {
            "fingerprint": "resume-fingerprint",
            "trained_models": {model: model for model in app_module.MODEL_PROFILES},
            "rows": checkpoint_rows,
            "next_step": 5,
        }
        with patch.object(nfl_predictor, "load_upcoming_games", return_value=upcoming), \
            patch.object(nfl_predictor, "_upcoming_build_fingerprint", return_value="resume-fingerprint"), \
            patch.object(nfl_predictor, "_load_upcoming_checkpoint", return_value=checkpoint), \
            patch.object(nfl_predictor, "_write_upcoming_checkpoint"), \
            patch.object(nfl_predictor, "predict_matchup", return_value={"pred_margin": 1.0, "pred_total": 44.0}) as predict:
            result = nfl_predictor._build_upcoming_prediction_cache(games, 2026, 2)

        self.assertEqual(len(result["games"]), 2)
        self.assertEqual(predict.call_count, (len(app_module.MODEL_PROFILES) - 5) + len(app_module.MODEL_PROFILES))

    def test_backtest_cache_reuses_computed_result(self):
        games = [{
            "season": 2025, "week": 1, "game_id": "2025_01_A_B",
            "away_team": "A", "home_team": "B", "away_score": 10.0,
            "home_score": 20.0, "spread_line": -3.0, "total_line": 44.5,
        }]
        summary = {"games": 1, "spread_bets": 0, "total_bets": 0}
        season_summary = {"games": 1, "spread_bets": 0, "total_bets": 0}
        cache_path = BACKEND_DIR / "data" / "test_backtest_cache.json"
        cache_path.unlink(missing_ok=True)
        with patch.object(nfl_predictor, "_backtest_cache_path", return_value=str(cache_path)), \
            patch.object(nfl_predictor, "run_backtest", return_value=(summary, [{"season": 2025}])) as backtest, \
            patch.object(nfl_predictor, "summarize_by_season", return_value=[(2025, season_summary)]):
            first_summary, first_seasons, first_hit = nfl_predictor.cached_backtest(games, 5, 6.0, 1.5, "baseline")
            second_summary, second_seasons, second_hit = nfl_predictor.cached_backtest(games, 5, 6.0, 1.5, "baseline")

        self.assertEqual(first_summary, summary)
        self.assertEqual(first_seasons, [(2025, season_summary)])
        self.assertFalse(first_hit)
        self.assertEqual(second_summary, summary)
        self.assertEqual(second_seasons, [(2025, season_summary)])
        self.assertTrue(second_hit)
        backtest.assert_called_once()
        cache_path.unlink(missing_ok=True)

    def test_market_blend_supports_total_backtest_picks(self):
        self.assertTrue(nfl_predictor.model_supports_totals("market_blend"))
        self.assertFalse(nfl_predictor.model_supports_totals("rothstein_plus"))
        self.assertFalse(nfl_predictor.model_supports_totals("rsm_stage7c"))

    def test_start_daily_upcoming_cache_refresh_loop_starts_background_thread(self):
        with patch.object(app_module.threading, "Thread") as mock_thread:
            app_module.start_daily_upcoming_cache_refresh_loop()

        self.assertTrue(mock_thread.called)
        self.assertTrue(mock_thread.call_args.kwargs["daemon"])

    def test_daily_upcoming_refresh_forces_fresh_games_and_cache_rebuild(self):
        games = [{"season": 2026, "week": 2, "away_score": 21, "home_score": 17}]
        rebuilt = {
            "ready": True,
            "season": 2026,
            "week": 2,
            "games": [{
                "schedule": {
                    "away_team": "CAR",
                    "home_team": "ATL",
                    "away_score": 21,
                    "home_score": 17,
                    "is_completed": True,
                }
            }],
        }

        with patch.object(app_module, "load_games", return_value=games) as load_games, \
            patch.object(app_module, "cached_upcoming_predictions", return_value=rebuilt) as upcoming:
            result = app_module.refresh_upcoming_prediction_cache_now()

        load_games.assert_called_once_with(refresh=True)
        upcoming.assert_called_once_with(games, None, None, True, False)
        self.assertEqual(result["games"][0]["schedule"]["away_score"], 21)
        self.assertTrue(result["games"][0]["schedule"]["is_completed"])

    def test_final_score_refresh_forces_fresh_games_without_cache_rebuild(self):
        refreshed = {
            "success": True,
            "updated_games": 1,
            "season": 2026,
            "week": 2,
            "requires_full_rebuild": False,
        }

        with patch.object(app_module, "load_games", return_value=[{"season": 2026, "week": 2}]) as load_games, \
            patch.object(app_module, "refresh_upcoming_final_scores_in_cache", return_value=refreshed) as score_refresh, \
            patch.object(app_module, "cached_upcoming_predictions", side_effect=AssertionError("score-only refresh should not rebuild predictions")):
            result = app_module.refresh_upcoming_final_scores_now()

        load_games.assert_called_once_with(refresh=True)
        score_refresh.assert_called_once_with()
        self.assertEqual(result["updated_games"], 1)
        self.assertFalse(result["requires_full_rebuild"])

    async def test_final_score_refresh_endpoint_is_protected_and_lightweight(self):
        refreshed = {
            "success": True,
            "updated_games": 1,
            "season": 2026,
            "week": 2,
            "requires_full_rebuild": False,
        }

        with patch.object(app_module, "refresh_upcoming_final_scores_now", return_value=refreshed) as score_refresh, \
            patch.object(app_module, "games_cache_info", return_value={"path": "cache"}), \
            patch.object(app_module, "cached_upcoming_predictions", side_effect=AssertionError("endpoint should not rebuild predictions")):
            response = await self.client.post(
                "/api/v1/nfl/refresh/final-scores",
                headers={"X-NFL-Refresh-Token": "test-refresh-token"},
            )

        self.assertEqual(response.status_code, 200)
        payload = await response.get_json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["final_score_refresh"]["updated_games"], 1)
        score_refresh.assert_called_once_with()

    def test_missing_upcoming_cache_returns_computing_status_without_blocking(self):
        cache_file = BACKEND_DIR / "data" / "nfl_upcoming_predictions_missing.json"
        missing_path = str(cache_file)

        with patch.object(nfl_predictor, "upcoming_prediction_cache_path", return_value=missing_path), \
            patch.object(nfl_predictor, "upcoming_prediction_cache_ttl_seconds", return_value=86400), \
            patch.object(nfl_predictor, "_build_upcoming_prediction_cache", side_effect=AssertionError("sync build should not run when the cache is missing")), \
            patch.object(nfl_predictor.threading, "Thread") as mock_thread:
            result = nfl_predictor.cached_upcoming_predictions([], season=2026, week=2)

        self.assertEqual(result["status"], "computing")
        self.assertFalse(result["ready"])
        self.assertEqual(result["progress"], 10)
        self.assertEqual(mock_thread.call_count, 1)


if __name__ == "__main__":
    unittest.main()
