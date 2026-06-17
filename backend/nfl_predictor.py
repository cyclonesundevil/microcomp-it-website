import argparse
import csv
import os
import statistics
import urllib.request
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
DEFAULT_CACHE_PATH = os.path.join(os.path.dirname(__file__), "data", "nfl_games.csv")
MODEL_PROFILES = ("baseline", "enhanced")


def _to_float(value: str) -> Optional[float]:
    if value is None:
        return None
    value = str(value).strip()
    if value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _to_bool(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "t", "yes", "y"}


def _bounded_recent(values: List[float], value: float, limit: int = 4) -> None:
    values.append(value)
    if len(values) > limit:
        del values[0]


def _mean(values: List[float], default: float = 0.0) -> float:
    if not values:
        return default
    return statistics.mean(values)


def download_games(cache_path: str = DEFAULT_CACHE_PATH, refresh: bool = False) -> str:
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    if refresh or not os.path.exists(cache_path):
        with urllib.request.urlopen(GAMES_URL, timeout=60) as response:
            content = response.read()
        with open(cache_path, "wb") as f:
            f.write(content)
    return cache_path


def load_games(cache_path: str = DEFAULT_CACHE_PATH, refresh: bool = False) -> List[dict]:
    path = download_games(cache_path=cache_path, refresh=refresh)
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    games = []
    for row in rows:
        if row.get("game_type") != "REG":
            continue

        away_score = _to_float(row.get("away_score"))
        home_score = _to_float(row.get("home_score"))
        spread_line = _to_float(row.get("spread_line"))
        total_line = _to_float(row.get("total_line"))

        if away_score is None or home_score is None:
            continue
        if spread_line is None or total_line is None:
            continue

        row["season"] = int(row["season"])
        row["week"] = int(row["week"])
        row["away_score"] = away_score
        row["home_score"] = home_score
        row["actual_margin"] = home_score - away_score
        row["actual_total"] = home_score + away_score
        row["spread_line"] = spread_line
        row["total_line"] = total_line
        row["away_rest"] = _to_float(row.get("away_rest")) or 7.0
        row["home_rest"] = _to_float(row.get("home_rest")) or 7.0
        row["div_game"] = _to_bool(row.get("div_game"))
        row["roof"] = (row.get("roof") or "").strip().lower()
        row["surface"] = (row.get("surface") or "").strip().lower()
        row["temp"] = _to_float(row.get("temp"))
        row["wind"] = _to_float(row.get("wind"))
        games.append(row)

    games.sort(key=lambda g: (g["season"], g["week"], g.get("gameday") or "", g.get("game_id") or ""))
    return games


@dataclass
class TeamState:
    margin_rating: float = 0.0
    home_margin_rating: float = 0.0
    away_margin_rating: float = 0.0
    offense: float = 0.0
    defense_allowed: float = 0.0
    recent_margins: List[float] = field(default_factory=list)
    recent_totals: List[float] = field(default_factory=list)
    recent_points_for: List[float] = field(default_factory=list)
    recent_points_allowed: List[float] = field(default_factory=list)
    games: int = 0


@dataclass
class OnlineNFLModel:
    hfa_margin: float = 1.6
    hfa_points: float = 0.8
    rest_weight: float = 0.08
    split_weight: float = 0.35
    recent_margin_weight: float = 0.18
    recent_total_weight: float = 0.16
    divisional_margin_adjustment: float = -0.25
    divisional_total_adjustment: float = -0.75
    open_roof_total_adjustment: float = -0.35
    dome_total_adjustment: float = 0.45
    cold_degree_weight: float = 0.05
    wind_mph_weight: float = 0.12
    margin_lr: float = 0.045
    split_margin_lr: float = 0.025
    point_lr: float = 0.035
    mean_total: float = 44.0
    total_games: int = 0
    teams: Dict[str, TeamState] = field(default_factory=dict)

    def team(self, abbr: str) -> TeamState:
        if abbr not in self.teams:
            self.teams[abbr] = TeamState()
        return self.teams[abbr]

    def predict(self, game: dict) -> Tuple[float, float]:
        away = self.team(game["away_team"])
        home = self.team(game["home_team"])

        rest_edge = game["home_rest"] - game["away_rest"]
        recent_margin_edge = _mean(home.recent_margins) - _mean(away.recent_margins)
        predicted_margin = (
            self.hfa_margin
            + home.margin_rating
            - away.margin_rating
            + self.split_weight * (home.home_margin_rating - away.away_margin_rating)
            + self.recent_margin_weight * recent_margin_edge
            + self.rest_weight * rest_edge
        )
        if game["div_game"]:
            predicted_margin += self.divisional_margin_adjustment if predicted_margin > 0 else -self.divisional_margin_adjustment

        league_team_points = self.mean_total / 2
        home_recent_offense = _mean(home.recent_points_for)
        away_recent_offense = _mean(away.recent_points_for)
        home_recent_defense = _mean(home.recent_points_allowed)
        away_recent_defense = _mean(away.recent_points_allowed)
        predicted_home_points = (
            league_team_points
            + home.offense
            + away.defense_allowed
            + self.recent_total_weight * ((home_recent_offense + away_recent_defense) / 2 - league_team_points)
            + self.hfa_points
        )
        predicted_away_points = (
            league_team_points
            + away.offense
            + home.defense_allowed
            + self.recent_total_weight * ((away_recent_offense + home_recent_defense) / 2 - league_team_points)
            - self.hfa_points
        )
        predicted_total = predicted_home_points + predicted_away_points
        predicted_total += self.weather_total_adjustment(game, home, away)

        return predicted_margin, predicted_total

    def weather_total_adjustment(self, game: dict, home: TeamState, away: TeamState) -> float:
        adjustment = 0.0
        roof = game["roof"]
        if roof in {"dome", "closed"}:
            adjustment += self.dome_total_adjustment
        elif roof in {"outdoors", "open"}:
            adjustment += self.open_roof_total_adjustment
            if game["temp"] is not None and game["temp"] < 40:
                adjustment -= (40 - game["temp"]) * self.cold_degree_weight
            if game["wind"] is not None and game["wind"] > 10:
                adjustment -= (game["wind"] - 10) * self.wind_mph_weight

        if game["div_game"]:
            adjustment += self.divisional_total_adjustment

        recent_total_context = (_mean(home.recent_totals, self.mean_total) + _mean(away.recent_totals, self.mean_total)) / 2
        adjustment += self.recent_total_weight * (recent_total_context - self.mean_total)
        return adjustment

    def update(self, game: dict, predicted_margin: float, predicted_total: float) -> None:
        away = self.team(game["away_team"])
        home = self.team(game["home_team"])

        actual_margin = game["actual_margin"]
        actual_total = game["actual_total"]
        margin_error = actual_margin - predicted_margin

        home.margin_rating += self.margin_lr * margin_error
        away.margin_rating -= self.margin_lr * margin_error
        home.home_margin_rating += self.split_margin_lr * margin_error
        away.away_margin_rating -= self.split_margin_lr * margin_error

        predicted_home_points = (predicted_total + predicted_margin) / 2
        predicted_away_points = (predicted_total - predicted_margin) / 2

        home_off_error = game["home_score"] - predicted_home_points
        away_off_error = game["away_score"] - predicted_away_points

        home.offense += self.point_lr * home_off_error
        away.defense_allowed += self.point_lr * home_off_error
        away.offense += self.point_lr * away_off_error
        home.defense_allowed += self.point_lr * away_off_error

        home.games += 1
        away.games += 1
        _bounded_recent(home.recent_margins, actual_margin)
        _bounded_recent(away.recent_margins, -actual_margin)
        _bounded_recent(home.recent_totals, actual_total)
        _bounded_recent(away.recent_totals, actual_total)
        _bounded_recent(home.recent_points_for, game["home_score"])
        _bounded_recent(home.recent_points_allowed, game["away_score"])
        _bounded_recent(away.recent_points_for, game["away_score"])
        _bounded_recent(away.recent_points_allowed, game["home_score"])
        self.total_games += 1
        self.mean_total += 0.01 * (actual_total - self.mean_total)


def create_model(profile: str) -> OnlineNFLModel:
    if profile == "baseline":
        return OnlineNFLModel(
            split_weight=0.0,
            recent_margin_weight=0.0,
            recent_total_weight=0.0,
            divisional_margin_adjustment=0.0,
            divisional_total_adjustment=0.0,
            open_roof_total_adjustment=0.0,
            dome_total_adjustment=0.0,
            cold_degree_weight=0.0,
            wind_mph_weight=0.0,
            split_margin_lr=0.0,
        )
    if profile == "enhanced":
        return OnlineNFLModel()
    raise ValueError(f"Unknown model profile: {profile}")


def train_model(games: List[dict], model_profile: str = "baseline") -> OnlineNFLModel:
    model = create_model(model_profile)
    for game in games:
        pred_margin, pred_total = model.predict(game)
        model.update(game, pred_margin, pred_total)
    return model


def list_teams(games: List[dict], current_only: bool = False) -> List[str]:
    if current_only:
        latest_season = max(game["season"] for game in games)
        games = [game for game in games if game["season"] == latest_season]

    teams = set()
    for game in games:
        teams.add(game["away_team"])
        teams.add(game["home_team"])
    return sorted(teams)


def predict_matchup(
    games: List[dict],
    away_team: str,
    home_team: str,
    spread_line: float = 0.0,
    total_line: float = 44.5,
    model_profile: str = "baseline",
    home_rest: float = 7.0,
    away_rest: float = 7.0,
    div_game: bool = False,
    roof: str = "",
    temp: Optional[float] = None,
    wind: Optional[float] = None,
) -> dict:
    available_teams = set(list_teams(games))
    if away_team not in available_teams:
        raise ValueError(f"Unknown away_team: {away_team}")
    if home_team not in available_teams:
        raise ValueError(f"Unknown home_team: {home_team}")
    if away_team == home_team:
        raise ValueError("away_team and home_team must be different")

    model = train_model(games, model_profile=model_profile)
    game = {
        "away_team": away_team,
        "home_team": home_team,
        "away_rest": away_rest,
        "home_rest": home_rest,
        "div_game": div_game,
        "roof": roof,
        "temp": temp,
        "wind": wind,
    }
    pred_margin, pred_total = model.predict(game)
    spread_edge = pred_margin - spread_line
    total_edge = pred_total - total_line

    return {
        "model": model_profile,
        "away_team": away_team,
        "home_team": home_team,
        "pred_margin": pred_margin,
        "pred_total": pred_total,
        "spread_line": spread_line,
        "total_line": total_line,
        "spread_edge": spread_edge,
        "total_edge": total_edge,
        "spread_pick": side_from_edge(spread_edge, threshold=0.0),
        "total_pick": total_from_edge(total_edge, threshold=0.0),
        "latest_training_season": max(g["season"] for g in games),
    }


def side_from_edge(edge: float, threshold: float) -> Optional[str]:
    if edge > threshold:
        return "home"
    if edge < -threshold:
        return "away"
    return None


def total_from_edge(edge: float, threshold: float) -> Optional[str]:
    if edge > threshold:
        return "over"
    if edge < -threshold:
        return "under"
    return None


def score_binary(correct: int, pushes: int, bets: int) -> Optional[float]:
    graded = bets - pushes
    if graded <= 0:
        return None
    return correct / graded


def summarize(records: List[dict]) -> dict:
    spread_bets = [r for r in records if r["spread_pick"]]
    total_bets = [r for r in records if r["total_pick"]]

    spread_correct = sum(1 for r in spread_bets if r["spread_result"] == "win")
    spread_pushes = sum(1 for r in spread_bets if r["spread_result"] == "push")
    total_correct = sum(1 for r in total_bets if r["total_result"] == "win")
    total_pushes = sum(1 for r in total_bets if r["total_result"] == "push")

    margin_errors = [abs(r["pred_margin"] - r["actual_margin"]) for r in records]
    total_errors = [abs(r["pred_total"] - r["actual_total"]) for r in records]

    return {
        "games": len(records),
        "spread_bets": len(spread_bets),
        "spread_wins": spread_correct,
        "spread_pushes": spread_pushes,
        "spread_win_rate": score_binary(spread_correct, spread_pushes, len(spread_bets)),
        "total_bets": len(total_bets),
        "total_wins": total_correct,
        "total_pushes": total_pushes,
        "total_win_rate": score_binary(total_correct, total_pushes, len(total_bets)),
        "margin_mae": statistics.mean(margin_errors) if margin_errors else None,
        "total_mae": statistics.mean(total_errors) if total_errors else None,
    }


def summarize_by_season(records: List[dict]) -> List[Tuple[int, dict]]:
    seasons = sorted({r["season"] for r in records})
    return [(season, summarize([r for r in records if r["season"] == season])) for season in seasons]


def run_backtest(
    games: List[dict],
    seasons_to_test: int,
    spread_threshold: float = 1.5,
    total_threshold: float = 1.5,
    model_profile: str = "baseline",
) -> Tuple[dict, List[dict]]:
    completed_seasons = sorted({g["season"] for g in games})
    test_seasons = set(completed_seasons[-seasons_to_test:])

    model = create_model(model_profile)
    records = []

    for game in games:
        pred_margin, pred_total = model.predict(game)

        if game["season"] in test_seasons:
            spread_edge = pred_margin - game["spread_line"]
            total_edge = pred_total - game["total_line"]
            spread_pick = side_from_edge(spread_edge, spread_threshold)
            total_pick = total_from_edge(total_edge, total_threshold)

            spread_result = None
            if spread_pick:
                cover_margin = game["actual_margin"] - game["spread_line"]
                if abs(cover_margin) < 1e-9:
                    spread_result = "push"
                elif (spread_pick == "home" and cover_margin > 0) or (spread_pick == "away" and cover_margin < 0):
                    spread_result = "win"
                else:
                    spread_result = "loss"

            total_result = None
            if total_pick:
                total_margin = game["actual_total"] - game["total_line"]
                if abs(total_margin) < 1e-9:
                    total_result = "push"
                elif (total_pick == "over" and total_margin > 0) or (total_pick == "under" and total_margin < 0):
                    total_result = "win"
                else:
                    total_result = "loss"

            records.append({
                "season": game["season"],
                "week": game["week"],
                "game_id": game["game_id"],
                "model": model_profile,
                "away_team": game["away_team"],
                "home_team": game["home_team"],
                "pred_margin": pred_margin,
                "actual_margin": game["actual_margin"],
                "spread_line": game["spread_line"],
                "spread_edge": spread_edge,
                "spread_pick": spread_pick,
                "spread_result": spread_result,
                "pred_total": pred_total,
                "actual_total": game["actual_total"],
                "total_line": game["total_line"],
                "total_edge": total_edge,
                "total_pick": total_pick,
                "total_result": total_result,
            })

        model.update(game, pred_margin, pred_total)

    return summarize(records), records


def format_pct(value: Optional[float]) -> str:
    if value is None:
        return "n/a"
    return f"{value * 100:.1f}%"


def print_summary(label: str, summary: dict) -> None:
    print(f"\n{label}")
    print("-" * len(label))
    print(f"Games tested:     {summary['games']}")
    print(f"Spread bets:      {summary['spread_bets']} ({summary['spread_wins']} wins, {summary['spread_pushes']} pushes)")
    print(f"Spread win rate:  {format_pct(summary['spread_win_rate'])}")
    print(f"Total bets:       {summary['total_bets']} ({summary['total_wins']} wins, {summary['total_pushes']} pushes)")
    print(f"Total win rate:   {format_pct(summary['total_win_rate'])}")
    print(f"Margin MAE:       {summary['margin_mae']:.2f}")
    print(f"Total MAE:        {summary['total_mae']:.2f}")


def print_season_table(records: List[dict]) -> None:
    print("\nSeason breakdown")
    print("----------------")
    print("Season  Games  Spread   Totals    Margin MAE  Total MAE")
    for season, summary in summarize_by_season(records):
        print(
            f"{season:<7} "
            f"{summary['games']:<6} "
            f"{format_pct(summary['spread_win_rate']):<8} "
            f"{format_pct(summary['total_win_rate']):<8} "
            f"{summary['margin_mae']:<10.2f} "
            f"{summary['total_mae']:.2f}"
        )


def print_threshold_sweep(games: List[dict], thresholds: List[float], model_profile: str) -> None:
    print("\nThreshold sweep")
    print("---------------")
    print("Edge  Window  Spread bets  Spread win  Total bets  Total win")
    for threshold in thresholds:
        for seasons in (5, 10):
            summary, _ = run_backtest(
                games,
                seasons_to_test=seasons,
                spread_threshold=threshold,
                total_threshold=threshold,
                model_profile=model_profile,
            )
            print(
                f"{threshold:<5g} "
                f"{seasons:<7} "
                f"{summary['spread_bets']:<12} "
                f"{format_pct(summary['spread_win_rate']):<11} "
                f"{summary['total_bets']:<10} "
                f"{format_pct(summary['total_win_rate'])}"
            )


def write_records(path: str, records: List[dict]) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    fieldnames = [
        "season",
        "week",
        "game_id",
        "model",
        "away_team",
        "home_team",
        "pred_margin",
        "actual_margin",
        "spread_line",
        "spread_edge",
        "spread_pick",
        "spread_result",
        "pred_total",
        "actual_total",
        "total_line",
        "total_edge",
        "total_pick",
        "total_result",
    ]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)


def main() -> None:
    parser = argparse.ArgumentParser(description="Backtest NFL spread and totals predictions.")
    parser.add_argument("--refresh", action="store_true", help="Re-download nflverse games.csv")
    parser.add_argument("--seasons", type=int, nargs="+", default=[5, 10], help="Backtest windows to run")
    parser.add_argument("--model", choices=MODEL_PROFILES, default="baseline", help="Model profile to backtest")
    parser.add_argument("--spread-threshold", type=float, default=5.0)
    parser.add_argument("--total-threshold", type=float, default=1.5)
    parser.add_argument("--by-season", action="store_true", help="Print per-season results for each window")
    parser.add_argument("--sweep", action="store_true", help="Print a threshold sweep for 5- and 10-year windows")
    parser.add_argument("--compare-models", action="store_true", help="Compare baseline and enhanced model profiles")
    parser.add_argument("--export", help="Write the largest backtest window to a CSV file")
    args = parser.parse_args()

    games = load_games(refresh=args.refresh)
    print(f"Loaded {len(games)} regular-season games with scores, spread_line, and total_line.")
    print(f"Data source: {GAMES_URL}")
    print(f"Seasons: {min(g['season'] for g in games)}-{max(g['season'] for g in games)}")
    print(f"Model profile: {args.model}")
    print(f"Spread pick threshold: {args.spread_threshold:.1f} points")
    print(f"Total pick threshold:  {args.total_threshold:.1f} points")

    if args.compare_models:
        print("\nModel comparison")
        print("----------------")
        print("Model     Window  Spread bets  Spread win  Total bets  Total win  Margin MAE  Total MAE")
        for profile in MODEL_PROFILES:
            for seasons in args.seasons:
                summary, _ = run_backtest(
                    games,
                    seasons_to_test=seasons,
                    spread_threshold=args.spread_threshold,
                    total_threshold=args.total_threshold,
                    model_profile=profile,
                )
                print(
                    f"{profile:<9} "
                    f"{seasons:<7} "
                    f"{summary['spread_bets']:<12} "
                    f"{format_pct(summary['spread_win_rate']):<11} "
                    f"{summary['total_bets']:<10} "
                    f"{format_pct(summary['total_win_rate']):<10} "
                    f"{summary['margin_mae']:<10.2f} "
                    f"{summary['total_mae']:.2f}"
                )

    largest_window_records = []
    for seasons in args.seasons:
        summary, records = run_backtest(
            games,
            seasons_to_test=seasons,
            spread_threshold=args.spread_threshold,
            total_threshold=args.total_threshold,
            model_profile=args.model,
        )
        print_summary(f"Last {seasons} completed seasons", summary)
        if args.by_season:
            print_season_table(records)
        if seasons == max(args.seasons):
            largest_window_records = records

    if args.export:
        write_records(args.export, largest_window_records)
        print(f"\nExported {len(largest_window_records)} prediction rows to {args.export}")

    if args.sweep:
        print_threshold_sweep(games, thresholds=[0, 1, 1.5, 2, 3, 4, 5, 7, 10], model_profile=args.model)


if __name__ == "__main__":
    main()
