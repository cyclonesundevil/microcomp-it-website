import os
from datetime import datetime, time as datetime_time, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


NFL_WEEK_ROLLOVER_TIMEZONE = "America/Los_Angeles"
NFL_WEEK_ROLLOVER_HOUR = 21


def nfl_week_rollover_zone():
    configured = os.getenv("NFL_WEEK_ROLLOVER_TIMEZONE", NFL_WEEK_ROLLOVER_TIMEZONE).strip() or NFL_WEEK_ROLLOVER_TIMEZONE
    try:
        return ZoneInfo(configured)
    except ZoneInfoNotFoundError:
        return timezone.utc


def nfl_week_rollover_hour() -> int:
    try:
        return min(23, max(0, int(os.getenv("NFL_WEEK_ROLLOVER_HOUR", str(NFL_WEEK_ROLLOVER_HOUR)))))
    except ValueError:
        return NFL_WEEK_ROLLOVER_HOUR


def parse_gameday(value: str):
    try:
        return datetime.strptime(str(value or "").strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


def football_week_start_for_gameday(gameday):
    days_since_tuesday = (gameday.weekday() - 1) % 7
    return gameday - timedelta(days=days_since_tuesday)


def football_week_start(schedule: dict):
    gameday = parse_gameday((schedule or {}).get("gameday"))
    return football_week_start_for_gameday(gameday).isoformat() if gameday else None


def tuesday_rollover_before(gameday, rollover_zone):
    return datetime.combine(
        football_week_start_for_gameday(gameday),
        datetime_time(hour=nfl_week_rollover_hour()),
        tzinfo=rollover_zone,
    )


def current_nfl_schedule_week(rows: list[dict], season: Optional[int] = None, now: Optional[datetime] = None) -> int:
    """Resolve the current NFL week from the configured Tuesday rollover time."""
    target_season = season or max(int(row["season"]) for row in rows if row.get("season"))
    rollover_zone = nfl_week_rollover_zone()
    current_time = now or datetime.now(rollover_zone)
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=rollover_zone)
    else:
        current_time = current_time.astimezone(rollover_zone)

    week_rollovers = []
    for row in rows:
        if row.get("game_type") != "REG" or int(row.get("season", 0)) != target_season or not row.get("week"):
            continue
        gameday = parse_gameday(row.get("gameday"))
        if gameday is None:
            continue
        week_rollovers.append((int(row["week"]), tuesday_rollover_before(gameday, rollover_zone)))

    if not week_rollovers:
        return 1

    started_weeks = [week for week, rollover_at in week_rollovers if rollover_at <= current_time]
    if started_weeks:
        return max(started_weeks)
    return min(week for week, _rollover_at in week_rollovers)
