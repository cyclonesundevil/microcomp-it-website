import csv
import hashlib
import html
import json
import os
import re
import time
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable, Iterable, Optional

from cache_io import atomic_write_json, read_json_or_none


ROSTER_CONTEXT_SCHEMA_VERSION = 2
TEAM_CODE_ALIASES = {
    "ARZ": "ARI",
    "JAC": "JAX",
    "LA": "LA",
    "LAR": "LA",
    "STL": "LA",
    "WSH": "WAS",
}
TEAM_NAME_TO_CODE = {
    "arizona cardinals": "ARI",
    "atlanta falcons": "ATL",
    "baltimore ravens": "BAL",
    "buffalo bills": "BUF",
    "carolina panthers": "CAR",
    "chicago bears": "CHI",
    "cincinnati bengals": "CIN",
    "cleveland browns": "CLE",
    "dallas cowboys": "DAL",
    "denver broncos": "DEN",
    "detroit lions": "DET",
    "green bay packers": "GB",
    "houston texans": "HOU",
    "indianapolis colts": "IND",
    "jacksonville jaguars": "JAX",
    "kansas city chiefs": "KC",
    "las vegas raiders": "LV",
    "los angeles chargers": "LAC",
    "los angeles rams": "LA",
    "miami dolphins": "MIA",
    "minnesota vikings": "MIN",
    "new england patriots": "NE",
    "new orleans saints": "NO",
    "new york giants": "NYG",
    "new york jets": "NYJ",
    "philadelphia eagles": "PHI",
    "pittsburgh steelers": "PIT",
    "san francisco 49ers": "SF",
    "seattle seahawks": "SEA",
    "tampa bay buccaneers": "TB",
    "tennessee titans": "TEN",
    "washington commanders": "WAS",
}
HIGH_IMPACT_EVENTS = {
    "QB1_OUT",
    "STARTER_CHANGED",
    "PLAYER_TO_IR",
    "PRACTICE_SQUAD_SIGNING",
    "DNP_TO_FULL",
    "LIMITED_TO_DNP",
    "UNIT_CLUSTER_INJURY",
}
IMPACT_POSITIONS = {"QB", "RB", "WR", "TE", "T", "G", "C", "OT", "OG", "OL", "CB", "S", "SAF", "DB", "EDGE", "DE", "DL", "DT", "OLB", "LB"}
DEFAULT_OFFICIAL_INJURY_REPORT_URLS = {
    "ARI": "https://www.azcardinals.com/team/injury-report/",
    "ATL": "https://www.atlantafalcons.com/team/injury-report/",
    "BAL": "https://www.baltimoreravens.com/team/injury-report/",
    "BUF": "https://www.buffalobills.com/team/injury-report/",
    "CAR": "https://www.panthers.com/team/injury-report/",
    "CHI": "https://www.chicagobears.com/team/injury-report/",
    "CIN": "https://www.bengals.com/team/injury-report/",
    "CLE": "https://www.clevelandbrowns.com/team/injury-report/",
    "DAL": "https://www.dallascowboys.com/team/injury-report/",
    "DEN": "https://www.denverbroncos.com/team/injury-report/",
    "DET": "https://www.detroitlions.com/team/injury-report/",
    "GB": "https://www.packers.com/team/injury-report/",
    "HOU": "https://www.houstontexans.com/team/injury-report/",
    "IND": "https://www.colts.com/team/injury-report/",
    "JAX": "https://www.jaguars.com/team/injury-report/",
    "KC": "https://www.chiefs.com/team/injury-report/",
    "LA": "https://www.therams.com/team/injury-report/",
    "LAC": "https://www.chargers.com/team/injury-report/",
    "LV": "https://www.raiders.com/team/injury-report/",
    "MIA": "https://www.miamidolphins.com/team/injury-report/",
    "MIN": "https://www.vikings.com/team/injury-report/",
    "NE": "https://www.patriots.com/team/injury-report/",
    "NO": "https://www.neworleanssaints.com/team/injury-report/",
    "NYG": "https://www.giants.com/team/injury-report/",
    "NYJ": "https://www.newyorkjets.com/team/injury-report/",
    "PHI": "https://www.philadelphiaeagles.com/team/injury-report/",
    "PIT": "https://www.steelers.com/team/injury-report/",
    "SEA": "https://www.seahawks.com/team/injury-report/",
    "SF": "https://www.49ers.com/team/injury-report/",
    "TB": "https://www.buccaneers.com/team/injury-report/",
    "TEN": "https://www.tennesseetitans.com/team/injury-report/",
    "WAS": "https://www.commanders.com/team/injury-report/",
}


@dataclass(frozen=True)
class RosterObservation:
    team: str
    player: str
    position: str = ""
    roster_status: str = ""
    injury_status: str = ""
    practice_status: str = ""
    expected_role: str = ""
    source_url: str = ""
    source_type: str = ""
    observed_at: str = ""
    confidence: str = "medium"

    def normalized_key(self) -> str:
        if self.source_type == "official_injury_report":
            return f"{self.team}|{_norm_name(self.player)}|{self.source_type}"
        return f"{self.team}|{_norm_name(self.player)}|{self.position}|{self.source_type}"


@dataclass(frozen=True)
class RosterEvent:
    event_type: str
    team: str
    player: str
    position: str = ""
    roster_status: str = ""
    injury_status: str = ""
    practice_status: str = ""
    expected_role: str = ""
    source_url: str = ""
    source_type: str = ""
    observed_at: str = ""
    confidence: str = "medium"
    description: str = ""
    previous: Optional[dict] = None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def canonical_team_code(team: Optional[str]) -> str:
    code = (team or "").strip().upper()
    return TEAM_CODE_ALIASES.get(code, code)


def roster_cache_root() -> Path:
    configured = os.getenv("NFL_ROSTER_CACHE_DIR", "").strip()
    if configured:
        return Path(configured)
    data_root = Path("/data") if os.path.isdir("/data") else Path(__file__).resolve().parent / "cache"
    return data_root / "nfl_roster"


def _team_cache_key(teams: Optional[Iterable[str]] = None) -> str:
    selected = sorted({canonical_team_code(team) for team in teams or [] if team})
    if not selected:
        return "all"
    digest = hashlib.sha1(",".join(selected).encode("utf-8")).hexdigest()[:12]
    return f"teams_{digest}"


def roster_snapshot_path(teams: Optional[Iterable[str]] = None) -> Path:
    return roster_cache_root() / f"roster_snapshot.{_team_cache_key(teams)}.json"


def roster_previous_snapshot_path(teams: Optional[Iterable[str]] = None) -> Path:
    return roster_cache_root() / f"roster_snapshot.{_team_cache_key(teams)}.previous.json"


def roster_context_ttl_seconds(now: Optional[datetime] = None) -> int:
    if os.getenv("NFL_ROSTER_CACHE_TTL_SECONDS"):
        return max(60, int(os.getenv("NFL_ROSTER_CACHE_TTL_SECONDS", "3600")))
    now = now or datetime.now(timezone.utc)
    # Game-day and late-week injury report windows should refresh more often.
    if now.weekday() == 6:
        return 30 * 60
    if now.weekday() in {2, 3, 4}:
        return 3 * 60 * 60
    return 6 * 60 * 60


def _read_url(url: str, timeout: int = 12) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "NFLPredictorRosterMonitor/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def _norm(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _norm_name(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _norm_status(value: object) -> str:
    return _norm(value).lower().replace("-", "_").replace(" ", "_")


def _hash_payload(payload: object) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _json_env_mapping(name: str) -> dict:
    raw = os.getenv(name, "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return {str(k).upper(): str(v) for k, v in parsed.items()} if isinstance(parsed, dict) else {}


def _split_table_row(line: str) -> list[str]:
    return [_norm(cell) for cell in line.strip().strip("|").split("|")]


def _strip_tags(value: str) -> str:
    return _norm(re.sub(r"<[^>]+>", " ", html.unescape(value)))


def _team_code_from_club_name(value: str) -> str:
    return TEAM_NAME_TO_CODE.get(_norm(value).lower(), "")


def _injury_report_html_sections(content: str) -> list[tuple[str, list[list[str]]]]:
    marker = "nfl-o-injury-report__container"
    if marker not in content or "nfl-o-injury-report__club-name" not in content:
        return []
    sections: list[tuple[str, list[list[str]]]] = []
    chunks = re.split(r'(?=<[^>]+class="[^"]*nfl-o-injury-report__container[^"]*")', content)
    for chunk in chunks:
        if marker not in chunk:
            continue
        club_match = re.search(
            r'class="[^"]*nfl-o-injury-report__club-name[^"]*"[^>]*>(.*?)</span>',
            chunk,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if not club_match:
            continue
        section_team = _team_code_from_club_name(_strip_tags(club_match.group(1)))
        if not section_team:
            continue
        rows = [row for row in html_table_rows(chunk) if len(row) >= 6]
        if rows:
            sections.append((section_team, rows))
    return sections


class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows: list[list[str]] = []
        self._in_cell = False
        self._current_cell: list[str] = []
        self._current_row: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._current_row = []
        if tag in {"td", "th"}:
            self._in_cell = True
            self._current_cell = []

    def handle_data(self, data):
        if self._in_cell:
            self._current_cell.append(data)

    def handle_endtag(self, tag):
        if tag in {"td", "th"} and self._in_cell:
            self._current_row.append(_norm(" ".join(self._current_cell)))
            self._in_cell = False
        if tag == "tr" and self._current_row:
            self.rows.append(self._current_row)
            self._current_row = []


def html_table_rows(content: str) -> list[list[str]]:
    parser = _TableParser()
    parser.feed(content)
    return parser.rows


def parse_official_injury_report(
    content: str,
    team: str,
    source_url: str,
    observed_at: Optional[str] = None,
) -> list[RosterObservation]:
    observed_at = observed_at or utc_now_iso()
    parsed_sections = _injury_report_html_sections(content)
    if not parsed_sections:
        rows: list[list[str]] = []
        lines = [html.unescape(line) for line in content.splitlines()]
        for line in lines:
            if "|" not in line:
                continue
            cells = _split_table_row(line)
            if len(cells) >= 6 and not set(cells) <= {"---", ""}:
                rows.append(cells)
        rows.extend(row for row in html_table_rows(content) if len(row) >= 6)
        parsed_sections = [(canonical_team_code(team), rows)]

    observations: list[RosterObservation] = []
    for section_team, rows in parsed_sections:
        for cells in rows:
            headerish = " ".join(cells).lower()
            if "player" in headerish and "injury" in headerish:
                continue
            if cells[0].startswith("---"):
                continue
            player, position, injury = cells[0], cells[1], cells[2]
            practice_cells = cells[3:-1] if len(cells) > 6 else cells[3:]
            game_status = cells[-1] if len(cells) >= 7 else ""
            practice_status = next((_norm(cell).upper() for cell in reversed(practice_cells) if _norm(cell) and _norm(cell) != "(-)"), "")
            if not player or not position or not injury:
                continue
            observations.append(RosterObservation(
                team=canonical_team_code(section_team),
                player=player,
                position=position.upper(),
                roster_status="active",
                injury_status=_norm(game_status if game_status and game_status not in {"(-)", "UNSPECIFIED"} else injury),
                practice_status=practice_status,
                expected_role=_infer_expected_role(position, player, practice_status, game_status),
                source_url=source_url,
                source_type="official_injury_report",
                observed_at=observed_at,
                confidence="high",
            ))
    return observations


def parse_official_transaction_text(
    content: str,
    team: str,
    source_url: str,
    observed_at: Optional[str] = None,
) -> list[RosterObservation]:
    observed_at = observed_at or utc_now_iso()
    text = _norm(re.sub(r"<[^>]+>", " ", html.unescape(content)))
    observations: list[RosterObservation] = []
    pos_pattern = r"(?P<pos>QB|quarterback|WR|wide receiver|RB|running back|TE|tight end|S|safety|CB|cornerback|LB|linebacker|OLB|DL|defensive lineman|DE|DT|OL|OT|G|C)"
    patterns = [
        (rf"placed\s+(?:third-year\s+|veteran\s+|rookie\s+)?(?:{pos_pattern}\s+)?(?P<player>[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){{1,3}})\s+on\s+(?:injured reserve|IR)", "injured_reserve", "PLAYER_TO_IR"),
        (rf"(?:signed|added|add)\s+(?:{pos_pattern}\s+)?(?P<player>[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){{1,3}})\s+to\s+(?:the\s+)?practice squad", "practice_squad", "PRACTICE_SQUAD_SIGNING"),
        (rf"promoted\s+(?:{pos_pattern}\s+)?(?P<player>[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){{1,3}})\s+to\s+(?:the\s+)?active roster", "active", "STARTER_CHANGED"),
    ]
    for pattern, roster_status, event_role in patterns:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            position = _normalize_position(match.groupdict().get("pos") or "")
            player = _clean_player_name(match.group("player"))
            if not player:
                continue
            observations.append(RosterObservation(
                team=team.upper(),
                player=player,
                position=position,
                roster_status=roster_status,
                injury_status="injured_reserve" if roster_status == "injured_reserve" else "",
                expected_role=event_role.lower(),
                source_url=source_url,
                source_type="official_transaction",
                observed_at=observed_at,
                confidence="high",
            ))

    starter_match = re.search(r"will\s+start\s+(?:rookie\s+|veteran\s+)?(?P<player>[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})\s+at\s+quarterback", text, flags=re.IGNORECASE)
    if starter_match:
        observations.append(RosterObservation(
            team=team.upper(),
            player=_clean_player_name(starter_match.group("player")),
            position="QB",
            roster_status="active",
            expected_role="projected_starter",
            source_url=source_url,
            source_type="official_transaction",
            observed_at=observed_at,
            confidence="high",
        ))
    return observations


def parse_nflverse_roster_csv(
    content: str,
    source_url: str,
    observed_at: Optional[str] = None,
) -> list[RosterObservation]:
    observed_at = observed_at or utc_now_iso()
    observations = []
    for row in csv.DictReader(content.splitlines()):
        team = (row.get("team") or row.get("recent_team") or "").upper()
        player = row.get("full_name") or row.get("player_name") or row.get("name") or ""
        if not team or not player:
            continue
        observations.append(RosterObservation(
            team=team,
            player=_norm(player),
            position=(row.get("position") or row.get("depth_chart_position") or "").upper(),
            roster_status=_norm_status(row.get("status") or row.get("roster_status") or ""),
            expected_role=_norm_status(row.get("depth_team") or row.get("depth_position") or row.get("depth_chart_position") or ""),
            source_url=source_url,
            source_type="nflverse_roster",
            observed_at=observed_at,
            confidence="medium",
        ))
    return observations


def _clean_player_name(value: str) -> str:
    value = _norm(value)
    value = re.sub(r"^(QB|WR|RB|TE|S|SAF|CB|LB|OLB|DL|DE|DT|OL|OT|G|C)\s+", "", value, flags=re.IGNORECASE)
    return value.strip(" .,")


def _normalize_position(value: str) -> str:
    lowered = _norm(value).lower()
    aliases = {
        "quarterback": "QB",
        "wide receiver": "WR",
        "running back": "RB",
        "tight end": "TE",
        "safety": "S",
        "cornerback": "CB",
        "linebacker": "LB",
        "defensive lineman": "DL",
    }
    return aliases.get(lowered, lowered.upper())


def _infer_expected_role(position: str, player: str, practice_status: str, game_status: str) -> str:
    pos = position.upper()
    unavailable = practice_status.upper() == "DNP" or _norm(game_status).upper() in {"OUT", "DOUBTFUL"}
    if pos == "QB" and unavailable:
        return "qb_unavailable"
    return ""


class RosterProvider:
    source_type = "unknown"

    def observations(self) -> list[RosterObservation]:
        raise NotImplementedError


class OfficialInjuryReportProvider(RosterProvider):
    source_type = "official_injury_report"

    def __init__(self, team_urls: dict[str, str], fetcher: Callable[[str], str] = _read_url):
        self.team_urls = {team.upper(): url for team, url in team_urls.items()}
        self.fetcher = fetcher

    def observations(self) -> list[RosterObservation]:
        output: list[RosterObservation] = []
        observed_at = utc_now_iso()
        for team, url in self.team_urls.items():
            output.extend(parse_official_injury_report(self.fetcher(url), team, url, observed_at))
        return output


class OfficialTransactionsProvider(RosterProvider):
    source_type = "official_transaction"

    def __init__(self, team_urls: dict[str, str], fetcher: Callable[[str], str] = _read_url):
        self.team_urls = {team.upper(): url for team, url in team_urls.items()}
        self.fetcher = fetcher

    def observations(self) -> list[RosterObservation]:
        output: list[RosterObservation] = []
        observed_at = utc_now_iso()
        for team, url in self.team_urls.items():
            output.extend(parse_official_transaction_text(self.fetcher(url), team, url, observed_at))
        return output


class NFLVerseRosterProvider(RosterProvider):
    source_type = "nflverse_roster"

    def __init__(self, urls: Iterable[str], fetcher: Callable[[str], str] = _read_url):
        self.urls = list(urls)
        self.fetcher = fetcher

    def observations(self) -> list[RosterObservation]:
        output: list[RosterObservation] = []
        observed_at = utc_now_iso()
        for url in self.urls:
            output.extend(parse_nflverse_roster_csv(self.fetcher(url), url, observed_at))
        return output


def configured_roster_providers(teams: Optional[Iterable[str]] = None) -> list[RosterProvider]:
    providers: list[RosterProvider] = []
    selected = {canonical_team_code(team) for team in teams or [] if team}
    injury_urls = _json_env_mapping("NFL_OFFICIAL_INJURY_REPORT_URLS")
    transaction_urls = _json_env_mapping("NFL_OFFICIAL_TRANSACTION_URLS")
    nflverse_urls = [url.strip() for url in os.getenv("NFLVERSE_ROSTER_URLS", "").split(",") if url.strip()]
    if not injury_urls and os.getenv("NFL_ROSTER_DISABLE_DEFAULT_INJURY_REPORTS", "").strip().lower() not in {"1", "true", "yes"}:
        injury_urls = dict(DEFAULT_OFFICIAL_INJURY_REPORT_URLS)
    if selected:
        injury_urls = {team: url for team, url in injury_urls.items() if team in selected}
        transaction_urls = {team: url for team, url in transaction_urls.items() if team in selected}
    if not nflverse_urls and os.getenv("NFL_ROSTER_DISABLE_DEFAULT_NFLVERSE", "").strip().lower() not in {"1", "true", "yes"}:
        season = datetime.now(timezone.utc).year
        nflverse_urls = [f"https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_{season}.csv"]
    if injury_urls:
        providers.append(OfficialInjuryReportProvider(injury_urls))
    if transaction_urls:
        providers.append(OfficialTransactionsProvider(transaction_urls))
    if nflverse_urls:
        providers.append(NFLVerseRosterProvider(nflverse_urls))
    return providers


def build_roster_snapshot(
    providers: Optional[list[RosterProvider]] = None,
    previous_snapshot: Optional[dict] = None,
    teams: Optional[Iterable[str]] = None,
) -> dict:
    providers = configured_roster_providers(teams) if providers is None else providers
    provider_errors = []
    observations: list[RosterObservation] = []
    for provider in providers:
        try:
            observations.extend(provider.observations())
        except Exception as exc:
            provider_errors.append({"provider": provider.source_type, "error": str(exc)})

    unique: dict[str, RosterObservation] = {}
    for observation in observations:
        unique[observation.normalized_key()] = observation
    observation_rows = sorted((asdict(item) for item in unique.values()), key=lambda row: (row["team"], row["player"], row["source_type"]))
    observation_hash = _hash_payload(observation_rows)
    events = diff_roster_snapshots(previous_snapshot or {}, observation_rows)
    generated_at = utc_now_iso()
    return {
        "schema_version": ROSTER_CONTEXT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "observation_hash": observation_hash,
        "providers": [provider.source_type for provider in providers],
        "provider_errors": provider_errors,
        "observations": observation_rows,
        "events": [asdict(event) for event in events],
        "event_count": len(events),
    }


def diff_roster_snapshots(previous_snapshot: dict, current_observations: list[dict]) -> list[RosterEvent]:
    previous_rows = previous_snapshot.get("observations") or []
    previous_by_player = {_player_key(row): row for row in previous_rows}
    events: list[RosterEvent] = []
    for row in current_observations:
        prior = previous_by_player.get(_player_key(row))
        events.extend(_current_row_events(row))
        if not prior:
            continue
        previous_practice = (prior.get("practice_status") or "").upper()
        current_practice = (row.get("practice_status") or "").upper()
        if previous_practice in {"DNP", "LP"} and current_practice == "FP":
            events.append(_event("DNP_TO_FULL", row, previous=prior) if previous_practice == "DNP" else _event("DNP_TO_FULL", row, previous=prior))
        if previous_practice == "LP" and current_practice == "DNP":
            events.append(_event("LIMITED_TO_DNP", row, previous=prior))
        previous_role = _norm_status(prior.get("expected_role"))
        current_role = _norm_status(row.get("expected_role"))
        if previous_role and current_role and previous_role != current_role:
            events.append(_event("STARTER_CHANGED", row, previous=prior))

    events.extend(_cluster_events(current_observations))
    return _dedupe_events(events)


def _player_key(row: dict) -> str:
    return f"{row.get('team', '').upper()}|{_norm_name(row.get('player'))}|{(row.get('position') or '').upper()}"


def _current_row_events(row: dict) -> list[RosterEvent]:
    events = []
    status = _norm_status(row.get("roster_status"))
    injury = _norm_status(row.get("injury_status"))
    practice = (row.get("practice_status") or "").upper()
    role = _norm_status(row.get("expected_role"))
    position = (row.get("position") or "").upper()
    if status in {"ir", "injured_reserve", "res", "reserve"} or injury in {"ir", "injured_reserve", "out"}:
        events.append(_event("PLAYER_TO_IR" if "reserve" in status or status in {"ir", "res"} else "QB1_OUT" if position == "QB" else "LIMITED_TO_DNP", row))
    if position == "QB" and (practice == "DNP" or "unavailable" in role or injury in {"out", "right_thumb"}):
        events.append(_event("QB1_OUT", row))
    if status == "practice_squad":
        events.append(_event("PRACTICE_SQUAD_SIGNING", row))
    if role in {"projected_starter", "starter_changed"}:
        events.append(_event("STARTER_CHANGED", row))
    return events


def _cluster_events(rows: list[dict]) -> list[RosterEvent]:
    by_team_unit: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        position = (row.get("position") or "").upper()
        if position not in IMPACT_POSITIONS:
            continue
        unavailable = (row.get("practice_status") or "").upper() == "DNP" or _norm_status(row.get("injury_status")) in {"out", "injured_reserve", "ir"}
        if unavailable:
            by_team_unit.setdefault((row.get("team", ""), _unit(position)), []).append(row)
    events = []
    for (team, unit), unit_rows in by_team_unit.items():
        if len(unit_rows) < 2:
            continue
        base = unit_rows[0]
        events.append(RosterEvent(
            event_type="UNIT_CLUSTER_INJURY",
            team=team,
            player=", ".join(row.get("player", "") for row in unit_rows[:4]),
            position=unit,
            source_url=base.get("source_url", ""),
            source_type=base.get("source_type", ""),
            observed_at=base.get("observed_at", ""),
            confidence="high" if all(row.get("confidence") == "high" for row in unit_rows) else "medium",
            description=f"{team} has {len(unit_rows)} unavailable or limited {unit} players.",
        ))
    return events


def _unit(position: str) -> str:
    if position in {"QB"}:
        return "QB"
    if position in {"RB", "WR", "TE"}:
        return "skill"
    if position in {"T", "G", "C", "OT", "OG", "OL"}:
        return "OL"
    if position in {"CB", "S", "SAF", "DB"}:
        return "secondary"
    return "front"


def _event(event_type: str, row: dict, previous: Optional[dict] = None) -> RosterEvent:
    return RosterEvent(
        event_type=event_type,
        team=row.get("team", ""),
        player=row.get("player", ""),
        position=row.get("position", ""),
        roster_status=row.get("roster_status", ""),
        injury_status=row.get("injury_status", ""),
        practice_status=row.get("practice_status", ""),
        expected_role=row.get("expected_role", ""),
        source_url=row.get("source_url", ""),
        source_type=row.get("source_type", ""),
        observed_at=row.get("observed_at", ""),
        confidence=row.get("confidence", "medium"),
        description=_event_description(event_type, row),
        previous=previous,
    )


def _event_description(event_type: str, row: dict) -> str:
    player = row.get("player") or "Unknown player"
    team = row.get("team") or "NFL"
    position = row.get("position") or "player"
    if event_type == "QB1_OUT":
        return f"{team} {position} {player} is unavailable or did not practice."
    if event_type == "STARTER_CHANGED":
        return f"{team} {position} {player} is tagged as a projected starter or role change."
    if event_type == "PLAYER_TO_IR":
        return f"{team} {position} {player} moved to injured reserve/reserve status."
    if event_type == "PRACTICE_SQUAD_SIGNING":
        return f"{team} {position} {player} was added to the practice squad."
    if event_type == "DNP_TO_FULL":
        return f"{team} {position} {player} improved from DNP/limited to full practice."
    if event_type == "LIMITED_TO_DNP":
        return f"{team} {position} {player} moved from limited to DNP."
    return f"{team} roster event for {player}."


def _dedupe_events(events: list[RosterEvent]) -> list[RosterEvent]:
    seen = set()
    output = []
    for event in events:
        if event.source_type == "official_injury_report":
            key = (event.event_type, event.team, _norm_name(event.player), event.source_type)
        else:
            key = (event.event_type, event.team, _norm_name(event.player), event.position, event.source_type)
        if key in seen:
            continue
        seen.add(key)
        output.append(event)
    return sorted(output, key=lambda event: (event.team, event.event_type, event.player))


def load_cached_roster_snapshot() -> Optional[dict]:
    return read_json_or_none(roster_snapshot_path())


def refresh_roster_snapshot(
    providers: Optional[list[RosterProvider]] = None,
    force: bool = False,
    ttl_seconds: Optional[int] = None,
    teams: Optional[Iterable[str]] = None,
) -> dict:
    path = roster_snapshot_path(teams)
    ttl_seconds = roster_context_ttl_seconds() if ttl_seconds is None else ttl_seconds
    cached = read_json_or_none(path)
    if cached and cached.get("schema_version") != ROSTER_CONTEXT_SCHEMA_VERSION:
        cached = None
    if cached and not force:
        age = max(0.0, time.time() - path.stat().st_mtime) if path.exists() else None
        if age is not None and age <= ttl_seconds:
            cached["cache_hit"] = True
            cached["cache_age_seconds"] = age
            cached["cache_ttl_seconds"] = ttl_seconds
            return cached

    previous = cached or read_json_or_none(roster_previous_snapshot_path(teams)) or {}
    snapshot = build_roster_snapshot(providers, previous, teams)
    snapshot["cache_hit"] = False
    snapshot["cache_age_seconds"] = 0.0
    snapshot["cache_ttl_seconds"] = ttl_seconds
    if cached:
        atomic_write_json(roster_previous_snapshot_path(teams), cached, indent=2, sort_keys=True)
    atomic_write_json(path, snapshot, indent=2, sort_keys=True)
    return snapshot


def roster_context_for_teams(
    teams: Iterable[str],
    force: bool = False,
    providers: Optional[list[RosterProvider]] = None,
) -> dict:
    requested = {team.upper() for team in teams if team}
    selected = {canonical_team_code(team) for team in requested}
    snapshot = refresh_roster_snapshot(providers=providers, force=force, teams=selected)
    events = [event for event in snapshot.get("events", []) if event.get("team") in selected and event.get("event_type") in HIGH_IMPACT_EVENTS]
    observations = [row for row in snapshot.get("observations", []) if row.get("team") in selected]
    events, suppressed_conflicts = _suppress_cross_team_event_conflicts(events)
    events.sort(key=lambda row: (row.get("confidence") != "high", row.get("team", ""), row.get("event_type", ""), row.get("player", "")))
    return {
        "teams": sorted(requested or selected),
        "canonical_teams": sorted(selected),
        "generated_at": snapshot.get("generated_at"),
        "observation_hash": snapshot.get("observation_hash"),
        "cache_hit": snapshot.get("cache_hit", False),
        "cache_age_seconds": snapshot.get("cache_age_seconds"),
        "cache_ttl_seconds": snapshot.get("cache_ttl_seconds"),
        "provider_errors": snapshot.get("provider_errors", []),
        "suppressed_conflicts": suppressed_conflicts,
        "events": events,
        "observations": observations,
        "summary": roster_context_summary(events),
    }


def _suppress_cross_team_event_conflicts(events: list[dict]) -> tuple[list[dict], list[dict]]:
    by_player: dict[tuple[str, str, str], set[str]] = {}
    for event in events:
        player = event.get("player") or ""
        if "," in player:
            continue
        key = (
            _norm_name(player),
            event.get("event_type") or "",
            event.get("source_type") or "",
        )
        if not key[0]:
            continue
        by_player.setdefault(key, set()).add(canonical_team_code(event.get("team")))

    conflict_keys = {key for key, teams in by_player.items() if len(teams) > 1}
    if not conflict_keys:
        return events, []

    conflict_players = {key[0] for key in conflict_keys}
    filtered = []
    suppressed = []
    for event in events:
        player_names = [_norm_name(name) for name in str(event.get("player") or "").split(",")]
        is_conflict = any(name in conflict_players for name in player_names if name)
        if is_conflict:
            suppressed.append({
                "event_type": event.get("event_type"),
                "team": event.get("team"),
                "player": event.get("player"),
                "position": event.get("position"),
                "source_type": event.get("source_type"),
                "reason": "same player attributed to multiple selected teams",
            })
            continue
        filtered.append(event)
    return filtered, suppressed


def roster_context_summary(events: list[dict]) -> list[str]:
    summary = []
    for event in events[:6]:
        source = event.get("source_type") or "source"
        confidence = event.get("confidence") or "medium"
        description = event.get("description") or event.get("event_type")
        summary.append(f"{description} Source: {source}; confidence: {confidence}.")
    return summary
