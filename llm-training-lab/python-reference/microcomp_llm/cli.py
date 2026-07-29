"""Command-line interface for the Python reference implementation."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch

from .config import ConfigurationError, ModelConfig, TrainingConfig
from .dataset import create_data_loaders, load_curated_dataset
from .inference import generate_text
from .model import TinyDecoderLM
from .parameters import actual_trainable_parameters, count_parameters
from .portable import (
    PackageValidationError,
    export_package,
    import_package,
    load_checkpoint,
    save_checkpoint,
    validate_artifact,
)
from .tokenizer import CharacterTokenizer
from .training import set_reproducible_seed, train_model


def _add_model_arguments(parser: argparse.ArgumentParser, *, include_vocab: bool) -> None:
    if include_vocab:
        parser.add_argument("--vocab-size", type=int, default=35)
    parser.add_argument("--context-length", type=int, default=128)
    parser.add_argument("--embedding-dim", type=int, default=64)
    parser.add_argument("--attention-heads", type=int, default=4)
    parser.add_argument("--transformer-blocks", type=int, default=3)
    parser.add_argument("--feed-forward-dim", type=int, default=128)
    parser.add_argument("--dropout", type=float, default=0.0)
    parser.add_argument("--tie-embeddings", action="store_true")


def _model_config(arguments: argparse.Namespace, vocab_size: int | None = None) -> ModelConfig:
    return ModelConfig(
        vocab_size=vocab_size if vocab_size is not None else arguments.vocab_size,
        context_length=arguments.context_length,
        embedding_dim=arguments.embedding_dim,
        attention_heads=arguments.attention_heads,
        transformer_blocks=arguments.transformer_blocks,
        feed_forward_dim=arguments.feed_forward_dim,
        dropout=arguments.dropout,
        tie_embeddings=arguments.tie_embeddings,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="microcomp-llm",
        description="MicroComp IT educational tiny language-model reference.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    count = commands.add_parser("count", help="Calculate and display parameters.")
    _add_model_arguments(count, include_vocab=True)

    train = commands.add_parser("train", help="Train on the bundled synthetic dataset.")
    _add_model_arguments(train, include_vocab=False)
    train.add_argument("--output", type=Path, required=True)
    train.add_argument("--checkpoint-directory", type=Path)
    train.add_argument("--learning-rate", type=float, default=0.001)
    train.add_argument("--batch-size", type=int, default=8)
    train.add_argument("--steps", type=int, default=200)
    train.add_argument("--validation-interval", type=int, default=20)
    train.add_argument("--checkpoint-interval", type=int, default=100)
    train.add_argument("--gradient-clip-norm", type=float, default=1.0)
    train.add_argument("--validation-batches", type=int, default=8)
    train.add_argument("--seed", type=int, default=4242)
    train.add_argument("--sample-prompt", default="alert: ")
    train.add_argument("--sample-max-new-tokens", type=int, default=80)
    train.add_argument("--sample-temperature", type=float, default=0.8)
    train.add_argument("--sample-top-k", type=int, default=12)
    train.add_argument("--stride", type=int, default=2)

    generate = commands.add_parser("generate", help="Generate text from a saved model.")
    generate.add_argument("--model", type=Path, required=True)
    generate.add_argument("--prompt", required=True)
    generate.add_argument("--temperature", type=float, default=0.8)
    generate.add_argument("--top-k", type=int, default=12)
    generate.add_argument("--max-new-tokens", type=int, default=80)
    generate.add_argument("--seed", type=int)

    inspect = commands.add_parser("inspect", help="Inspect and validate a saved artifact.")
    inspect.add_argument("--model", type=Path, required=True)

    export = commands.add_parser("export", help="Export a checkpoint as .mcllm.")
    export.add_argument("--checkpoint", type=Path, required=True)
    export.add_argument("--output", type=Path, required=True)

    import_command = commands.add_parser(
        "import-package", help="Validate and import a .mcllm package."
    )
    import_command.add_argument("--package", type=Path, required=True)
    import_command.add_argument("--output", type=Path, required=True)
    return parser


def _training_config(arguments: argparse.Namespace) -> TrainingConfig:
    return TrainingConfig(
        learning_rate=arguments.learning_rate,
        batch_size=arguments.batch_size,
        steps=arguments.steps,
        validation_interval=arguments.validation_interval,
        checkpoint_interval=arguments.checkpoint_interval,
        gradient_clip_norm=arguments.gradient_clip_norm,
        seed=arguments.seed,
        validation_batches=arguments.validation_batches,
        sample_prompt=arguments.sample_prompt,
        sample_max_new_tokens=arguments.sample_max_new_tokens,
        sample_temperature=arguments.sample_temperature,
        sample_top_k=arguments.sample_top_k,
    )


def _run_count(arguments: argparse.Namespace) -> int:
    config = _model_config(arguments)
    breakdown = count_parameters(config)
    print(json.dumps({"configuration": config.to_dict(), **breakdown.to_dict()}, indent=2))
    return 0


def _run_train(arguments: argparse.Namespace) -> int:
    dataset = load_curated_dataset()
    tokenizer = CharacterTokenizer.from_texts(dataset.all_texts)
    model_config = _model_config(arguments, tokenizer.vocab_size)
    training_config = _training_config(arguments)
    set_reproducible_seed(training_config.seed)
    model = TinyDecoderLM(model_config)
    training_loader, validation_loader = create_data_loaders(
        dataset,
        tokenizer,
        context_length=model_config.context_length,
        batch_size=training_config.batch_size,
        seed=training_config.seed,
        stride=arguments.stride,
    )

    def checkpoint_callback(
        step: int, current_model: TinyDecoderLM, history: list[dict[str, object]]
    ) -> None:
        if arguments.checkpoint_directory is None:
            return
        checkpoint = arguments.checkpoint_directory / f"step-{step:06d}"
        save_checkpoint(
            checkpoint,
            current_model,
            tokenizer,
            training_config,
            history,
            dataset_identifier=dataset.dataset_id,
            dataset_sha256=dataset.sha256,
        )
        print(f"checkpoint={checkpoint}", flush=True)

    result = train_model(
        model,
        tokenizer,
        training_loader,
        validation_loader,
        training_config,
        checkpoint_callback=checkpoint_callback,
    )
    save_checkpoint(
        arguments.output,
        model,
        tokenizer,
        training_config,
        list(result.history),
        dataset_identifier=dataset.dataset_id,
        dataset_sha256=dataset.sha256,
    )
    print(f"initial_sample={result.initial_sample!r}")
    print(f"final_sample={result.final_sample!r}")
    print(f"saved_model={arguments.output}")
    return 0


def _run_generate(arguments: argparse.Namespace) -> int:
    model, tokenizer, _, _, _ = load_checkpoint(arguments.model)
    seed = arguments.seed
    text = generate_text(
        model,
        tokenizer,
        arguments.prompt,
        temperature=arguments.temperature,
        top_k=arguments.top_k,
        max_new_tokens=arguments.max_new_tokens,
        seed=seed,
    )
    print(text)
    return 0


def _run_inspect(arguments: argparse.Namespace) -> int:
    manifest = validate_artifact(arguments.model)
    print(json.dumps(manifest, indent=2))
    return 0


def run(arguments: argparse.Namespace) -> int:
    if arguments.command == "count":
        return _run_count(arguments)
    if arguments.command == "train":
        return _run_train(arguments)
    if arguments.command == "generate":
        return _run_generate(arguments)
    if arguments.command == "inspect":
        return _run_inspect(arguments)
    if arguments.command == "export":
        result = export_package(arguments.checkpoint, arguments.output)
        print(f"exported_package={result}")
        return 0
    if arguments.command == "import-package":
        result = import_package(arguments.package, arguments.output)
        print(f"imported_checkpoint={result}")
        return 0
    raise RuntimeError("Unhandled command.")


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    arguments = parser.parse_args(argv)
    try:
        return run(arguments)
    except (
        ConfigurationError,
        PackageValidationError,
        FileExistsError,
        ValueError,
        RuntimeError,
        OSError,
    ) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
