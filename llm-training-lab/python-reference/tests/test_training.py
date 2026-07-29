from __future__ import annotations

import torch

from microcomp_llm.config import ModelConfig, TrainingConfig
from microcomp_llm.dataset import create_data_loaders, load_curated_dataset
from microcomp_llm.model import TinyDecoderLM
from microcomp_llm.tokenizer import CharacterTokenizer
from microcomp_llm.training import train_model


def test_short_training_smoke_run_is_finite_and_updates_weights() -> None:
    dataset = load_curated_dataset()
    tokenizer = CharacterTokenizer.from_texts(dataset.all_texts)
    config = ModelConfig(
        tokenizer.vocab_size,
        context_length=8,
        embedding_dim=16,
        attention_heads=2,
        transformer_blocks=1,
        feed_forward_dim=32,
        dropout=0.0,
    )
    torch.manual_seed(123)
    model = TinyDecoderLM(config)
    before = model.token_embedding.weight.detach().clone()
    training, validation = create_data_loaders(
        dataset,
        tokenizer,
        context_length=config.context_length,
        batch_size=2,
        seed=123,
        stride=8,
    )
    events: list[dict[str, object]] = []
    result = train_model(
        model,
        tokenizer,
        training,
        validation,
        TrainingConfig(
            learning_rate=0.002,
            batch_size=2,
            steps=2,
            validation_interval=1,
            checkpoint_interval=2,
            validation_batches=1,
            seed=123,
            sample_prompt="alert: ",
            sample_max_new_tokens=4,
            sample_top_k=4,
        ),
        progress_callback=events.append,
    )
    assert len(result.history) == 2
    assert len(events) == 2
    assert all(torch.isfinite(torch.tensor(item["train_loss"])) for item in result.history)
    assert all(item["validation_loss"] is not None for item in result.history)
    assert not torch.equal(before, model.token_embedding.weight)
    assert result.initial_sample.startswith("alert: ")
    assert result.final_sample.startswith("alert: ")
