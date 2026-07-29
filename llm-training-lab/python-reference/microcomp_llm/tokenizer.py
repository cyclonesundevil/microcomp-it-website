"""Deterministic serializable character-level tokenizer."""

from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

TOKENIZER_SCHEMA_VERSION = "1.0"
RESERVED_TOKENS = ("<pad>", "<bos>", "<eos>", "<unk>")
UNKNOWN_REPLACEMENT = "\ufffd"


class TokenizerError(ValueError):
    """Raised for malformed or incompatible tokenizer data."""


@dataclass(frozen=True)
class CharacterTokenizer:
    tokens: tuple[str, ...]
    normalization: str = "NFC"

    def __post_init__(self) -> None:
        if self.normalization != "NFC":
            raise TokenizerError("Specification v1 requires NFC normalization.")
        if tuple(self.tokens[: len(RESERVED_TOKENS)]) != RESERVED_TOKENS:
            raise TokenizerError("Reserved tokens must occupy IDs 0 through 3.")
        if len(self.tokens) != len(set(self.tokens)):
            raise TokenizerError("Tokenizer tokens must be unique.")
        for token in self.tokens[len(RESERVED_TOKENS) :]:
            if len(token) != 1 or 0xD800 <= ord(token) <= 0xDFFF:
                raise TokenizerError(
                    "Non-reserved vocabulary entries must be one Unicode scalar value."
                )

    @classmethod
    def from_texts(
        cls, texts: Iterable[str], *, normalization: str = "NFC"
    ) -> "CharacterTokenizer":
        normalized = [unicodedata.normalize(normalization, text) for text in texts]
        characters = sorted({character for text in normalized for character in text})
        characters = [character for character in characters if character not in RESERVED_TOKENS]
        return cls(tuple((*RESERVED_TOKENS, *characters)), normalization)

    @property
    def vocab_size(self) -> int:
        return len(self.tokens)

    @property
    def pad_id(self) -> int:
        return 0

    @property
    def bos_id(self) -> int:
        return 1

    @property
    def eos_id(self) -> int:
        return 2

    @property
    def unk_id(self) -> int:
        return 3

    def encode(
        self, text: str, *, add_bos: bool = False, add_eos: bool = False
    ) -> list[int]:
        if not isinstance(text, str):
            raise TokenizerError("text must be a string.")
        mapping = {token: index for index, token in enumerate(self.tokens)}
        normalized = unicodedata.normalize(self.normalization, text)
        encoded = [mapping.get(character, self.unk_id) for character in normalized]
        if add_bos:
            encoded.insert(0, self.bos_id)
        if add_eos:
            encoded.append(self.eos_id)
        return encoded

    def decode(self, token_ids: Iterable[int], *, skip_special: bool = True) -> str:
        output: list[str] = []
        for token_id in token_ids:
            if isinstance(token_id, bool) or not isinstance(token_id, int):
                raise TokenizerError("Token IDs must be integers.")
            if token_id < 0 or token_id >= self.vocab_size:
                raise TokenizerError(f"Token ID {token_id} is outside the vocabulary.")
            token = self.tokens[token_id]
            if token in RESERVED_TOKENS:
                if not skip_special:
                    output.append(token)
                elif token == "<unk>":
                    output.append(UNKNOWN_REPLACEMENT)
            else:
                output.append(token)
        return "".join(output)

    def to_dict(self) -> dict[str, object]:
        return {
            "schema_version": TOKENIZER_SCHEMA_VERSION,
            "type": "character",
            "normalization": self.normalization,
            "reserved_tokens": list(RESERVED_TOKENS),
            "tokens": list(self.tokens),
            "unknown_behavior": "encode as <unk>; decode as Unicode replacement character",
        }

    @classmethod
    def from_dict(cls, value: dict[str, object]) -> "CharacterTokenizer":
        expected = {
            "schema_version",
            "type",
            "normalization",
            "reserved_tokens",
            "tokens",
            "unknown_behavior",
        }
        if set(value) != expected:
            raise TokenizerError("Tokenizer fields do not match schema 1.0.")
        if value["schema_version"] != TOKENIZER_SCHEMA_VERSION:
            raise TokenizerError("Unsupported tokenizer schema version.")
        if value["type"] != "character":
            raise TokenizerError("Unsupported tokenizer type.")
        if value["reserved_tokens"] != list(RESERVED_TOKENS):
            raise TokenizerError("Reserved token declaration is invalid.")
        if (
            value["unknown_behavior"]
            != "encode as <unk>; decode as Unicode replacement character"
        ):
            raise TokenizerError("Unknown-character behavior is invalid.")
        tokens = value["tokens"]
        if not isinstance(tokens, list) or not all(isinstance(item, str) for item in tokens):
            raise TokenizerError("tokens must be a string array.")
        return cls(tuple(tokens), str(value["normalization"]))

    def save(self, path: Path) -> None:
        path.write_text(json.dumps(self.to_dict(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> "CharacterTokenizer":
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise TokenizerError("Tokenizer document must be an object.")
        return cls.from_dict(value)
