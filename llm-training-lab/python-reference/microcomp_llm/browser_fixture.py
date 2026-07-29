"""Generate the canonical browser/Python inference compatibility fixture."""

from __future__ import annotations

import json
from typing import Any

import torch

from .config import ModelConfig, TrainingConfig
from .inference import generate_text
from .model import TinyDecoderLM
from .portable import create_checkpoint_files
from .tokenizer import CharacterTokenizer

FIXTURE_VERSION = "1.0"
WEIGHT_RECIPE = "global-index-mod29-v1"
CREATION_TIMESTAMP = "2026-07-28T12:00:00+00:00"
TOKENS = ("<pad>", "<bos>", "<eos>", "<unk>", " ", "a", "b")
INPUT_TOKEN_IDS = [1, 5, 6, 4]


def _fill_fixture_weights(model: TinyDecoderLM) -> None:
    """Fill canonical tensor order with an engine-independent float32 sequence."""

    global_index = 0
    with torch.no_grad():
        for _, parameter in sorted(model.named_parameters(), key=lambda item: item[0]):
            count = parameter.numel()
            values = [
                ((index % 29) - 14) / 100
                for index in range(global_index, global_index + count)
            ]
            parameter.copy_(
                torch.tensor(values, dtype=torch.float32).reshape(parameter.shape)
            )
            global_index += count


def build_browser_fixture() -> dict[str, Any]:
    """Return a deterministic, JSON-serializable Python parity fixture."""

    config = ModelConfig(
        vocab_size=len(TOKENS),
        context_length=4,
        embedding_dim=4,
        attention_heads=1,
        transformer_blocks=1,
        feed_forward_dim=4,
        dropout=0.0,
        tie_embeddings=False,
    )
    tokenizer = CharacterTokenizer(TOKENS)
    model = TinyDecoderLM(config)
    _fill_fixture_weights(model)
    model.eval()

    training_config = TrainingConfig(
        learning_rate=0.001,
        batch_size=1,
        steps=1,
        validation_interval=1,
        checkpoint_interval=1,
        gradient_clip_norm=1.0,
        seed=7,
        validation_batches=1,
        sample_prompt="ab",
        sample_max_new_tokens=4,
        sample_temperature=1.0,
        sample_top_k=1,
    )
    files = create_checkpoint_files(
        model,
        tokenizer,
        training_config,
        [],
        dataset_identifier="browser-parity-fixture-v1",
        dataset_sha256="0" * 64,
        creation_timestamp=CREATION_TIMESTAMP,
    )
    manifest = json.loads(files["manifest.json"])
    tokenizer_document = json.loads(files["tokenizer.json"])

    with torch.inference_mode():
        logits, _, _ = model(torch.tensor([INPUT_TOKEN_IDS], dtype=torch.long))
    generation_options = {
        "temperature": 1.0,
        "topK": 1,
        "maxNewTokens": 4,
        "seed": 7,
    }
    generated = generate_text(
        model,
        tokenizer,
        "ab",
        temperature=generation_options["temperature"],
        top_k=generation_options["topK"],
        max_new_tokens=generation_options["maxNewTokens"],
        seed=generation_options["seed"],
    )
    return {
        "fixture_version": FIXTURE_VERSION,
        "source_engine": manifest["training_engine_identifier"],
        "weight_recipe": WEIGHT_RECIPE,
        "manifest": manifest,
        "tokenizer": tokenizer_document,
        "input_token_ids": INPUT_TOKEN_IDS,
        "logit_shape": list(logits.shape),
        "expected_logits": logits.reshape(-1).tolist(),
        "logit_tolerance": 0.00002,
        "tokenizer_probe": {
            "text": "ab? ",
            "expected_ids": [5, 6, 3, 4],
        },
        "generation": {
            "prompt": "ab",
            "options": generation_options,
            "expected_text": generated,
        },
    }


def main() -> None:
    print(json.dumps(build_browser_fixture(), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
