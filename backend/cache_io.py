import json
import os
import pickle
import time
from pathlib import Path
from typing import Any


def atomic_write_json(path: str | Path, payload: Any, **json_kwargs) -> None:
    target_path = Path(path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = target_path.with_name(f"{target_path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    try:
        with temporary_path.open("w", encoding="utf-8") as target:
            json.dump(payload, target, **json_kwargs)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary_path, target_path)
    except OSError:
        try:
            temporary_path.unlink()
        except OSError:
            pass
        raise


def atomic_write_pickle(path: str | Path, payload: Any) -> None:
    target_path = Path(path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = target_path.with_name(f"{target_path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    try:
        with temporary_path.open("wb") as target:
            pickle.dump(payload, target, protocol=pickle.HIGHEST_PROTOCOL)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary_path, target_path)
    except OSError:
        try:
            temporary_path.unlink()
        except OSError:
            pass
        raise


def read_json_or_none(path: str | Path):
    try:
        with Path(path).open(encoding="utf-8") as source:
            return json.load(source)
    except (OSError, json.JSONDecodeError):
        return None
