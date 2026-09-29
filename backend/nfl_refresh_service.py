import json


def refresh_active_week_predictions(load_games_fn, cached_upcoming_predictions_fn):
    """Fetch fresh game data and synchronously rebuild the active-week board."""
    games = load_games_fn(refresh=True)
    return cached_upcoming_predictions_fn(games, None, None, True, False)


def refresh_active_week_final_scores(load_games_fn, refresh_final_scores_fn):
    """Fetch fresh game data and update only final-score fields in the active-week cache."""
    load_games_fn(refresh=True)
    return refresh_final_scores_fn()


def load_upcoming_prediction_cache_snapshot(upcoming_cache_path_fn):
    """Read the persisted upcoming board without loading games or rebuilding models."""
    try:
        with open(upcoming_cache_path_fn(), encoding="utf-8") as source:
            return json.load(source)
    except (OSError, json.JSONDecodeError):
        return None


def upcoming_cache_needs_startup_rebuild(snapshot: dict | None, has_valid_upcoming_games_fn) -> bool:
    return not isinstance(snapshot, dict) or not has_valid_upcoming_games_fn(snapshot)


def reconcile_startup_upcoming_cache(
    load_snapshot_fn,
    cache_needs_rebuild_fn,
    resolve_target_fn,
    load_games_fn,
    schedule_refresh_fn,
):
    """Serve a persisted board on startup and rebuild only when the cache cannot satisfy current inputs."""
    snapshot = load_snapshot_fn()
    if not cache_needs_rebuild_fn(snapshot):
        return False
    target_season, target_week = resolve_target_fn(None, None)
    games = load_games_fn(refresh=False)
    return schedule_refresh_fn(games, target_season, target_week)
