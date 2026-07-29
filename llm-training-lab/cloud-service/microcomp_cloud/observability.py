"""Bounded JSON logging without credentials or user prompt contents."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        value: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        structured = getattr(record, "structured", None)
        if isinstance(structured, dict):
            value.update(structured)
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)


def append_job_log(path: Path | None, event: dict[str, Any], maximum_bytes: int = 1_048_576) -> None:
    if path is None:
        return
    try:
        if path.exists() and path.stat().st_size >= maximum_bytes:
            return
        safe = {
            key: value for key, value in event.items()
            if key not in {"sample", "final_sample", "prompt", "generated_text"}
        }
        with path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(safe, separators=(",", ":"), ensure_ascii=False))
            handle.write("\n")
    except OSError:
        logging.getLogger(__name__).warning("job_log_write_failed")
