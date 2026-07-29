# Completion Report: Browser Inference Engine

Status: Complete

Completion date: July 28, 2026

Remote repository updated: No

Training implemented: No

## Requested outcome

Implement the specification-v1 browser inference engine without adding
training. The browser must construct and inspect models, run causal forward
propagation, produce logits, generate text with temperature and top-k sampling,
keep model tensors out of the UI thread, and prove compatibility with the
Python reference.

## Browser architecture

The implementation is framework-free and divided into four boundaries:

1. `model-contract.js` validates exact model/manifest schemas, calculates the
   parameter count, reconstructs canonical tensor names and shapes, and decodes
   portable little-endian float32 weights.
2. `inference-tokenizer.js` implements the specification-v1 NFC character
   tokenizer, reserved IDs, unknown-character behavior, and decoding.
3. `inference-core.js` implements float32 embeddings, learned positions,
   pre-normalized decoder blocks, causal multi-head attention, exact-form GELU,
   feed-forward layers, final normalization, the language-model projection,
   logits, temperature, top-k, context truncation, and generation.
4. `inference-worker.js` exclusively owns tokenizers, weight tensors,
   activations, model instances, forward propagation, and generation.

The UI controller communicates through a versioned worker message protocol:

```text
PROBE_CAPABILITIES
LOAD_FIXTURE
LOAD_MODEL_URLS
CREATE_MODEL
INSPECT
FORWARD
GENERATE
DISPOSE
```

The UI thread receives only capability information, model metadata, requested
logits, token IDs, and generated text. It never constructs or receives model
weight tensors.

## Runtime selected

Selected runtime:

```text
cpu-reference-v1
```

This milestone uses worker-owned JavaScript `Float32Array` CPU kernels. This is
the most direct reference implementation of the canonical architecture and
does not add a browser ML dependency or framework.

The capability page independently reports:

- WebGPU adapter availability;
- WebAssembly validation availability; and
- CPU fallback availability and active status.

WebGPU and WebAssembly are explicitly shown as available-but-idle when the
browser supports them. No accelerated kernel is claimed or selected in this
milestone. CPU is the active inference runtime.

## Implemented inference behavior

- strict specification-v1 configuration validation;
- pre-allocation rejection above 200,000 parameters;
- exact parameter formula and canonical tensor table;
- untied and tied input/output embeddings;
- NFC character tokenization;
- fixed reserved IDs `0` through `3`;
- learned absolute positional embeddings;
- pre-normalized decoder blocks;
- separate biased Q, K, V, and output projections;
- lower-triangular causal masking including the diagonal;
- population-variance layer normalization with epsilon `1e-5`;
- exact error-function GELU;
- biased feed-forward projections;
- final layer normalization and vocabulary projection;
- logits with shape `[batch, sequence, vocabulary]`;
- context-window suffix truncation and position re-indexing;
- temperature scaling;
- stable top-k selection with lower token IDs winning ties;
- isolated seeded sampling;
- EOS stopping; and
- explicit model disposal that clears worker-owned tensors.

No optimizer, gradient calculation, backward pass, Adam/AdamW state, training
loop, checkpoint writer, or training chart was added.

## Compatibility report

The Python reference generates the committed fixture:

```text
frontend/llm-training-lab/fixtures/python-parity-v1.json
```

The fixture uses an engine-independent canonical tensor-fill recipe and
contains the actual Python manifest, tokenizer document, input token IDs,
logit shape, expected logits, tolerance, and deterministic top-k-one
generation result.

Browser compatibility checks:

| Contract | Result |
| --- | --- |
| Tokenizer IDs and unknown-character behavior | Passed |
| Exact parameter count | Passed |
| Canonical tensor names | Passed |
| Canonical tensor shapes and ordering | Passed |
| Strict manifest validation | Passed |
| Deterministic forward logits | Passed |
| Deterministic top-k-one generation | Passed |
| Causal masking | Passed |

The browser can also load `manifest.json`, `tokenizer.json`, and `weights.bin`
from a canonical directory inside the worker. It validates the complete
manifest tensor contract, whole-weight SHA-256, every tensor SHA-256, byte
lengths, contiguous offsets, dtype, byte order, layout, finite values, names,
shapes, and parameter total before constructing the model.

## Python parity report

Parity fixture:

```text
Architecture:          microcomp.char-decoder-transformer.pre-norm.v1
Python engine:         microcomp-pytorch-reference-0.1.0
Configuration:         V=7, T=4, D=4, H=1, L=1, F=4
Parameter count:       223
Tensor count:          22
Fixture logits shape:  [1, 4, 7]
Maximum absolute error: 7.450580596923828e-9
Allowed tolerance:      2e-5
Generation prompt:      ab
Python output:           ab
Browser output:          ab
```

The maximum observed logit error is approximately 2,684 times smaller than the
allowed tolerance. Cross-engine generated text is only asserted with `top_k=1`
because specification v1 deliberately allows engine-specific sampling PRNGs.

The Python test rebuilds the fixture and requires exact JSON equality with the
committed browser fixture, preventing an implementation change from silently
making the fixture stale.

## Capability page

Route:

```text
/demo-lab/llm-inference-capabilities.html
```

The page includes:

- separate WebGPU, WebAssembly, and CPU capability states;
- selected-runtime reasoning;
- a visual worker ownership boundary;
- live six-part Python parity status;
- model configuration and parameter inspection;
- the canonical tensor table;
- worker-driven generation controls;
- a requested-logits inspector;
- clear inference-only scope language;
- keyboard labels and visible focus states;
- live status announcements;
- responsive desktop, tablet, and mobile layouts; and
- light and dark theme support.

The existing training lab links to this capability page, and the route is
included in `frontend/sitemap.xml`.

## Files created

```text
docs/llm-training-lab/05-browser-inference-completion-report.md
frontend/demo-lab/llm-inference-capabilities.html
frontend/llm-inference.css
frontend/llm-inference-page.js
frontend/llm-training-lab/fixtures/python-parity-v1.json
frontend/llm-training-lab/inference-core.js
frontend/llm-training-lab/inference-tokenizer.js
frontend/llm-training-lab/inference-worker.js
frontend/llm-training-lab/model-contract.js
llm-training-lab/python-reference/microcomp_llm/browser_fixture.py
llm-training-lab/python-reference/tests/test_browser_compatibility.py
tests/llm-browser-inference.test.js
```

## Existing files updated

```text
frontend/demo-lab/llm-training-simulation.html
frontend/llm-training-lab.css
frontend/sitemap.xml
```

## Tests

JavaScript command:

```powershell
node --test tests/llm-browser-inference.test.js tests/llm-training-lab.test.js
```

Result:

```text
21 passed, 0 failed
```

Python command:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

```text
31 passed, 0 failed
```

Browser smoke validation:

```text
Chrome headless served the production route over localhost.
Worker initialization completed.
Selected runtime rendered as cpu-reference-v1.
Python compatibility rendered as 6 / 6 passed.
Result: passed.
```

Additional validation:

```text
git diff --check: passed
```

## Deferred by design

- browser training;
- optimizers and gradient computation;
- model-weight mutation;
- training checkpoints;
- import UI for `.mcllm` ZIP files;
- WebGPU inference kernels;
- WebAssembly inference kernels;
- key/value caching; and
- performance charts.

These are outside the requested inference-only milestone.
