"""Bounded autoregressive inference and deterministic sampling."""

from __future__ import annotations

import math

import torch
from torch.nn import functional as F

from .model import TinyDecoderLM
from .tokenizer import CharacterTokenizer


def generate_text(
    model: TinyDecoderLM,
    tokenizer: CharacterTokenizer,
    prompt: str,
    *,
    temperature: float = 0.8,
    top_k: int = 12,
    max_new_tokens: int = 80,
    seed: int | None = 4242,
) -> str:
    """Generate text with context truncation and optional seeded sampling."""

    if not isinstance(prompt, str) or len(prompt) > 4_096:
        raise ValueError("prompt must be a string of at most 4,096 characters.")
    if (
        not isinstance(temperature, (int, float))
        or isinstance(temperature, bool)
        or not math.isfinite(float(temperature))
        or not 0.05 <= float(temperature) <= 5.0
    ):
        raise ValueError("temperature must be between 0.05 and 5.0.")
    if isinstance(top_k, bool) or not isinstance(top_k, int) or not 1 <= top_k <= tokenizer.vocab_size:
        raise ValueError("top_k must be between 1 and the vocabulary size.")
    if (
        isinstance(max_new_tokens, bool)
        or not isinstance(max_new_tokens, int)
        or not 1 <= max_new_tokens <= 256
    ):
        raise ValueError("max_new_tokens must be between 1 and 256.")
    if seed is not None and (
        isinstance(seed, bool)
        or not isinstance(seed, int)
        or not 0 <= seed <= 2_147_483_647
    ):
        raise ValueError("seed must be None or an integer from 0 through 2147483647.")

    token_ids = tokenizer.encode(prompt)
    if not token_ids:
        token_ids = [tokenizer.bos_id]
    generator = None
    if seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(seed)
    was_training = model.training
    model.eval()
    with torch.inference_mode():
        for _ in range(max_new_tokens):
            context = token_ids[-model.config.context_length :]
            inputs = torch.tensor([context], dtype=torch.long)
            logits, _, _ = model(inputs)
            next_logits = logits[0, -1] / float(temperature)
            indices = torch.argsort(
                next_logits, descending=True, stable=True
            )[: min(top_k, tokenizer.vocab_size)]
            values = next_logits[indices]
            probabilities = F.softmax(values, dim=-1)
            sampled_index = torch.multinomial(
                probabilities, num_samples=1, generator=generator
            )
            next_token = int(indices[sampled_index].item())
            if next_token == tokenizer.eos_id:
                break
            token_ids.append(next_token)
    model.train(was_training)
    return tokenizer.decode(token_ids)
