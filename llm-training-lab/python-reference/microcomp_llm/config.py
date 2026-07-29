"""Validated model and training configuration contracts."""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any

MAX_TRAINABLE_PARAMETERS = 200_000
ARCHITECTURE_ID = "microcomp.char-decoder-transformer.pre-norm.v1"
FORMAT_VERSION = "1.0"
TRAINING_ENGINE_ID = "microcomp-pytorch-reference-0.1.0"


class ConfigurationError(ValueError):
    """Raised when a model or training configuration violates a hard bound."""


@dataclass(frozen=True)
class ModelConfig:
    """Hyperparameters for the pre-normalized decoder-only Transformer."""

    vocab_size: int
    context_length: int = 128
    embedding_dim: int = 64
    attention_heads: int = 4
    transformer_blocks: int = 3
    feed_forward_dim: int = 128
    dropout: float = 0.0
    tie_embeddings: bool = False

    def __post_init__(self) -> None:
        integer_bounds = {
            "vocab_size": (self.vocab_size, 5, 512),
            "context_length": (self.context_length, 2, 256),
            "embedding_dim": (self.embedding_dim, 4, 256),
            "attention_heads": (self.attention_heads, 1, 16),
            "transformer_blocks": (self.transformer_blocks, 1, 8),
            "feed_forward_dim": (self.feed_forward_dim, 4, 1024),
        }
        for name, (value, minimum, maximum) in integer_bounds.items():
            if isinstance(value, bool) or not isinstance(value, int):
                raise ConfigurationError(f"{name} must be an integer.")
            if value < minimum or value > maximum:
                raise ConfigurationError(f"{name} must be between {minimum} and {maximum}.")
        if self.embedding_dim % self.attention_heads != 0:
            raise ConfigurationError("embedding_dim must be divisible by attention_heads.")
        if self.embedding_dim // self.attention_heads < 4:
            raise ConfigurationError("Each attention head must have a dimension of at least 4.")
        if not isinstance(self.dropout, (int, float)) or isinstance(self.dropout, bool):
            raise ConfigurationError("dropout must be numeric.")
        if not math.isfinite(float(self.dropout)) or not 0.0 <= float(self.dropout) <= 0.5:
            raise ConfigurationError("dropout must be between 0.0 and 0.5.")
        if not isinstance(self.tie_embeddings, bool):
            raise ConfigurationError("tie_embeddings must be a Boolean.")
        from .parameters import count_parameters

        total = count_parameters(self).total
        if total > MAX_TRAINABLE_PARAMETERS:
            raise ConfigurationError(
                f"Configuration has {total:,} trainable parameters; "
                f"the maximum is {MAX_TRAINABLE_PARAMETERS:,}."
            )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "ModelConfig":
        if not isinstance(value, dict):
            raise ConfigurationError("Model configuration must be an object.")
        expected = {
            "vocab_size",
            "context_length",
            "embedding_dim",
            "attention_heads",
            "transformer_blocks",
            "feed_forward_dim",
            "dropout",
            "tie_embeddings",
        }
        if set(value) != expected:
            raise ConfigurationError("Model configuration fields do not match schema 1.0.")
        return cls(**value)


@dataclass(frozen=True)
class TrainingConfig:
    """Bounded training controls for reproducible CPU runs."""

    learning_rate: float = 0.001
    batch_size: int = 8
    steps: int = 200
    validation_interval: int = 20
    checkpoint_interval: int = 100
    gradient_clip_norm: float = 1.0
    seed: int = 4242
    validation_batches: int = 8
    sample_prompt: str = "alert: "
    sample_max_new_tokens: int = 80
    sample_temperature: float = 0.8
    sample_top_k: int = 12

    def __post_init__(self) -> None:
        if (
            not isinstance(self.learning_rate, (int, float))
            or isinstance(self.learning_rate, bool)
            or not math.isfinite(float(self.learning_rate))
            or not 1e-6 <= float(self.learning_rate) <= 1.0
        ):
            raise ConfigurationError("learning_rate must be between 0.000001 and 1.0.")
        integer_bounds = {
            "batch_size": (self.batch_size, 1, 64),
            "steps": (self.steps, 1, 100_000),
            "validation_interval": (self.validation_interval, 1, 100_000),
            "checkpoint_interval": (self.checkpoint_interval, 1, 100_000),
            "seed": (self.seed, 0, 2_147_483_647),
            "validation_batches": (self.validation_batches, 1, 128),
            "sample_max_new_tokens": (self.sample_max_new_tokens, 1, 256),
            "sample_top_k": (self.sample_top_k, 1, 512),
        }
        for name, (value, minimum, maximum) in integer_bounds.items():
            if isinstance(value, bool) or not isinstance(value, int):
                raise ConfigurationError(f"{name} must be an integer.")
            if value < minimum or value > maximum:
                raise ConfigurationError(f"{name} must be between {minimum} and {maximum}.")
        if (
            not isinstance(self.gradient_clip_norm, (int, float))
            or isinstance(self.gradient_clip_norm, bool)
            or not math.isfinite(float(self.gradient_clip_norm))
            or not 0.01 <= float(self.gradient_clip_norm) <= 100.0
        ):
            raise ConfigurationError("gradient_clip_norm must be between 0.01 and 100.")
        if (
            not isinstance(self.sample_temperature, (int, float))
            or isinstance(self.sample_temperature, bool)
            or not math.isfinite(float(self.sample_temperature))
            or not 0.05 <= float(self.sample_temperature) <= 5.0
        ):
            raise ConfigurationError("sample_temperature must be between 0.05 and 5.0.")
        if not isinstance(self.sample_prompt, str) or len(self.sample_prompt) > 512:
            raise ConfigurationError("sample_prompt must be a string of at most 512 characters.")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "TrainingConfig":
        if not isinstance(value, dict):
            raise ConfigurationError("Training configuration must be an object.")
        expected = set(cls.__dataclass_fields__)
        if set(value) != expected:
            raise ConfigurationError("Training configuration fields do not match schema 1.0.")
        return cls(**value)
