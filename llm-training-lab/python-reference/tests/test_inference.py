from __future__ import annotations

import torch

from microcomp_llm.config import ModelConfig
from microcomp_llm.inference import generate_text
from microcomp_llm.model import TinyDecoderLM
from microcomp_llm.tokenizer import CharacterTokenizer


def test_seeded_generation_is_deterministic_and_bounded() -> None:
    tokenizer = CharacterTokenizer.from_texts(["alert: safe response."])
    torch.manual_seed(12)
    model = TinyDecoderLM(
        ModelConfig(tokenizer.vocab_size, 8, 16, 2, 1, 32, dropout=0.0)
    )
    first = generate_text(
        model, tokenizer, "alert: ", seed=99, top_k=5, max_new_tokens=12
    )
    second = generate_text(
        model, tokenizer, "alert: ", seed=99, top_k=5, max_new_tokens=12
    )
    assert first == second
    assert first.startswith("alert: ")
    assert len(first) <= len("alert: ") + 12


def test_generation_truncates_prompt_to_context_window() -> None:
    tokenizer = CharacterTokenizer.from_texts(["alert: safe response."])
    model = TinyDecoderLM(ModelConfig(tokenizer.vocab_size, 8, 16, 2, 1, 32))
    result = generate_text(
        model,
        tokenizer,
        "alert: " * 20,
        seed=1,
        top_k=1,
        max_new_tokens=2,
    )
    assert result.startswith("alert: ")
    assert len(result) <= len("alert: " * 20) + 2
