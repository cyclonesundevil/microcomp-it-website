# Prompt 2 Completion Report: Python Tiny-LLM Reference

Status: Complete

Completion date: July 28, 2026

Remote repository updated: No

## Requested outcome

Implement a deterministic, testable Python reference for a character-level,
decoder-only Transformer with fewer than 200,000 trainable parameters. This
implementation is the reference specification for the future browser and
cloud training engines.

## Implementation location

- [`llm-training-lab/python-reference/`](../../llm-training-lab/python-reference/)
- Primary documentation:
  [`llm-training-lab/python-reference/README.md`](../../llm-training-lab/python-reference/README.md)

The production website was not modified by this prompt.

## Architecture delivered

Architecture identifier:

```text
microcomp.char-decoder-transformer.pre-norm.v1
```

The implementation provides:

- character-level tokenization;
- learned token embeddings;
- learned absolute position embeddings;
- explicit query, key, value, and output attention projections;
- lower-triangular causal masking;
- multi-head causal self-attention;
- pre-normalized residual decoder blocks;
- GELU feed-forward layers;
- final layer normalization;
- vocabulary projection with bias;
- configurable dropout;
- optional tied input/output embeddings; and
- a hard 200,000-parameter configuration limit.

Pre-normalization is explicitly defined as:

```text
layer norm → attention → residual
layer norm → feed-forward network → residual
```

## Recommended configuration

The recommended classroom configuration uses the bundled 35-token vocabulary:

| Setting | Value |
| --- | ---: |
| Vocabulary size | 35 |
| Context length | 128 |
| Embedding dimension | 64 |
| Attention heads | 4 |
| Transformer blocks | 3 |
| Feed-forward dimension | 128 |
| Dropout | 0.0 |
| Tied embeddings | No |
| Exact trainable parameters | **113,251** |

The calculated value was verified against PyTorch's actual trainable parameter
count.

## Parameter accounting

For vocabulary `V`, context `T`, embedding width `D`, blocks `L`, and
feed-forward width `F`:

```text
token embedding       = V*D
position embedding    = T*D
one decoder block     = 4*D^2 + 2*D*F + 9*D + F
final layer norm      = 2*D
LM head bias          = V
untied LM head weight = D*V
```

The implementation:

- calculates an exact layer breakdown before model allocation;
- rejects configurations above 200,000 parameters;
- sums actual PyTorch trainable weights after construction; and
- raises an error if the calculated and actual values differ.

## Tokenizer delivered

Reserved token IDs are stable:

| ID | Token |
| ---: | --- |
| 0 | `<pad>` |
| 1 | `<bos>` |
| 2 | `<eos>` |
| 3 | `<unk>` |

Additional vocabulary characters are Unicode-NFC normalized and sorted by code
point. Unknown input characters encode as `<unk>`, and decoding `<unk>`
produces the Unicode replacement character.

The complete tokenizer vocabulary and behavior are serializable.

## Dataset delivered

Dataset:

- [`cybersecurity-alerts-v1.json`](../../llm-training-lab/python-reference/datasets/cybersecurity-alerts-v1.json)

Characteristics:

- original synthetic content;
- safe to distribute;
- CC0-1.0 declaration;
- 24 training records;
- 6 validation records;
- separate splits;
- no runtime network download; and
- schema and size validation.

## Training implementation

The trainer includes:

- Python and PyTorch seed control;
- deterministic PyTorch algorithms;
- deterministic data-loader shuffling;
- mini-batch next-token windows;
- cross-entropy loss;
- AdamW optimization;
- configurable learning rate, batch size, steps, validation interval, and
  checkpoint interval;
- gradient clipping;
- bounded validation batches;
- CPU compatibility;
- progress events;
- validation-loss reporting; and
- seeded checkpoint samples.

## Inference implementation

Generation supports:

- a text prompt;
- temperature;
- top-k sampling;
- maximum generated tokens;
- an optional deterministic seed;
- context-window truncation; and
- stop-on-EOS behavior.

## Portable checkpoint/package format

Checkpoint directories and `.mcllm` exports contain exactly:

```text
manifest.json
tokenizer.json
training-config.json
training-history.json
weights.bin
```

Format version `1.0` is declarative and does not use pickle or another
executable model serialization format.

The manifest records:

- format version;
- architecture identifier;
- model hyperparameters;
- normalization and position representation;
- tokenizer type;
- vocabulary size;
- context length;
- exact parameter count and limit;
- tied-embedding state;
- tensor names;
- tensor shapes;
- tensor dtypes;
- byte order, offsets, lengths, and layouts;
- per-tensor hashes;
- creation timestamp;
- dataset identifier and hash;
- training engine identifier; and
- package-file hashes.

Weights are stored as lexicographically named, concatenated, little-endian
float32 tensors in C row-major order.

Package import rejects:

- missing or unexpected files;
- nested files;
- ZIP path traversal;
- encrypted members;
- oversized packages;
- invalid UTF-8 or JSON;
- unsupported schemas;
- parameter mismatches;
- tensor-name or shape mismatches;
- bad byte offsets;
- invalid hashes; and
- configurations above the parameter limit.

## Command-line interface

Implemented commands:

```text
microcomp-llm count
microcomp-llm train
microcomp-llm generate
microcomp-llm inspect
microcomp-llm export
microcomp-llm import-package
```

Equivalent module invocation:

```text
python -m microcomp_llm
```

## Files created

```text
llm-training-lab/python-reference/
  README.md
  pyproject.toml
  requirements.txt
  datasets/
    cybersecurity-alerts-v1.json
  microcomp_llm/
    __init__.py
    __main__.py
    cli.py
    config.py
    dataset.py
    inference.py
    model.py
    parameters.py
    portable.py
    tokenizer.py
    training.py
  tests/
    test_cli.py
    test_inference.py
    test_model.py
    test_portable.py
    test_tokenizer_dataset.py
    test_training.py
```

The repository `.gitignore` was also updated to exclude the isolated virtual
environment, pytest cache, editable-install metadata, and generated training
artifacts.

## Test results

Final Python reference result:

```text
24 passed
```

Covered behavior includes:

- tokenizer round trips;
- unknown characters;
- dataset validation;
- causal masking;
- exact parameter counting;
- parameter-limit rejection;
- forward output shapes;
- deterministic generation;
- checkpoint save/load consistency;
- package round trips;
- malformed package rejection;
- unsafe ZIP rejection;
- CLI behavior; and
- a short training smoke test.

The existing cybersecurity website regression suite was also run:

```text
73 passed
```

## Short training example

A deterministic, default-size, 20-step CPU run produced:

```text
initial_sample='alert: -djt'
final_sample='alert: detorpirecpond t:sese edstsesased  edtolitelonthe aeatitesee'
```

Final reported validation loss:

```text
2.7484
```

The output remains incoherent, as expected from only 20 optimization steps and
a 113,251-parameter character model. The run demonstrates deterministic
training, checkpointing, validation, and package restoration rather than useful
language quality.

## Deviations and limitations

1. The original architecture plan proposed starting with a TensorFlow.js
   browser slice. The user explicitly redirected the first implementation
   milestone to Python so the browser and cloud engines would have a stable
   reference.
2. Format version `1.0` does not store optimizer state. It restores weights,
   tokenizer, configuration, and history exactly for inference and inspection,
   but it is not a bit-identical mid-optimizer resume format.
3. Bit-for-bit determinism is scoped to the pinned environment and compatible
   CPU behavior; it is not promised across every PyTorch version or hardware
   accelerator.
4. This model is an educational instrument and must not be used for factual,
   operational, or cybersecurity decisions.
