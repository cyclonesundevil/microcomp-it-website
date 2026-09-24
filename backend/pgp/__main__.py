from __future__ import annotations

import argparse
import json
from pathlib import Path

from .data import DEFAULT_DRIVE_SUMMARIES_PATH, DEFAULT_GAMES_PATH, load_drive_summaries, load_games
from .evaluation import evaluate
from .reports import DEFAULT_REPORTS_DIR, write_evaluation_outputs
from .schema import InformationTier, PGPSimulationConfig


def main() -> None:
    parser = argparse.ArgumentParser(description="Research-only NFL Pre-Game Predictability tools")
    subparsers = parser.add_subparsers(dest="command", required=True)

    evaluate_parser = subparsers.add_parser("evaluate", help="Evaluate PGP tiers on a chronological test season")
    evaluate_parser.add_argument("--games", type=Path, default=DEFAULT_GAMES_PATH)
    evaluate_parser.add_argument("--train-through", type=int, required=True)
    evaluate_parser.add_argument("--test-season", type=int, required=True)
    evaluate_parser.add_argument("--tiers", nargs="+", type=int, default=[0, 1], choices=[0, 1])
    evaluate_parser.add_argument("--simulations", type=int, default=25_000)
    evaluate_parser.add_argument("--seed", type=int, default=12345)
    evaluate_parser.add_argument("--possessions-per-team", type=int, default=11)
    evaluate_parser.add_argument("--prior-source", choices=["score", "drive"], default="score")
    evaluate_parser.add_argument("--drive-summaries", type=Path, default=DEFAULT_DRIVE_SUMMARIES_PATH)
    evaluate_parser.add_argument("--output-dir", type=Path, default=DEFAULT_REPORTS_DIR)

    args = parser.parse_args()

    if args.command == "evaluate":
        config = PGPSimulationConfig(
            simulations=args.simulations,
            seed=args.seed,
            possessions_per_team=args.possessions_per_team,
            prior_source=args.prior_source,
        )
        drive_summaries = load_drive_summaries(args.drive_summaries) if args.prior_source == "drive" else None
        result = evaluate(
            load_games(args.games),
            train_through=args.train_through,
            test_season=args.test_season,
            tiers=[InformationTier(value) for value in args.tiers],
            config=config,
            drive_summaries=drive_summaries,
        )
        output = write_evaluation_outputs(result, args.output_dir)
    else:
        parser.error(f"Unknown command: {args.command}")

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
