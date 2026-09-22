import csv
import io
import json
import os
import pytest
from datetime import datetime
from zoneinfo import ZoneInfo

from nfl_predictor import (
    MODEL_PROFILES,
    MarketBlendNFLModel,
    RsmStage7CComparisonModel,
    apply_upcoming_availability_adjustments,
    build_model_signals,
    _rsm_artifact,
    _games_source_signature,
    _availability_adjustments_signature,
    _validate_games_csv,
    cached_weekly_model_performance,
    cached_weekly_model_performance_trend,
    current_nfl_schedule_week,
    cached_matchup_history,
    cached_upcoming_predictions,
    download_games,
    find_upcoming_scheduled_match,
    load_upcoming_games,
    list_teams,
    matchup_history,
    predict_matchup,
    run_backtest,
    side_from_edge,
    summarize,
    train_model,
    weekly_model_performance,
)


def _feed_csv(rows=None):
    if rows is None:
        rows = ["2026_01_KC_BUF,2026,1,REG,KC,BUF,20,24,3.0,47.5"]
    header = "game_id,season,week,game_type,away_team,home_team,away_score,home_score,spread_line,total_line"
    return (header + "\n" + "\n".join(rows) + "\n").encode()


def _schedule_csv(rows):
    header = (
        "game_id,season,week,game_type,away_team,home_team,away_score,home_score,"
        "spread_line,total_line,gameday,gametime,away_rest,home_rest,div_game,roof,temp,wind"
    )
    return header + "\n" + "\n".join(rows) + "\n"


class _FeedResponse:
    def __init__(self, content):
        self.content = content

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self.content


def _FixedDateTime(fixed_now):
    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return fixed_now.replace(tzinfo=None)
            return fixed_now.astimezone(tz)

    return FixedDateTime


def test_forced_refresh_validates_and_atomically_replaces_cache(tmp_path, monkeypatch):
    cache_path = tmp_path / "nfl_games.csv"
    cache_path.write_bytes(b"previous-good-cache")
    monkeypatch.setattr("urllib.request.urlopen", lambda *args, **kwargs: _FeedResponse(_feed_csv()))

    assert download_games(str(cache_path), refresh=True) == str(cache_path)
    assert cache_path.read_bytes() == _feed_csv()
    assert not list(tmp_path.glob("*.tmp"))


def test_invalid_refresh_preserves_previous_cache(tmp_path, monkeypatch):
    cache_path = tmp_path / "nfl_games.csv"
    cache_path.write_bytes(b"previous-good-cache")
    monkeypatch.setattr("urllib.request.urlopen", lambda *args, **kwargs: _FeedResponse(b"not,the,nfl,feed\n1,2,3,4\n"))

    with pytest.raises(ValueError, match="missing required columns"):
        download_games(str(cache_path), refresh=True)

    assert cache_path.read_bytes() == b"previous-good-cache"
    assert not list(tmp_path.glob("*.tmp"))


def test_feed_validation_rejects_header_only_response():
    with pytest.raises(ValueError, match="no data rows"):
        _validate_games_csv(_feed_csv(rows=[]))


def test_games_source_signature_ignores_file_mtime_for_deploy_stability(tmp_path, monkeypatch):
    cache_path = tmp_path / "nfl_games.csv"
    cache_path.write_bytes(_feed_csv())
    monkeypatch.setattr("nfl_predictor.DEFAULT_CACHE_PATH", str(cache_path))

    first_signature = _games_source_signature()
    os.utime(cache_path, (100, 100))
    second_signature = _games_source_signature()

    assert first_signature == second_signature


def test_availability_adjustment_signature_changes_with_content(tmp_path, monkeypatch):
    adjustment_path = tmp_path / "availability.json"
    adjustment_path.write_text('{"adjustments":[]}', encoding="utf-8")
    monkeypatch.setenv("NFL_AVAILABILITY_ADJUSTMENTS_PATH", str(adjustment_path))

    first_signature = _availability_adjustments_signature()
    os.utime(adjustment_path, (100, 100))
    second_signature = _availability_adjustments_signature()
    adjustment_path.write_text('{"adjustments":[{"team":"ATL","margin_delta":-4}]}', encoding="utf-8")
    third_signature = _availability_adjustments_signature()

    assert first_signature == second_signature
    assert third_signature != first_signature


def test_valid_upcoming_cache_is_served_while_source_mismatch_refreshes(tmp_path, monkeypatch):
    cache_file = tmp_path / "nfl_upcoming_predictions.json"
    snapshot = {
        "generated_at": "2026-09-15T13:00:00+00:00",
        "prediction_schema_version": 5,
        "games_source_signature": "old-source",
        "availability_adjustments_signature": "same-availability",
        "season": 2026,
        "week": 2,
        "models": list(MODEL_PROFILES),
        "games": [{
            "schedule": {"away_team": "CAR", "home_team": "ATL", "season": 2026, "week": 2},
            "models": {model: {"model": model} for model in MODEL_PROFILES},
        }],
    }
    cache_file.write_text(json.dumps(snapshot), encoding="utf-8")

    monkeypatch.setattr("nfl_predictor.upcoming_prediction_cache_path", lambda: str(cache_file))
    monkeypatch.setattr("nfl_predictor._games_source_signature", lambda: "new-source")
    monkeypatch.setattr("nfl_predictor._availability_adjustments_signature", lambda: "same-availability")
    monkeypatch.setattr("nfl_predictor._UPCOMING_REFRESH_RUNNING", False)
    started = {"value": False}

    class _NoopThread:
        def __init__(self, *args, **kwargs):
            pass

        def start(self):
            started["value"] = True

    with monkeypatch.context() as nested:
        nested.setattr("nfl_predictor.threading.Thread", _NoopThread)
        nested.setattr("nfl_predictor._build_upcoming_prediction_cache", lambda *_args, **_kwargs: pytest.fail("request path should not rebuild synchronously"))
        result = cached_upcoming_predictions([], season=2026, week=2)

    assert result["ready"] is True
    assert result["cache_hit"] is True
    assert result["refresh_scheduled"] is True
    assert started["value"] is True
    assert result["games"][0]["schedule"]["away_team"] == "CAR"


def test_upcoming_cache_target_mismatch_serves_last_valid_and_schedules_current_week(tmp_path, monkeypatch):
    cache_file = tmp_path / "nfl_upcoming_predictions.json"
    snapshot = {
        "generated_at": "2026-09-21T13:00:00+00:00",
        "prediction_schema_version": 5,
        "games_source_signature": "source",
        "availability_adjustments_signature": "availability",
        "season": 2026,
        "week": 2,
        "models": list(MODEL_PROFILES),
        "games": [{
            "schedule": {"away_team": "PHI", "home_team": "TEN", "season": 2026, "week": 2},
            "models": {model: {"model": model} for model in MODEL_PROFILES},
        }],
    }
    cache_file.write_text(json.dumps(snapshot), encoding="utf-8")

    monkeypatch.setattr("nfl_predictor.upcoming_prediction_cache_path", lambda: str(cache_file))
    monkeypatch.setattr("nfl_predictor._games_source_signature", lambda: "source")
    monkeypatch.setattr("nfl_predictor._availability_adjustments_signature", lambda: "availability")
    monkeypatch.setattr("nfl_predictor.load_upcoming_games", lambda season=None, week=None: [{
        "game_id": "2026_03_ATL_GB",
        "season": 2026,
        "week": 3,
        "away_team": "ATL",
        "home_team": "GB",
    }])
    monkeypatch.setattr("nfl_predictor._UPCOMING_REFRESH_RUNNING", False)
    scheduled = {}

    def fake_schedule(_games, season, week):
        scheduled["season"] = season
        scheduled["week"] = week
        return True

    monkeypatch.setattr("nfl_predictor._schedule_upcoming_prediction_refresh", fake_schedule)
    result = cached_upcoming_predictions([], allow_background_refresh=True)

    assert result["ready"] is True
    assert result["cache_hit"] is True
    assert result["cache_target_mismatch"] is True
    assert result["requested_season"] == 2026
    assert result["requested_week"] == 3
    assert result["week"] == 2
    assert result["games"][0]["schedule"]["away_team"] == "PHI"
    assert result["refresh_scheduled"] is True
    assert scheduled == {"season": 2026, "week": 3}


def test_public_upcoming_cache_miss_does_not_schedule_rebuild(tmp_path, monkeypatch):
    cache_file = tmp_path / "nfl_upcoming_predictions.json"
    monkeypatch.setattr("nfl_predictor.upcoming_prediction_cache_path", lambda: str(cache_file))
    monkeypatch.setattr("nfl_predictor._games_source_signature", lambda: "source")
    monkeypatch.setattr("nfl_predictor._availability_adjustments_signature", lambda: "availability")
    monkeypatch.setattr("nfl_predictor._UPCOMING_REFRESH_RUNNING", False)

    with monkeypatch.context() as nested:
        nested.setattr("nfl_predictor._schedule_upcoming_prediction_refresh", lambda *_args, **_kwargs: pytest.fail("public cache read should not schedule rebuild"))
        result = cached_upcoming_predictions([], season=2026, week=2, allow_background_refresh=False)

    assert result["ready"] is False
    assert result["refresh_scheduled"] is False
    assert "Admin refresh" in result["message"]


def test_current_nfl_schedule_week_does_not_advance_after_early_week_final():
    rows = list(csv.DictReader(io.StringIO(_schedule_csv([
        "2026_02_LAC_KC,2026,2,REG,LAC,KC,20,24,-3.0,47.5,2026-09-17,20:15,7,7,1,outdoors,,",
        "2026_02_DAL_NYG,2026,2,REG,DAL,NYG,,,,,2026-09-20,13:00,7,7,1,outdoors,,",
        "2026_03_SF_SEA,2026,3,REG,SF,SEA,,,,,2026-09-24,20:15,7,7,1,outdoors,,",
    ]))))
    now = datetime(2026, 9, 19, 10, 0, tzinfo=ZoneInfo("America/Phoenix"))

    assert current_nfl_schedule_week(rows, season=2026, now=now) == 2


def test_current_nfl_schedule_week_advances_on_tuesday_morning():
    rows = list(csv.DictReader(io.StringIO(_schedule_csv([
        "2026_02_DAL_NYG,2026,2,REG,DAL,NYG,,,,,2026-09-20,13:00,7,7,1,outdoors,,",
        "2026_03_SF_SEA,2026,3,REG,SF,SEA,,,,,2026-09-24,20:15,7,7,1,outdoors,,",
    ]))))
    before_rollover = datetime(2026, 9, 22, 5, 59, tzinfo=ZoneInfo("America/Phoenix"))
    after_rollover = datetime(2026, 9, 22, 6, 0, tzinfo=ZoneInfo("America/Phoenix"))

    assert current_nfl_schedule_week(rows, season=2026, now=before_rollover) == 2
    assert current_nfl_schedule_week(rows, season=2026, now=after_rollover) == 3


def test_load_upcoming_games_uses_schedule_week_not_completed_week(tmp_path, monkeypatch):
    schedule_path = tmp_path / "nfl_games.csv"
    schedule_path.write_text(_schedule_csv([
        "2026_02_LAC_KC,2026,2,REG,LAC,KC,20,24,-3.0,47.5,2026-09-17,20:15,7,7,1,outdoors,,",
        "2026_02_DAL_NYG,2026,2,REG,DAL,NYG,,,-2.5,45.5,2026-09-20,13:00,7,7,1,outdoors,,",
        "2026_03_SF_SEA,2026,3,REG,SF,SEA,,,-1.5,44.0,2026-09-24,20:15,7,7,1,outdoors,,",
    ]), encoding="utf-8")
    now = datetime(2026, 9, 19, 10, 0, tzinfo=ZoneInfo("America/Phoenix"))

    monkeypatch.setattr("nfl_predictor.download_games", lambda *args, **kwargs: str(schedule_path))
    monkeypatch.setattr("nfl_predictor.datetime", _FixedDateTime(now))

    upcoming = load_upcoming_games()

    assert [game["game_id"] for game in upcoming] == ["2026_02_DAL_NYG"]


def test_find_upcoming_scheduled_match_returns_exact_scheduled_game(tmp_path, monkeypatch):
    schedule_path = tmp_path / "nfl_games.csv"
    schedule_path.write_text(_schedule_csv([
        "2026_02_CAR_ATL,2026,2,REG,CAR,ATL,,,-2.5,43.5,2026-09-20,13:00,7,7,1,dome,,",
        "2026_02_DAL_NYG,2026,2,REG,DAL,NYG,,,-2.5,45.5,2026-09-20,13:00,7,7,1,outdoors,,",
    ]), encoding="utf-8")
    now = datetime(2026, 9, 20, 8, 0, tzinfo=ZoneInfo("America/Phoenix"))

    monkeypatch.setattr("nfl_predictor.download_games", lambda *args, **kwargs: str(schedule_path))
    monkeypatch.setattr("nfl_predictor.datetime", _FixedDateTime(now))

    scheduled = find_upcoming_scheduled_match("CAR", "ATL")

    assert scheduled["game_id"] == "2026_02_CAR_ATL"
    assert scheduled["spread_line"] == -2.5
    assert find_upcoming_scheduled_match("ATL", "CAR") is None


def _game(season, away_team, home_team):
    return {
        "season": season,
        "away_team": away_team,
        "home_team": home_team,
    }


def _graded_game(season=2025, away_team="KC", home_team="PHI"):
    return {
        **_game(season, away_team, home_team),
        "week": 1,
        "away_score": 20.0,
        "home_score": 24.0,
        "actual_margin": 4.0,
        "actual_total": 44.0,
        "spread_line": 3.0,
        "total_line": 47.0,
        "away_rest": 7.0,
        "home_rest": 7.0,
        "div_game": False,
        "roof": "outdoors",
        "temp": 65.0,
        "wind": 5.0,
    }


def _history_game(game_id, season, week, away_team, home_team, away_score, home_score, spread_line=-3.0, total_line=44.5):
    actual_margin = float(home_score - away_score)
    actual_total = float(home_score + away_score)
    return {
        "game_id": game_id,
        "season": season,
        "week": week,
        "gameday": f"{season}-09-{week + 7:02d}",
        "away_team": away_team,
        "home_team": home_team,
        "away_score": float(away_score),
        "home_score": float(home_score),
        "actual_margin": actual_margin,
        "actual_total": actual_total,
        "spread_line": float(spread_line),
        "total_line": float(total_line),
        "away_rest": 7.0,
        "home_rest": 7.0,
        "div_game": False,
        "roof": "outdoors",
        "temp": 65.0,
        "wind": 5.0,
    }


def test_current_teams_retain_previous_season_during_partial_opening_week():
    games = [
        _game(2025, "ARI", "ATL"),
        _game(2025, "BUF", "CAR"),
        _game(2026, "NE", "SEA"),
    ]

    assert list_teams(games, current_only=True) == [
        "ARI",
        "ATL",
        "BUF",
        "CAR",
        "NE",
        "SEA",
    ]


def test_current_teams_use_latest_season_once_its_team_set_is_complete():
    games = [
        _game(2025, "OAK", "SD"),
        _game(2026, "LV", "LAC"),
    ]

    assert list_teams(games, current_only=True) == ["LAC", "LV"]


def test_market_blend_shrinks_baseline_projection_toward_market():
    model = MarketBlendNFLModel(model_weight=0.5)
    margin, total = model.predict(_graded_game())

    assert margin == pytest.approx(2.3)
    assert total == pytest.approx(45.5)


def test_matchup_api_uses_conventional_negative_home_favorite_line():
    prediction = predict_matchup(
        [_graded_game()],
        away_team="KC",
        home_team="PHI",
        spread_line=-3.0,
        model_profile="baseline",
    )

    assert prediction["spread_line"] == -3.0
    assert prediction["market_margin"] == 3.0
    assert prediction["spread_edge"] == pytest.approx(prediction["pred_margin"] - 3.0)


def test_upcoming_market_blend_converts_nflverse_home_margin_before_prediction():
    games = [_graded_game()]
    prediction = predict_matchup(
        games,
        away_team="KC",
        home_team="PHI",
        spread_line=-3.0,
        model_profile="market_blend",
    )

    assert prediction["market_margin"] == 3.0
    baseline = predict_matchup(
        games,
        away_team="KC",
        home_team="PHI",
        spread_line=-3.0,
        model_profile="baseline",
    )
    assert prediction["pred_margin"] == pytest.approx((baseline["pred_margin"] + prediction["market_margin"]) / 2)


def test_mean_reversion_early_season_low_sample_is_stable_and_market_independent():
    games = [
        _history_game("2024_01_MIN_CHI", 2024, 1, "MIN", "CHI", 21, 20, spread_line=1.5, total_line=42.0),
        _history_game("2024_02_CHI_MIN", 2024, 2, "CHI", "MIN", 17, 24, spread_line=-3.0, total_line=43.0),
        _history_game("2025_01_MIN_CHI", 2025, 1, "MIN", "CHI", 20, 19, spread_line=1.0, total_line=41.5),
        _history_game("2025_02_CHI_MIN", 2025, 2, "CHI", "MIN", 16, 23, spread_line=-2.5, total_line=42.5),
        _history_game("2026_01_MIN_GB", 2026, 1, "MIN", "GB", 70, 63, spread_line=-3.0, total_line=47.5),
        _history_game("2026_01_DET_CHI", 2026, 1, "DET", "CHI", 65, 70, spread_line=2.5, total_line=48.5),
    ]

    favorite_home = predict_matchup(
        games,
        away_team="MIN",
        home_team="CHI",
        spread_line=-2.5,
        total_line=48.5,
        model_profile="mean_reversion",
    )
    different_market = predict_matchup(
        games,
        away_team="MIN",
        home_team="CHI",
        spread_line=7.5,
        total_line=35.5,
        model_profile="mean_reversion",
    )

    assert favorite_home["model"] == "mean_reversion"
    assert favorite_home["pred_total"] < 70.0
    assert 30.0 <= favorite_home["pred_total"] <= 62.0
    assert favorite_home["pred_margin"] == pytest.approx(different_market["pred_margin"])
    assert favorite_home["pred_total"] == pytest.approx(different_market["pred_total"])


def test_mean_reversion_current_season_weight_increases_later_in_season():
    games = [
        _history_game("2024_01_MIN_CHI", 2024, 1, "MIN", "CHI", 20, 20),
        _history_game("2024_02_CHI_MIN", 2024, 2, "CHI", "MIN", 20, 20),
        _history_game("2025_01_MIN_CHI", 2025, 1, "MIN", "CHI", 20, 20),
        _history_game("2025_02_CHI_MIN", 2025, 2, "CHI", "MIN", 20, 20),
        _history_game("2026_01_MIN_GB", 2026, 1, "MIN", "GB", 50, 20),
        _history_game("2026_02_MIN_DET", 2026, 2, "MIN", "DET", 50, 20),
        _history_game("2026_03_MIN_BAL", 2026, 3, "MIN", "BAL", 50, 20),
        _history_game("2026_04_MIN_SEA", 2026, 4, "MIN", "SEA", 50, 20),
    ]
    model = train_model(games, "mean_reversion")

    early_margin, early_total = model.predict({
        "season": 2026, "week": 2, "away_team": "MIN", "home_team": "CHI",
    })
    late_margin, late_total = model.predict({
        "season": 2026, "week": 10, "away_team": "MIN", "home_team": "CHI",
    })

    assert late_total > early_total
    assert late_margin < early_margin


def test_mean_reversion_spread_and_total_sign_conventions():
    games = [
        _history_game("2024_01_KC_PHI", 2024, 1, "KC", "PHI", 21, 24),
        _history_game("2025_01_KC_PHI", 2025, 1, "KC", "PHI", 20, 24),
        _history_game("2026_01_KC_BUF", 2026, 1, "KC", "BUF", 27, 20),
        _history_game("2026_01_DAL_PHI", 2026, 1, "DAL", "PHI", 17, 24),
    ]

    prediction = predict_matchup(
        games,
        away_team="KC",
        home_team="PHI",
        spread_line=-3.0,
        total_line=47.5,
        model_profile="mean_reversion",
    )

    assert prediction["market_margin"] == 3.0
    assert prediction["spread_edge"] == pytest.approx(prediction["pred_margin"] - 3.0)
    assert prediction["total_edge"] == pytest.approx(prediction["pred_total"] - 47.5)


def test_upcoming_availability_adjustment_applies_team_downgrade_after_prediction():
    prediction = {
        "model": "baseline",
        "pred_margin": 5.0,
        "pred_total": 45.0,
        "market_margin": -2.5,
        "total_line": 43.5,
        "eligible": True,
        "spread_threshold": 6.0,
        "total_threshold": 1.5,
        "model_notes": [],
    }
    scheduled = {"season": 2026, "week": 2, "game_id": "2026_02_CAR_ATL", "away_team": "CAR", "home_team": "ATL"}
    adjustments = [{
        "season": 2026,
        "week": 2,
        "game_id": "2026_02_CAR_ATL",
        "team": "ATL",
        "margin_delta": -4.0,
        "total_delta": -2.5,
        "label": "ATL QB downgrade",
        "source": "unit-test",
    }]

    adjusted = apply_upcoming_availability_adjustments(prediction, scheduled, adjustments)

    assert adjusted["pred_margin"] == pytest.approx(1.0)
    assert adjusted["pred_total"] == pytest.approx(42.5)
    assert adjusted["spread_edge"] == pytest.approx(3.5)
    assert adjusted["total_edge"] == pytest.approx(-1.0)
    assert adjusted["spread_pick"] is None
    assert adjusted["total_pick"] is None
    assert adjusted["winner_pick"] == "home"
    assert adjusted["raw_pred_margin_before_availability"] == 5.0
    assert adjusted["availability_adjusted"] is True
    assert adjusted["availability_adjustments"][0]["team"] == "ATL"


def test_upcoming_availability_adjustment_preserves_market_favorite_sign_convention():
    prediction = {
        "model": "mean_reversion",
        "pred_margin": 4.5,
        "pred_total": 49.5,
        "market_margin": -2.5,
        "total_line": 43.5,
        "eligible": True,
        "spread_threshold": 4.0,
        "total_threshold": 2.0,
        "model_notes": [],
    }
    scheduled = {"season": 2026, "week": 2, "game_id": "2026_02_CAR_ATL", "away_team": "CAR", "home_team": "ATL"}
    adjusted = apply_upcoming_availability_adjustments(prediction, scheduled, [{
        "season": 2026, "week": 2, "game_id": "2026_02_CAR_ATL", "team": "ATL",
        "margin_delta": -4.0, "total_delta": -2.5, "label": "ATL QB downgrade", "source": "unit-test",
    }])

    assert adjusted["market_margin"] == -2.5
    assert adjusted["pred_margin"] == pytest.approx(0.5)
    assert adjusted["spread_edge"] == pytest.approx(3.0)
    assert adjusted["spread_pick"] is None


def test_rothstein_upcoming_low_sample_total_is_stabilized():
    games = [
        _history_game("2026_01_MIN_GB", 2026, 1, "MIN", "GB", 60, 50, spread_line=-3.0, total_line=47.5),
        _history_game("2026_01_DET_CHI", 2026, 1, "DET", "CHI", 55, 60, spread_line=2.5, total_line=48.5),
    ]
    trained = train_model(games, "rothstein")

    raw = predict_matchup(
        games,
        away_team="MIN",
        home_team="CHI",
        spread_line=-2.5,
        total_line=48.5,
        model_profile="rothstein",
        trained_model=trained,
    )
    upcoming = predict_matchup(
        games,
        away_team="MIN",
        home_team="CHI",
        spread_line=-2.5,
        total_line=48.5,
        model_profile="rothstein",
        trained_model=trained,
        upcoming_context=True,
    )

    assert raw["pred_total"] > 70.0
    assert upcoming["pred_total"] <= 60.0
    assert upcoming["pred_total"] == pytest.approx(48.5)
    assert upcoming["raw_pred_total"] == pytest.approx(raw["pred_total"])
    assert upcoming["upcoming_stabilized"] is True
    assert upcoming["data_confidence"] == "LOW"


def test_rothstein_upcoming_spread_sign_convention_after_stabilization():
    games = [
        _history_game("2026_01_MIN_GB", 2026, 1, "MIN", "GB", 60, 50, spread_line=-3.0, total_line=47.5),
        _history_game("2026_01_DET_CHI", 2026, 1, "DET", "CHI", 55, 60, spread_line=2.5, total_line=48.5),
    ]
    trained = train_model(games, "rothstein")

    prediction = predict_matchup(
        games,
        away_team="MIN",
        home_team="CHI",
        spread_line=-2.5,
        total_line=48.5,
        model_profile="rothstein",
        trained_model=trained,
        upcoming_context=True,
    )

    assert prediction["spread_line"] == -2.5
    assert prediction["market_margin"] == 2.5
    assert prediction["pred_margin"] == pytest.approx(2.5)
    assert prediction["spread_edge"] == pytest.approx(0.0)
    assert prediction["spread_pick"] is None
    assert prediction["total_edge"] == pytest.approx(0.0)
    assert prediction["total_pick"] is None


def test_manual_matchup_can_apply_upcoming_rothstein_context_and_availability():
    games = [
        _history_game("2026_01_CAR_TB", 2026, 1, "CAR", "TB", 20, 17, spread_line=-1.5, total_line=43.5),
        _history_game("2026_01_NO_ATL", 2026, 1, "NO", "ATL", 17, 35, spread_line=2.5, total_line=44.5),
    ]
    scheduled = {"season": 2026, "week": 2, "game_id": "2026_02_CAR_ATL", "away_team": "CAR", "home_team": "ATL"}

    raw = predict_matchup(
        games,
        away_team="CAR",
        home_team="ATL",
        spread_line=2.5,
        total_line=43.5,
        model_profile="rothstein",
    )
    upcoming = predict_matchup(
        games,
        away_team="CAR",
        home_team="ATL",
        spread_line=2.5,
        total_line=43.5,
        model_profile="rothstein",
        upcoming_context=True,
    )
    adjusted = apply_upcoming_availability_adjustments(upcoming, scheduled, [{
        "season": 2026, "week": 2, "game_id": "2026_02_CAR_ATL", "team": "ATL",
        "margin_delta": -4.0, "total_delta": -2.5, "label": "ATL QB downgrade", "source": "unit-test",
    }])

    assert raw["pred_margin"] == pytest.approx(7.5)
    assert raw["pred_total"] == pytest.approx(44.5)
    assert upcoming["pred_margin"] == pytest.approx(-2.5)
    assert adjusted["pred_margin"] == pytest.approx(-6.5)
    assert adjusted["pred_total"] == pytest.approx(41.0)
    assert adjusted["availability_adjusted"] is True
    assert adjusted["winner_pick"] == "away"


def test_rothstein_plus_upcoming_low_confidence_is_visibly_ineligible():
    games = [
        _history_game("2026_01_MIN_GB", 2026, 1, "MIN", "GB", 60, 50, spread_line=-3.0, total_line=47.5),
        _history_game("2026_01_DET_CHI", 2026, 1, "DET", "CHI", 55, 60, spread_line=2.5, total_line=48.5),
    ]
    trained = train_model(games, "rothstein_plus")

    prediction = predict_matchup(
        games,
        away_team="MIN",
        home_team="CHI",
        spread_line=-2.5,
        total_line=48.5,
        model_profile="rothstein_plus",
        trained_model=trained,
        upcoming_context=True,
    )

    assert prediction["eligible"] is False
    assert prediction["display_suppressed"] is True
    assert prediction["spread_pick"] is None
    assert prediction["total_pick"] is None
    assert "hidden" in " ".join(prediction["model_notes"])


def test_upcoming_context_does_not_change_non_rothstein_models():
    games = [_graded_game(2025, "KC", "PHI"), _graded_game(2026, "KC", "PHI")]

    for model_profile in ("baseline", "enhanced", "market_blend", "rsm_stage7c"):
        normal = predict_matchup(
            games,
            away_team="KC",
            home_team="PHI",
            spread_line=-3.0,
            total_line=47.5,
            model_profile=model_profile,
        )
        upcoming = predict_matchup(
            games,
            away_team="KC",
            home_team="PHI",
            spread_line=-3.0,
            total_line=47.5,
            model_profile=model_profile,
            upcoming_context=True,
        )
        for key in ("pred_margin", "pred_total", "spread_edge", "total_edge", "spread_pick", "total_pick", "eligible"):
            assert upcoming[key] == normal[key]


def test_rsm_profile_maps_frozen_margin_to_experimental_winner_and_ats_projection():
    assert "rsm_stage7c" in MODEL_PROFILES
    games = [
        _graded_game(2025, "KC", "PHI"),
        _graded_game(2026, "KC", "PHI"),
    ]

    prediction = predict_matchup(
        games,
        away_team="KC",
        home_team="PHI",
        spread_line=-3.0,
        model_profile="rsm_stage7c",
        market_source="manual_test_source",
        market_observed_at="2026-09-13T12:00:00Z",
    )

    assert prediction["model"] == "rsm_stage7c"
    assert prediction["pred_total"] is not None
    assert prediction["total_pick"] in {"over", "under", None}
    assert prediction["total_line"] is None
    assert prediction["market_margin"] == 3.0
    assert prediction["spread_edge"] == pytest.approx(prediction["pred_margin"] - 3.0)
    assert prediction["spread_threshold"] == 0.0
    assert prediction["winner_pick"] == ("home" if prediction["pred_margin"] > 0 else "away")
    assert prediction["spread_pick"] == ("home" if prediction["spread_edge"] > 0 else "away")
    assert prediction["market_source"] == "manual_test_source"
    assert prediction["market_observed_at"] == "2026-09-13T12:00:00Z"
    assert prediction["lineup_confidence"] == "LOW"
    assert prediction["total_model_version"] == "RSM-v2 Stage7B Total diagnostic (experimental)"
    assert prediction["model_notes"]


def test_rsm_spread_sign_convention_and_exact_tie_abstention():
    # Conventional home -3 maps to a +3 expected home margin. A positive edge
    # chooses home; a negative edge chooses away; exact equality abstains.
    assert side_from_edge(2.0, threshold=0.0) == "home"
    assert side_from_edge(-2.0, threshold=0.0) == "away"
    assert side_from_edge(0.0, threshold=0.0) is None


def test_rsm_missing_market_line_has_no_ats_projection_or_total_pick():
    prediction = predict_matchup(
        [_graded_game(2025, "KC", "PHI"), _graded_game(2026, "KC", "PHI")],
        away_team="KC",
        home_team="PHI",
        spread_line=None,
        model_profile="rsm_stage7c",
    )
    assert prediction["market_margin"] is None
    assert prediction["spread_edge"] is None
    assert prediction["spread_pick"] is None
    assert prediction["pred_total"] is not None
    assert prediction["total_pick"] is None


def test_rsm_total_is_independent_of_market_total_and_grades_edge_at_zero():
    games = [_graded_game(2025, "KC", "PHI"), _graded_game(2026, "KC", "PHI")]
    without_line = predict_matchup(games, "KC", "PHI", model_profile="rsm_stage7c")
    with_line = predict_matchup(games, "KC", "PHI", total_line=without_line["pred_total"], model_profile="rsm_stage7c")

    assert without_line["pred_total"] == pytest.approx(with_line["pred_total"])
    assert without_line["total_edge"] is None
    assert without_line["total_pick"] is None
    assert with_line["total_edge"] == pytest.approx(0.0)
    assert with_line["total_pick"] is None


def test_rsm_missing_snapshot_team_fails_instead_of_fabricating_features():
    with pytest.raises(ValueError, match="snapshot ratings are unavailable"):
        RsmStage7CComparisonModel().predict({"home_team": "PHI", "away_team": "ZZZ"})


def test_historical_matchup_cache_reuses_all_pairs_cache(tmp_path, monkeypatch):
    games = [
        _history_game("2025_01_A_B", 2025, 1, "A", "B", 10, 20),
        _history_game("2025_02_C_D", 2025, 2, "C", "D", 17, 14),
    ]
    monkeypatch.setenv("NFL_HISTORY_CACHE_DIR", str(tmp_path))

    expected = matchup_history(games, "A", "B", "baseline")
    first_rows, first_hit = cached_matchup_history(games, "A", "B", "baseline")
    with monkeypatch.context() as nested:
        nested.setattr("nfl_predictor._build_all_matchup_history", lambda *_args, **_kwargs: pytest.fail("cache should be reused"))
        second_rows, second_hit = cached_matchup_history(games, "C", "D", "baseline")

    assert first_rows == expected
    assert first_hit is False
    assert second_hit is True
    assert [row["away_team"] for row in second_rows] == ["C"]


def test_historical_matchup_cache_invalidates_by_model_and_games(tmp_path, monkeypatch):
    games = [_history_game("2025_01_A_B", 2025, 1, "A", "B", 10, 20)]
    changed_games = [{**games[0], "home_score": 21.0, "actual_margin": 11.0, "actual_total": 31.0}]
    monkeypatch.setenv("NFL_HISTORY_CACHE_DIR", str(tmp_path))

    baseline_rows, baseline_hit = cached_matchup_history(games, "A", "B", "baseline")
    enhanced_rows, enhanced_hit = cached_matchup_history(games, "A", "B", "enhanced")
    changed_rows, changed_hit = cached_matchup_history(changed_games, "A", "B", "baseline")

    assert baseline_hit is False
    assert enhanced_hit is False
    assert changed_hit is False
    assert baseline_rows[0]["model"] == "baseline"
    assert enhanced_rows[0]["model"] == "enhanced"
    assert changed_rows[0]["home_score"] == 21.0


def test_historical_matchup_cache_rebuilds_malformed_cache(tmp_path, monkeypatch):
    games = [_history_game("2025_01_A_B", 2025, 1, "A", "B", 10, 20)]
    monkeypatch.setenv("NFL_HISTORY_CACHE_DIR", str(tmp_path))
    cache_path = tmp_path / "malformed.json"
    cache_path.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr("nfl_predictor._all_matchup_history_cache_path", lambda *_args: str(cache_path))

    rows, cache_hit = cached_matchup_history(games, "A", "B", "baseline")

    assert cache_hit is False
    assert rows == matchup_history(games, "A", "B", "baseline")


def test_historical_matchup_cache_preserves_response_shape_and_selected_spread(tmp_path, monkeypatch):
    games = [_history_game("2025_01_A_B", 2025, 1, "A", "B", 10, 20, spread_line=-3.0)]
    monkeypatch.setenv("NFL_HISTORY_CACHE_DIR", str(tmp_path))

    scheduled_rows, _ = cached_matchup_history(games, "A", "B", "baseline")
    reversed_rows, reversed_hit = cached_matchup_history(games, "B", "A", "baseline")

    assert set(scheduled_rows[0]) == set(matchup_history(games, "A", "B", "baseline")[0])
    assert scheduled_rows[0]["selected_home_spread"] == -3.0
    assert reversed_rows[0]["selected_home_spread"] == 3.0
    assert reversed_hit is True


def test_rsm_manual_capture_details_preserve_the_exact_frozen_feature_vector():
    details = RsmStage7CComparisonModel().prediction_details({"home_team": "PHI", "away_team": "KC", "home_rest": 7, "away_rest": 7})

    assert len(details["features"]) == 18
    assert list(details["features"]) == list(_rsm_artifact()["feature_names"])
    assert details["lineup_confidence"] == "LOW"
    assert "no prospective lineup verification" in details["lineup_source"]


def test_rsm_backtest_uses_committed_validation_rows_without_picks():
    games = [
        {
            **_graded_game(2023, "ARI", "WAS"),
            "game_id": "2023_01_ARI_WAS",
        }
    ]

    summary, records = run_backtest(games, seasons_to_test=1, model_profile="rsm_stage7c")

    assert records
    assert records[0]["spread_pick"] is None
    assert summary["games"] == 1
    assert summary["spread_bets"] == 0
    assert summary["margin_mae"] is not None


def test_weekly_model_performance_grades_displayed_week_only():
    games = [
        _history_game("2026_01_CAR_ATL", 2026, 1, "CAR", "ATL", 17, 20, spread_line=-2.5, total_line=42.5),
        _history_game("2026_02_TB_ATL", 2026, 2, "TB", "ATL", 21, 24, spread_line=1.5, total_line=44.5),
    ]

    performance = weekly_model_performance(games, 2026, 2, model_profiles=("baseline",))

    assert performance["season"] == 2026
    assert performance["week"] == 2
    assert performance["completed_games"] == 1
    assert len(performance["models"]) == 1
    row = performance["models"][0]
    assert row["model"] == "baseline"
    assert row["completed_games"] == 1
    assert row["spread_bets"] >= 0
    assert row["total_bets"] >= 0
    assert row["margin_mae"] is not None
    assert row["total_mae"] is not None


def test_weekly_model_performance_cache_reuses_and_invalidates(tmp_path, monkeypatch):
    games = [
        _history_game("2026_01_CAR_ATL", 2026, 1, "CAR", "ATL", 17, 20, spread_line=-2.5, total_line=42.5),
        _history_game("2026_02_TB_ATL", 2026, 2, "TB", "ATL", 21, 24, spread_line=1.5, total_line=44.5),
    ]
    monkeypatch.setenv("NFL_PERFORMANCE_CACHE_DIR", str(tmp_path))

    first, first_hit = cached_weekly_model_performance(games, 2026, 2, model_profiles=("baseline",))
    second, second_hit = cached_weekly_model_performance(games, 2026, 2, model_profiles=("baseline",))
    changed, changed_hit = cached_weekly_model_performance([{**games[1], "home_score": 31.0, "actual_margin": 10.0, "actual_total": 52.0}], 2026, 2, model_profiles=("baseline",))

    assert first_hit is False
    assert second_hit is True
    assert first == second
    assert changed_hit is False
    assert changed != first


def test_weekly_performance_trend_cache_reuses_and_invalidates(tmp_path, monkeypatch):
    games = [
        _history_game("2026_01_CAR_ATL", 2026, 1, "CAR", "ATL", 17, 20, spread_line=-2.5, total_line=42.5),
        _history_game("2026_02_TB_ATL", 2026, 2, "TB", "ATL", 21, 24, spread_line=1.5, total_line=44.5),
    ]
    monkeypatch.setenv("NFL_PERFORMANCE_CACHE_DIR", str(tmp_path))

    first, first_hit = cached_weekly_model_performance_trend(games, 2026, "baseline")
    second, second_hit = cached_weekly_model_performance_trend(games, 2026, "baseline")
    changed, changed_hit = cached_weekly_model_performance_trend([{**games[0], "home_score": 31.0, "actual_margin": 14.0, "actual_total": 48.0}, games[1]], 2026, "baseline")

    assert first_hit is False
    assert second_hit is True
    assert first == second
    assert changed_hit is False
    assert changed != first


def _signal_row(margins, totals=None, market_margin=-3.0, market_total=44.0, profiles=None):
    profiles = profiles or tuple(f"m{i}" for i in range(len(margins)))
    totals = totals if totals is not None else [market_total for _ in margins]
    return {
        "schedule": {
            "away_team": "CAR",
            "home_team": "ATL",
            "spread_line": market_margin,
            "total_line": market_total,
        },
        "models": {
            profile: {
                "model": profile,
                "away_team": "CAR",
                "home_team": "ATL",
                "pred_margin": margin,
                "pred_total": total,
            }
            for profile, margin, total in zip(profiles, margins, totals)
        },
    }


def test_model_signals_classify_strong_mixed_and_high_disagreement():
    strong = build_model_signals(_signal_row([-3.1, -3.4, -2.9]), ("m0", "m1", "m2"))
    mixed = build_model_signals(_signal_row([-5.0, -2.0, 3.0]), ("m0", "m1", "m2"))
    high = build_model_signals(_signal_row([-10.0, 8.0, 9.0, -7.0]), ("m0", "m1", "m2", "m3"))

    assert strong["agreement_label"] == "Strong agreement"
    assert mixed["agreement_label"] == "Mixed signals"
    assert high["agreement_label"] == "High disagreement"


def test_model_signals_market_favorite_sign_convention_for_away_favorite():
    signals = build_model_signals(_signal_row([-4.0, -5.0, 2.0], market_margin=-2.5), ("m0", "m1", "m2"))

    assert signals["models_favoring_market_favorite"] == 2
    assert signals["models_favoring_market_underdog"] == 1
    assert signals["market_alignment_label"] == "Models align with market"
    assert "Market favors CAR by 2.5" in signals["story"]


def test_model_signals_handle_missing_outputs_and_research_status_labels():
    row = _signal_row([1.0, 2.0], profiles=("dsm", "prm"))
    row["models"]["prm"]["display_suppressed"] = True

    signals = build_model_signals(row, ("dsm", "prm", "missing_model"))

    assert signals["agreement_label"] == "Insufficient model coverage"
    assert signals["models_without_output"] == 2
    assert signals["model_statuses"]["dsm"] == "Research only"
    assert signals["model_statuses"]["prm"] == "Research only"
    assert signals["included_models"][0]["model"] == "dsm"


def test_summary_reports_uncertainty_and_minus_110_roi():
    records = [
        {"spread_pick": "home", "spread_result": "win", "total_pick": None,
         "pred_margin": 3.0, "actual_margin": 4.0, "pred_total": 44.0, "actual_total": 45.0},
        {"spread_pick": "away", "spread_result": "loss", "total_pick": None,
         "pred_margin": -2.0, "actual_margin": 1.0, "pred_total": 43.0, "actual_total": 42.0},
    ]

    summary = summarize(records)

    assert summary["spread_losses"] == 1
    assert summary["spread_win_rate_ci95"][0] < 0.5 < summary["spread_win_rate_ci95"][1]
    assert summary["spread_roi_at_minus_110"] == pytest.approx(-0.0454545, abs=1e-7)
