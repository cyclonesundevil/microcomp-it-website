from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest
import torch

from microcomp_llm.config import ModelConfig, TrainingConfig
from microcomp_llm.dataset import load_curated_dataset
from microcomp_llm.model import TinyDecoderLM
from microcomp_llm.portable import (
    PackageValidationError,
    export_package,
    import_package,
    load_checkpoint,
    save_checkpoint,
    validate_artifact,
)
from microcomp_llm.tokenizer import CharacterTokenizer


HISTORY_EVENT = {
    "step": 1,
    "train_loss": 3.5,
    "validation_loss": 3.6,
    "gradient_norm": 1.2,
    "elapsed_seconds": 0.5,
    "sample": "alert: test",
}


def _fixture(tmp_path: Path) -> tuple[Path, TinyDecoderLM, CharacterTokenizer]:
    dataset = load_curated_dataset()
    tokenizer = CharacterTokenizer.from_texts(dataset.all_texts)
    torch.manual_seed(21)
    model = TinyDecoderLM(
        ModelConfig(tokenizer.vocab_size, 8, 16, 2, 1, 32, dropout=0.0)
    )
    checkpoint = tmp_path / "checkpoint"
    save_checkpoint(
        checkpoint,
        model,
        tokenizer,
        TrainingConfig(
            batch_size=2,
            steps=1,
            validation_interval=1,
            checkpoint_interval=1,
        ),
        [HISTORY_EVENT],
        dataset_identifier=dataset.dataset_id,
        dataset_sha256=dataset.sha256,
        creation_timestamp="2026-07-28T12:00:00+00:00",
    )
    return checkpoint, model, tokenizer


def test_checkpoint_save_load_preserves_parameters_and_logits(tmp_path: Path) -> None:
    checkpoint, model, _ = _fixture(tmp_path)
    loaded, _, _, history, manifest = load_checkpoint(checkpoint)
    assert history == [HISTORY_EVENT]
    assert manifest["parameter_count"] == sum(p.numel() for p in model.parameters())
    for original, restored in zip(model.parameters(), loaded.parameters(), strict=True):
        assert torch.equal(original, restored)
    inputs = torch.tensor([[1, 4, 5, 6]])
    model.eval()
    loaded.eval()
    with torch.inference_mode():
        expected, _, _ = model(inputs)
        actual, _, _ = loaded(inputs)
    assert torch.equal(expected, actual)


def test_export_validate_import_round_trip(tmp_path: Path) -> None:
    checkpoint, _, _ = _fixture(tmp_path)
    package = export_package(checkpoint, tmp_path / "model.mcllm")
    manifest = validate_artifact(package)
    assert manifest["format_version"] == "1.0"
    assert manifest["architecture_identifier"].endswith("pre-norm.v1")
    assert manifest["tensor_count"] == len(manifest["tensors"])
    assert [record["name"] for record in manifest["tensors"]] == sorted(
        record["name"] for record in manifest["tensors"]
    )
    imported = import_package(package, tmp_path / "imported")
    assert validate_artifact(imported) == manifest


def test_corrupted_weights_are_rejected(tmp_path: Path) -> None:
    checkpoint, _, _ = _fixture(tmp_path)
    weights = checkpoint / "weights.bin"
    value = bytearray(weights.read_bytes())
    value[0] ^= 0xFF
    weights.write_bytes(value)
    with pytest.raises(PackageValidationError, match="integrity"):
        validate_artifact(checkpoint)


def test_manifest_parameter_tampering_is_rejected(tmp_path: Path) -> None:
    checkpoint, _, _ = _fixture(tmp_path)
    manifest_path = checkpoint / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["parameter_count"] += 1
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(PackageValidationError, match="parameter count"):
        validate_artifact(checkpoint)


def test_tied_package_uses_one_canonical_embedding_tensor(tmp_path: Path) -> None:
    dataset = load_curated_dataset()
    tokenizer = CharacterTokenizer.from_texts(dataset.all_texts)
    model = TinyDecoderLM(
        ModelConfig(
            tokenizer.vocab_size,
            8,
            16,
            2,
            1,
            32,
            tie_embeddings=True,
        )
    )
    checkpoint = tmp_path / "tied-checkpoint"
    save_checkpoint(
        checkpoint,
        model,
        tokenizer,
        TrainingConfig(
            batch_size=2,
            steps=1,
            validation_interval=1,
            checkpoint_interval=1,
        ),
        [HISTORY_EVENT],
        dataset_identifier=dataset.dataset_id,
        dataset_sha256=dataset.sha256,
        creation_timestamp="2026-07-28T12:00:00+00:00",
    )
    names = [record["name"] for record in validate_artifact(checkpoint)["tensors"]]
    assert "token_embedding.weight" in names
    assert "lm_head.weight" not in names


def test_noncanonical_history_and_timestamp_are_rejected(tmp_path: Path) -> None:
    checkpoint, _, _ = _fixture(tmp_path)
    history_path = checkpoint / "training-history.json"
    history = json.loads(history_path.read_text(encoding="utf-8"))
    history["events"][0].pop("gradient_norm")
    history_path.write_text(json.dumps(history), encoding="utf-8")
    with pytest.raises(PackageValidationError, match="event schema"):
        validate_artifact(checkpoint)

    second, _, _ = _fixture(tmp_path / "second")
    manifest_path = second / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["creation_timestamp"] = "2026-07-28T12:00:00"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(PackageValidationError, match="UTC offset"):
        validate_artifact(second)


def test_nonfinite_weights_are_rejected_before_checkpoint_commit(tmp_path: Path) -> None:
    dataset = load_curated_dataset()
    tokenizer = CharacterTokenizer.from_texts(dataset.all_texts)
    model = TinyDecoderLM(ModelConfig(tokenizer.vocab_size, 8, 16, 2, 1, 32))
    with torch.no_grad():
        model.token_embedding.weight[0, 0] = float("inf")
    with pytest.raises(PackageValidationError, match="non-finite"):
        save_checkpoint(
            tmp_path / "nonfinite",
            model,
            tokenizer,
            TrainingConfig(
                batch_size=2,
                steps=1,
                validation_interval=1,
                checkpoint_interval=1,
            ),
            [HISTORY_EVENT],
            dataset_identifier=dataset.dataset_id,
            dataset_sha256=dataset.sha256,
            creation_timestamp="2026-07-28T12:00:00+00:00",
        )
    assert not (tmp_path / "nonfinite").exists()


def test_malformed_and_traversal_packages_are_rejected(tmp_path: Path) -> None:
    malformed = tmp_path / "malformed.mcllm"
    malformed.write_bytes(b"not a zip")
    with pytest.raises(PackageValidationError):
        validate_artifact(malformed)

    traversal = tmp_path / "traversal.mcllm"
    with zipfile.ZipFile(traversal, "w") as archive:
        archive.writestr("../manifest.json", "{}")
    with pytest.raises(PackageValidationError):
        validate_artifact(traversal)
