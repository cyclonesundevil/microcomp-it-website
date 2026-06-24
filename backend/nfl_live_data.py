import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests


ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"


def _team_abbr(competitor: Dict[str, Any]) -> str:
    team = competitor.get("team") or {}
    return (team.get("abbreviation") or team.get("shortDisplayName") or team.get("displayName") or "").upper()


def _team_score(competitor: Dict[str, Any]) -> Optional[int]:
    score = competitor.get("score")
    if score in (None, ""):
        return None
    try:
        return int(score)
    except (TypeError, ValueError):
        return None


def fetch_espn_scoreboard() -> Dict[str, Any]:
    response = requests.get(ESPN_SCOREBOARD_URL, timeout=12)
    response.raise_for_status()
    payload = response.json()
    events: List[Dict[str, Any]] = []

    for event in payload.get("events", []):
        competition = (event.get("competitions") or [{}])[0]
        competitors = competition.get("competitors") or []
        home = next((item for item in competitors if item.get("homeAway") == "home"), {})
        away = next((item for item in competitors if item.get("homeAway") == "away"), {})
        status = competition.get("status") or event.get("status") or {}
        status_type = status.get("type") or {}

        events.append({
            "id": event.get("id"),
            "name": event.get("name"),
            "short_name": event.get("shortName"),
            "date": event.get("date"),
            "home_team": _team_abbr(home),
            "away_team": _team_abbr(away),
            "home_score": _team_score(home),
            "away_score": _team_score(away),
            "status": status_type.get("description") or status_type.get("name"),
            "state": status_type.get("state"),
            "completed": bool(status_type.get("completed")),
            "clock": status.get("displayClock"),
            "period": status.get("period"),
            "venue": ((competition.get("venue") or {}).get("fullName")),
        })

    return {
        "success": True,
        "enabled": True,
        "provider": "espn",
        "source": ESPN_SCOREBOARD_URL,
        "fetched_at_utc": datetime.now(timezone.utc).isoformat(),
        "season": payload.get("season"),
        "week": payload.get("week"),
        "events": events,
        "coverage": {
            "live_scores": True,
            "live_odds": False,
            "injuries": False,
            "official_contract": False,
        },
    }


def live_scoreboard() -> Dict[str, Any]:
    live_provider = os.getenv("NFL_LIVE_PROVIDER", "off").strip().lower()
    if live_provider in {"", "off", "disabled", "none"}:
        return {
            "success": True,
            "enabled": False,
            "provider": live_provider or "off",
            "events": [],
            "coverage": {
                "live_scores": False,
                "live_odds": False,
                "injuries": False,
                "official_contract": False,
            },
            "message": "Set NFL_LIVE_PROVIDER=espn to enable the optional live scoreboard adapter.",
        }

    if live_provider == "espn":
        return fetch_espn_scoreboard()

    return {
        "success": False,
        "enabled": False,
        "provider": live_provider,
        "events": [],
        "message": f"Unsupported NFL_LIVE_PROVIDER: {live_provider}",
    }
