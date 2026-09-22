from __future__ import annotations

import argparse
import json
from pathlib import Path

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

    args = parser.parse_args()

    if args.command == "update-pbp":
        result = update_pbp_sources(args.seasons, args.data_root, refresh=args.refresh)
    elif args.command == "inspect-pbp":
        result = inspect_pbp_schema(pbp_paths_for_seasons(args.seasons, args.data_root))
    elif args.command == "derive-drives":
        output = args.output or drive_summary_path(args.data_root)
        manifest = args.manifest or drive_summary_manifest_path(args.data_root)
        result = write_drive_summaries(pbp_paths_for_seasons(args.seasons, args.data_root), output, manifest)
    else:
        parser.error(f"Unknown command: {args.command}")

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
