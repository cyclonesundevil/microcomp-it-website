from __future__ import annotations

import pytest
import torch

from microcomp_llm.config import ConfigurationError, ModelConfig
from microcomp_llm.model import TinyDecoderLM
from microcomp_llm.parameters import actual_trainable_parameters, count_parameters


@pytest.mark.parametrize(
    "config",
    [
        ModelConfig(35, 16, 16, 2, 1, 32, 0.0, False),
        ModelConfig(35, 32, 32, 4, 2, 64, 0.0, False),
        ModelConfig(35, 64, 48, 3, 2, 96, 0.1, True),
        ModelConfig(35, 128, 64, 4, 3, 128, 0.0, False),
    ],
)
def test_calculated_parameter_count_matches_framework(config: ModelConfig) -> None:
    torch.manual_seed(1)
    model = TinyDecoderLM(config)
    assert count_parameters(config).total == actual_trainable_parameters(model)


def test_recommended_configuration_is_between_100k_and_190k() -> None:
    config = ModelConfig(
        vocab_size=35,
        context_length=128,
        embedding_dim=64,
        attention_heads=4,
        transformer_blocks=3,
        feed_forward_dim=128,
    )
    assert count_parameters(config).total == 113_251
    assert 100_000 <= count_parameters(config).total <= 190_000


def test_tied_embeddings_remove_only_output_weight_parameters() -> None:
    untied = ModelConfig(35, 32, 32, 4, 2, 64, tie_embeddings=False)
    tied = ModelConfig(35, 32, 32, 4, 2, 64, tie_embeddings=True)
    assert count_parameters(untied).total - count_parameters(tied).total == 35 * 32
    model = TinyDecoderLM(tied)
    assert model.lm_head.weight is model.token_embedding.weight


def test_parameter_limit_is_rejected_before_model_construction() -> None:
    with pytest.raises(ConfigurationError, match="maximum"):
        ModelConfig(
            vocab_size=256,
            context_length=256,
            embedding_dim=128,
            attention_heads=8,
            transformer_blocks=4,
            feed_forward_dim=512,
        )


def test_configuration_requires_canonical_scalar_types() -> None:
    with pytest.raises(ConfigurationError, match="Boolean"):
        ModelConfig(35, 16, 16, 2, 1, 32, tie_embeddings=1)  # type: ignore[arg-type]
    with pytest.raises(ConfigurationError, match="dropout"):
        ModelConfig(35, 16, 16, 2, 1, 32, dropout=float("nan"))


def test_forward_pass_shape_and_loss() -> None:
    config = ModelConfig(35, 16, 16, 2, 1, 32)
    model = TinyDecoderLM(config)
    inputs = torch.randint(0, config.vocab_size, (3, 12))
    targets = torch.randint(0, config.vocab_size, (3, 12))
    logits, loss, attentions = model(inputs, targets, return_attentions=True)
    assert logits.shape == (3, 12, config.vocab_size)
    assert loss is not None and torch.isfinite(loss)
    assert attentions is not None
    assert attentions[0].shape == (3, config.attention_heads, 12, 12)


def test_causal_mask_blocks_future_tokens() -> None:
    torch.manual_seed(11)
    config = ModelConfig(35, 8, 16, 2, 1, 32, dropout=0.0)
    model = TinyDecoderLM(config).eval()
    first = torch.tensor([[1, 4, 5, 6, 7]])
    second = torch.tensor([[1, 4, 5, 20, 21]])
    with torch.inference_mode():
        first_logits, _, first_attention = model(first, return_attentions=True)
        second_logits, _, _ = model(second, return_attentions=True)
    assert torch.allclose(first_logits[:, :3], second_logits[:, :3], atol=1e-7)
    assert first_attention is not None
    upper_triangle = torch.triu(first_attention[0][0, 0], diagonal=1)
    assert torch.count_nonzero(upper_triangle) == 0


def test_v1_normalization_and_activation_are_explicit() -> None:
    model = TinyDecoderLM(ModelConfig(35, 8, 16, 2, 1, 32))
    assert model.blocks[0].ln1.eps == 1e-5
    assert model.blocks[0].ln2.eps == 1e-5
    assert model.final_norm.eps == 1e-5
    assert all(parameter.dtype == torch.float32 for parameter in model.parameters())
