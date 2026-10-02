import asyncio
import datetime
import os
import traceback
from pathlib import Path

from quart import jsonify, request, send_from_directory

from api_responses import api_error

from nfl_live_data import live_scoreboard
from nfl_mobile_contract import (
    mobile_model_signals_payload,
    mobile_performance_trend,
    mobile_upcoming_payload,
    mobile_weekly_performance,
)
from nfl_roster_monitor import roster_context_for_teams
from nfl_predictor import (
    GAMES_URL,
    MODEL_PROFILES,
    RSM_PROFILE,
    GamesRefreshAlreadyRunning,
    RsmStage7CComparisonModel,
    _rsm_artifact,
    apply_rsm_roster_context_overlay,
    apply_upcoming_availability_adjustments,
    cached_backtest,
    cached_matchup_history,
    cached_upcoming_predictions,
    cached_weekly_model_performance,
    cached_weekly_model_performance_trend,
    dashboard_snapshot,
    default_spread_threshold,
    default_total_threshold,
    experimental_market_probabilities,
    find_upcoming_scheduled_match,
    games_cache_info,
    list_teams,
    load_games,
    load_upcoming_availability_adjustments,
    load_upcoming_games,
    model_status_labels,
    postgame_game_results,
    postgame_grading_summary,
    predict_matchup,
    upcoming_prediction_status_snapshot,
    upcoming_predictions_for_roster_basis,
)
from qb_availability_audit import (
    DEFAULT_MNF_JSON_REPORT,
    DEFAULT_MNF_MD_REPORT,
    apply_ready_availability_adjustments,
    build_monday_night_roster_audit,
    merge_existing_review_fields,
    read_json_report,
    write_json_report,
    write_markdown_report,
)
from rsm.stage8_evaluation import (
    TOTAL_MODEL_VERSION,
    capture_total_observation,
    evaluation_report,
    record_outcome,
    total_evaluation_report,
)
from rsm.stage8_shadow import capture_observation, line_movements


def register_nfl_routes(app, context):
    app_module = context["app_module"]
    admin_secret_authorized = context["admin_secret_authorized"]
    base_dir = context["base_dir"]
    experimental_models_payload = context["experimental_models_payload"]
    nfl_data_refresh_authorized = context["nfl_data_refresh_authorized"]
    request_bool = context["request_bool"]
    rsm_manual_write_authorized = context["rsm_manual_write_authorized"]
    rsm_shadow_paths = context["rsm_shadow_paths"]
    rsm_total_observation_store = context["rsm_total_observation_store"]
    EXPERIMENTAL_LIVE_MODELS = context["experimental_live_models"]

    def load_games(*args, **kwargs):
        return app_module.load_games(*args, **kwargs)

    def games_cache_info(*args, **kwargs):
        return app_module.games_cache_info(*args, **kwargs)

    def cached_upcoming_predictions(*args, **kwargs):
        return app_module.cached_upcoming_predictions(*args, **kwargs)

    def cached_weekly_model_performance(*args, **kwargs):
        return app_module.cached_weekly_model_performance(*args, **kwargs)

    def cached_weekly_model_performance_trend(*args, **kwargs):
        return app_module.cached_weekly_model_performance_trend(*args, **kwargs)

    def predict_matchup(*args, **kwargs):
        return app_module.predict_matchup(*args, **kwargs)

    def schedule_history_cache_warmup(*args, **kwargs):
        return app_module.schedule_history_cache_warmup(*args, **kwargs)

    def refresh_upcoming_final_scores_now(*args, **kwargs):
        return app_module.refresh_upcoming_final_scores_now(*args, **kwargs)

    def upcoming_prediction_status_snapshot(*args, **kwargs):
        return app_module.upcoming_prediction_status_snapshot(*args, **kwargs)

    async def load_nfl_games_for_request():
        return await app_module.load_nfl_games_for_request()

    async def _read_mobile_upcoming_snapshot():
        return await app_module._read_mobile_upcoming_snapshot()

    def _json_summary(summary):
        return {
            "games": summary["games"],
            "spread_bets": summary["spread_bets"],
            "spread_wins": summary["spread_wins"],
            "spread_losses": summary["spread_losses"],
            "spread_pushes": summary["spread_pushes"],
            "spread_win_rate": summary["spread_win_rate"],
            "spread_win_rate_ci95": summary["spread_win_rate_ci95"],
            "spread_net_units_at_minus_110": summary["spread_net_units_at_minus_110"],
            "spread_roi_at_minus_110": summary["spread_roi_at_minus_110"],
            "total_bets": summary["total_bets"],
            "total_wins": summary["total_wins"],
            "total_losses": summary["total_losses"],
            "total_pushes": summary["total_pushes"],
            "total_win_rate": summary["total_win_rate"],
            "total_win_rate_ci95": summary["total_win_rate_ci95"],
            "total_net_units_at_minus_110": summary["total_net_units_at_minus_110"],
            "total_roi_at_minus_110": summary["total_roi_at_minus_110"],
            "margin_mae": summary["margin_mae"],
            "total_mae": summary["total_mae"],
        }


    @app.route("/api/nfl/backtest")
    @app.route("/api/v1/nfl/backtest")
    async def nfl_backtest():
        try:
            seasons = int(request.args.get("seasons", "10"))
            if seasons not in {5, 10}:
                return api_error("seasons must be 5 or 10", 400)

            model = request.args.get("model", "baseline")
            if model not in MODEL_PROFILES:
                return jsonify({"success": False, "error": f"model must be one of: {', '.join(MODEL_PROFILES)}"}), 400

            spread_threshold = float(request.args.get("spread_threshold", str(default_spread_threshold(model))))
            total_threshold = float(request.args.get("total_threshold", str(default_total_threshold(model))))

            games, cache = await load_nfl_games_for_request()
            summary, season_summaries, cache_hit = await asyncio.to_thread(
                cached_backtest,
                games,
                seasons,
                spread_threshold,
                total_threshold,
                model,
            )

            season_rows = []
            for season, season_summary in season_summaries:
                season_rows.append({
                    "season": season,
                    **_json_summary(season_summary),
                })

            return jsonify({
                "success": True,
                "source": GAMES_URL,
                "cache": cache,
                "model": model,
                "seasons": seasons,
                "available_seasons": {
                    "start": min(g["season"] for g in games),
                    "end": max(g["season"] for g in games),
                },
                "thresholds": {
                    "spread": spread_threshold,
                    "total": total_threshold,
                },
                "summary": _json_summary(summary),
                "by_season": season_rows,
                "backtest_cache_hit": cache_hit,
            })
        except Exception as e:
            traceback.print_exc()
            return api_error(str(e), 500)


    @app.route("/api/nfl/refresh", methods=["POST"])
    @app.route("/api/v1/nfl/refresh", methods=["POST"])
    async def nfl_refresh():
        """Refresh nflverse data inside the production web service's own filesystem."""
        if not nfl_data_refresh_authorized():
            return api_error("NFL data refresh is disabled or the token is invalid.", 403)
        try:
            games = await asyncio.to_thread(load_games, refresh=True)
            upcoming_cache = await asyncio.to_thread(cached_upcoming_predictions, games, None, None, True)
            history_warmup_scheduled = schedule_history_cache_warmup(games)
            cache = games_cache_info()
            latest_season = max(game["season"] for game in games)
            latest_week = max(game["week"] for game in games if game["season"] == latest_season)
            app.logger.info(
                "NFL data refresh completed from nflverse: %s graded regular-season games through %s week %s",
                len(games),
                latest_season,
                latest_week,
            )
            return jsonify({
                "success": True,
                "source": GAMES_URL,
                "cache": cache,
                "graded_regular_season_games": len(games),
                "latest_season": latest_season,
                "latest_week": latest_week,
                "upcoming_cache_generated_at": upcoming_cache["generated_at"],
                "history_cache_warmup_scheduled": history_warmup_scheduled,
            })
        except GamesRefreshAlreadyRunning as error:
            app.logger.warning("NFL data refresh skipped because another refresh is running")
            return api_error(str(error), 409)
        except Exception as error:
            app.logger.exception("NFL data refresh failed")
            return api_error(str(error), 502)


    @app.route("/api/nfl/refresh/final-scores", methods=["POST"])
    @app.route("/api/v1/nfl/refresh/final-scores", methods=["POST"])
    async def nfl_refresh_final_scores():
        """Refresh nflverse data and update active-week final scores without rebuilding models."""
        if not nfl_data_refresh_authorized():
            return api_error("NFL data refresh is disabled or the token is invalid.", 403)
        try:
            result = await asyncio.to_thread(refresh_upcoming_final_scores_now)
            cache = games_cache_info()
            return jsonify({
                "success": True,
                "source": GAMES_URL,
                "cache": cache,
                "final_score_refresh": result,
            })
        except GamesRefreshAlreadyRunning as error:
            app.logger.warning("NFL final-score refresh skipped because another refresh is running")
            return api_error(str(error), 409)
        except Exception as error:
            app.logger.exception("NFL final-score refresh failed")
            return api_error(str(error), 502)


    @app.route("/api/nfl/monday-night-roster-audit", methods=["POST"])
    @app.route("/api/v1/nfl/monday-night-roster-audit", methods=["POST"])
    async def nfl_monday_night_roster_audit():
        """Generate the protected Monday-night roster review artifact for both teams."""
        if not nfl_data_refresh_authorized():
            return api_error("NFL Monday-night roster audit requires the admin refresh token.", 403)
        try:
            requested_week = request.args.get("week")
            requested_season = request.args.get("season")
            season = int(requested_season) if requested_season else None
            week = int(requested_week) if requested_week else None
            generated_report = await asyncio.to_thread(build_monday_night_roster_audit, season, week)
            existing_report = await asyncio.to_thread(read_json_report, DEFAULT_MNF_JSON_REPORT)
            report = await asyncio.to_thread(merge_existing_review_fields, generated_report, existing_report)
            supplied = await request.get_json(silent=True)
            if isinstance(supplied, dict):
                report = supplied.get("audit") if isinstance(supplied.get("audit"), dict) else supplied
            await asyncio.to_thread(write_json_report, report, DEFAULT_MNF_JSON_REPORT)
            await asyncio.to_thread(write_markdown_report, report, DEFAULT_MNF_MD_REPORT)
            apply_result = await asyncio.to_thread(apply_ready_availability_adjustments, report)
            refreshed = None
            if apply_result["ready_adjustments"] > 0:
                games = await asyncio.to_thread(load_games, refresh=True)
                refreshed = await asyncio.to_thread(cached_upcoming_predictions, games, season, week, True, False)
            return jsonify({
                "success": True,
                "source": GAMES_URL,
                "json_report": DEFAULT_MNF_JSON_REPORT,
                "markdown_report": DEFAULT_MNF_MD_REPORT,
                "availability_adjustments": apply_result,
                "upcoming_cache_refreshed": refreshed is not None,
                "upcoming_cache_generated_at": refreshed.get("generated_at") if refreshed else None,
                "audit": report,
            })
        except ValueError as error:
            return api_error(str(error), 400)
        except Exception as error:
            app.logger.exception("NFL Monday-night roster audit failed")
            return api_error(str(error), 502)


    @app.route("/api/nfl/teams")
    @app.route("/api/v1/nfl/teams")
    async def nfl_teams():
        try:
            games, cache = await load_nfl_games_for_request()
            return jsonify({
                "success": True,
                "source": GAMES_URL,
                "cache": cache,
                "teams": list_teams(games, current_only=True),
                "available_seasons": {
                    "start": min(g["season"] for g in games),
                    "end": max(g["season"] for g in games),
                },
            })
        except Exception as e:
            traceback.print_exc()
            return api_error(str(e), 500)


    @app.route("/api/v1/nfl/models")
    async def nfl_v1_models():
        statuses = model_status_labels()
        return jsonify({
            "success": True,
            "api_version": "v1",
            "models": [
                {
                    "id": model,
                    "spread_threshold": default_spread_threshold(model),
                    "total_threshold": default_total_threshold(model),
                    "status_label": statuses.get(model, "Production"),
                    "experimental": statuses.get(model) == "Experimental",
                }
                for model in MODEL_PROFILES
            ],
            "default_model": "market_blend",
        })


    @app.route("/nfl-predictor/experimental")
    async def nfl_experimental_models_page():
        if not admin_secret_authorized():
            return "Unauthorized. Add ?secret=YOUR_SECRET to the URL.", 401
        response = await send_from_directory(app.static_folder, "nfl-experimental-models.html")
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response


    @app.route("/nfl-postgame-grading")
    async def nfl_postgame_grading_page():
        return await send_from_directory(app.static_folder, "nfl-postgame-grading.html")


    @app.route("/api/nfl/experimental-models")
    @app.route("/api/v1/nfl/experimental-models")
    async def nfl_experimental_models():
        if not admin_secret_authorized():
            return api_error("Admin token is required.", 403)
        try:
            requested_week = request.args.get("week")
            requested_season = request.args.get("season")
            week = int(requested_week) if requested_week else None
            season = int(requested_season) if requested_season else None
            games, _cache = await load_nfl_games_for_request()
            snapshot = await asyncio.to_thread(cached_upcoming_predictions, games, season, week, False, False)
            probabilities = await asyncio.to_thread(
                experimental_market_probabilities,
                snapshot,
                games,
                EXPERIMENTAL_LIVE_MODELS,
            )
            return jsonify(experimental_models_payload(probabilities))
        except ValueError:
            return api_error("season and week must be numeric when supplied.", 400)
        except Exception as e:
            traceback.print_exc()
            return api_error(str(e), 500)


    @app.route("/api/nfl/experimental-models/predict")
    @app.route("/api/v1/nfl/experimental-models/predict")
    async def nfl_experimental_models_predict():
        if not admin_secret_authorized():
            return api_error("Admin token is required.", 403)
        try:
            away_team = (request.args.get("away_team") or "").strip().upper()
            home_team = (request.args.get("home_team") or "").strip().upper()
            if not away_team or not home_team or away_team == home_team:
                return api_error("Provide distinct away_team and home_team values.", 400)

            spread_line = request.args.get("spread_line")
            total_line = request.args.get("total_line")
            games, cache = await load_nfl_games_for_request()
            predictions = []
            errors = []
            for model in EXPERIMENTAL_LIVE_MODELS:
                try:
                    prediction = await asyncio.to_thread(
                        predict_matchup,
                        games,
                        away_team,
                        home_team,
                        float(spread_line) if spread_line not in (None, "") else 0.0,
                        float(total_line) if total_line not in (None, "") else None,
                        model,
                    )
                    predictions.append(prediction)
                except Exception as model_error:
                    errors.append({"model": model, "error": str(model_error)})

            return jsonify({
                "success": True,
                "cache": cache,
                "away_team": away_team,
                "home_team": home_team,
                "spread_line": float(spread_line) if spread_line not in (None, "") else 0.0,
                "total_line": float(total_line) if total_line not in (None, "") else None,
                "models": predictions,
                "model_errors": errors,
            })
        except ValueError:
            return api_error("spread_line and total_line must be numeric when supplied.", 400)
        except Exception as e:
            traceback.print_exc()
            return api_error(str(e), 500)


    @app.route("/api/nfl/dashboard")
    @app.route("/api/v1/nfl/dashboard")
    async def nfl_dashboard():
        try:
            model = request.args.get("model", "baseline")
            if model not in MODEL_PROFILES:
                return jsonify({"success": False, "error": f"model must be one of: {', '.join(MODEL_PROFILES)}"}), 400
            playoff_mode = str(request.args.get("playoff_mode", "false")).lower() in {"1", "true", "yes"}
            injury_team = (request.args.get("injury_team") or "").strip().upper()
            injury_impact = float(request.args.get("injury_impact", "0") or 0)
            injury_position = (request.args.get("injury_position") or "general").strip().lower()

            games, cache = await load_nfl_games_for_request()
            snapshot = await asyncio.to_thread(dashboard_snapshot, games, model, playoff_mode, injury_team, injury_impact, injury_position)
            dashboard_teams = [row.get("team") for row in (snapshot.get("top_teams") or [])[:8]]
            if injury_team:
                dashboard_teams.append(injury_team)
            roster_context = await asyncio.to_thread(roster_context_for_teams, dashboard_teams)
            return jsonify({"success": True, "source": GAMES_URL, "cache": cache, "dashboard": snapshot, "roster_context": roster_context})
        except Exception as e:
            traceback.print_exc()
            return api_error(str(e), 500)


    @app.route("/api/nfl/predict")
    @app.route("/api/v1/nfl/predict")
    async def nfl_predict():
        try:
            away_team = (request.args.get("away_team") or "").strip().upper()
            home_team = (request.args.get("home_team") or "").strip().upper()
            if not away_team or not home_team:
                return api_error("away_team and home_team are required", 400)

            model = request.args.get("model", "baseline")
            if model not in MODEL_PROFILES:
                return jsonify({"success": False, "error": f"model must be one of: {', '.join(MODEL_PROFILES)}"}), 400

            raw_spread_line = request.args.get("spread_line")
            spread_line = float(raw_spread_line) if raw_spread_line not in (None, "") else None
            raw_total_line = request.args.get("total_line")
            total_line = float(raw_total_line) if raw_total_line not in (None, "") else None
            home_rest = float(request.args.get("home_rest", "7"))
            away_rest = float(request.args.get("away_rest", "7"))
            div_game = str(request.args.get("div_game", "false")).lower() in {"1", "true", "yes"}
            roof = (request.args.get("roof") or "").strip().lower()
            temp = request.args.get("temp")
            wind = request.args.get("wind")

            games, cache = await load_nfl_games_for_request()
            scheduled_upcoming = await asyncio.to_thread(find_upcoming_scheduled_match, away_team, home_team)
            prediction = await asyncio.to_thread(
                predict_matchup,
                games,
                away_team,
                home_team,
                spread_line,
                total_line,
                model,
                home_rest,
                away_rest,
                div_game,
                roof,
                float(temp) if temp else None,
                float(wind) if wind else None,
                (request.args.get("market_source") or "").strip() or None,
                (request.args.get("market_observed_at") or "").strip() or None,
                None,
                bool(scheduled_upcoming),
            )
            if scheduled_upcoming:
                availability_adjustments = await asyncio.to_thread(load_upcoming_availability_adjustments)
                prediction = await asyncio.to_thread(
                    apply_upcoming_availability_adjustments,
                    prediction,
                    scheduled_upcoming,
                    availability_adjustments,
                )
                notes = list(prediction.get("model_notes") or [])
                notes.append(f"Matched upcoming schedule game {scheduled_upcoming.get('game_id')}; upcoming-only safeguards were applied to this manual matchup display.")
                prediction["model_notes"] = notes
                prediction["upcoming_schedule_match"] = {
                    "game_id": scheduled_upcoming.get("game_id"),
                    "season": scheduled_upcoming.get("season"),
                    "week": scheduled_upcoming.get("week"),
                }
            roster_context = await asyncio.to_thread(roster_context_for_teams, [away_team, home_team])
            prediction = await asyncio.to_thread(apply_rsm_roster_context_overlay, prediction, {
                "away_team": away_team,
                "home_team": home_team,
            }, roster_context)
            prediction["roster_context"] = roster_context
            return jsonify({"success": True, "source": GAMES_URL, "cache": cache, "prediction": prediction})
        except ValueError as e:
            return api_error(str(e), 400)
        except Exception as e:
            traceback.print_exc()
            return api_error(str(e), 500)


    @app.route("/api/nfl/upcoming")
    @app.route("/api/v1/nfl/upcoming")
    async def nfl_upcoming():
        try:
            scope = (request.args.get("scope") or "upcoming").strip().lower()
            if scope != "upcoming":
                return api_error("The upcoming endpoint only supports the upcoming-week scope.", 400)
            force_refresh = request_bool("refresh", False)
            if force_refresh and not nfl_data_refresh_authorized():
                return api_error("Upcoming prediction refresh requires the admin refresh token.", 403)
            requested_week = request.args.get("week")
            requested_season = request.args.get("season")
            roster_basis = (request.args.get("roster_basis") or "active").strip().lower()
            week = int(requested_week) if requested_week else None
            season = int(requested_season) if requested_season else None
            games, cache = await load_nfl_games_for_request()
            snapshot = await asyncio.to_thread(cached_upcoming_predictions, games, season, week, force_refresh, True)
            snapshot = await asyncio.to_thread(upcoming_predictions_for_roster_basis, snapshot, roster_basis)
            upcoming_teams = sorted({
                team
                for game in snapshot.get("games", [])
                for team in (
                    (game.get("schedule") or {}).get("away_team"),
                    (game.get("schedule") or {}).get("home_team"),
                )
                if team
            })
            roster_context = await asyncio.to_thread(roster_context_for_teams, upcoming_teams, force_refresh)
            for game in snapshot.get("games", []):
                schedule = game.get("schedule") or {}
                models = game.get("models") or {}
                for profile in ("rsm_stage7c", "rsm_plus"):
                    if isinstance(models.get(profile), dict):
                        models[profile] = apply_rsm_roster_context_overlay(models[profile], schedule, roster_context)
            snapshot["roster_context"] = roster_context
            return jsonify({"success": True, "source": GAMES_URL, "cache": cache, **snapshot})
        except ValueError as error:
            return api_error(str(error), 400)
        except Exception as error:
            app.logger.exception("Upcoming NFL batch prediction failed")
            return api_error(str(error), 502)


    @app.route("/api/nfl/upcoming/status")
    @app.route("/api/v1/nfl/upcoming/status")
    async def nfl_upcoming_status():
        """Lightweight progress endpoint that never loads games or starts a rebuild."""
        return jsonify({
            "success": True,
            "source": GAMES_URL,
            "progress": upcoming_prediction_status_snapshot(),
        })


    @app.route("/api/nfl/week-performance")
    @app.route("/api/v1/nfl/week-performance")
    async def nfl_week_performance():
        try:
            requested_week = request.args.get("week")
            requested_season = request.args.get("season")
            games, cache = await load_nfl_games_for_request()
            if not games:
                return api_error("No completed NFL games are available for performance grading.", 404)
            season = int(requested_season) if requested_season else max(game["season"] for game in games)
            season_games = [game for game in games if game["season"] == season]
            if not season_games:
                return jsonify({"success": False, "error": f"No completed NFL games are available for season {season}."}), 404
            week = int(requested_week) if requested_week else max(game["week"] for game in season_games)
            performance, cache_hit = await asyncio.to_thread(cached_weekly_model_performance, games, season, week)
            return jsonify({"success": True, "source": GAMES_URL, "cache": cache, "cache_hit": cache_hit, "performance": performance})
        except ValueError as error:
            return api_error(str(error), 400)
        except Exception as error:
            app.logger.exception("Weekly NFL model performance failed")
            return api_error(str(error), 502)


    @app.route("/api/nfl/week-performance-trend")
    @app.route("/api/v1/nfl/week-performance-trend")
    async def nfl_week_performance_trend():
        try:
            model = (request.args.get("model") or "baseline").strip()
            requested_season = request.args.get("season")
            games, cache = await load_nfl_games_for_request()
            if not games:
                return api_error("No completed NFL games are available for performance trend grading.", 404)
            season = int(requested_season) if requested_season else max(game["season"] for game in games)
            trend, cache_hit = await asyncio.to_thread(cached_weekly_model_performance_trend, games, season, model)
            return jsonify({"success": True, "source": GAMES_URL, "cache": cache, "cache_hit": cache_hit, "trend": trend})
        except ValueError as error:
            return api_error(str(error), 400)
        except Exception as error:
            app.logger.exception("Weekly NFL model performance trend failed")
            return api_error(str(error), 502)


    @app.route("/api/nfl/postgame-grading")
    @app.route("/api/v1/nfl/postgame-grading")
    async def nfl_postgame_grading():
        try:
            requested_week = request.args.get("week")
            requested_season = request.args.get("season")
            games, cache = await load_nfl_games_for_request()
            if not games:
                return api_error("No completed NFL games are available for postgame grading.", 404)
            season = int(requested_season) if requested_season else max(game["season"] for game in games)
            season_games = [game for game in games if game["season"] == season]
            if not season_games:
                return jsonify({"success": False, "error": f"No completed NFL games are available for season {season}."}), 404
            week = int(requested_week) if requested_week else max(game["week"] for game in season_games)
            scheduled_games = await asyncio.to_thread(load_upcoming_games, season, week)
            grading = await asyncio.to_thread(postgame_grading_summary, games, season, week, scheduled_games)
            game_results = await asyncio.to_thread(postgame_game_results, games, season, week)
            return jsonify({
                "success": True,
                "source": GAMES_URL,
                "cache": cache,
                "grading": grading,
                "game_results": game_results,
            })
        except ValueError as error:
            return api_error(str(error), 400)
        except Exception as error:
            app.logger.exception("NFL postgame grading failed")
            return api_error(str(error), 502)


    @app.route("/api/v1/nfl/mobile/upcoming")
    async def nfl_mobile_upcoming():
        """Stable read-only upcoming board contract for future mobile clients."""
        try:
            snapshot, cache = await _read_mobile_upcoming_snapshot()
            return jsonify(mobile_upcoming_payload(snapshot, cache))
        except ValueError as error:
            return api_error(str(error), 400)
        except Exception:
            app.logger.exception("Mobile NFL upcoming contract failed")
            return api_error("Mobile upcoming data is unavailable.", 502)


    @app.route("/api/v1/nfl/mobile/model-signals")
    async def nfl_mobile_model_signals():
        """Return only the display-only Model Signals metadata for upcoming games."""
        try:
            snapshot, cache = await _read_mobile_upcoming_snapshot()
            return jsonify(mobile_model_signals_payload(snapshot, cache))
        except ValueError as error:
            return api_error(str(error), 400)
        except Exception:
            app.logger.exception("Mobile NFL model signals contract failed")
            return api_error("Mobile model signals are unavailable.", 502)


    @app.route("/api/v1/nfl/mobile/weekly-performance")
    async def nfl_mobile_weekly_performance():
        try:
            requested_week = request.args.get("week")
            requested_season = request.args.get("season")
            games, cache = await load_nfl_games_for_request()
            if not games:
                return api_error("No completed NFL games are available for performance grading.", 404)
            season = int(requested_season) if requested_season else max(game["season"] for game in games)
            season_games = [game for game in games if game["season"] == season]
            if not season_games:
                return jsonify({"success": False, "error": f"No completed NFL games are available for season {season}."}), 404
            week = int(requested_week) if requested_week else max(game["week"] for game in season_games)
            performance, cache_hit = await asyncio.to_thread(cached_weekly_model_performance, games, season, week)
            return jsonify({
                "success": True,
                "api_version": "v1",
                "client_contract": "nfl-mobile-1",
                "source": GAMES_URL,
                "cache": cache,
                "cache_hit": cache_hit,
                "performance": mobile_weekly_performance(performance),
            })
        except ValueError as error:
            return api_error(str(error), 400)
        except Exception:
            app.logger.exception("Mobile NFL weekly performance contract failed")
            return api_error("Mobile weekly performance is unavailable.", 502)


    @app.route("/api/v1/nfl/mobile/algorithm-performance/<model>")
    async def nfl_mobile_algorithm_performance(model):
        try:
            requested_season = request.args.get("season")
            games, cache = await load_nfl_games_for_request()
            if not games:
                return api_error("No completed NFL games are available for performance trend grading.", 404)
            season = int(requested_season) if requested_season else max(game["season"] for game in games)
            trend, cache_hit = await asyncio.to_thread(cached_weekly_model_performance_trend, games, season, model)
            return jsonify({
                "success": True,
                "api_version": "v1",
                "client_contract": "nfl-mobile-1",
                "source": GAMES_URL,
                "cache": cache,
                "cache_hit": cache_hit,
                "trend": mobile_performance_trend(trend),
            })
        except ValueError as error:
            return api_error(str(error), 400)
        except Exception:
            app.logger.exception("Mobile NFL algorithm performance contract failed")
            return api_error("Mobile algorithm performance is unavailable.", 502)


    @app.route("/api/nfl/rsm-observations", methods=["GET"])
    async def nfl_rsm_observations():
        observation_store, outcome_store = rsm_shadow_paths()
        report = await asyncio.to_thread(evaluation_report, observation_store, outcome_store)
        report["line_movements"] = await asyncio.to_thread(line_movements, observation_store)
        report["closing_line_value"] = "unavailable unless a comparable, source-timestamped closing observation is captured"
        return jsonify({"success": True, "report": report})


    @app.route("/api/nfl/rsm-observations", methods=["POST"])
    async def nfl_record_rsm_observation():
        if not rsm_manual_write_authorized():
            return api_error("Manual RSM recording is disabled or the operator token is invalid.", 403)
        try:
            body = await request.get_json()
            expected = {"away_team", "home_team", "spread_line", "sportsbook", "market_source", "kickoff", "season", "week"}
            if not isinstance(body, dict) or set(body) != expected:
                return api_error("Observation requires away_team, home_team, spread_line, sportsbook, market_source, kickoff, season, and week.", 400)
            away_team, home_team = str(body["away_team"]).upper().strip(), str(body["home_team"]).upper().strip()
            now = datetime.datetime.now(datetime.UTC)
            kickoff = datetime.datetime.fromisoformat(str(body["kickoff"]).replace("Z", "+00:00"))
            if kickoff.tzinfo is None or kickoff.utcoffset() is None:
                return api_error("kickoff must include a timezone offset.", 400)
            kickoff = kickoff.astimezone(datetime.UTC)
            if now >= kickoff:
                return api_error("Observations must be recorded strictly before kickoff.", 400)
            if not away_team or not home_team or away_team == home_team or not str(body["sportsbook"]).strip() or not str(body["market_source"]).strip():
                return api_error("Teams, a sportsbook, and a market source are required.", 400)
            spread_line = float(body["spread_line"])
            details = RsmStage7CComparisonModel().prediction_details({"away_team": away_team, "home_team": home_team, "home_rest": 7.0, "away_rest": 7.0})
            timestamp = now.isoformat().replace("+00:00", "Z")
            game_id = f"{int(body['season'])}_{int(body['week']):02d}_{away_team}_{home_team}"
            payload = {
                "game_id": game_id, "season": int(body["season"]), "week": int(body["week"]),
                "kickoff": kickoff.isoformat().replace("+00:00", "Z"), "prediction_timestamp": timestamp,
                "away_team": away_team, "home_team": home_team,
                "schedule_source": "MANUAL_OPERATOR_ENTRY_UNVERIFIED", "schedule_observed_at": timestamp,
                "features": details["features"], "features_as_of": details["features_as_of"], "features_source": details["features_source"],
                "lineup": {"confidence": details["lineup_confidence"], "as_of": details["features_as_of"], "source": details["lineup_source"], "expected_starters": [], "inactive_or_injured": []},
                "market": {"sportsbook": str(body["sportsbook"]).strip(), "retrieved_timestamp": timestamp, "line_type": "SPREAD", "line_stage": "CURRENT", "market_kind": "INDIVIDUAL_BOOK", "spread": spread_line, "spread_convention": "HOME_SPREAD", "home_price": None, "away_price": None, "source": f"MANUAL_UNVERIFIED: {str(body['market_source']).strip()}"},
            }
            observation_store, _ = rsm_shadow_paths()
            result = await asyncio.to_thread(capture_observation, payload, observation_store, Path(base_dir).parent / "reports", now)
            result.update({"success": True, "manual_market_entry": True, "market_verification": "operator-entered; bookmaker offer time is not independently verified", "prediction": {"model": RSM_PROFILE, "pred_margin": details["predicted_margin"]}})
            return jsonify(result)
        except ValueError as error:
            return api_error(str(error), 400)
        except Exception as error:
            traceback.print_exc()
            return api_error(str(error), 500)


    @app.route("/api/nfl/rsm-total-observations", methods=["GET"])
    async def nfl_rsm_total_observations():
        _, outcome_store = rsm_shadow_paths()
        report = await asyncio.to_thread(total_evaluation_report, rsm_total_observation_store(), outcome_store)
        return jsonify({"success": True, "report": report})


    @app.route("/api/nfl/rsm-total-observations", methods=["POST"])
    async def nfl_record_rsm_total_observation():
        if not rsm_manual_write_authorized():
            return api_error("Manual RSM recording is disabled or the operator token is invalid.", 403)
        try:
            body = await request.get_json()
            expected = {"away_team", "home_team", "total_line", "sportsbook", "market_source", "kickoff", "season", "week", "game_type"}
            if not isinstance(body, dict) or set(body) != expected:
                return api_error("Total observation requires away_team, home_team, total_line, sportsbook, market_source, kickoff, season, week, and game_type.", 400)
            away_team, home_team = str(body["away_team"]).upper().strip(), str(body["home_team"]).upper().strip()
            now = datetime.datetime.now(datetime.UTC)
            kickoff = datetime.datetime.fromisoformat(str(body["kickoff"]).replace("Z", "+00:00"))
            if kickoff.tzinfo is None or kickoff.utcoffset() is None:
                return api_error("kickoff must include a timezone offset.", 400)
            kickoff = kickoff.astimezone(datetime.UTC)
            if now >= kickoff:
                return api_error("Total observations must be recorded strictly before kickoff.", 400)
            if not away_team or not home_team or away_team == home_team or not str(body["sportsbook"]).strip() or not str(body["market_source"]).strip():
                return api_error("Teams, a sportsbook, and a market source are required.", 400)
            total_line = float(body["total_line"])
            details = RsmStage7CComparisonModel().prediction_details({"away_team": away_team, "home_team": home_team, "home_rest": 7.0, "away_rest": 7.0})
            timestamp = now.isoformat().replace("+00:00", "Z")
            payload = {
                "game_id": f"{int(body['season'])}_{int(body['week']):02d}_{away_team}_{home_team}", "season": int(body["season"]), "week": int(body["week"]),
                "game_type": str(body["game_type"]).upper(), "kickoff": kickoff.isoformat().replace("+00:00", "Z"), "away_team": away_team, "home_team": home_team,
                "predicted_total": details["predicted_total"], "market_total": total_line, "sportsbook": str(body["sportsbook"]).strip(),
                "market_source": f"MANUAL_UNVERIFIED: {str(body['market_source']).strip()}", "market_observed_at": timestamp,
                "features": details["features"], "feature_names": _rsm_artifact()["feature_names"], "features_as_of": details["features_as_of"],
                "features_source": details["features_source"], "lineup_confidence": details["lineup_confidence"], "lineup_source": details["lineup_source"],
                "total_model_version": TOTAL_MODEL_VERSION,
            }
            result = await asyncio.to_thread(capture_total_observation, payload, rsm_total_observation_store(), now)
            result.update({"success": True, "manual_market_entry": True, "market_verification": "operator-entered; bookmaker offer time is not independently verified", "prediction": {"model": RSM_PROFILE, "pred_total": details["predicted_total"], "total_model_version": TOTAL_MODEL_VERSION}})
            return jsonify(result)
        except ValueError as error:
            return api_error(str(error), 400)
        except Exception as error:
            traceback.print_exc()
            return api_error(str(error), 500)


    @app.route("/api/nfl/rsm-outcomes", methods=["POST"])
    async def nfl_record_rsm_outcome():
        if not rsm_manual_write_authorized():
            return api_error("Manual RSM recording is disabled or the operator token is invalid.", 403)
        try:
            body = await request.get_json()
            observation_store, outcome_store = rsm_shadow_paths()
            result = await asyncio.to_thread(record_outcome, body, observation_store, outcome_store)
            return jsonify({"success": True, **result, "report": await asyncio.to_thread(evaluation_report, observation_store, outcome_store)})
        except ValueError as error:
            return api_error(str(error), 400)
        except Exception as error:
            traceback.print_exc()
            return api_error(str(error), 500)


    @app.route("/api/nfl/history")
    @app.route("/api/v1/nfl/history")
    async def nfl_history():
        try:
            away_team = (request.args.get("away_team") or "").strip().upper()
            home_team = (request.args.get("home_team") or "").strip().upper()
            if not away_team or not home_team:
                return api_error("away_team and home_team are required", 400)
            if away_team == home_team:
                return api_error("away_team and home_team must be different", 400)
            model = request.args.get("model", "baseline")
            if model not in MODEL_PROFILES:
                return jsonify({"success": False, "error": f"model must be one of: {', '.join(MODEL_PROFILES)}"}), 400

            games, cache = await load_nfl_games_for_request()
            teams = set(list_teams(games))
            if away_team not in teams:
                return jsonify({"success": False, "error": f"Unknown away_team: {away_team}"}), 400
            if home_team not in teams:
                return jsonify({"success": False, "error": f"Unknown home_team: {home_team}"}), 400

            rows, cache_hit = await asyncio.to_thread(cached_matchup_history, games, away_team, home_team, model)
            return jsonify({
                "success": True,
                "source": GAMES_URL,
                "cache": cache,
                "away_team": away_team,
                "home_team": home_team,
                "model": model,
                "games": rows,
                "history_cache_hit": cache_hit,
            })
        except Exception as e:
            traceback.print_exc()
            return api_error(str(e), 500)


    @app.route("/api/nfl/roster-context")
    @app.route("/api/v1/nfl/roster-context")
    async def nfl_roster_context():
        try:
            raw_teams = request.args.get("teams", "")
            teams = [team.strip().upper() for team in raw_teams.split(",") if team.strip()]
            away_team = (request.args.get("away_team") or "").strip().upper()
            home_team = (request.args.get("home_team") or "").strip().upper()
            if away_team:
                teams.append(away_team)
            if home_team:
                teams.append(home_team)
            if not teams:
                return api_error("teams or away_team/home_team are required", 400)
            force = request_bool("refresh", False)
            if force and not nfl_data_refresh_authorized():
                return api_error("Roster context refresh requires the admin refresh token.", 403)
            context_payload = await asyncio.to_thread(roster_context_for_teams, teams, force)
            return jsonify({"success": True, "roster_context": context_payload})
        except Exception as e:
            traceback.print_exc()
            return api_error(str(e), 500)


    @app.route("/api/nfl/live")
    @app.route("/api/v1/nfl/live")
    async def nfl_live():
        try:
            data = await asyncio.to_thread(live_scoreboard)
            status = 200 if data.get("success", False) else 400
            return jsonify(data), status
        except Exception as e:
            traceback.print_exc()
            return jsonify({"success": False, "enabled": False, "events": [], "error": str(e)}), 500
