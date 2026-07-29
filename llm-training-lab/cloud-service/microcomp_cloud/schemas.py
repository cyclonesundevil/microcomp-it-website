"""Strict request and response contracts for API version 1."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ModelConfiguration(StrictModel):
    vocab_size: int = Field(default=35, ge=5, le=512)
    context_length: int = Field(default=128, ge=2, le=256)
    embedding_dim: int = Field(default=64, ge=4, le=256)
    attention_heads: int = Field(default=4, ge=1, le=16)
    transformer_blocks: int = Field(default=3, ge=1, le=8)
    feed_forward_dim: int = Field(default=128, ge=4, le=1024)
    dropout: float = Field(default=0.0, ge=0.0, le=0.5)
    tie_embeddings: bool = False

    @field_validator(
        "vocab_size", "context_length", "embedding_dim", "attention_heads",
        "transformer_blocks", "feed_forward_dim", mode="before"
    )
    @classmethod
    def reject_boolean_integer(cls, value: object) -> object:
        if isinstance(value, bool):
            raise ValueError("Boolean values are not integers.")
        return value

    @field_validator("dropout", mode="before")
    @classmethod
    def reject_boolean_float(cls, value: object) -> object:
        if isinstance(value, bool):
            raise ValueError("Boolean values are not numeric.")
        return value


class TrainingConfiguration(StrictModel):
    learning_rate: float = Field(default=0.001, ge=0.000001, le=1.0)
    batch_size: int = Field(default=2, ge=1, le=64)
    steps: int = Field(default=40, ge=1, le=100_000)
    validation_interval: int = Field(default=10, ge=1, le=100_000)
    checkpoint_interval: int = Field(default=10, ge=1, le=100_000)
    gradient_clip_norm: float = Field(default=1.0, ge=0.01, le=100.0)
    seed: int = Field(default=4242, ge=0, le=2_147_483_647)
    validation_batches: int = Field(default=4, ge=1, le=128)
    sample_prompt: str = Field(default="alert: ", max_length=512)
    sample_max_new_tokens: int = Field(default=24, ge=1, le=256)
    sample_temperature: float = Field(default=0.8, ge=0.05, le=5.0)
    sample_top_k: int = Field(default=12, ge=1, le=512)

    @field_validator(
        "batch_size", "steps", "validation_interval", "checkpoint_interval",
        "seed", "validation_batches", "sample_max_new_tokens", "sample_top_k",
        mode="before"
    )
    @classmethod
    def reject_boolean_integer(cls, value: object) -> object:
        if isinstance(value, bool):
            raise ValueError("Boolean values are not integers.")
        return value

    @field_validator(
        "learning_rate", "gradient_clip_norm", "sample_temperature", mode="before"
    )
    @classmethod
    def reject_boolean_float(cls, value: object) -> object:
        if isinstance(value, bool):
            raise ValueError("Boolean values are not numeric.")
        return value


class CreateJobRequest(StrictModel):
    dataset_id: Literal["cybersecurity-alerts-v1"] = "cybersecurity-alerts-v1"
    model: ModelConfiguration = Field(default_factory=ModelConfiguration)
    training: TrainingConfiguration = Field(default_factory=TrainingConfiguration)
    stride: int = Field(default=32, ge=1, le=256)

    @field_validator("stride", mode="before")
    @classmethod
    def reject_boolean_stride(cls, value: object) -> object:
        if isinstance(value, bool):
            raise ValueError("Boolean values are not integers.")
        return value


class GenerationRequest(StrictModel):
    prompt: str = Field(max_length=4096)
    temperature: float = Field(default=0.8, ge=0.05, le=5.0)
    top_k: int = Field(default=12, ge=1, le=512)
    max_new_tokens: int = Field(default=80, ge=1, le=256)
    seed: int | None = Field(default=4242, ge=0, le=2_147_483_647)

    @field_validator("top_k", "max_new_tokens", "seed", mode="before")
    @classmethod
    def reject_boolean_integer(cls, value: object) -> object:
        if isinstance(value, bool):
            raise ValueError("Boolean values are not integers.")
        return value

    @field_validator("temperature", mode="before")
    @classmethod
    def reject_boolean_float(cls, value: object) -> object:
        if isinstance(value, bool):
            raise ValueError("Boolean values are not numeric.")
        return value


JobState = Literal[
    "queued", "initializing", "training", "completed", "cancelled", "expired"
]
