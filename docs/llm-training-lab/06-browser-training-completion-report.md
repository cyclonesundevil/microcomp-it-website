# Completion Report: Full Browser Training

Status: Complete

Completion date: July 28, 2026

Remote repository updated: No

## Requested outcome

Replace the simulated browser-training experience with a real, observable,
deterministic training implementation that conforms to
`docs/model-specification-v1.md`, runs entirely inside the existing Web Worker,
supports lifecycle control and completed-only persistence, and provides an
advanced replayable Learning Explorer.

## Training architecture

The existing inference worker remains the sole model-computation boundary.
Training dependencies are loaded lazily only after a user starts a training
run:

```text
UI thread
  -> versioned worker commands
  -> existing inference-worker.js
       -> canonical configuration and tokenizer validation
       -> locally vendored TensorFlow.js 4.22.0 CPU backend
       -> specification-v1 differentiable forward pass
       -> backpropagation
       -> global gradient clipping
       -> AdamW update
       -> validation and replay capture
       -> existing CPU inference model after completion
       -> IndexedDB persistence after completion only
```

The UI thread never receives model weights, gradients, optimizer slots, or
activation tensors. It receives scalar metrics and bounded educational
snapshots containing copied numeric observations.

TensorFlow.js was selected in the repository architecture plan because it
provides browser automatic differentiation and custom optimization while
supporting Web Worker execution. The runtime is pinned and served locally;
training makes no CDN request. Official TensorFlow.js documentation describes
both Core API optimizer loops and worker-based training:

- [Training models with TensorFlow.js](https://www.tensorflow.org/js/guide/train_models)
- [Train a model using a web worker](https://www.tensorflow.org/js/tutorials/training/web_worker)

## Canonical training behavior

Implemented:

- specification-v1 character tokenization and NFC normalization;
- separate bundled training and validation documents;
- `<bos>` and `<eos>` document boundaries;
- fixed-width next-token windows;
- seeded deterministic Fisher-Yates training-window shuffling;
- mini-batch categorical cross-entropy;
- differentiable learned token and position embeddings;
- differentiable pre-normalized causal decoder blocks;
- exact-form GELU through `erf`;
- tied and untied embedding configurations;
- dropout with deterministic per-step seeds when enabled;
- AdamW with:
  - beta 1 `0.9`;
  - beta 2 `0.999`;
  - epsilon `1e-8`;
  - weight decay `0.01`;
  - weight decay applied to every unique trainable tensor;
- one global L2 gradient norm;
- clipping before the optimizer update;
- learning rate, batch, step, interval, clip, stride, and seed controls;
- evaluation-mode validation;
- real checkpoint samples through the existing inference engine;
- pause and resume without losing in-memory weights or optimizer slots;
- cancellation at a cooperative worker step boundary;
- explicit tensor disposal on completion, cancellation, and failure; and
- a 500-step / 101-snapshot browser resource boundary.

No cloud request or arbitrary dataset upload was introduced.

## Real metrics and lifecycle

The former scripted reducer and simulated chart were removed.

The worker emits:

```text
LIFECYCLE
PROGRESS
SNAPSHOT
COMPLETED
CANCELLED
FAILED
PERSISTED
PERSISTENCE_FAILED
```

The production UI now displays worker measurements for:

- training step;
- training loss;
- validation loss;
- tokens processed;
- active elapsed time;
- estimated remaining time;
- pre-clip gradient norm in the worker event contract;
- retained TensorFlow tensor memory; and
- completion/persistence state.

The loss chart contains only measured training and validation values. Paused
time is excluded from elapsed time and ETA calculations.

## Learning Explorer

Every replay checkpoint stores:

- checkpoint index and training step;
- measured training loss;
- measured validation loss;
- deterministic generated sample;
- exact parameter count;
- elapsed active time;
- token IDs for the bounded probe prompt;
- first-block attention for every head, up to 16 positions;
- selected token-embedding rows, up to 12 tokens and 8 dimensions;
- final-position logits;
- final-position softmax probabilities;
- highest-probability next-token selection; and
- mean-absolute and RMS activation summaries for embeddings, each decoder
  block, and final normalization.

The UI provides:

- a replay scrubber;
- automatic replay playback;
- embedding-evolution lines across snapshots;
- selectable attention heads and causal attention matrices;
- ranked logit bars;
- ranked probability bars;
- next-token identity and probability;
- layer-activation magnitude bars; and
- the checkpoint loss, sample, parameter count, and retained tensor memory.

Snapshots are observations, not full weight copies. This bounds replay memory
while preserving educational changes over time.

## Persistence

IndexedDB database:

```text
microcomp-llm-training-lab
```

Object store:

```text
completed-models
```

Persistence is called only after the worker reaches `completed`. The storage
layer independently rejects any record whose status is not `completed`.

Saved records contain:

- canonical configuration;
- tokenizer;
- final float32 weights;
- training controls;
- final metrics;
- measured history; and
- bounded replay snapshots.

Paused, running, cancelled, and failed runs are never written. A browser smoke
test verified save, list, reload, parameter-count preservation, and generation
from the reloaded model.

## Training speed

These are observed measurements on the current Windows workstation. They are
not universal promises.

### Chrome 2026 desktop, TensorFlow.js CPU worker

Small smoke configuration:

```text
V=35, T=8, D=8, H=2, L=1, F=16
Parameters: 1,275
Batch size: 1
Steps: 3
Elapsed active time: 0.0711 seconds
Approximate rate: 42.2 steps/second
Approximate rate: 337.6 tokens/second
Snapshots: 4 including baseline
```

Classroom configuration:

```text
V=35, T=128, D=64, H=4, L=3, F=128
Parameters: 113,251
Batch size: 1
Steps: 2
Elapsed active time: 2.0611 seconds
Approximate rate: 0.97 steps/second
Approximate rate: 124.2 tokens/second
Snapshots: 3 including baseline
```

Elapsed time includes real validation and deterministic snapshot generation,
not just optimizer kernels. The production default uses batch size 2 and 40
steps; completion time will vary materially by processor and checkpoint
frequency.

The Chrome classroom run recorded 232 main-thread timer ticks while its worker
trained, validated, captured snapshots, persisted, and generated text. This
confirms that the UI event loop remained responsive during the measured run.

## Memory usage

Retained TensorFlow memory reported after a training step:

| Configuration | Parameters | Model weights | Adam slots | Retained TensorFlow total |
| --- | ---: | ---: | ---: | ---: |
| Small smoke | 1,275 | 5,100 bytes | 10,200 bytes | 15,300 bytes |
| Classroom | 113,251 | 453,004 bytes | 906,008 bytes | 1,359,012 bytes |

The classroom run retained 162 TensorFlow tensors. Disposal tests returned the
TensorFlow tensor count to zero after terminal runs.

These figures cover model variables and the two Adam slot arrays. They do not
represent total browser-process memory. Temporary gradients, forward
activations, TensorFlow.js engine objects, JavaScript replay objects, the final
CPU inference copy, and IndexedDB implementation overhead can increase peak
memory. TensorFlow.js does not expose a portable, reliable browser-process peak
resident-memory measurement.

## Browser compatibility

Verified on this workstation:

| Browser | Worker training | Validation | Replay | IndexedDB save/reload | Inference after training |
| --- | --- | --- | --- | --- | --- |
| Google Chrome desktop | Passed | Passed | Passed | Passed | Passed |
| Microsoft Edge desktop | Passed | Passed | Passed | Passed | Passed |

Both browsers selected the locally vendored TensorFlow.js CPU backend. The
existing capability page still reports WebGPU, WebAssembly, and CPU
availability separately.

WebGPU and WebAssembly training kernels are not enabled in this milestone.
Firefox and Safari were not available on the test workstation and therefore
are not claimed as verified.

Required browser primitives:

- Web Workers;
- typed arrays;
- IndexedDB in workers;
- Promises;
- Unicode normalization; and
- the TensorFlow.js CPU backend.

## Python and inference parity

The TensorFlow.js training forward pass was tested against the same
Python-produced deterministic fixture used by the inference engine.

```text
Logit shape: [1, 4, 7]
Maximum absolute TensorFlow/Python error: 1.4901161193847656e-8
Allowed tolerance: 2e-5
Result: passed
```

The existing pure JavaScript inference engine remains the post-training
generation runtime. Final TensorFlow variables are copied by canonical tensor
name and shape into that engine after successful completion.

## Regression results

JavaScript:

```powershell
node --test tests/*.test.js
```

```text
102 passed
0 failed
```

The focused browser-training suite contains nine tests covering:

- canonical dataset windows;
- finite AdamW steps;
- global gradient clipping;
- TensorFlow/Python logit parity;
- tied embeddings;
- deterministic complete runs;
- validation and Learning Explorer snapshots;
- pause/resume;
- cancellation and disposal; and
- worker/persistence/UI contracts.

Python:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

```text
31 passed
0 failed
```

Browser tests:

```text
Chrome small worker run: passed
Chrome classroom worker run: passed
Edge small worker run: passed
Production training UI run: passed
Completed-only persistence and reload: passed
Post-training generation: passed
```

## Files created

```text
docs/llm-training-lab/06-browser-training-completion-report.md
frontend/llm-training-lab/local-training-client.js
frontend/llm-training-lab/training-core.js
frontend/llm-training-lab/training-runner.js
frontend/llm-training-lab/training-storage.js
frontend/llm-training-lab/vendor/README.md
frontend/llm-training-lab/vendor/tf.min.js
tests/browser-training-smoke.html
tests/llm-browser-training.test.js
```

## Files updated

```text
frontend/demo-lab/llm-training-simulation.html
frontend/llm-training-lab.css
frontend/llm-training-lab/inference-worker.js
frontend/llm-training-lab.js
tests/llm-browser-inference.test.js
tests/llm-training-lab.test.js
```

The obsolete scripted `frontend/llm-training-lab/preview-state.js` module was
removed.

## Remaining limitations

1. Training uses the TensorFlow.js CPU backend. WebGPU and WASM acceleration
   remain future work.
2. A 113,251-parameter classroom model is intentionally slow compared with a
   production ML stack; snapshot generation and validation add visible cost.
3. Pause and resume are in-memory lifecycle operations. Reloading the page
   ends an incomplete run because incomplete state is intentionally not
   persisted.
4. Completed records do not contain Adam slots because completed models are
   persisted for replay and inference, not continued optimization.
5. Replay stores bounded observations rather than every activation, every
   attention block, or full weight copies.
6. The UI displays one selectable attention head at a time from the first
   decoder block.
7. Browser background-tab suspension can delay a run.
8. IndexedDB can be cleared by the user, browser, storage pressure, or privacy
   settings; it is not a durability guarantee.
9. TensorFlow.js retained tensor bytes are not a browser-process peak-memory
   measurement.
10. Firefox, Safari, mobile thermal throttling, and low-memory mobile devices
    remain unverified.
11. The model remains educational: character-level, data-limited, short-context,
    and unsuitable for factual or cybersecurity decisions.
