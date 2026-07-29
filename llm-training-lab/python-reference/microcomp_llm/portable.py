"""Safe declarative checkpoint and .mcllm package I/O.

Weights are concatenated little-endian float32 tensors. No pickle or executable
framework serialization is accepted.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
import stat
import struct
import tempfile
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

import torch

from .config import (
    ARCHITECTURE_ID,
    FORMAT_VERSION,
    MAX_TRAINABLE_PARAMETERS,
    TRAINING_ENGINE_ID,
    ModelConfig,
    TrainingConfig,
)
from .model import TinyDecoderLM
from .parameters import actual_trainable_parameters, count_parameters
from .tokenizer import CharacterTokenizer

EXPECTED_FILES = {
    "manifest.json",
    "tokenizer.json",
    "training-config.json",
    "training-history.json",
    "weights.bin",
}
MAX_PACKAGE_BYTES = 20 * 1024 * 1024
MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_TENSORS = 256
MAX_HISTORY_EVENTS = 250
MAX_HISTORY_SAMPLE_CHARACTERS = 4_608
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
ENGINE_IDENTIFIER_PATTERN = re.compile(
    r"^[a-z0-9][a-z0-9._-]*-(?:v)?[0-9]+\.[0-9]+\.[0-9]+$"
)


class PackageValidationError(ValueError):
    """Raised when a checkpoint/package fails its strict declarative schema."""


def _json_bytes(value: object) -> bytes:
    return (json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode(
        "utf-8"
    )


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _validate_sha256(value: object, field: str) -> str:
    if not isinstance(value, str) or SHA256_PATTERN.fullmatch(value) is None:
        raise PackageValidationError(f"{field} must be a lowercase SHA-256 digest.")
    return value


def _validate_identifier(value: object, field: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 200:
        raise PackageValidationError(f"{field} must be a non-empty bounded string.")
    return value


def _validate_engine_identifier(value: object) -> str:
    if (
        not isinstance(value, str)
        or len(value) > 200
        or ENGINE_IDENTIFIER_PATTERN.fullmatch(value) is None
    ):
        raise PackageValidationError(
            "Training engine identifier must be a lowercase versioned identifier."
        )
    return value


def _validate_timestamp(value: object) -> str:
    if not isinstance(value, str):
        raise PackageValidationError("Manifest creation timestamp is invalid.")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise PackageValidationError("Manifest creation timestamp is invalid.") from error
    if parsed.utcoffset() is None:
        raise PackageValidationError("Manifest creation timestamp must include a UTC offset.")
    return value


def _finite_nonnegative(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
        and float(value) >= 0.0
    )


def _validate_history(
    value: object, training_config: TrainingConfig
) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) > MAX_HISTORY_EVENTS:
        raise PackageValidationError("Training history events are invalid.")
    expected_fields = {
        "step",
        "train_loss",
        "validation_loss",
        "gradient_norm",
        "elapsed_seconds",
        "sample",
    }
    previous_step = 0
    previous_elapsed = -1.0
    for event in value:
        if not isinstance(event, dict) or set(event) != expected_fields:
            raise PackageValidationError("Training history event schema is invalid.")
        step = event["step"]
        if (
            not isinstance(step, int)
            or isinstance(step, bool)
            or not previous_step < step <= training_config.steps
        ):
            raise PackageValidationError("Training history steps are invalid.")
        if not _finite_nonnegative(event["train_loss"]):
            raise PackageValidationError("Training history train loss is invalid.")
        validation_loss = event["validation_loss"]
        if validation_loss is not None and not _finite_nonnegative(validation_loss):
            raise PackageValidationError("Training history validation loss is invalid.")
        if not _finite_nonnegative(event["gradient_norm"]):
            raise PackageValidationError("Training history gradient norm is invalid.")
        elapsed = event["elapsed_seconds"]
        if not _finite_nonnegative(elapsed) or float(elapsed) < previous_elapsed:
            raise PackageValidationError("Training history elapsed time is invalid.")
        sample = event["sample"]
        if sample is not None and (
            not isinstance(sample, str)
            or len(sample) > MAX_HISTORY_SAMPLE_CHARACTERS
        ):
            raise PackageValidationError("Training history sample is invalid.")
        previous_step = step
        previous_elapsed = float(elapsed)
    return value


def _parameter_items(model: TinyDecoderLM) -> list[tuple[str, torch.nn.Parameter]]:
    return sorted(model.named_parameters(), key=lambda item: item[0])


def _serialize_weights(
    model: TinyDecoderLM,
) -> tuple[bytes, list[dict[str, Any]]]:
    content = bytearray()
    tensors: list[dict[str, Any]] = []
    for name, parameter in _parameter_items(model):
        tensor = parameter.detach().cpu().contiguous().to(torch.float32)
        raw = tensor.numpy().astype("<f4", copy=False).tobytes(order="C")
        record = {
            "name": name,
            "shape": list(tensor.shape),
            "dtype": "float32",
            "layout": "row-major",
            "byte_order": "little",
            "offset": len(content),
            "byte_length": len(raw),
            "sha256": _sha256(raw),
        }
        content.extend(raw)
        tensors.append(record)
    return bytes(content), tensors


def create_checkpoint_files(
    model: TinyDecoderLM,
    tokenizer: CharacterTokenizer,
    training_config: TrainingConfig,
    history: list[dict[str, Any]],
    *,
    dataset_identifier: str,
    dataset_sha256: str,
    creation_timestamp: str | None = None,
) -> dict[str, bytes]:
    actual = actual_trainable_parameters(model)
    calculated = count_parameters(model.config).total
    if actual != calculated or actual > MAX_TRAINABLE_PARAMETERS:
        raise PackageValidationError("Model parameter count failed checkpoint verification.")
    if tokenizer.vocab_size != model.config.vocab_size:
        raise PackageValidationError("Tokenizer vocabulary does not match model configuration.")
    _validate_history(history, training_config)
    _validate_identifier(dataset_identifier, "Training dataset identifier")
    _validate_sha256(dataset_sha256, "Training dataset SHA-256")
    weights, tensors = _serialize_weights(model)
    tokenizer_bytes = _json_bytes(tokenizer.to_dict())
    training_config_document = {
        "schema_version": "1.0",
        "model": model.config.to_dict(),
        "training": training_config.to_dict(),
    }
    training_config_bytes = _json_bytes(training_config_document)
    history_bytes = _json_bytes({"schema_version": "1.0", "events": history})
    timestamp = _validate_timestamp(
        creation_timestamp or datetime.now(UTC).isoformat()
    )
    file_records = {
        "tokenizer.json": {
            "byte_length": len(tokenizer_bytes),
            "sha256": _sha256(tokenizer_bytes),
        },
        "training-config.json": {
            "byte_length": len(training_config_bytes),
            "sha256": _sha256(training_config_bytes),
        },
        "training-history.json": {
            "byte_length": len(history_bytes),
            "sha256": _sha256(history_bytes),
        },
        "weights.bin": {
            "byte_length": len(weights),
            "sha256": _sha256(weights),
        },
    }
    manifest = {
        "format_version": FORMAT_VERSION,
        "architecture_identifier": ARCHITECTURE_ID,
        "model_hyperparameters": model.config.to_dict(),
        "normalization": "pre-normalization",
        "position_representation": "learned-position-embedding",
        "tokenizer_type": "character",
        "vocabulary_size": tokenizer.vocab_size,
        "context_length": model.config.context_length,
        "parameter_count": actual,
        "parameter_limit": MAX_TRAINABLE_PARAMETERS,
        "tied_input_output_embeddings": model.config.tie_embeddings,
        "tensor_count": len(tensors),
        "tensors": tensors,
        "creation_timestamp": timestamp,
        "training_dataset_identifier": dataset_identifier,
        "training_dataset_sha256": dataset_sha256,
        "training_engine_identifier": TRAINING_ENGINE_ID,
        "weight_format": "concatenated-little-endian-float32-row-major",
        "files": file_records,
    }
    return {
        "manifest.json": _json_bytes(manifest),
        "tokenizer.json": tokenizer_bytes,
        "training-config.json": training_config_bytes,
        "training-history.json": history_bytes,
        "weights.bin": weights,
    }


def _read_directory(path: Path) -> dict[str, bytes]:
    if not path.is_dir():
        raise PackageValidationError("Checkpoint path must be a directory.")
    if any(item.is_symlink() for item in path.iterdir()):
        raise PackageValidationError("Checkpoint must not contain symbolic links.")
    names = {item.name for item in path.iterdir() if item.is_file()}
    if names != EXPECTED_FILES:
        raise PackageValidationError("Checkpoint must contain exactly the five required files.")
    if any(item.is_dir() for item in path.iterdir()):
        raise PackageValidationError("Checkpoint must not contain nested directories.")
    files = {name: (path / name).read_bytes() for name in EXPECTED_FILES}
    if sum(map(len, files.values())) > MAX_PACKAGE_BYTES:
        raise PackageValidationError("Checkpoint exceeds the package size limit.")
    return files


def _read_zip(path: Path) -> dict[str, bytes]:
    if not path.is_file() or not (
        path.name.lower().endswith(".mcllm")
        or path.name.lower().endswith(".microcomp-model")
    ):
        raise PackageValidationError(
            "Portable package must be a .mcllm or .microcomp-model file."
        )
    if path.stat().st_size > MAX_PACKAGE_BYTES:
        raise PackageValidationError("Compressed package exceeds the size limit.")
    try:
        with zipfile.ZipFile(path, "r") as archive:
            infos = archive.infolist()
            if len(infos) != len(EXPECTED_FILES):
                raise PackageValidationError("Package file count is invalid.")
            names: set[str] = set()
            total = 0
            for info in infos:
                pure = PurePosixPath(info.filename)
                if (
                    info.is_dir()
                    or pure.is_absolute()
                    or len(pure.parts) != 1
                    or ".." in pure.parts
                    or info.flag_bits & 0x1
                    or stat.S_IFMT(info.external_attr >> 16) == stat.S_IFLNK
                ):
                    raise PackageValidationError("Package contains an unsafe entry.")
                names.add(info.filename)
                total += info.file_size
            if names != EXPECTED_FILES or total > MAX_PACKAGE_BYTES:
                raise PackageValidationError("Package contents do not match the required format.")
            return {name: archive.read(name) for name in EXPECTED_FILES}
    except (zipfile.BadZipFile, OSError) as error:
        raise PackageValidationError("Portable package is not a valid ZIP container.") from error


def read_artifact(path: Path) -> dict[str, bytes]:
    return _read_directory(path) if path.is_dir() else _read_zip(path)


def _parse_json(files: dict[str, bytes], name: str) -> dict[str, Any]:
    raw = files[name]
    if len(raw) > MAX_JSON_BYTES:
        raise PackageValidationError(f"{name} exceeds the JSON size limit.")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PackageValidationError(f"{name} is not valid UTF-8 JSON.") from error
    if not isinstance(value, dict):
        raise PackageValidationError(f"{name} must contain a JSON object.")
    return value


def validate_artifact(path: Path) -> dict[str, Any]:
    files = read_artifact(path)
    manifest = _parse_json(files, "manifest.json")
    required_manifest = {
        "format_version",
        "architecture_identifier",
        "model_hyperparameters",
        "normalization",
        "position_representation",
        "tokenizer_type",
        "vocabulary_size",
        "context_length",
        "parameter_count",
        "parameter_limit",
        "tied_input_output_embeddings",
        "tensor_count",
        "tensors",
        "creation_timestamp",
        "training_dataset_identifier",
        "training_dataset_sha256",
        "training_engine_identifier",
        "weight_format",
        "files",
    }
    if set(manifest) != required_manifest:
        raise PackageValidationError("Manifest fields do not match format 1.0.")
    if (
        manifest["format_version"] != FORMAT_VERSION
        or manifest["architecture_identifier"] != ARCHITECTURE_ID
        or manifest["normalization"] != "pre-normalization"
        or manifest["position_representation"] != "learned-position-embedding"
        or manifest["tokenizer_type"] != "character"
        or manifest["weight_format"] != "concatenated-little-endian-float32-row-major"
        or manifest["parameter_limit"] != MAX_TRAINABLE_PARAMETERS
    ):
        raise PackageValidationError("Manifest declares an unsupported format.")
    _validate_timestamp(manifest["creation_timestamp"])
    _validate_identifier(
        manifest["training_dataset_identifier"], "Training dataset identifier"
    )
    _validate_sha256(
        manifest["training_dataset_sha256"], "Training dataset SHA-256"
    )
    _validate_engine_identifier(manifest["training_engine_identifier"])
    config = ModelConfig.from_dict(manifest["model_hyperparameters"])
    if (
        manifest["vocabulary_size"] != config.vocab_size
        or manifest["context_length"] != config.context_length
        or manifest["tied_input_output_embeddings"] != config.tie_embeddings
    ):
        raise PackageValidationError("Manifest duplicates inconsistent hyperparameters.")
    calculated = count_parameters(config).total
    if manifest["parameter_count"] != calculated or calculated > MAX_TRAINABLE_PARAMETERS:
        raise PackageValidationError("Manifest parameter count is invalid.")
    tokenizer = CharacterTokenizer.from_dict(_parse_json(files, "tokenizer.json"))
    if tokenizer.vocab_size != config.vocab_size:
        raise PackageValidationError("Tokenizer vocabulary size does not match the model.")
    training_document = _parse_json(files, "training-config.json")
    if set(training_document) != {"schema_version", "model", "training"}:
        raise PackageValidationError("Training configuration schema is invalid.")
    if training_document["schema_version"] != "1.0":
        raise PackageValidationError("Training configuration version is unsupported.")
    if ModelConfig.from_dict(training_document["model"]) != config:
        raise PackageValidationError("Training and manifest model configurations differ.")
    training_config = TrainingConfig.from_dict(training_document["training"])
    history = _parse_json(files, "training-history.json")
    if set(history) != {"schema_version", "events"} or history["schema_version"] != "1.0":
        raise PackageValidationError("Training history schema is invalid.")
    _validate_history(history["events"], training_config)

    file_records = manifest["files"]
    if not isinstance(file_records, dict) or set(file_records) != EXPECTED_FILES - {"manifest.json"}:
        raise PackageValidationError("Manifest file records are invalid.")
    for name, record in file_records.items():
        if (
            not isinstance(record, dict)
            or set(record) != {"byte_length", "sha256"}
            or not isinstance(record["byte_length"], int)
            or isinstance(record["byte_length"], bool)
            or record["byte_length"] != len(files[name])
            or _validate_sha256(record["sha256"], f"{name} SHA-256")
            != _sha256(files[name])
        ):
            raise PackageValidationError(f"File integrity check failed for {name}.")

    tensors = manifest["tensors"]
    if (
        not isinstance(tensors, list)
        or not 1 <= len(tensors) <= MAX_TENSORS
        or manifest["tensor_count"] != len(tensors)
    ):
        raise PackageValidationError("Manifest tensor table is invalid.")
    weights = files["weights.bin"]
    expected_offset = 0
    parameter_total = 0
    names: set[str] = set()
    ordered_names: list[str] = []
    for tensor in tensors:
        required_tensor = {
            "name",
            "shape",
            "dtype",
            "layout",
            "byte_order",
            "offset",
            "byte_length",
            "sha256",
        }
        if not isinstance(tensor, dict) or set(tensor) != required_tensor:
            raise PackageValidationError("Tensor record schema is invalid.")
        name, shape = tensor["name"], tensor["shape"]
        if not isinstance(name, str) or not name or len(name) > 200 or name in names:
            raise PackageValidationError("Tensor name is invalid.")
        if (
            not isinstance(shape, list)
            or not 1 <= len(shape) <= 4
            or not all(isinstance(size, int) and not isinstance(size, bool) and 1 <= size <= 1_000_000 for size in shape)
        ):
            raise PackageValidationError(f"Tensor shape is invalid for {name}.")
        elements = math.prod(shape)
        byte_length = elements * 4
        if (
            tensor["dtype"] != "float32"
            or tensor["layout"] != "row-major"
            or tensor["byte_order"] != "little"
            or tensor["offset"] != expected_offset
            or tensor["byte_length"] != byte_length
            or expected_offset + byte_length > len(weights)
        ):
            raise PackageValidationError(f"Tensor layout is invalid for {name}.")
        raw = weights[expected_offset : expected_offset + byte_length]
        if any(
            not math.isfinite(value[0])
            for value in struct.iter_unpack("<f", raw)
        ):
            raise PackageValidationError(f"Tensor values are non-finite for {name}.")
        if (
            _validate_sha256(tensor["sha256"], f"{name} tensor SHA-256")
            != _sha256(raw)
        ):
            raise PackageValidationError(f"Tensor integrity check failed for {name}.")
        names.add(name)
        ordered_names.append(name)
        expected_offset += byte_length
        parameter_total += elements
    if expected_offset != len(weights) or parameter_total != calculated:
        raise PackageValidationError("Tensor table does not match weights or parameter count.")

    torch.manual_seed(0)
    model = TinyDecoderLM(config)
    expected_parameters = {name: parameter for name, parameter in _parameter_items(model)}
    if set(expected_parameters) != names:
        raise PackageValidationError("Tensor names do not match the reference architecture.")
    if ordered_names != sorted(expected_parameters):
        raise PackageValidationError("Tensor records are not in canonical name order.")
    for tensor in tensors:
        if list(expected_parameters[tensor["name"]].shape) != tensor["shape"]:
            raise PackageValidationError(f"Tensor shape does not match {tensor['name']}.")
    return manifest


def save_checkpoint(
    path: Path,
    model: TinyDecoderLM,
    tokenizer: CharacterTokenizer,
    training_config: TrainingConfig,
    history: list[dict[str, Any]],
    *,
    dataset_identifier: str,
    dataset_sha256: str,
    creation_timestamp: str | None = None,
) -> Path:
    path = path.resolve()
    if path.exists():
        raise FileExistsError(f"Checkpoint already exists: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f".{path.name}.tmp-{uuid.uuid4().hex}"
    temporary.mkdir()
    try:
        files = create_checkpoint_files(
            model,
            tokenizer,
            training_config,
            history,
            dataset_identifier=dataset_identifier,
            dataset_sha256=dataset_sha256,
            creation_timestamp=creation_timestamp,
        )
        for name, content in files.items():
            (temporary / name).write_bytes(content)
        validate_artifact(temporary)
        temporary.rename(path)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return path


def load_checkpoint(
    path: Path,
) -> tuple[TinyDecoderLM, CharacterTokenizer, TrainingConfig, list[dict[str, Any]], dict[str, Any]]:
    manifest = validate_artifact(path)
    files = read_artifact(path)
    config = ModelConfig.from_dict(manifest["model_hyperparameters"])
    tokenizer = CharacterTokenizer.from_dict(_parse_json(files, "tokenizer.json"))
    training_document = _parse_json(files, "training-config.json")
    training_config = TrainingConfig.from_dict(training_document["training"])
    history = _parse_json(files, "training-history.json")["events"]
    torch.manual_seed(0)
    model = TinyDecoderLM(config)
    parameters = {name: parameter for name, parameter in _parameter_items(model)}
    weights = files["weights.bin"]
    with torch.no_grad():
        for record in manifest["tensors"]:
            start = record["offset"]
            raw = weights[start : start + record["byte_length"]]
            values = struct.unpack(f"<{math.prod(record['shape'])}f", raw)
            tensor = torch.tensor(values, dtype=torch.float32).reshape(record["shape"])
            parameters[record["name"]].copy_(tensor)
    return model, tokenizer, training_config, history, manifest


def export_package(checkpoint: Path, destination: Path) -> Path:
    validate_artifact(checkpoint)
    files = read_artifact(checkpoint)
    destination = destination.resolve()
    if destination.suffix.lower() != ".mcllm":
        raise PackageValidationError("Export destination must use the .mcllm extension.")
    if destination.exists():
        raise FileExistsError(f"Export destination already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=destination.parent, prefix=f".{destination.stem}.", suffix=".mcllm", delete=False
    ) as temporary_file:
        temporary_path = Path(temporary_file.name)
    try:
        with zipfile.ZipFile(
            temporary_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
        ) as archive:
            for name in sorted(EXPECTED_FILES):
                archive.writestr(name, files[name])
        validate_artifact(temporary_path)
        temporary_path.replace(destination)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise
    validate_artifact(destination)
    return destination
def import_package(package: Path, destination: Path) -> Path:
    validate_artifact(package)
    files = read_artifact(package)
    destination = destination.resolve()
    if destination.exists():
        raise FileExistsError(f"Import destination already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.parent / f".{destination.name}.tmp-{uuid.uuid4().hex}"
    temporary.mkdir()
    try:
        for name, content in files.items():
            (temporary / name).write_bytes(content)
        validate_artifact(temporary)
        temporary.rename(destination)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return destination
