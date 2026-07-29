# Completion Report: Canonical Model Specification v1

Status: Complete

Completion date: July 28, 2026

Remote repository updated: No

Website implementation modified: No

## Requested outcome

Create the authoritative Tiny LLM architecture contract, compare the Python
reference against it, resolve ambiguities, update Python only where required
for conformance, and run all Python tests.

## Canonical specification created

Created:

- [`docs/model-specification-v1.md`](../model-specification-v1.md)

Canonical identifiers:

```text
Specification version:       1.0.0
Architecture identifier:     microcomp.char-decoder-transformer.pre-norm.v1
Portable package version:    1.0
Maximum trainable parameters: 200000
```

The specification explicitly states that implementations conform to the
document. Python, browser, and future cloud source code do not independently
define the architecture.

## Specification coverage

The specification defines:

- conformance levels;
- architecture and package versioning;
- model configuration and bounds;
- reserved token IDs;
- Unicode NFC normalization;
- character vocabulary construction and ordering;
- encoding, decoding, and unknown-character behavior;
- token and position embeddings;
- learned absolute position indexing;
- complete forward-pass ordering;
- pre-normalized residual blocks;
- causal multi-head self-attention equations;
- attention masking and softmax dimension;
- attention and output dropout positions;
- layer-normalization epsilon and variance convention;
- exact GELU rather than approximate GELU;
- feed-forward ordering;
- final normalization and vocabulary projection;
- tied-embedding behavior;
- cross-entropy behavior;
- every canonical tensor name and shape;
- tensor ordering;
- weight initialization categories;
- float32 requirements;
- parameter formulas and verification;
- package layout and size limits;
- raw weight serialization;
- tensor metadata;
- complete manifest schema;
- tokenizer schema;
- training-configuration schema;
- AdamW constants and update semantics;
- gradient clipping;
- training-history schema;
- inference-checkpoint boundaries;
- dataset-to-window transformation;
- generation and top-k behavior;
- random-seed guarantees and limitations;
- runtime training-state schema;
- import/export requirements;
- backward compatibility;
- future migrations; and
- minimum conformance vectors.

## Ambiguities discovered

### 1. Source-of-truth ambiguity

The plan and Python README described the architecture, while Python source
contained the executable behavior. None was explicitly authoritative.

### 2. Unicode normalization

The planning direction and browser tokenizer used NFC, but Python accepted both
NFC and NFKC. Those forms can produce different vocabularies and token IDs.

### 3. Unicode character definition

“Character” did not explicitly distinguish Unicode scalar values from UTF-16
code units or invalid surrogate code points.

### 4. Tokenizer metadata

Python serialized an `unknown_behavior` declaration but did not validate its
value during import.

### 5. Layer normalization

Layer-normalization epsilon, affine state, normalized axis, and population
variance behavior were inherited from framework defaults.

### 6. GELU

The implementation called GELU without stating whether the exact error-function
form or tanh approximation was canonical.

### 7. Numerical dtype

Packages used float32, but model construction could theoretically inherit a
different process-wide PyTorch default dtype.

### 8. Tensor ordering and tied weights

The writer sorted tensors, but the importer did not require canonical order.
The omission rule for `lm_head.weight` in tied models was not previously
normative.

### 9. Non-finite weights

The package validator checked hashes and shapes but did not reject NaN or
infinite parameter values.

### 10. Optimizer defaults

AdamW beta values, epsilon, weight decay, AMSGrad state, and weight-decay
parameter scope were implicit PyTorch defaults.

### 11. Top-k ties

Generation did not define how equal logits at the top-k boundary were ordered.

### 12. Seed guarantees

“Deterministic” did not separate same-engine reproducibility from impossible
blanket guarantees across different frameworks and hardware.

### 13. Training history

The package accepted up to 100,000 arbitrary JSON events even though the
trainer retained 250 structured events.

### 14. Checkpoint meaning

The package was called a checkpoint but omitted optimizer slots, data-loader
position, and RNG state. It was unclear whether exact training resume was
promised.

### 15. Manifest validation

Timezone offsets, lowercase SHA-256 syntax, bounded dataset identifiers, and a
versioned training-engine identifier were not fully constrained.

### 16. Archive entries

Path traversal and nested files were rejected, but symbolic-link entries were
not explicitly rejected in both directory and ZIP representations.

### 17. Backward compatibility

There was no rule explaining which changes require a new package minor version
versus a new architecture identifier.

## Ambiguities resolved

The canonical decisions are:

1. `docs/model-specification-v1.md` controls all implementations.
2. v1 normalization is NFC only.
3. Vocabulary entries are Unicode scalar values ordered by code point.
4. Reserved IDs are permanently `pad=0`, `bos=1`, `eos=2`, `unk=3`.
5. Unknown characters encode to ID 3 and default decode to U+FFFD.
6. Layer normalization uses the final width axis, affine parameters, population
   variance, and epsilon `1e-5`.
7. GELU uses the exact error-function form.
8. Model parameters and portable tensors are float32.
9. Tensor records use canonical names in lexicographic order.
10. Linear weights serialize as `[out_features, in_features]`.
11. Tied models serialize `token_embedding.weight` once and omit
    `lm_head.weight`.
12. Non-finite package weights are invalid.
13. AdamW uses betas `(0.9, 0.999)`, epsilon `1e-8`, weight decay `0.01`, and
    no AMSGrad.
14. Weight decay applies to every trainable tensor.
15. Gradient clipping uses one global L2 norm.
16. Top-k ties prefer lower token IDs.
17. Same-seed equality is required within the same declared deterministic
    engine/environment; portable weights define cross-engine identity.
18. Training history contains at most 250 strictly validated events.
19. v1 packages are inference checkpoints, not exact resumable-training
    checkpoints.
20. Package timestamps require a UTC offset.
21. SHA-256 values use exactly 64 lowercase hexadecimal characters.
22. Training engine identifiers are lowercase and versioned.
23. Directory and ZIP symbolic links are rejected.
24. Architecture-changing behavior requires `.v2`; backward-compatible
    metadata requires package `1.1`; migrations never overwrite a source
    artifact.

## Python conformance changes

### Configuration

- Reject non-Boolean `tie_embeddings`.
- Reject non-finite dropout, learning rate, gradient clipping, and sample
  temperature values.
- Reject non-object model and training configuration documents.

### Tokenizer

- Require NFC.
- Reject NFKC.
- Reject surrogate code points as vocabulary characters.
- Validate the exact unknown-character behavior declaration.

### Model

- Make LayerNorm epsilon and affine behavior explicit.
- Make exact GELU explicit.
- Force model parameters to float32.

### Inference

- Reject Boolean and non-finite temperature values.
- Use stable descending logit ordering so lower token IDs win equal-logit
  top-k ties.

### Training

- Pass every canonical AdamW setting explicitly instead of relying on framework
  defaults.

### Packages

- Limit history to 250 canonical events.
- Validate every history field, step ordering, elapsed ordering, and finite
  metric value.
- Require timezone-aware creation timestamps.
- Validate dataset and tensor SHA-256 syntax.
- Validate versioned engine identifiers.
- Require canonical tensor order.
- Reject non-finite tensor values.
- Reject directory and ZIP symbolic links.
- Preserve existing transactional checkpoint behavior.

### Documentation

- Updated the Python README to defer to the canonical specification.
- Updated parameter-accounting documentation to reference specification v1
  rather than `model.py` as the authority.

## Files modified

Created:

```text
docs/model-specification-v1.md
docs/llm-training-lab/04-model-specification-v1-completion-report.md
```

Updated:

```text
llm-training-lab/python-reference/README.md
llm-training-lab/python-reference/microcomp_llm/config.py
llm-training-lab/python-reference/microcomp_llm/inference.py
llm-training-lab/python-reference/microcomp_llm/model.py
llm-training-lab/python-reference/microcomp_llm/parameters.py
llm-training-lab/python-reference/microcomp_llm/portable.py
llm-training-lab/python-reference/microcomp_llm/tokenizer.py
llm-training-lab/python-reference/microcomp_llm/training.py
llm-training-lab/python-reference/tests/test_model.py
llm-training-lab/python-reference/tests/test_portable.py
llm-training-lab/python-reference/tests/test_tokenizer_dataset.py
```

No file under `frontend/` or `backend/` was modified for this task.

## Regression results

Command:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
30 passed in 4.94s
```

Additional validation:

```text
Python compileall: passed
git diff --check: passed
```

The suite increased from 24 to 30 tests. New coverage includes:

- canonical scalar configuration types;
- explicit LayerNorm/float32 behavior;
- NFC-only tokenizer behavior;
- exact tokenizer metadata;
- tied-package tensor omission;
- canonical tensor ordering;
- strict history schema;
- timezone-aware timestamps; and
- non-finite weight rejection with transactional cleanup.

## Compatibility note

Models and packages produced through the normal Python training path already
use the canonical tensor names, full history events, UTC timestamps, and valid
hashes. A hand-built pre-specification artifact that relied on previously
permissive arbitrary history objects, NFKC tokenization, naive timestamps, or
non-finite weights is now correctly rejected as non-conformant format `1.0`.
