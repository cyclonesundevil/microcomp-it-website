"""Deterministic mini-batch training for the reference model."""

from __future__ import annotations

import math
import random
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import torch
from torch import nn
from torch.utils.data import DataLoader

from .config import TrainingConfig
from .inference import generate_text
from .model import TinyDecoderLM
from .tokenizer import CharacterTokenizer

ProgressCallback = Callable[[dict[str, Any]], None]
CheckpointCallback = Callable[[int, TinyDecoderLM, list[dict[str, Any]]], None]
CancellationCallback = Callable[[], bool]


class TrainingCancelled(RuntimeError):
    """Raised at a safe optimizer-step boundary when cancellation is requested."""


@dataclass(frozen=True)
class TrainingResult:
    history: tuple[dict[str, Any], ...]
    initial_sample: str
    final_sample: str


def set_reproducible_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True)


def evaluate_loss(
    model: TinyDecoderLM,
    validation_loader: DataLoader,
    *,
    maximum_batches: int,
) -> float:
    was_training = model.training
    model.eval()
    losses: list[float] = []
    with torch.inference_mode():
        for index, (inputs, targets) in enumerate(validation_loader):
            if index >= maximum_batches:
                break
            _, loss, _ = model(inputs, targets)
            if loss is None or not torch.isfinite(loss):
                raise RuntimeError("Validation produced a non-finite loss.")
            losses.append(float(loss.item()))
    model.train(was_training)
    if not losses:
        raise RuntimeError("Validation loader produced no batches.")
    return sum(losses) / len(losses)


def _default_progress(event: dict[str, Any]) -> None:
    fields = [
        f"step={event['step']}",
        f"train_loss={event['train_loss']:.4f}",
    ]
    if event.get("validation_loss") is not None:
        fields.append(f"validation_loss={event['validation_loss']:.4f}")
    fields.append(f"grad_norm={event['gradient_norm']:.4f}")
    fields.append(f"elapsed={event['elapsed_seconds']:.2f}s")
    print(" ".join(fields), flush=True)
    if event.get("sample") is not None:
        print(f"sample={event['sample']!r}", flush=True)


def train_model(
    model: TinyDecoderLM,
    tokenizer: CharacterTokenizer,
    training_loader: DataLoader,
    validation_loader: DataLoader,
    config: TrainingConfig,
    *,
    progress_callback: ProgressCallback | None = None,
    checkpoint_callback: CheckpointCallback | None = None,
    cancellation_callback: CancellationCallback | None = None,
    progress_every_step: bool = False,
) -> TrainingResult:
    """Train using AdamW, cross entropy, clipping, and bounded validation."""

    set_reproducible_seed(config.seed)
    callback = progress_callback or _default_progress
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=config.learning_rate,
        betas=(0.9, 0.999),
        eps=1e-8,
        weight_decay=0.01,
        amsgrad=False,
    )
    history: list[dict[str, Any]] = []
    initial_sample = generate_text(
        model,
        tokenizer,
        config.sample_prompt,
        temperature=config.sample_temperature,
        top_k=min(config.sample_top_k, tokenizer.vocab_size),
        max_new_tokens=config.sample_max_new_tokens,
        seed=config.seed,
    )
    model.train()
    iterator = iter(training_loader)
    started = time.perf_counter()
    for step in range(1, config.steps + 1):
        if cancellation_callback is not None and cancellation_callback():
            raise TrainingCancelled("Training was cancelled.")
        try:
            inputs, targets = next(iterator)
        except StopIteration:
            iterator = iter(training_loader)
            inputs, targets = next(iterator)
        optimizer.zero_grad(set_to_none=True)
        _, loss, _ = model(inputs, targets)
        if loss is None or not torch.isfinite(loss):
            raise RuntimeError("Training produced a non-finite loss.")
        loss.backward()
        gradient_norm = nn.utils.clip_grad_norm_(
            model.parameters(), config.gradient_clip_norm
        )
        if not math.isfinite(float(gradient_norm)):
            raise RuntimeError("Training produced a non-finite gradient norm.")
        optimizer.step()

        validation_loss = None
        sample = None
        should_validate = step % config.validation_interval == 0 or step == config.steps
        should_checkpoint = step % config.checkpoint_interval == 0 or step == config.steps
        if should_validate:
            validation_loss = evaluate_loss(
                model,
                validation_loader,
                maximum_batches=config.validation_batches,
            )
        if should_checkpoint:
            sample = generate_text(
                model,
                tokenizer,
                config.sample_prompt,
                temperature=config.sample_temperature,
                top_k=min(config.sample_top_k, tokenizer.vocab_size),
                max_new_tokens=config.sample_max_new_tokens,
                seed=config.seed,
            )
        event = {
            "step": step,
            "train_loss": float(loss.item()),
            "validation_loss": validation_loss,
            "gradient_norm": float(gradient_norm),
            "elapsed_seconds": time.perf_counter() - started,
            "sample": sample,
        }
        history.append(event)
        if len(history) > 250:
            history.pop(0)
        if progress_every_step or should_validate or should_checkpoint or step == 1:
            callback(event)
        if should_checkpoint and checkpoint_callback is not None:
            checkpoint_callback(step, model, history.copy())
        if cancellation_callback is not None and cancellation_callback():
            raise TrainingCancelled("Training was cancelled.")

    final_sample = generate_text(
        model,
        tokenizer,
        config.sample_prompt,
        temperature=config.sample_temperature,
        top_k=min(config.sample_top_k, tokenizer.vocab_size),
        max_new_tokens=config.sample_max_new_tokens,
        seed=config.seed,
    )
    return TrainingResult(tuple(history), initial_sample, final_sample)
