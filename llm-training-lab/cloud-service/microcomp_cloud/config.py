"""Environment-backed, fail-closed cloud service configuration."""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path


class SettingsError(ValueError):
    """Raised when a deployment setting violates a service safety bound."""


def _integer(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except ValueError as error:
        raise SettingsError(f"{name} must be an integer.") from error
    if not minimum <= value <= maximum:
        raise SettingsError(f"{name} must be between {minimum} and {maximum}.")
    return value


@dataclass(frozen=True)
class Settings:
    api_key: str
    data_root: Path
    inactivity_ttl_seconds: int = 3600
    maximum_lifetime_seconds: int = 21600
    cleanup_interval_seconds: int = 30
    maximum_concurrent_jobs: int = 1
    maximum_queued_jobs: int = 8
    maximum_jobs_per_session: int = 2
    maximum_training_steps: int = 500
    maximum_batch_size: int = 8
    maximum_request_bytes: int = 65_536
    maximum_job_disk_bytes: int = 20 * 1024 * 1024
    maximum_estimated_memory_bytes: int = 384 * 1024 * 1024
    maximum_events_per_job: int = 512
    rate_limit_requests: int = 60
    rate_limit_window_seconds: int = 60
    torch_threads: int = 1
    log_level: str = "INFO"
    cors_origins: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if len(self.api_key) < 24:
            raise SettingsError("MICROCOMP_CLOUD_API_KEY must contain at least 24 characters.")
        if self.inactivity_ttl_seconds > self.maximum_lifetime_seconds:
            raise SettingsError("Inactivity TTL cannot exceed maximum job lifetime.")
        resolved = self.data_root.expanduser().resolve()
        if resolved == Path(resolved.anchor):
            raise SettingsError("MICROCOMP_CLOUD_DATA_ROOT cannot be a filesystem root.")
        object.__setattr__(self, "data_root", resolved)

    @classmethod
    def from_environment(cls) -> "Settings":
        key = os.getenv("MICROCOMP_CLOUD_API_KEY", "")
        root = Path(os.getenv(
            "MICROCOMP_CLOUD_DATA_ROOT",
            str(Path(tempfile.gettempdir()) / "microcomp-llm-cloud"),
        ))
        origins = tuple(
            item.strip()
            for item in os.getenv("MICROCOMP_CLOUD_CORS_ORIGINS", "").split(",")
            if item.strip()
        )
        return cls(
            api_key=key,
            data_root=root,
            inactivity_ttl_seconds=_integer(
                "MICROCOMP_CLOUD_INACTIVITY_TTL_SECONDS", 3600, 60, 21600
            ),
            maximum_lifetime_seconds=_integer(
                "MICROCOMP_CLOUD_MAX_LIFETIME_SECONDS", 21600, 300, 21600
            ),
            cleanup_interval_seconds=_integer(
                "MICROCOMP_CLOUD_CLEANUP_INTERVAL_SECONDS", 30, 5, 300
            ),
            maximum_concurrent_jobs=_integer(
                "MICROCOMP_CLOUD_MAX_CONCURRENT_JOBS", 1, 1, 4
            ),
            maximum_queued_jobs=_integer(
                "MICROCOMP_CLOUD_MAX_QUEUED_JOBS", 8, 1, 32
            ),
            maximum_jobs_per_session=_integer(
                "MICROCOMP_CLOUD_MAX_JOBS_PER_SESSION", 2, 1, 8
            ),
            maximum_training_steps=_integer(
                "MICROCOMP_CLOUD_MAX_TRAINING_STEPS", 500, 1, 2000
            ),
            maximum_batch_size=_integer(
                "MICROCOMP_CLOUD_MAX_BATCH_SIZE", 8, 1, 16
            ),
            maximum_request_bytes=_integer(
                "MICROCOMP_CLOUD_MAX_REQUEST_BYTES", 65_536, 1024, 1_048_576
            ),
            maximum_job_disk_bytes=_integer(
                "MICROCOMP_CLOUD_MAX_JOB_DISK_BYTES",
                20 * 1024 * 1024,
                1_048_576,
                20 * 1024 * 1024,
            ),
            maximum_estimated_memory_bytes=_integer(
                "MICROCOMP_CLOUD_MAX_ESTIMATED_MEMORY_BYTES",
                384 * 1024 * 1024,
                64 * 1024 * 1024,
                2 * 1024 * 1024 * 1024,
            ),
            maximum_events_per_job=_integer(
                "MICROCOMP_CLOUD_MAX_EVENTS_PER_JOB", 512, 32, 2048
            ),
            rate_limit_requests=_integer(
                "MICROCOMP_CLOUD_RATE_LIMIT_REQUESTS", 60, 1, 1000
            ),
            rate_limit_window_seconds=_integer(
                "MICROCOMP_CLOUD_RATE_LIMIT_WINDOW_SECONDS", 60, 1, 3600
            ),
            torch_threads=_integer("MICROCOMP_CLOUD_TORCH_THREADS", 1, 1, 8),
            log_level=os.getenv("MICROCOMP_CLOUD_LOG_LEVEL", "INFO").upper(),
            cors_origins=origins,
        )
