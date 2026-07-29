"""MicroComp IT tiny decoder-only language model reference."""

from .config import MAX_TRAINABLE_PARAMETERS, ModelConfig, TrainingConfig
from .model import TinyDecoderLM
from .tokenizer import CharacterTokenizer

__all__ = [
    "MAX_TRAINABLE_PARAMETERS",
    "CharacterTokenizer",
    "ModelConfig",
    "TrainingConfig",
    "TinyDecoderLM",
]

__version__ = "0.1.0"
