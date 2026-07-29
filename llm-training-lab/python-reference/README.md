# MicroComp Tiny LLM Python Reference

This directory is the deterministic Python reference for the educational LLM
Training Simulation Lab. It trains only on the bundled synthetic dataset, runs
on a CPU, and rejects every model configuration above 200,000 trainable
parameters. It does not change or serve the production website.

The authoritative architecture and interchange contract is
[`docs/model-specification-v1.md`](../../docs/model-specification-v1.md). This
README documents the Python implementation and does not independently define
the model. If this README and the canonical specification ever differ, the
canonical specification controls.

## Setup

Python 3.12 through 3.14 is supported. The tested environment uses Python 3.12.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[test]"
python -m pytest -q
```

The exact runtime and test dependency versions are also listed in
`requirements.txt`.

## Architecture

The architecture identifier is
`microcomp.char-decoder-transformer.pre-norm.v1`. It is a character-level,
decoder-only autoregressive Transformer with:

- learned token and absolute position embeddings;
- explicit query, key, value, and attention-output projections;
- a lower-triangular causal attention mask;
- pre-normalized residual blocks: layer norm, attention, residual, then layer
  norm, GELU feed-forward network, residual;
- a final layer norm and vocabulary projection with bias;
- optional tied token-input and vocabulary-output weights; and
- dropout on embeddings, attention weights, attention output, and feed-forward
  output.

The recommended configuration for the bundled 35-token vocabulary is:

| Setting | Value |
| --- | ---: |
| Context length | 128 |
| Embedding dimension | 64 |
| Attention heads | 4 |
| Transformer blocks | 3 |
| Feed-forward dimension | 128 |
| Dropout | 0.0 |
| Tied embeddings | No |
| Trainable parameters | 113,251 |

Dropout defaults to zero so identical seeds, software versions, hardware, and
commands are reproducible. Nonzero dropout is supported.

## Exact parameter formula

Let `V` be vocabulary size, `T` context length, `D` embedding dimension, `L`
the number of blocks, and `F` feed-forward dimension.

```text
token embedding       = V*D
position embedding    = T*D
one decoder block     = 4*D^2 + 2*D*F + 9*D + F
final layer norm      = 2*D
LM head bias          = V
untied LM head weight = D*V (zero additional parameters when tied)
```

Therefore:

```text
total = V*D + T*D + L*(4*D^2 + 2*D*F + 9*D + F)
        + 2*D + V + (0 if tied else D*V)
```

`count_parameters()` reports a layer-by-layer breakdown. Model construction
also compares this calculation with PyTorch's actual trainable parameter count
and fails on any mismatch. `ModelConfig` rejects a calculated total greater
than 200,000 before allocating the model.

## Tensor names and weight layout

Portable tensors use these stable names:

```text
token_embedding.weight
position_embedding.weight
blocks.N.ln1.weight
blocks.N.ln1.bias
blocks.N.attention.q_proj.weight
blocks.N.attention.q_proj.bias
blocks.N.attention.k_proj.weight
blocks.N.attention.k_proj.bias
blocks.N.attention.v_proj.weight
blocks.N.attention.v_proj.bias
blocks.N.attention.out_proj.weight
blocks.N.attention.out_proj.bias
blocks.N.ln2.weight
blocks.N.ln2.bias
blocks.N.ff_up.weight
blocks.N.ff_up.bias
blocks.N.ff_down.weight
blocks.N.ff_down.bias
final_norm.weight
final_norm.bias
lm_head.weight
lm_head.bias
```

`N` is the zero-based block number. In a tied model, `lm_head.weight` and
`token_embedding.weight` are the same parameter and only
`token_embedding.weight` is stored.

Embedding matrices use `[entries, D]`. PyTorch linear weights use
`[out_features, in_features]`; biases and layer-norm parameters are
one-dimensional. `weights.bin` concatenates tensors in lexicographic name order
as little-endian float32 values in C row-major order. Each manifest tensor
record gives its name, shape, dtype, byte order, byte offset, byte length, and
SHA-256 digest. A browser implementation must preserve this semantic layout,
transposing linear weights only when its matrix API requires the opposite
convention.

## Tokenizer and dataset

The tokenizer normalizes input with Unicode NFC and builds a deterministic,
sorted character vocabulary. Reserved token IDs are fixed:

```text
0 <pad>
1 <bos>
2 <eos>
3 <unk>
```

An unknown input character encodes as `<unk>`. Decoding `<unk>` produces the
Unicode replacement character `�`; other special tokens are omitted by
default. The full vocabulary and behavior are serialized in `tokenizer.json`.

`datasets/cybersecurity-alerts-v1.json` is an original, synthetic, distributable
collection of safe alert and incident-response descriptions. It contains 24
training records and 6 validation records. Splits are kept separate, and the
loader performs no network access.

## Training and inference

Training uses fixed-width, next-token windows, mini-batches, cross-entropy loss,
AdamW, gradient clipping, bounded validation, and checkpoint samples. Python
and PyTorch random generators are seeded, deterministic PyTorch algorithms are
enabled, and data-loader shuffling uses a dedicated seeded generator.

Generation supports a prompt, temperature, top-k sampling, a maximum token
count, and an optional seed. It retains only the newest context-window tokens
for each forward pass and stops when `<eos>` is sampled.

Examples:

```powershell
# Exact count and layer breakdown
microcomp-llm count

# Short CPU training run on the bundled data
microcomp-llm train `
  --output artifacts/reference-run `
  --steps 20 `
  --validation-interval 5 `
  --checkpoint-interval 10 `
  --seed 4242

# Deterministic sampling
microcomp-llm generate `
  --model artifacts/reference-run `
  --prompt "alert: " `
  --temperature 0.8 `
  --top-k 12 `
  --max-new-tokens 80 `
  --seed 4242

# Inspect, export, validate/import, and inspect the imported checkpoint
microcomp-llm inspect --model artifacts/reference-run
microcomp-llm export `
  --checkpoint artifacts/reference-run `
  --output artifacts/reference-run.mcllm
microcomp-llm import-package `
  --package artifacts/reference-run.mcllm `
  --output artifacts/imported-reference-run
microcomp-llm inspect --model artifacts/imported-reference-run
```

Use `python -m microcomp_llm` instead of `microcomp-llm` when the console script
is not on `PATH`.

## Portable model package

A checkpoint directory and its `.mcllm` ZIP export contain exactly:

```text
manifest.json
tokenizer.json
training-config.json
training-history.json
weights.bin
```

Format version `1.0` is declarative and contains no pickle or executable
payload. The manifest records architecture and engine identifiers, all model
hyperparameters, tokenizer type, vocabulary and context sizes, exact parameter
count and limit, timestamp, dataset identifier and digest, tensor metadata, and
file-integrity hashes. Import rejects unexpected or nested files, path
traversal, encrypted ZIP members, schema mismatches, oversized input,
unsupported configurations, bad shapes or offsets, and hash failures.

The saved training history contains bounded progress events. Optimizer state is
intentionally not part of format 1.0, so a package exactly restores weights for
inference and inspection but is not a bit-identical mid-optimizer resume point.

## Limitations

A 200,000-parameter character model is a teaching instrument, not a useful
general-purpose assistant. It has a tiny vocabulary and context, learns surface
patterns slowly, produces frequently incoherent text, has no factual grounding
or safety classifier, and should not be treated as a security decision system.
CPU determinism is tested within the pinned environment, but bit-for-bit
results are not promised across different PyTorch releases, processors, or
accelerators. The first release intentionally accepts no user dataset uploads.
