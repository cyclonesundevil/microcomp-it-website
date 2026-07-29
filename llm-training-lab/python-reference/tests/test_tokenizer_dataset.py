from __future__ import annotations

import pytest

from microcomp_llm.dataset import DATASET_ID, create_data_loaders, load_curated_dataset
from microcomp_llm.tokenizer import CharacterTokenizer, TokenizerError, UNKNOWN_REPLACEMENT


def test_tokenizer_round_trip_and_serialization() -> None:
    tokenizer = CharacterTokenizer.from_texts(["alert: safe.", "response: verify."])
    text = "alert: verify."
    assert tokenizer.decode(tokenizer.encode(text)) == text
    assert CharacterTokenizer.from_dict(tokenizer.to_dict()) == tokenizer


def test_unknown_character_behavior_is_explicit() -> None:
    tokenizer = CharacterTokenizer.from_texts(["abc"])
    encoded = tokenizer.encode("aZ")
    assert encoded == [tokenizer.tokens.index("a"), tokenizer.unk_id]
    assert tokenizer.decode(encoded) == f"a{UNKNOWN_REPLACEMENT}"
    assert tokenizer.decode([tokenizer.unk_id], skip_special=False) == "<unk>"


def test_reserved_tokens_and_bos_eos() -> None:
    tokenizer = CharacterTokenizer.from_texts(["safe"])
    encoded = tokenizer.encode("safe", add_bos=True, add_eos=True)
    assert encoded[0] == tokenizer.bos_id
    assert encoded[-1] == tokenizer.eos_id
    assert tokenizer.decode(encoded) == "safe"


def test_specification_v1_rejects_noncanonical_normalization_and_metadata() -> None:
    with pytest.raises(TokenizerError, match="NFC"):
        CharacterTokenizer.from_texts(["safe"], normalization="NFKC")
    value = CharacterTokenizer.from_texts(["safe"]).to_dict()
    value["unknown_behavior"] = "implementation defined"
    with pytest.raises(TokenizerError, match="behavior"):
        CharacterTokenizer.from_dict(value)


def test_curated_dataset_has_separate_bounded_splits() -> None:
    dataset = load_curated_dataset()
    assert dataset.dataset_id == DATASET_ID
    assert len(dataset.training) == 24
    assert len(dataset.validation) == 6
    assert len(dataset.sha256) == 64
    assert all("alert:" in text and "response:" in text for text in dataset.all_texts)


def test_data_loaders_produce_next_token_batches() -> None:
    dataset = load_curated_dataset()
    tokenizer = CharacterTokenizer.from_texts(dataset.all_texts)
    training, validation = create_data_loaders(
        dataset,
        tokenizer,
        context_length=16,
        batch_size=3,
        seed=7,
        stride=4,
    )
    inputs, targets = next(iter(training))
    assert inputs.shape == targets.shape
    assert inputs.shape[1] == 16
    assert (inputs[:, 1:] == targets[:, :-1]).all()
    assert len(validation) > 0
