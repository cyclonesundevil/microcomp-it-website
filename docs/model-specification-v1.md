# MicroComp Tiny LLM Architecture Specification v1

Specification version: 1.0.0

Architecture identifier:
`microcomp.char-decoder-transformer.pre-norm.v1`

Portable package format version: `1.0`

Status: Canonical

## 1. Purpose and authority

This document is the authoritative contract for the MicroComp Tiny LLM.
Browser, Python, cloud, and independent implementations conform to this
document; no implementation source code defines the architecture.

An implementation may use any framework or programming language if its
observable model structure, tensor semantics, parameter count, tokenizer,
package representation, and validation behavior conform to this specification.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are normative.

## 2. Conformance levels

Three conformance levels are defined.

### 2.1 Architecture-conformant

An architecture-conformant implementation MUST:

- accept the model configuration in Section 5;
- implement the tokenizer in Section 6;
- implement the forward pass in Sections 7 through 12;
- expose tensors with the names and shapes in Section 14;
- calculate parameters using Section 16; and
- reject configurations above 200,000 trainable parameters.

### 2.2 Package-conformant

A package-conformant implementation MUST also:

- read and write the package in Sections 17 through 21;
- preserve every float32 parameter bit pattern during a load/save round trip;
- validate all required schemas and integrity hashes; and
- reject unsupported architecture or package versions.

### 2.3 Training-conformant

A training-conformant implementation MUST also:

- construct next-token examples as specified in Section 22;
- implement the training behavior in Section 23;
- implement seed handling in Section 24; and
- expose the training-state semantics in Section 25.

Numerically close logits and losses are expected across conforming engines, but
bit-identical floating-point operations and bit-identical training trajectories
are not required across different frameworks, processors, or accelerators.
Portable model weights are the cross-engine identity boundary.

## 3. Versioning strategy

### 3.1 Specification version

This document uses semantic versioning:

```text
MAJOR.MINOR.PATCH
```

- **MAJOR** changes alter architecture, tensor semantics, tokenizer semantics,
  or previously valid package interpretation.
- **MINOR** changes add backward-compatible optional metadata or clarify
  behavior without changing existing tensors or outputs.
- **PATCH** changes are editorial clarifications with no contract change.

### 3.2 Architecture identifier

The architecture identifier is immutable:

```text
microcomp.char-decoder-transformer.pre-norm.v1
```

Any change to token IDs, normalization, layer order, tensor names, tensor
shapes, activation, masking, learned position representation, or projection
biases requires a new architecture identifier ending in `.v2` or later.

### 3.3 Package format version

The package format uses:

```text
MAJOR.MINOR
```

Readers MUST reject a package with an unsupported major version. A reader MAY
accept a newer minor version only when it recognizes all required fields and
the newer version explicitly declares backward compatibility.

Version `1.0` uses exact-field schemas. Unknown fields are rejected. Adding a
field therefore requires at least package format `1.1`.

## 4. Symbols and numerical conventions

The specification uses:

| Symbol | Meaning |
| --- | --- |
| `B` | batch size |
| `S` | current sequence length |
| `V` | vocabulary size |
| `T` | maximum context length |
| `D` | embedding dimension/model width |
| `H` | number of attention heads |
| `Dh` | head dimension, `D / H` |
| `L` | number of decoder blocks |
| `F` | feed-forward dimension |

Trainable parameters and forward activations MUST use IEEE-754 binary32
(`float32`). Token IDs and tensor dimensions are integers. Implementations MAY
use wider accumulator precision internally if final stored parameters remain
float32 and behavior remains numerically equivalent.

Matrix notation in this document treats a linear layer as:

```text
y = x × Wᵀ + b
```

where serialized `W` has shape `[out_features, in_features]`.

## 5. Model configuration

The model configuration contains exactly:

```json
{
  "vocab_size": 35,
  "context_length": 128,
  "embedding_dim": 64,
  "attention_heads": 4,
  "transformer_blocks": 3,
  "feed_forward_dim": 128,
  "dropout": 0.0,
  "tie_embeddings": false
}
```

Required bounds:

| Field | Type | Inclusive bounds |
| --- | --- | --- |
| `vocab_size` | integer, not Boolean | 5 through 512 |
| `context_length` | integer, not Boolean | 2 through 256 |
| `embedding_dim` | integer, not Boolean | 4 through 256 |
| `attention_heads` | integer, not Boolean | 1 through 16 |
| `transformer_blocks` | integer, not Boolean | 1 through 8 |
| `feed_forward_dim` | integer, not Boolean | 4 through 1024 |
| `dropout` | finite number, not Boolean | 0.0 through 0.5 |
| `tie_embeddings` | Boolean | `true` or `false` |

Additional requirements:

```text
D mod H = 0
Dh = D / H ≥ 4
calculated trainable parameters ≤ 200000
```

The recommended classroom configuration is the example above and contains
exactly 113,251 parameters for `V = 35`.

## 6. Character tokenizer

### 6.1 Reserved token IDs

Reserved IDs are immutable:

| ID | Token | Meaning |
| ---: | --- | --- |
| 0 | `<pad>` | padding; not used by fixed-width v1 training batches |
| 1 | `<bos>` | beginning of document or empty generation prompt |
| 2 | `<eos>` | end of document and generation stop token |
| 3 | `<unk>` | character absent from the vocabulary |

Changing a reserved ID requires a new architecture identifier.

### 6.2 Normalization

All dataset text and prompt text MUST be normalized with Unicode Normalization
Form C (`NFC`) before vocabulary construction or encoding.

NFKC, NFD, NFKD, locale-specific case conversion, whitespace folding, newline
conversion, and control-character removal are not part of v1. A producer
SHOULD normalize dataset line endings before publishing the dataset, but the
tokenizer itself MUST NOT rewrite line endings.

### 6.3 Vocabulary construction and ordering

Vocabulary construction is deterministic:

1. NFC-normalize each source string independently.
2. Iterate the resulting Unicode scalar values/characters.
3. Form the set of unique characters.
4. Sort characters by ascending Unicode code point.
5. Prefix the four reserved tokens in fixed ID order.

Every non-reserved vocabulary entry MUST represent exactly one Unicode scalar
value. Duplicate entries are invalid. Vocabulary size is the length of the
complete token array, including reserved tokens.

JavaScript implementations MUST iterate Unicode code points, for example with
`Array.from()`, rather than UTF-16 code units.

### 6.4 Encoding

Encoding:

1. validates that input is a string;
2. applies NFC normalization;
3. maps each character to its vocabulary ID;
4. maps an absent character to ID 3; and
5. optionally prepends ID 1 and/or appends ID 2.

Encoding never inserts padding.

### 6.5 Decoding

With `skip_special = true`, the default:

- IDs 0, 1, and 2 produce no output;
- ID 3 produces U+FFFD REPLACEMENT CHARACTER (`�`);
- other IDs produce their vocabulary character.

With `skip_special = false`, IDs 0 through 3 produce their literal token
strings (`<pad>`, `<bos>`, `<eos>`, and `<unk>`).

Non-integer, Boolean, negative, or out-of-range token IDs MUST be rejected.

### 6.6 `tokenizer.json`

The tokenizer document contains exactly:

```json
{
  "schema_version": "1.0",
  "type": "character",
  "normalization": "NFC",
  "reserved_tokens": ["<pad>", "<bos>", "<eos>", "<unk>"],
  "tokens": ["<pad>", "<bos>", "<eos>", "<unk>", " ", "..."],
  "unknown_behavior": "encode as <unk>; decode as Unicode replacement character"
}
```

Every constant string above is normative.

## 7. Forward-pass overview

Given token IDs with shape `[B, S]`, where `1 ≤ S ≤ T`:

```text
token IDs
  → token embeddings
  + learned absolute position embeddings
  → embedding dropout
  → L pre-normalized decoder blocks
  → final layer normalization
  → vocabulary projection
  → logits [B, S, V]
```

Token IDs outside `[0, V - 1]`, a rank other than two, or a sequence longer
than `T` MUST be rejected.

## 8. Embeddings and positions

### 8.1 Token embeddings

`token_embedding.weight` has shape `[V, D]`. Token lookup produces `[B, S, D]`.

### 8.2 Position embeddings

`position_embedding.weight` has shape `[T, D]`. v1 uses learned absolute
positions only. Rotary, sinusoidal, ALiBi, or relative positions are not
conformant.

For every forward call, position IDs are:

```text
[0, 1, ..., S - 1]
```

The position embedding is added elementwise to the token embedding. During
context truncation, the retained suffix is re-indexed starting at position
zero.

### 8.3 Embedding dropout

Dropout with probability `dropout` is applied after token and position
embeddings are added. Dropout is disabled during evaluation and generation.

## 9. Decoder block and residual ordering

Each block `i`, from zero through `L - 1`, is pre-normalized and MUST execute in
this order:

```text
x0 = block input
a  = LayerNorm1(x0)
b  = CausalSelfAttention(a)
x1 = x0 + AttentionOutputDropout(b)
c  = LayerNorm2(x1)
d  = FeedForward(c)
x2 = x1 + FeedForwardDropout(d)
```

`x2` is the block output. There is no post-residual layer normalization inside
the block.

## 10. Layer normalization

Every layer normalization:

- normalizes the last dimension of size `D`;
- uses a trainable scale and bias, each shape `[D]`;
- uses epsilon `1e-5`;
- calculates variance with divisor `D` (population/biased variance); and
- computes:

```text
mean = sum(x) / D
variance = sum((x - mean)²) / D
y = ((x - mean) / sqrt(variance + 1e-5)) × weight + bias
```

`blocks.i.ln1` and `blocks.i.ln2` occur as specified in Section 9.
`final_norm` is applied after the last block and before the language-model
head.

## 11. Causal multi-head self-attention

### 11.1 Projections

Attention uses four biased linear projections:

```text
Q = q_proj(x)
K = k_proj(x)
Vv = v_proj(x)
```

Each input and output has final width `D`. Each projected tensor is reshaped
from `[B, S, D]` to `[B, S, H, Dh]`, then transposed to `[B, H, S, Dh]`.

Q, K, and V are separate tensors and separate parameters. A fused QKV
implementation is allowed internally only if import/export presents the
canonical separate names and produces equivalent results.

### 11.2 Scores and causal mask

Scores are:

```text
scores = Q × Kᵀ / sqrt(Dh)
```

with shape `[B, H, S, S]`.

The Boolean causal mask is lower triangular including the diagonal:

```text
allowed(query_position, key_position) = key_position ≤ query_position
```

Disallowed score values are replaced with negative infinity before softmax.
Softmax is applied on the final/key-position dimension.

### 11.3 Attention dropout and output

Attention-probability dropout is applied after softmax. The dropped attention
probabilities multiply V. Heads are transposed back, made contiguous if the
framework requires it, and reshaped to `[B, S, D]`.

The result passes through the biased `out_proj` linear layer and then attention
output dropout. The residual addition follows Section 9.

No attention bias, cross-attention, key/value cache tensor, or learned causal
mask is part of v1.

## 12. Feed-forward network and activation

The feed-forward network is:

```text
hidden = GELU(ff_up(x))
output = ff_down(hidden)
```

`ff_up` is a biased linear layer from `D` to `F`. `ff_down` is a biased linear
layer from `F` to `D`.

GELU uses the exact error-function form, not the tanh approximation:

```text
GELU(x) = 0.5 × x × (1 + erf(x / sqrt(2)))
```

Feed-forward dropout is applied after `ff_down` and before the residual
addition. There is no dropout between GELU and `ff_down`.

## 13. Final projection, tying, and loss

After `final_norm`, logits are:

```text
logits = normalized × lm_head.weightᵀ + lm_head.bias
```

with shape `[B, S, V]`.

When `tie_embeddings = false`, `lm_head.weight` is an independent trainable
tensor with shape `[V, D]`.

When `tie_embeddings = true`, the output projection MUST use
`token_embedding.weight`; `lm_head.weight` is an alias, not an additional
parameter and not an additional serialized tensor. `lm_head.bias` remains an
independent trainable tensor.

Next-token training uses unweighted categorical cross-entropy over all `B × S`
target positions. v1 fixed-width training does not ignore the pad ID and does
not apply label smoothing.

## 14. Canonical tensor names and shapes

`i` is the zero-based decoder block index.

| Tensor name | Shape |
| --- | --- |
| `token_embedding.weight` | `[V, D]` |
| `position_embedding.weight` | `[T, D]` |
| `blocks.i.ln1.weight` | `[D]` |
| `blocks.i.ln1.bias` | `[D]` |
| `blocks.i.attention.q_proj.weight` | `[D, D]` |
| `blocks.i.attention.q_proj.bias` | `[D]` |
| `blocks.i.attention.k_proj.weight` | `[D, D]` |
| `blocks.i.attention.k_proj.bias` | `[D]` |
| `blocks.i.attention.v_proj.weight` | `[D, D]` |
| `blocks.i.attention.v_proj.bias` | `[D]` |
| `blocks.i.attention.out_proj.weight` | `[D, D]` |
| `blocks.i.attention.out_proj.bias` | `[D]` |
| `blocks.i.ln2.weight` | `[D]` |
| `blocks.i.ln2.bias` | `[D]` |
| `blocks.i.ff_up.weight` | `[F, D]` |
| `blocks.i.ff_up.bias` | `[F]` |
| `blocks.i.ff_down.weight` | `[D, F]` |
| `blocks.i.ff_down.bias` | `[D]` |
| `final_norm.weight` | `[D]` |
| `final_norm.bias` | `[D]` |
| `lm_head.weight` | `[V, D]`, omitted when tied |
| `lm_head.bias` | `[V]` |

Dropout modules and the causal mask contain no serialized trainable tensors.

## 15. Tensor ordering and initialization

### 15.1 Portable tensor order

Serialized tensors MUST be ordered by ascending Unicode code-point
lexicographic order of the complete tensor name. Names contain only ASCII in
v1, so this is equivalent to ascending ASCII order.

Offsets MUST be contiguous. The first tensor starts at byte offset zero. No
padding is inserted between tensors.

### 15.2 Initialization

Before training:

- embedding and linear weights use a normal distribution with mean `0.0` and
  standard deviation `0.02`;
- linear biases are zero;
- layer-normalization scales are one; and
- layer-normalization biases are zero.

When embeddings are tied, both references MUST resolve to the same parameter
before the first forward pass.

The sequence of pseudorandom values used for initial weights is engine-defined.
The same seed MUST reproduce initialization within the same declared training
engine and supported deterministic environment. Different engines are not
required to produce identical initial weight bits from the same seed.
Cross-engine equality is established by loading the same portable
`weights.bin`.

## 16. Parameter formula and verification

### 16.1 Components

```text
token embedding       = V × D
position embedding    = T × D

Q, K, V projections   = 3 × (D × D + D)
attention output      = D × D + D
feed-forward up       = D × F + F
feed-forward down     = F × D + D
two layer norms       = 4 × D

one decoder block     = 4D² + 2DF + 9D + F

final layer norm      = 2 × D
LM head bias          = V
untied LM head weight = D × V
```

### 16.2 Total

Untied:

```text
P = VD + TD + L(4D² + 2DF + 9D + F) + 2D + V + DV
```

Tied:

```text
P = VD + TD + L(4D² + 2DF + 9D + F) + 2D + V
```

### 16.3 Verification rules

Every implementation MUST:

1. validate configuration types and bounds;
2. calculate `P` before allocating model tensors;
3. reject `P > 200000`;
4. construct the model;
5. sum the element count of every unique trainable tensor;
6. require actual count to equal `P`;
7. reject a mismatch before training or export; and
8. repeat formula and tensor-table verification during import.

Aliases such as a tied output weight are counted once.

## 17. Portable package layout

A v1 checkpoint directory or `.mcllm` ZIP contains exactly five root files:

```text
manifest.json
tokenizer.json
training-config.json
training-history.json
weights.bin
```

No directory, nested entry, encrypted entry, symbolic link, executable
serialization, pickle payload, or additional file is allowed.

A `.mcllm` file is a ZIP container. Compression method and ZIP member timestamp
are not semantically significant. Importers MUST validate uncompressed sizes
before allocating large buffers.

v1 limits:

- compressed or uncompressed package total: 20 MiB maximum;
- each JSON document: 2 MiB maximum;
- tensor records: 256 maximum; and
- training-history events: 250 maximum.

## 18. Weight and tensor serialization

`weights.bin` is the byte concatenation of tensors in Section 15 order.

Every tensor:

- is converted to float32;
- contains only finite float32 values;
- uses little-endian byte order;
- uses C row-major element order;
- uses the canonical shape in Section 14; and
- has no header inside `weights.bin`.

Each manifest tensor record contains exactly:

```json
{
  "name": "blocks.0.attention.k_proj.bias",
  "shape": [64],
  "dtype": "float32",
  "layout": "row-major",
  "byte_order": "little",
  "offset": 0,
  "byte_length": 256,
  "sha256": "64 lowercase hexadecimal characters"
}
```

Rules:

```text
element_count = product(shape)
byte_length = element_count × 4
next_offset = offset + byte_length
```

Tensor SHA-256 is calculated over that tensor's exact byte slice.

## 19. Manifest schema

`manifest.json` is UTF-8 JSON and contains exactly these fields:

| Field | Type and v1 requirement |
| --- | --- |
| `format_version` | string, exactly `"1.0"` |
| `architecture_identifier` | exact identifier from this specification |
| `model_hyperparameters` | exact model configuration from Section 5 |
| `normalization` | string, exactly `"pre-normalization"` |
| `position_representation` | string, exactly `"learned-position-embedding"` |
| `tokenizer_type` | string, exactly `"character"` |
| `vocabulary_size` | integer equal to `V` |
| `context_length` | integer equal to `T` |
| `parameter_count` | integer equal to verified `P` |
| `parameter_limit` | integer, exactly `200000` |
| `tied_input_output_embeddings` | Boolean equal to `tie_embeddings` |
| `tensor_count` | integer equal to `tensors.length` |
| `tensors` | ordered tensor records from Section 18 |
| `creation_timestamp` | RFC 3339/ISO-8601 timestamp with UTC offset |
| `training_dataset_identifier` | non-empty string, at most 200 characters |
| `training_dataset_sha256` | 64 lowercase hexadecimal characters |
| `training_engine_identifier` | lowercase versioned identifier matching `[a-z0-9][a-z0-9._-]*-(v)?MAJOR.MINOR.PATCH`, at most 200 characters |
| `weight_format` | exactly `"concatenated-little-endian-float32-row-major"` |
| `files` | integrity records for the four non-manifest files |

The `files` object has exactly:

```text
tokenizer.json
training-config.json
training-history.json
weights.bin
```

Each value contains exactly:

```json
{
  "byte_length": 123,
  "sha256": "64 lowercase hexadecimal characters"
}
```

`manifest.json` does not hash itself, avoiding recursive content.

JSON object key order and indentation are not semantically significant.
Canonical writers SHOULD emit UTF-8, sorted object keys, two-space indentation,
unescaped Unicode, and one trailing newline.

## 20. Training configuration schema

`training-config.json` contains exactly:

```json
{
  "schema_version": "1.0",
  "model": {
    "vocab_size": 35,
    "context_length": 128,
    "embedding_dim": 64,
    "attention_heads": 4,
    "transformer_blocks": 3,
    "feed_forward_dim": 128,
    "dropout": 0.0,
    "tie_embeddings": false
  },
  "training": {
    "learning_rate": 0.001,
    "batch_size": 8,
    "steps": 200,
    "validation_interval": 20,
    "checkpoint_interval": 100,
    "gradient_clip_norm": 1.0,
    "seed": 4242,
    "validation_batches": 8,
    "sample_prompt": "alert: ",
    "sample_max_new_tokens": 80,
    "sample_temperature": 0.8,
    "sample_top_k": 12
  }
}
```

The model object MUST equal the manifest configuration.

Training bounds are:

| Field | Constraint |
| --- | --- |
| `learning_rate` | finite number, `0.000001` through `1.0` |
| `batch_size` | integer, 1 through 64 |
| `steps` | integer, 1 through 100000 |
| `validation_interval` | integer, 1 through 100000 |
| `checkpoint_interval` | integer, 1 through 100000 |
| `gradient_clip_norm` | finite number, 0.01 through 100 |
| `seed` | integer, 0 through 2147483647 |
| `validation_batches` | integer, 1 through 128 |
| `sample_prompt` | string, at most 512 Unicode characters |
| `sample_max_new_tokens` | integer, 1 through 256 |
| `sample_temperature` | finite number, 0.05 through 5.0 |
| `sample_top_k` | integer, 1 through 512 |

v1 training uses fixed AdamW values not separately configurable in this
document:

```text
beta1 = 0.9
beta2 = 0.999
epsilon = 1e-8
weight_decay = 0.01
amsgrad = false
```

AdamW is applied to every trainable tensor, including biases, embeddings, and
layer-normalization parameters. There are no parameter groups exempt from
weight decay. For optimizer step `t`:

```text
m_t = beta1 × m_(t-1) + (1 - beta1) × g_t
v_t = beta2 × v_(t-1) + (1 - beta2) × g_t²
m_hat = m_t / (1 - beta1^t)
v_hat = v_t / (1 - beta2^t)
theta = theta - learning_rate ×
        (m_hat / (sqrt(v_hat) + epsilon) + weight_decay × theta)
```

Before the AdamW update, one global L2 norm is calculated across all parameter
gradients. When it exceeds `gradient_clip_norm`, every gradient is multiplied
by `gradient_clip_norm / global_norm`.

## 21. Training history and checkpoint schema

`training-history.json` contains exactly:

```json
{
  "schema_version": "1.0",
  "events": []
}
```

It contains at most 250 ordered events. Every event contains exactly:

```json
{
  "step": 20,
  "train_loss": 2.73,
  "validation_loss": 2.81,
  "gradient_norm": 0.83,
  "elapsed_seconds": 1.22,
  "sample": "alert: ..."
}
```

Event rules:

- `step` is an integer from 1 through configured `steps`;
- steps are strictly increasing;
- `train_loss` is a finite, non-negative number;
- `validation_loss` is either a finite, non-negative number or `null`;
- `gradient_norm` is a finite, non-negative number;
- `elapsed_seconds` is a finite, non-negative number and is monotonically
  non-decreasing;
- `sample` is a string of at most 4,608 Unicode characters or `null`.

A v1 package is an **inference checkpoint**. It exactly restores model
configuration, tokenizer, weights, training configuration, and bounded
history. It does not contain optimizer slots, data-loader position, or
framework RNG state and therefore MUST NOT be advertised as a bit-identical
resumable training checkpoint.

Directory checkpoint creation SHOULD be transactional: write and validate a
temporary sibling directory, then rename it into place. Existing destinations
MUST NOT be silently overwritten.

## 22. Dataset-to-batch transformation

Training and validation documents remain separate.

For each split, in declared document order:

1. encode one document with `<bos>` prepended and `<eos>` appended;
2. append it to the split token stream;
3. do not insert any additional delimiter; and
4. create fixed-width windows:

```text
input  = stream[start : start + T]
target = stream[start + 1 : start + T + 1]
```

Starts are `0, stride, 2 × stride, ...` while a full target window exists.
Stride is an engine/run input from 1 through `T`; it is not a model
hyperparameter.

Training windows are deterministically shuffled from the training seed.
Validation windows retain ascending start order. v1 uses no padding and does
not mix windows from training and validation documents.

## 23. Training behavior

A training-conformant implementation uses:

- mini-batch next-token cross-entropy;
- AdamW with Section 20 values;
- global gradient-norm clipping before the optimizer update;
- evaluation mode during validation;
- validation at each configured interval and the final step;
- checkpoint sample generation at each checkpoint interval and the final step;
- no gradient accumulation;
- no learning-rate schedule;
- no mixed-precision parameters; and
- no distributed training requirement.

The history retains the newest 250 events. Progress output MAY be presented
more frequently, but exported events MUST conform to Section 21.

## 24. Random seed and generation behavior

### 24.1 Training seed

The integer training seed controls:

- framework/model initialization RNG when set before construction;
- training-window shuffle order;
- training-time dropout; and
- checkpoint sample generation.

An engine MUST document its identifier and deterministic environment. Same
seed, configuration, data, engine version, backend, and supported hardware MUST
reproduce the same result. Cross-engine initial weights and training
trajectories are not required to be bit-identical.

Elapsed wall-clock values are explicitly excluded from deterministic equality.

### 24.2 Generation

Generation:

1. NFC-normalizes and encodes the prompt without automatic BOS/EOS;
2. uses `[<bos>]` when the encoded prompt is empty;
3. retains at most the newest `T` tokens for each forward call;
4. re-indexes retained tokens from position zero;
5. takes logits at the final sequence position;
6. divides logits by temperature;
7. selects the `top_k` greatest logits;
8. applies softmax within those logits;
9. samples one token;
10. stops without appending when token ID 2 is selected; and
11. otherwise appends the token and repeats.

For equal logits at the top-k boundary, lower token ID sorts first.

Generation constraints:

- prompt: at most 4,096 Unicode characters;
- temperature: 0.05 through 5.0;
- top-k: 1 through `V`;
- maximum new tokens: 1 through 256;
- seed: `null` for non-deterministic engine sampling or integer 0 through
  2147483647.

A provided generation seed MUST use an isolated sampling generator and MUST
NOT mutate the model-training generator state. The exact sampling PRNG
algorithm is engine-defined; cross-engine generated text is guaranteed only
when implementations also share an explicitly versioned sampling algorithm.

## 25. Logical training-state schema

Training state is a runtime contract, distinct from the inference checkpoint.
Implementations MAY keep it only in memory in v1.

```json
{
  "schema_version": "1.0",
  "status": "paused",
  "mode": "local",
  "run_id": "opaque engine-local identifier",
  "dataset": {
    "dataset_id": "cybersecurity-alerts-v1",
    "sha256": "64 lowercase hexadecimal characters"
  },
  "model": {
    "architecture_identifier": "microcomp.char-decoder-transformer.pre-norm.v1",
    "parameter_count": 113251
  },
  "optimizer": {
    "type": "adamw",
    "learning_rate": 0.001,
    "beta1": 0.9,
    "beta2": 0.999,
    "epsilon": 1e-8,
    "weight_decay": 0.01
  },
  "progress": {
    "global_step": 20,
    "train_loss": 2.73,
    "validation_loss": 2.81,
    "tokens_processed": 20480,
    "elapsed_seconds": 1.22
  },
  "seed": 4242,
  "created_at": "2026-07-28T12:00:00+00:00",
  "updated_at": "2026-07-28T12:00:01+00:00"
}
```

Allowed statuses:

```text
ready
running
paused
completed
cancelled
failed
expired
```

Allowed modes are `local` and `cloud`. Status changes MUST occur through the
owning engine's lifecycle operations. A v1 `.mcllm` package does not claim to
restore this runtime state.

## 26. Import/export compatibility

An importer MUST:

1. enforce package and per-JSON size limits;
2. reject unsafe ZIP entries before extraction;
3. require exactly the five files;
4. parse UTF-8 JSON objects;
5. require exact schema fields and supported versions;
6. validate architecture and duplicated manifest fields;
7. recalculate the parameter formula;
8. reconstruct the expected canonical tensor names and shapes from config;
9. require tensor records in canonical lexicographic order;
10. validate contiguous offsets, sizes, dtypes, layouts, and byte order;
11. reject NaN and positive or negative infinity in weight tensors;
12. validate per-file and per-tensor SHA-256 values;
13. require the tensor element sum to equal `parameter_count`;
14. validate tokenizer and training documents; and
15. copy float32 values into the corresponding canonical tensors without
    transposing serialized data.

A framework whose internal linear-weight layout is
`[in_features, out_features]` MUST transpose at its internal boundary. It MUST
still read and write the canonical `[out_features, in_features]` layout.

A load followed immediately by save MUST preserve parameter values exactly,
although JSON formatting, ZIP compression, and ZIP timestamps MAY differ.

## 27. Backward compatibility

All packages with:

```text
format_version = "1.0"
architecture_identifier = "microcomp.char-decoder-transformer.pre-norm.v1"
```

MUST be interpreted using this document.

Readers MUST NOT guess the meaning of an unknown architecture identifier,
unknown required field, invalid tensor alias, or unsupported major format.
Failure MUST be explicit and occur before model use.

Optional behavior cannot be retroactively added to format `1.0` because its
schemas reject unknown fields. A backward-compatible metadata addition requires
format `1.1`.

Implementation bug fixes that do not change serialized tensor semantics may
retain the architecture identifier. A bug fix that changes a normative forward
result or tokenizer mapping requires a new architecture version unless it only
corrects a previously non-conformant implementation.

## 28. Future migration rules

A migration is an explicit, versioned transformation. It MUST:

- name source and destination package versions;
- name source and destination architecture identifiers;
- validate the complete source before transformation;
- never modify the source artifact in place;
- produce a new destination artifact;
- recalculate tensor and file hashes;
- record migration provenance in a destination format that supports it;
- fail rather than invent weights for a structurally incompatible tensor; and
- include golden tokenizer, parameter, tensor-shape, logits, and round-trip
  tests.

Examples:

- Adding optional non-semantic metadata may migrate `1.0` to `1.1` without an
  architecture change.
- Changing GELU approximation, position encoding, normalization epsilon,
  reserved token IDs, tensor names, or projection biases requires architecture
  `.v2`.
- Adding optimizer state requires a later checkpoint/package format and MUST
  distinguish resumable checkpoints from inference packages.

No implementation may silently relabel a v1 package as a newer architecture.

## 29. Canonical conformance vectors

Every implementation SHOULD include these minimum tests:

1. For `V=35, T=128, D=64, H=4, L=3, F=128`, untied count is `113251`.
2. Tying embeddings removes exactly `V × D = 2240` parameters.
3. `D=48, H=5` is rejected.
4. Any calculated count above 200,000 is rejected before model allocation.
5. Changing a future token cannot change earlier-position logits when dropout
   is disabled.
6. Unknown input encodes to ID 3.
7. Default decoding of ID 3 produces U+FFFD.
8. Tied packages omit `lm_head.weight`.
9. Untied packages include `lm_head.weight` with shape `[V, D]`.
10. Tensor records are lexicographically ordered and contiguous.
11. Checkpoint load preserves every parameter bit and produces equal logits in
    the same engine.
12. Malformed, oversized, traversal, hash-invalid, schema-invalid, and
    over-limit packages are rejected.
