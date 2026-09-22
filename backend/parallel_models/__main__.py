from __future__ import annotations

import argparse
import json
from pathlib import Path

from .backtest import DEFAULT_GAMES_PATH, DEFAULT_REPORTS_DIR, write_drive_model_backtest
from .nflverse_pbp import (
    DEFAULT_PARALLEL_DATA_ROOT,
    drive_summary_manifest_path,
    drive_summary_path,
    inspect_pbp_schema,
    pbp_paths_for_seasons,
    update_pbp_sources,
    write_drive_summaries,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Research-only parallel NFL model utilities")
    subparsers = parser.add_subparsers(dest="command", required=True)

    update = subparsers.add_parser("update-pbp", help="Download nflverse play-by-play CSVs into the research data root")
    update.add_argument("--seasons", nargs="+", type=int, required=True)
    update.add_argument("--data-root", type=Path, default=DEFAULT_PARALLEL_DATA_ROOT)
    update.add_argument("--refresh", action="store_true")

    inspect = subparsers.add_parser("inspect-pbp", help="Inspect local nflverse play-by-play CSV schemas")
    inspect.add_argument("--seasons", nargs="+", type=int, required=True)
    inspect.add_argument("--data-root", type=Path, default=DEFAULT_PARALLEL_DATA_ROOT)

    derive = subparsers.add_parser("derive-drives", help="Derive drive summaries from local nflverse play-by-play CSVs")
    derive.add_argument("--seasons", nargs="+", type=int, required=True)
    derive.add_argument("--data-root", type=Path, default=DEFAULT_PARALLEL_DATA_ROOT)
    derive.add_argument("--output", type=Path)
    derive.add_argument("--manifest", type=Path)

    evaluate = subparsers.add_parser("evaluate-drive-models", help="Evaluate research-only DSM/PRM baselines")
    evaluate.add_argument("--period", default="validation", choices=["train", "validation", "prospective"])
    evaluate.add_argument("--games", type=Path, default=DEFAULT_GAMES_PATH)
    evaluate.add_argument("--drive-summaries", type=Path, default=drive_summary_path())
    evaluate.add_argument("--output-dir", type=Path, default=DEFAULT_REPORTS_DIR)

    args = parser.parse_args()

    if args.command == "update-pbp":
        result = update_pbp_sources(args.seasons, args.data_root, refresh=args.refresh)
    elif args.command == "inspect-pbp":
        result = inspect_pbp_schema(pbp_paths_for_seasons(args.seasons, args.data_root))
    elif args.command == "derive-drives":
        output = args.output or drive_summary_path(args.data_root)
        manifest = args.manifest or drive_summary_manifest_path(args.data_root)
        result = write_drive_summaries(pbp_paths_for_seasons(args.seasons, args.data_root), output, manifest)
    elif args.command == "evaluate-drive-models":
        result = write_drive_model_backtest(
            games_path=args.games,
            drive_summaries_path=args.drive_summaries,
            output_dir=args.output_dir,
            period=args.period,
        )
    else:
        parser.error(f"Unknown command: {args.command}")

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
