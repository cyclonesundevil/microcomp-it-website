import datetime

from nfl_predictor import GAMES_URL, MODEL_PROFILES, model_status_labels


CLIENT_CONTRACT = "nfl-mobile-1"
API_VERSION = "v1"


def football_week_start(schedule: dict):
    gameday = (schedule or {}).get("gameday")
    if not gameday:
        return None
    try:
        game_date = datetime.date.fromisoformat(str(gameday))
    except ValueError:
        return None
    days_since_tuesday = (game_date.weekday() - 1) % 7
    return (game_date - datetime.timedelta(days=days_since_tuesday)).isoformat()


def market_favorite(schedule: dict):
    spread_line = schedule.get("spread_line")
    if spread_line is None:
        return None
    try:
        home_margin = float(spread_line)
    except (TypeError, ValueError):
        return None
    if home_margin > 0:
        return {
            "team": schedule.get("home_team"),
            "spread": -abs(home_margin),
            "home_margin": home_margin,
            "basis": "home-team margin; positive means home team favored",
        }
    if home_margin < 0:
        return {
            "team": schedule.get("away_team"),
            "spread": -abs(home_margin),
            "home_margin": home_margin,
            "basis": "home-team margin; negative means away team favored",
        }
    return {
        "team": None,
        "spread": 0.0,
        "home_margin": 0.0,
        "basis": "pick'em",
    }


def model_favorite_relative_spread(predicted_home_margin, market_home_margin):
    if predicted_home_margin is None or market_home_margin is None:
        return None
    try:
        pred_home_margin = float(predicted_home_margin)
        market_margin = float(market_home_margin)
    except (TypeError, ValueError):
        return None
    if market_margin > 0:
        return -pred_home_margin
    if market_margin < 0:
        return pred_home_margin
    return pred_home_margin


def mobile_model_prediction(model_name: str, prediction: dict, schedule: dict) -> dict:
    prediction = prediction if isinstance(prediction, dict) else {}
    return {
        "model": model_name,
        "status_label": model_status_labels().get(model_name, "Production"),
        "eligible": prediction.get("eligible"),
        "display_suppressed": bool(prediction.get("display_suppressed")),
        "predicted_home_margin": prediction.get("pred_margin"),
        "predicted_total": prediction.get("pred_total"),
        "market_favorite_relative_spread": model_favorite_relative_spread(
            prediction.get("pred_margin"),
            schedule.get("spread_line"),
        ),
        "spread_edge": prediction.get("spread_edge"),
        "total_edge": prediction.get("total_edge"),
        "availability_adjusted": bool(prediction.get("availability_adjusted")),
        "notes": prediction.get("model_notes") or [],
    }


def mobile_upcoming_game(row: dict) -> dict:
    schedule = row.get("schedule") if isinstance(row, dict) else {}
    schedule = schedule if isinstance(schedule, dict) else {}
    models = row.get("models") if isinstance(row, dict) else {}
    models = models if isinstance(models, dict) else {}
    return {
        "game_id": schedule.get("game_id"),
        "season": schedule.get("season"),
        "week": schedule.get("week"),
        "football_week_start": football_week_start(schedule),
        "game_status": "final" if schedule.get("is_completed") else "scheduled",
        "kickoff_date": schedule.get("gameday"),
        "kickoff_time": schedule.get("gametime"),
        "away_team": schedule.get("away_team"),
        "home_team": schedule.get("home_team"),
        "away_score": schedule.get("away_score"),
        "home_score": schedule.get("home_score"),
        "market": {
            "spread_line": schedule.get("spread_line"),
            "total_line": schedule.get("total_line"),
            "favorite": market_favorite(schedule),
        },
        "algorithms": {
            model: mobile_model_prediction(model, models.get(model), schedule)
            for model in MODEL_PROFILES
        },
        "model_signals": row.get("model_signals") if isinstance(row, dict) else None,
    }


def mobile_upcoming_payload(snapshot: dict, cache: dict) -> dict:
    games = snapshot.get("games") if isinstance(snapshot.get("games"), list) else []
    first_schedule = (games[0] or {}).get("schedule", {}) if games else {}
    return {
        "success": True,
        "api_version": API_VERSION,
        "client_contract": CLIENT_CONTRACT,
        "source": GAMES_URL,
        "cache": cache,
        "cache_hit": snapshot.get("cache_hit"),
        "ready": snapshot.get("ready"),
        "status": snapshot.get("status"),
        "message": snapshot.get("message"),
        "season": snapshot.get("season"),
        "week": snapshot.get("week"),
        "football_week_start": football_week_start(first_schedule),
        "generated_at": snapshot.get("generated_at"),
        "last_rebuild_at": snapshot.get("generated_at"),
        "cache_age_seconds": snapshot.get("cache_age_seconds"),
        "cache_ttl_seconds": snapshot.get("cache_ttl_seconds"),
        "model_status_labels": model_status_labels(),
        "spread_sign_convention": {
            "market_spread_line": "home-team margin from the schedule feed; positive means the home team is favored and negative means the away team is favored",
            "market_favorite_relative_spread": "display spread from the current market favorite's perspective; negative favors that team, positive means the model leans opposite the market favorite",
        },
        "games": [mobile_upcoming_game(row) for row in games],
        "model_signals_note": snapshot.get("model_signals_note"),
    }


def mobile_model_signals_payload(snapshot: dict, cache: dict) -> dict:
    mobile = mobile_upcoming_payload(snapshot, cache)
    return {
        "success": True,
        "api_version": API_VERSION,
        "client_contract": CLIENT_CONTRACT,
        "source": GAMES_URL,
        "cache": cache,
        "cache_hit": mobile.get("cache_hit"),
        "ready": mobile.get("ready"),
        "status": mobile.get("status"),
        "season": mobile.get("season"),
        "week": mobile.get("week"),
        "football_week_start": mobile.get("football_week_start"),
        "last_rebuild_at": mobile.get("last_rebuild_at"),
        "model_status_labels": mobile.get("model_status_labels"),
        "disclaimer": "Model Signals are matchup comparison tools, not betting recommendations.",
        "games": [
            {
                "game_id": game.get("game_id"),
                "season": game.get("season"),
                "week": game.get("week"),
                "football_week_start": game.get("football_week_start"),
                "game_status": game.get("game_status"),
                "kickoff_date": game.get("kickoff_date"),
                "kickoff_time": game.get("kickoff_time"),
                "away_team": game.get("away_team"),
                "home_team": game.get("home_team"),
                "market": game.get("market"),
                "model_signals": game.get("model_signals"),
            }
            for game in mobile.get("games", [])
        ],
    }


def mobile_weekly_performance(performance: dict) -> dict:
    rows = []
    for row in performance.get("models", []) if isinstance(performance, dict) else []:
        rows.append({
            "model": row.get("model"),
            "completed_games": row.get("completed_games"),
            "spread_wins": row.get("spread_wins"),
            "spread_losses": row.get("spread_losses"),
            "spread_pushes": row.get("spread_pushes"),
            "spread_bets": row.get("spread_bets"),
            "spread_win_rate": row.get("spread_win_rate"),
            "total_wins": row.get("total_wins"),
            "total_losses": row.get("total_losses"),
            "total_pushes": row.get("total_pushes"),
            "total_bets": row.get("total_bets"),
            "total_win_rate": row.get("total_win_rate"),
            "spread_mae": row.get("margin_mae"),
            "total_score_mae": row.get("total_mae"),
        })
    return {
        "season": performance.get("season"),
        "week": performance.get("week"),
        "completed_games": performance.get("completed_games"),
        "generated_at": performance.get("generated_at"),
        "models": rows,
    }


def mobile_performance_trend(trend: dict) -> dict:
    weeks = []
    for row in trend.get("weeks", []) if isinstance(trend, dict) else []:
        weeks.append({
            "week": row.get("week"),
            "completed_games": row.get("completed_games"),
            "spread_wins": row.get("spread_wins"),
            "spread_losses": row.get("spread_losses"),
            "spread_pushes": row.get("spread_pushes"),
            "spread_bets": row.get("spread_bets"),
            "spread_win_rate": row.get("spread_win_rate"),
            "total_wins": row.get("total_wins"),
            "total_losses": row.get("total_losses"),
            "total_pushes": row.get("total_pushes"),
            "total_bets": row.get("total_bets"),
            "total_win_rate": row.get("total_win_rate"),
            "spread_mae": row.get("margin_mae"),
            "total_score_mae": row.get("total_mae"),
        })
    return {
        "season": trend.get("season"),
        "model": trend.get("model"),
        "generated_at": trend.get("generated_at"),
        "weeks": weeks,
    }
