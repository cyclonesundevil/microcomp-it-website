import argparse
import json
import os
from datetime import datetime
from pathlib import Path

from .config import DEFAULT_CONFIG
from .data import (
    DEFAULT_DATA_ROOT,
    enrich_roster_ids,
    load_current_roster,
    load_latest_depth_chart,
    load_player_stats,
    load_snap_counts,
    source_paths,
    update_sources,
)
from .ratings import build_player_ratings, build_team_ratings
from .reports import write_data_quality_report, write_player_report, write_snapshot, write_team_report
from .backtest import run_checkpoint_two
from .fitting import TrainingPlan, fit_rsm_v1, write_v1_artifacts
from .integrity_audit import audit_historical_integrity
from .locked_backtest import run_locked_backtest
from .stage6_diagnostics import run_stage6_diagnostics
from .stage7a_diagnostics import run_stage7a_diagnostics
from .stage7b_candidate import run_stage7b
from .stage7c_anomaly import run_stage7c
from .stage8_shadow import (
    DEFAULT_STORE,
    capture_observation,
    initialize_store,
    shadow_status,
    write_status_reports,
)
from .stage8a_capture import (
    DEFAULT_LOCK,
    DEFAULT_LOG,
    DEFAULT_STATE,
    CaptureConfig,
    FixtureProvider,
    health_report,
    readiness_result,
    run_capture_cycle,
    verify_frozen_baseline,
    write_readiness_reports,
)
from .stage8b_public_sources import (
    DEFAULT_PUBLIC_ROOT,
    audit_public_sources,
    public_health,
    sports_game_odds_market_dry_run,
    write_public_readiness,
)


def _environment_path(name: str, default: Path) -> Path:
    return Path(os.environ.get(name, str(default)))


def _stage8a_config(args: argparse.Namespace) -> CaptureConfig:
    return CaptureConfig(
        store_path=args.store, log_path=args.log, state_path=args.state, lock_path=args.lock,
        timeout_seconds=args.timeout, max_attempts=args.max_attempts,
        backoff_seconds=args.backoff, horizon_hours=args.horizon_hours,
        minimum_lead_minutes=args.minimum_lead_minutes,
        stale_lock_seconds=args.stale_lock_seconds,
    )


def build_checkpoint(data_root: Path, reports_root: Path, refresh: bool = False) -> None:
    config = DEFAULT_CONFIG
    manifest_path = data_root / "source-manifest.json"
    if refresh or not manifest_path.exists():
        manifest = update_sources(config.current_season, config.history_seasons, data_root, refresh=refresh)
    else:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    paths = source_paths(config.current_season, config.history_seasons, data_root)
    roster = enrich_roster_ids(load_current_roster(paths["roster"]), paths["players"])
    roster_timestamp, depth = load_latest_depth_chart(paths["depth"])
    stats = load_player_stats(paths["stats"], config.current_season, config.current_week)
    snaps = load_snap_counts(paths["snaps"], config.current_season, config.current_week)
    players = build_player_ratings(roster, stats, snaps, config)
    teams = build_team_ratings(roster, depth, players, roster_timestamp, config)

    write_player_report(reports_root / "rsm-player-ratings.csv", players, config)
    write_team_report(reports_root / "rsm-team-ratings.csv", teams, config)
    write_data_quality_report(
        reports_root / "rsm-data-quality.md", roster, depth, players, teams,
        roster_timestamp, config,
    )
    write_snapshot(data_root / "derived" / "rsm-checkpoint1.json", teams, manifest, config)
    print(f"RSM checkpoint one: {len(players)} players, {len(teams)} teams")
    print(f"Roster snapshot: {roster_timestamp}")
    print(f"Team report: {reports_root / 'rsm-team-ratings.csv'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="NFL Roster Strength Model tools")
    subparsers = parser.add_subparsers(dest="command", required=True)
    update = subparsers.add_parser("update-rosters", help="Refresh roster, depth-chart, stats, and snap sources")
    update.add_argument("--refresh", action="store_true")
    checkpoint = subparsers.add_parser("checkpoint-one", help="Generate PSR and 32-team unit ratings")
    checkpoint.add_argument("--refresh", action="store_true")
    checkpoint_two = subparsers.add_parser("checkpoint-two", help="Run unoptimized historical RSM-v0 scores")
    checkpoint_two.add_argument("--refresh", action="store_true")
    checkpoint_two.add_argument("--seasons", nargs="+", type=int, default=[2024, 2025])
    checkpoint_three = subparsers.add_parser("checkpoint-three", help="Fit RSM-v1 on development seasons")
    checkpoint_three.add_argument("--refresh", action="store_true")
    subparsers.add_parser("audit-history", help="Audit existing historical features without rebuilding RSM")
    subparsers.add_parser("locked-backtest", help="Apply frozen RSM-v1 to its locked test period")
    subparsers.add_parser("stage6-diagnostics", help="Diagnose frozen Stage 5 results without optimization")
    subparsers.add_parser("stage7a-diagnostics", help="Diagnose score compression and confidence inversion")
    stage7b = subparsers.add_parser("stage7b-candidate", help="Build the structural RSM-v2 candidate on development seasons")
    stage7b.add_argument("--rebuild-features", action="store_true")
    subparsers.add_parser("stage7c-anomaly", help="Evaluate frozen selective market-disagreement rules on 2023")
    stage8_init = subparsers.add_parser("stage8-shadow-init", help="Initialize the research-only prospective shadow ledger")
    stage8_init.add_argument("--store", type=Path, default=DEFAULT_STORE)
    stage8_capture = subparsers.add_parser("stage8-shadow-capture", help="Append one timestamped pre-kickoff shadow observation")
    stage8_capture.add_argument("input", type=Path)
    stage8_capture.add_argument("--store", type=Path, default=DEFAULT_STORE)
    stage8_status = subparsers.add_parser("stage8-shadow-status", help="Verify and summarize the append-only shadow ledger")
    stage8_status.add_argument("--store", type=Path, default=DEFAULT_STORE)
    stage8a_baseline = subparsers.add_parser("stage8a-baseline", help="Verify all frozen artifacts and the prospective ledger")
    stage8a_baseline.add_argument("--store", type=Path, default=_environment_path("RSM_STAGE8A_STORE", DEFAULT_STORE))
    stage8a_capture = subparsers.add_parser("stage8a-capture", help="Run one fixture-backed prospective capture cycle")
    stage8a_capture.add_argument("--fixture", type=Path, required=True)
    capture_mode = stage8a_capture.add_mutually_exclusive_group(required=True)
    capture_mode.add_argument("--dry-run", action="store_true")
    capture_mode.add_argument("--write", action="store_true")
    stage8a_capture.add_argument("--game")
    stage8a_capture.add_argument("--observed-at", help="Timezone-aware ISO-8601 cycle time; defaults to current UTC")
    stage8a_capture.add_argument("--store", type=Path, default=_environment_path("RSM_STAGE8A_STORE", DEFAULT_STORE))
    stage8a_capture.add_argument("--log", type=Path, default=_environment_path("RSM_STAGE8A_LOG", DEFAULT_LOG))
    stage8a_capture.add_argument("--state", type=Path, default=_environment_path("RSM_STAGE8A_STATE", DEFAULT_STATE))
    stage8a_capture.add_argument("--lock", type=Path, default=_environment_path("RSM_STAGE8A_LOCK", DEFAULT_LOCK))
    stage8a_capture.add_argument("--timeout", type=float, default=float(os.environ.get("RSM_STAGE8A_TIMEOUT_SECONDS", "10")))
    stage8a_capture.add_argument("--max-attempts", type=int, default=int(os.environ.get("RSM_STAGE8A_MAX_ATTEMPTS", "3")))
    stage8a_capture.add_argument("--backoff", type=float, default=float(os.environ.get("RSM_STAGE8A_BACKOFF_SECONDS", "0.25")))
    stage8a_capture.add_argument("--horizon-hours", type=float, default=float(os.environ.get("RSM_STAGE8A_HORIZON_HOURS", "30")))
    stage8a_capture.add_argument("--minimum-lead-minutes", type=float, default=float(os.environ.get("RSM_STAGE8A_MINIMUM_LEAD_MINUTES", "5")))
    stage8a_capture.add_argument("--stale-lock-seconds", type=float, default=float(os.environ.get("RSM_STAGE8A_STALE_LOCK_SECONDS", "900")))
    stage8a_health = subparsers.add_parser("stage8a-health", help="Read-only Stage 8A integrity and source-health report")
    stage8a_health.add_argument("--fixture", type=Path)
    stage8a_health.add_argument("--observed-at", help="Timezone-aware ISO-8601 health-check time")
    stage8a_health.add_argument("--store", type=Path, default=_environment_path("RSM_STAGE8A_STORE", DEFAULT_STORE))
    stage8a_health.add_argument("--state", type=Path, default=_environment_path("RSM_STAGE8A_STATE", DEFAULT_STATE))
    stage8a_health.add_argument("--timeout", type=float, default=float(os.environ.get("RSM_STAGE8A_TIMEOUT_SECONDS", "10")))
    stage8a_health.add_argument("--horizon-hours", type=float, default=float(os.environ.get("RSM_STAGE8A_HORIZON_HOURS", "30")))
    subparsers.add_parser("stage8a-readiness", help="Regenerate Stage 8A baseline and provider-readiness reports")
    stage8b_audit = subparsers.add_parser("stage8b-source-audit", help="Audit public-source policy, cache, and readiness")
    stage8b_audit.add_argument("--live", action="store_true", help="Retrieve only permitted nflverse and Sleeper public endpoints")
    stage8b_audit.add_argument("--public-root", type=Path, default=DEFAULT_PUBLIC_ROOT)
    stage8b_live = subparsers.add_parser("stage8b-live-dry-run", help="Fetch permitted public sources without ledger writes")
    stage8b_live.add_argument("--public-root", type=Path, default=DEFAULT_PUBLIC_ROOT)
    stage8b_market = subparsers.add_parser("stage8b-market-dry-run", help="Explicitly fetch one credentialed NFL market response without ledger writes")
    stage8b_market.add_argument("--public-root", type=Path, default=DEFAULT_PUBLIC_ROOT)
    stage8b_market.add_argument("--timeout", type=float, default=15)
    stage8b_rehearsal = subparsers.add_parser("stage8b-rehearsal", help="Write a redacted fixture to an isolated rehearsal ledger")
    stage8b_rehearsal.add_argument("--fixture", type=Path, required=True)
    stage8b_rehearsal.add_argument("--store", type=Path, required=True)
    stage8b_rehearsal.add_argument("--game")
    stage8b_health = subparsers.add_parser("stage8b-health", help="Read-only Stage 8A/8B health status")
    stage8b_health.add_argument("--public-root", type=Path, default=DEFAULT_PUBLIC_ROOT)
    subparsers.add_parser("stage8b-readiness", help="Regenerate Stage 8B public-source readiness reports")
    args = parser.parse_args()

    if args.command == "update-rosters":
        manifest = update_sources(
            DEFAULT_CONFIG.current_season,
            DEFAULT_CONFIG.history_seasons,
            DEFAULT_DATA_ROOT,
            refresh=args.refresh,
        )
        print(json.dumps({"files": len(manifest["files"]), "created_at": manifest["created_at"]}, indent=2))
    elif args.command == "checkpoint-one":
        reports_root = Path(__file__).resolve().parents[2] / "reports"
        build_checkpoint(DEFAULT_DATA_ROOT, reports_root, refresh=args.refresh)
    elif args.command == "checkpoint-two":
        reports_root = Path(__file__).resolve().parents[2] / "reports"
        _, summary = run_checkpoint_two(args.seasons, DEFAULT_DATA_ROOT, reports_root, refresh=args.refresh)
        print(json.dumps(summary, indent=2))
    elif args.command == "checkpoint-three":
        reports_root = Path(__file__).resolve().parents[2] / "reports"
        plan = TrainingPlan()
        development_seasons = [*plan.training_seasons, *plan.validation_seasons]
        records, _ = run_checkpoint_two(
            development_seasons,
            DEFAULT_DATA_ROOT,
            reports_root,
            refresh=args.refresh,
            report_stem="rsm-development-v0",
        )
        artifact, summary, predictions = fit_rsm_v1(records, plan, DEFAULT_CONFIG)
        write_v1_artifacts(reports_root, artifact, summary, predictions)
        print(json.dumps(summary, indent=2))
    elif args.command == "audit-history":
        reports_root = Path(__file__).resolve().parents[2] / "reports"
        summary = audit_historical_integrity(
            reports_root / "rsm-development-v0-predictions.csv",
            reports_root / "rsm-lineup-data-quality.md",
            DEFAULT_DATA_ROOT,
        )
        print(json.dumps(summary, indent=2))
    elif args.command == "locked-backtest":
        reports_root = Path(__file__).resolve().parents[2] / "reports"
        summary = run_locked_backtest(reports_root, DEFAULT_DATA_ROOT)
        print(json.dumps({
            "regular_season": summary["regular_season"],
            "playoffs": summary["playoffs"],
            "regular_exclusions": summary["regular_exclusions"],
            "playoff_exclusions": summary["playoff_exclusions"],
        }, indent=2))
    elif args.command == "stage6-diagnostics":
        reports_root = Path(__file__).resolve().parents[2] / "reports"
        summary = run_stage6_diagnostics(reports_root, DEFAULT_DATA_ROOT)
        print(json.dumps({
            "existing_predictor": summary["existing_predictor"],
            "rsm_v1": summary["rsm_v1"],
            "market": summary["market"],
        }, indent=2))
    elif args.command == "stage7a-diagnostics":
        reports_root = Path(__file__).resolve().parents[2] / "reports"
        summary = run_stage7a_diagnostics(reports_root)
        print(json.dumps({
            "scope": summary["scope"],
            "score_calibration_experiment": summary["score_calibration_experiment"],
            "probability_calibration_experiment": summary["probability_calibration_experiment"],
        }, indent=2))
    elif args.command == "stage7b-candidate":
        reports_root = Path(__file__).resolve().parents[2] / "reports"
        summary = run_stage7b(reports_root, DEFAULT_DATA_ROOT, rebuild_features=args.rebuild_features)
        total_summary = {
            key: value
            for key, value in summary["total_diagnostic"]["candidate"].items()
            if key != "predictions"
        }
        print(json.dumps({
            "scope": summary["scope"],
            "model_a": summary["model_a"]["validation"],
            "model_b": summary["model_b"]["validation"],
            "model_b_ats": summary["model_b"]["ats"],
            "total": total_summary,
        }, indent=2))
    elif args.command == "stage7c-anomaly":
        reports_root = Path(__file__).resolve().parents[2] / "reports"
        summary = run_stage7c(reports_root, DEFAULT_DATA_ROOT)
        print(json.dumps({
            "scope": summary["scope"],
            "frozen_rules": summary["frozen_rules"],
            "validation": summary["validation"],
            "production_ready": summary["production_ready"],
        }, indent=2))
    elif args.command == "stage8-shadow-init":
        reports_root = Path(__file__).resolve().parents[2] / "reports"
        initialize_store(args.store, reports_root)
        status = shadow_status(args.store, reports_root)
        write_status_reports(status, reports_root)
        print(json.dumps(status, indent=2))
    elif args.command == "stage8-shadow-capture":
        reports_root = Path(__file__).resolve().parents[2] / "reports"
        payload = json.loads(args.input.read_text(encoding="utf-8"))
        result = capture_observation(payload, args.store, reports_root)
        write_status_reports(shadow_status(args.store, reports_root), reports_root)
        print(json.dumps(result, indent=2))
    elif args.command == "stage8-shadow-status":
        reports_root = Path(__file__).resolve().parents[2] / "reports"
        initialize_store(args.store, reports_root)
        status = shadow_status(args.store, reports_root)
        write_status_reports(status, reports_root)
        print(json.dumps(status, indent=2))
    elif args.command == "stage8a-baseline":
        reports_root = Path(__file__).resolve().parents[2] / "reports"
        result = verify_frozen_baseline(args.store, reports_root)
        print(json.dumps(result, indent=2))
        if not result["passed"]:
            raise SystemExit(2)
    elif args.command == "stage8a-capture":
        reports_root = Path(__file__).resolve().parents[2] / "reports"
        if args.write and args.observed_at:
            parser.error("--observed-at is test-only and cannot be combined with --write")
        provider = FixtureProvider(args.fixture)
        observed_at = datetime.fromisoformat(args.observed_at.replace("Z", "+00:00")) if args.observed_at else None
        result = run_capture_cycle(
            provider, provider, provider, provider, _stage8a_config(args), reports_root,
            observed_at=observed_at, game_id=args.game, dry_run=args.dry_run,
        )
        print(json.dumps(result, indent=2))
        if not result["success"]:
            raise SystemExit(3)
    elif args.command == "stage8a-health":
        reports_root = Path(__file__).resolve().parents[2] / "reports"
        provider = FixtureProvider(args.fixture) if args.fixture else None
        observed_at = datetime.fromisoformat(args.observed_at.replace("Z", "+00:00")) if args.observed_at else None
        config = CaptureConfig(
            store_path=args.store, state_path=args.state, timeout_seconds=args.timeout,
            horizon_hours=args.horizon_hours,
        )
        result = health_report(config, reports_root, provider, observed_at)
        print(json.dumps(result, indent=2))
        if not result["healthy"]:
            raise SystemExit(4)
    elif args.command == "stage8a-readiness":
        repository_root = Path(__file__).resolve().parents[2]
        reports_root = repository_root / "reports"
        result = readiness_result(DEFAULT_STORE, reports_root, repository_root)
        write_readiness_reports(result, reports_root)
        print(json.dumps(result, indent=2))
    elif args.command == "stage8b-source-audit":
        repository_root = Path(__file__).resolve().parents[2]
        result = audit_public_sources(repository_root, live=args.live, root=args.public_root)
        print(json.dumps(result, indent=2))
        if not result["baseline"]["passed"]:
            raise SystemExit(2)
    elif args.command == "stage8b-live-dry-run":
        repository_root = Path(__file__).resolve().parents[2]
        result = audit_public_sources(repository_root, live=True, root=args.public_root)
        result["ledger_writes"] = 0
        print(json.dumps(result, indent=2))
        if not result["baseline"]["passed"]:
            raise SystemExit(2)
        if any(check["status"] == "FAILED" for check in result["source_checks"]):
            raise SystemExit(3)
    elif args.command == "stage8b-market-dry-run":
        result = sports_game_odds_market_dry_run(args.public_root, timeout=args.timeout)
        print(json.dumps(result, indent=2))
        if result["enabled"] and not result["accessed"]:
            raise SystemExit(3)
    elif args.command == "stage8b-rehearsal":
        reports_root = Path(__file__).resolve().parents[2] / "reports"
        if args.store.resolve() == DEFAULT_STORE.resolve():
            parser.error("Stage 8B rehearsal must use a separate non-default ledger")
        provider = FixtureProvider(args.fixture)
        config = CaptureConfig(
            store_path=args.store, log_path=args.store.with_suffix(".jsonl"),
            state_path=args.store.with_suffix(".state.json"), lock_path=args.store.with_suffix(".lock"),
        )
        result = run_capture_cycle(
            provider, provider, provider, provider, config, reports_root,
            game_id=args.game, dry_run=False,
        )
        result["rehearsal_only"] = True
        print(json.dumps(result, indent=2))
        if not result["success"]:
            raise SystemExit(3)
    elif args.command == "stage8b-health":
        repository_root = Path(__file__).resolve().parents[2]
        result = public_health(repository_root, args.public_root)
        print(json.dumps(result, indent=2))
        if not result["healthy"]:
            raise SystemExit(4)
    elif args.command == "stage8b-readiness":
        repository_root = Path(__file__).resolve().parents[2]
        reports_root = repository_root / "reports"
        result = audit_public_sources(repository_root, live=False)
        write_public_readiness(result, reports_root)
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
