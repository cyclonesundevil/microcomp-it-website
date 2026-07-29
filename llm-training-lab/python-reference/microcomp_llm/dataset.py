"""Curated local dataset loading and deterministic next-token batching."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

import torch
from torch import Tensor
from torch.utils.data import DataLoader, Dataset

from .tokenizer import CharacterTokenizer

DATASET_ID = "cybersecurity-alerts-v1"
DEFAULT_DATASET_PATH = (
    Path(__file__).resolve().parent.parent
    / "datasets"
    / "cybersecurity-alerts-v1.json"
)


class DatasetError(ValueError):
    """Raised when the bundled dataset does not match its bounded schema."""


@dataclass(frozen=True)
class CuratedDataset:
    dataset_id: str
    display_name: str
    training: tuple[str, ...]
    validation: tuple[str, ...]
    sha256: str

    @property
    def all_texts(self) -> tuple[str, ...]:
        return self.training + self.validation


def _validate_documents(value: Any, split: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not 1 <= len(value) <= 100:
        raise DatasetError(f"{split} must contain between 1 and 100 documents.")
    expected_ids: set[str] = set()
    texts: list[str] = []
    for item in value:
        if not isinstance(item, dict) or set(item) != {"id", "text"}:
            raise DatasetError(f"Every {split} document must contain only id and text.")
        document_id, text = item["id"], item["text"]
        if not isinstance(document_id, str) or not document_id or len(document_id) > 80:
            raise DatasetError(f"{split} document IDs must be bounded strings.")
        if document_id in expected_ids:
            raise DatasetError(f"Duplicate document ID: {document_id}.")
        if not isinstance(text, str) or not 20 <= len(text) <= 1_000:
            raise DatasetError(f"{split} document text must contain 20 to 1,000 characters.")
        expected_ids.add(document_id)
        texts.append(text)
    return tuple(texts)


def load_curated_dataset(path: Path = DEFAULT_DATASET_PATH) -> CuratedDataset:
    raw = path.read_bytes()
    if len(raw) > 256_000:
        raise DatasetError("Dataset exceeds the 256 KB safety limit.")
    value = json.loads(raw.decode("utf-8"))
    expected = {
        "schema_version",
        "dataset_id",
        "display_name",
        "description",
        "language",
        "license",
        "provenance",
        "synthetic_only",
        "training",
        "validation",
    }
    if not isinstance(value, dict) or set(value) != expected:
        raise DatasetError("Dataset fields do not match schema 1.0.")
    if value["schema_version"] != "1.0" or value["dataset_id"] != DATASET_ID:
        raise DatasetError("Unsupported dataset schema or identifier.")
    if value["synthetic_only"] is not True:
        raise DatasetError("Only explicitly synthetic datasets are accepted.")
    training = _validate_documents(value["training"], "training")
    validation = _validate_documents(value["validation"], "validation")
    return CuratedDataset(
        dataset_id=value["dataset_id"],
        display_name=value["display_name"],
        training=training,
        validation=validation,
        sha256=hashlib.sha256(raw).hexdigest(),
    )


class NextTokenDataset(Dataset[tuple[Tensor, Tensor]]):
    """Sliding fixed-width windows from one pre-separated dataset split."""

    def __init__(
        self,
        documents: Sequence[str],
        tokenizer: CharacterTokenizer,
        context_length: int,
        *,
        stride: int = 1,
    ) -> None:
        if stride < 1 or stride > context_length:
            raise DatasetError("stride must be between 1 and context_length.")
        stream: list[int] = []
        for document in documents:
            stream.extend(tokenizer.encode(document, add_bos=True, add_eos=True))
        if len(stream) < context_length + 1:
            raise DatasetError("Dataset split is too short for the configured context length.")
        self.tokens = torch.tensor(stream, dtype=torch.long)
        self.context_length = context_length
        self.starts = tuple(range(0, len(stream) - context_length, stride))

    def __len__(self) -> int:
        return len(self.starts)

    def __getitem__(self, index: int) -> tuple[Tensor, Tensor]:
        start = self.starts[index]
        end = start + self.context_length
        return self.tokens[start:end], self.tokens[start + 1 : end + 1]


def create_data_loaders(
    dataset: CuratedDataset,
    tokenizer: CharacterTokenizer,
    *,
    context_length: int,
    batch_size: int,
    seed: int,
    stride: int = 1,
) -> tuple[DataLoader[tuple[Tensor, Tensor]], DataLoader[tuple[Tensor, Tensor]]]:
    training = NextTokenDataset(
        dataset.training, tokenizer, context_length, stride=stride
    )
    validation = NextTokenDataset(
        dataset.validation, tokenizer, context_length, stride=stride
    )
    generator = torch.Generator().manual_seed(seed)
    train_loader = DataLoader(
        training,
        batch_size=batch_size,
        shuffle=True,
        generator=generator,
        num_workers=0,
        drop_last=False,
    )
    validation_loader = DataLoader(
        validation,
        batch_size=batch_size,
        shuffle=False,
        num_workers=0,
        drop_last=False,
    )
    return train_loader, validation_loader
