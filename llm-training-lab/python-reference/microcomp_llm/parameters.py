"""Exact, framework-independent trainable parameter accounting."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .config import ModelConfig


@dataclass(frozen=True)
class ParameterBreakdown:
    layers: dict[str, int]

    @property
    def total(self) -> int:
        return sum(self.layers.values())

    def to_dict(self) -> dict[str, object]:
        return {"layers": dict(self.layers), "total": self.total}


def count_parameters(config: "ModelConfig") -> ParameterBreakdown:
    """Return the exact count required by model specification v1."""

    vocab = config.vocab_size
    context = config.context_length
    width = config.embedding_dim
    blocks = config.transformer_blocks
    hidden = config.feed_forward_dim

    layers: dict[str, int] = {
        "token_embedding": vocab * width,
        "position_embedding": context * width,
    }
    for index in range(blocks):
        prefix = f"blocks.{index}"
        layers[f"{prefix}.attention.qkv"] = 3 * (width * width + width)
        layers[f"{prefix}.attention.output"] = width * width + width
        layers[f"{prefix}.feed_forward.up"] = width * hidden + hidden
        layers[f"{prefix}.feed_forward.down"] = hidden * width + width
        layers[f"{prefix}.layer_norms"] = 4 * width
    layers["final_layer_norm"] = 2 * width
    layers["language_model_head.bias"] = vocab
    layers["language_model_head.weight"] = 0 if config.tie_embeddings else width * vocab
    return ParameterBreakdown(layers)


def actual_trainable_parameters(model: object) -> int:
    parameters = getattr(model, "parameters", None)
    if not callable(parameters):
        raise TypeError("model must provide parameters().")
    return sum(parameter.numel() for parameter in parameters() if parameter.requires_grad)


def verify_parameter_count(model: object, config: "ModelConfig") -> int:
    calculated = count_parameters(config).total
    actual = actual_trainable_parameters(model)
    if calculated != actual:
        raise RuntimeError(
            f"Parameter accounting mismatch: calculated {calculated:,}, actual {actual:,}."
        )
    return actual
