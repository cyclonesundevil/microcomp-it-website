# LLM Training Simulation Lab — Implementation Plan

Status: planning only
Prepared: July 28, 2026
Implementation code included: no

## 1. Executive recommendation

Build the lab as a new dependency-light static experience within the existing Demo Lab, with two deliberately separated execution paths:

1. **Local mode** uses TensorFlow.js inside a dedicated Web Worker. Training, inference, checkpoints, and curated data stay in the visitor's browser. Use TensorFlow.js WebGPU when it passes a runtime capability test, TensorFlow.js WASM as the primary CPU fallback, and the plain JavaScript CPU backend only as a last-resort compatibility path.
2. **Cloud mode** is added later as a separate `llm-training-service/` FastAPI Render Web Service. It uses the same manifest, tokenizer, architecture rules, parameter counter, datasets, and package format as local mode. Cloud jobs are anonymous, tightly bounded, temporary, token-protected, and deleted automatically.

Use a very small character-level, decoder-only Transformer with causal self-attention. Enforce the 200,000-trainable-parameter ceiling twice: first with a pure preflight formula before model allocation and again by summing actual trainable weight sizes after construction.

Do not add a frontend framework or modify the existing Quart application for training. The current site is already a static HTML/CSS/JavaScript application, and this lab can follow that structure.

## 2. Repository findings

### 2.1 Current top-level architecture

```text
backend/       Existing Quart application and website API
docs/          Architecture, audit, and implementation documents
frontend/      Dependency-free static website and interactive demos
mcp-server/    Separate TypeScript/Node MCP service
tests/         Node built-in tests for the cybersecurity lab
```

The Git worktree was clean at the start of planning, and `main` matched `origin/main`.

### 2.2 Frontend architecture

The frontend is composed of directly served HTML, CSS, and browser JavaScript. There is no global frontend package manager, bundler, component framework, or compile step.

Relevant conventions:

- `frontend/index.html` is the home page.
- `frontend/demo-lab.html` is the directory for interactive experiences.
- Canonical nested lab routes are already established by `frontend/demo-lab/cybersecurity-simulation.html`.
- `frontend/styles.css` owns the shared design tokens, navigation, buttons, cards, footer, responsive behavior, light mode, and dark mode.
- `frontend/theme.js` stores the selected theme in `localStorage` under `microcomp-theme` and updates controls marked with `data-theme-toggle`.
- `frontend/analytics.js` handles existing site analytics and disables unsupported local behavior.
- Individual demos use dedicated page, controller, and style files rather than a framework.
- Font Awesome and Google Fonts are loaded externally by existing pages.

The visual system uses:

- Inter typography;
- cyan and purple accents;
- dark glass-like surfaces;
- explicit light-theme variables;
- reusable `.navbar`, `.site-footer`, `.btn-primary`, `.theme-toggle`, `.demo-card`, and grid patterns;
- responsive breakpoints around 820 and 520 pixels;
- visible focus treatment and established accessibility remediation.

### 2.3 Existing backend

`backend/app.py` is a single Quart application that:

- serves the static `frontend/` directory;
- provides contact, analytics, NFL, chat, and voice routes;
- contains integrations and operational state unrelated to model training;
- binds to `0.0.0.0:$PORT`;
- uses Hypercorn/Quart dependencies;
- writes some local analytics/cache data.

The training backend should not be added to this file. ML dependencies, CPU-bound job execution, temporary artifacts, and job cleanup have different deployment and failure characteristics. Keeping them isolated prevents a training job from delaying the existing website, chat, contact, analytics, or sports endpoints.

### 2.4 Existing deployment model

No repository-managed `render.yaml` is present. Services are configured manually in Render.

The repository already demonstrates a multi-service approach:

- the existing website/Quart service;
- the separate `mcp-server/` Node service.

The LLM cloud trainer should follow the same pattern with a third, independently deployable root directory. Render Web Services require binding to `0.0.0.0`, and their default filesystem is ephemeral. That matches the requirement that cloud models be temporary. Persistent disks are unnecessary for the first cloud release.

### 2.5 Existing test process

The frontend currently has no global build or lint command. The cybersecurity lab uses:

- pure/domain JavaScript that can run under Node;
- Node's built-in `node:test`;
- static DOM and asset contract checks;
- syntax tests;
- targeted headless-browser and accessibility validation.

The new lab should preserve this lightweight default and add only a scoped test tool where an actual browser ML backend must be exercised.

## 3. Recommended page and route

### Canonical route

```text
frontend/demo-lab/llm-training-simulation.html
```

Public URL:

```text
/demo-lab/llm-training-simulation.html
```

This follows the existing cybersecurity lab convention and keeps educational simulations together.

### Compatibility route

When implementation begins, add:

```text
frontend/llm-training-simulation.html
```

It should be a minimal same-origin redirect to the canonical nested route. This preserves simple direct links while avoiding two maintained page implementations.

### Discovery

After the first working vertical slice:

- add an “LLM Training Simulation Lab” card to `frontend/demo-lab.html`;
- add a small home-page promotion only after the lab has passed performance and accessibility gates;
- update `frontend/sitemap.xml`;
- retain all current navigation links and demos.

### Page information architecture

Recommended desktop regions:

1. Site navigation
2. Lab introduction and educational disclaimer
3. Local/cloud privacy comparison
4. Mode selector
5. Dataset and model configurator
6. Live parameter budget
7. Runtime/backend capability panel
8. Training controls and progress
9. Loss/validation charts and training event log
10. Model/attention inspector
11. Prompt and generation playground
12. Saved-model library and export/import controls
13. Educational explanations and limitations
14. Site footer

Local and cloud modes must never be distinguished by color alone. Every relevant panel should display a persistent text badge:

```text
LOCAL — Data and model stay in this browser
```

or:

```text
CLOUD — Curated dataset ID and training configuration are sent to MicroComp IT's temporary training service
```

Mode changes should require confirmation if an unsaved training run exists.

## 4. Recommended frontend module structure

Keep all lab-specific code scoped away from existing pages:

```text
frontend/
  demo-lab/
    llm-training-simulation.html
  llm-training-simulation.html             # compatibility redirect
  llm-training-lab.css
  llm-training-lab.js                      # DOM/controller entry
  llm-training-lab/
    config.js                              # constants and bounded presets
    contracts.js                           # message and state contracts
    parameter-count.js                     # pure preflight calculator
    tokenizer.js                           # deterministic character tokenizer
    datasets.js                            # bundled dataset registry/loader
    manifest.js                            # common manifest validation
    package-io.js                          # .mcllm export/import
    storage.js                             # IndexedDB repository
    sampling.js                            # pure seeded sampling helpers
    local-training-client.js               # main-thread worker facade
    cloud-training-client.js               # later FastAPI client
    ui/
      render-config.js
      render-progress.js
      render-inspector.js
      render-library.js
      render-playground.js
      render-privacy.js
      charts.js
    worker/
      training-worker.js
      backend-selection.js
      model.js
      transformer-block.js
      trainer.js
      inference.js
      checkpoint.js
    datasets/
      registry.json
      tiny-dialogue-v1.json
      simple-stories-v1.json
      technical-sentences-v1.json
    vendor/
      README.md
      tensorflow.min.js
      tf-backend-webgpu.min.js
      tf-backend-wasm.min.js
      tfjs-backend-wasm.wasm
```

Names may be refined during implementation, but the boundaries should remain:

- pure model and data rules;
- worker-owned computation;
- main-thread UI;
- persistence;
- transport;
- shared interchange contracts.

### Dependency delivery

Do not introduce a site-wide frontend framework or build.

For the first implementation, vendor exact, license-compatible TensorFlow.js browser artifacts locally under `frontend/llm-training-lab/vendor/`. Record versions, source URLs, licenses, integrity hashes, and update instructions in `vendor/README.md`.

This is preferable to a runtime CDN dependency because:

- model training can start without contacting a third-party library host;
- privacy language remains simple;
- versions cannot change underneath the lab;
- worker loading is same-origin;
- the existing static deployment can serve the files without a new build command.

If the vendored footprint becomes unreasonable, introduce a narrowly scoped build project for this lab only. Do not convert the entire frontend to a framework or bundler.

## 5. Browser ML library decision

### Recommendation: TensorFlow.js

Use TensorFlow.js Layers/Core APIs for local training and inference.

Why it is the best fit:

- supports automatic differentiation and optimizers in the browser;
- supports custom training loops;
- supports serializable model weights;
- has CPU, WASM, WebGL, and WebGPU backends;
- can save models to IndexedDB and custom I/O handlers;
- permits explicit tensor disposal and memory measurement;
- avoids implementing autodiff, optimizers, and kernels.

The official TensorFlow.js training guide supports both the higher-level Layers API and lower-level `Optimizer.minimize()` loops. The initial Transformer will likely need a small custom model/training loop, but should still use TensorFlow.js tensors, variables, gradients, and optimizers.

### Why not ONNX Runtime Web as the primary trainer

ONNX Runtime Web is a strong inference engine and a potential later export target. It is not the best primary implementation for this training-first lab because:

- its mainstream browser API and documentation center on inference sessions;
- web training requires specialized builds and a more complex artifact pipeline;
- the WebGPU execution provider remains platform-dependent;
- updating a live educational model and optimizer state is less direct;
- it would still require another system to construct and export the training graph.

Consider ONNX export only in a later interoperability phase after the canonical `.mcllm` format is stable.

### Why not raw WebGPU

Raw WebGPU would require the project to own:

- tensor storage;
- WGSL kernels;
- broadcasting;
- causal attention;
- softmax;
- gradient generation;
- optimizer state;
- numerical-stability behavior;
- kernel scheduling;
- device-loss recovery;
- CPU parity.

That work is far beyond the educational product goal and would create a new ML runtime rather than an LLM lab.

### Why not Transformers.js

Transformers.js is optimized around consuming pretrained models. It does not simplify training this custom sub-200K-parameter model enough to justify another abstraction.

## 6. Model architecture

Use a decoder-only autoregressive Transformer:

```text
character IDs
  → token embedding
  + learned positional embedding
  → N pre-normalized decoder blocks
      layer norm
      masked multi-head self-attention
      residual connection
      layer norm
      feed-forward network
      residual connection
  → final layer norm
  → vocabulary projection
  → next-character logits
```

Initial design decisions:

- character-level tokenizer;
- fixed maximum context length;
- learned positional embeddings;
- causal attention mask;
- GELU or ReLU feed-forward activation;
- dropout available but defaulted low or off for deterministic lessons;
- untied output projection for implementation clarity in the first release;
- categorical cross-entropy loss;
- Adam optimizer, with SGD offered later as an educational comparison;
- float32 weights;
- seeded initialization and sampling;
- no pretrained weights;
- no remote dataset.

The architecture is educational, not production-grade. The UI must explain that parameter scale, dataset scale, tokenizer quality, and training time are intentionally tiny.

### Safe initial presets

Suggested presets:

| Preset | Context | Width | Heads | Layers | FF width | Approximate intent |
|---|---:|---:|---:|---:|---:|---|
| Tiny | 32 | 32 | 2 | 1 | 64 | Mobile/CPU introduction |
| Small | 64 | 48 | 3 | 2 | 96 | Default local lesson |
| Classroom | 128 | 64 | 4 | 3 | 128 | Strong desktop exercise |
| Near limit | 128 | 80 | 4 or 5 | 3 | 160 | Advanced inspection |

Every width must divide evenly by the selected head count.

## 7. Parameter-count calculation

The cap applies to **trainable parameters**, not file size, activations, optimizer slots, or inference cache.

For:

- `V` = vocabulary size
- `T` = context length
- `D` = model width
- `L` = decoder block count
- `F` = feed-forward width
- `H` = attention heads, where `D % H === 0`

and an untied output projection with biases:

### Embeddings

```text
token embedding       = V × D
position embedding    = T × D
```

### One decoder block

```text
Q, K, V projections   = 3 × (D × D + D)
attention output      = D × D + D
feed-forward          = D × F + F + F × D + D
two layer norms       = 4 × D
```

Simplified:

```text
block parameters = 4D² + 2DF + 9D + F
```

### Final layers

```text
final layer norm      = 2 × D
LM output projection  = D × V + V
```

### Total

```text
P = VD + TD + L(4D² + 2DF + 9D + F) + 2D + DV + V
```

The number of heads does not change the projection parameter count when the total width remains `D`, but it must pass divisibility and minimum head-dimension validation.

### Enforcement

1. Calculate `P` from configuration before creating tensors.
2. Reject configuration when `P > 200000`.
3. Construct the model.
4. Calculate:

```text
actual = sum(product(weight.shape) for every trainable weight)
```

5. Refuse training and dispose the model unless `actual === P` and `actual <= 200000`.
6. Store both counts in the manifest.
7. Repeat the same pure formula and actual-weight check in Python.
8. Add golden tests shared by JavaScript and Python.

Also estimate memory separately:

```text
weight bytes ≈ parameters × 4
Adam slots   ≈ parameters × 8
gradients    ≈ parameters × 4
```

Activations depend on batch, context, layers, and width and must be estimated before training. The UI must not imply that 200K parameters means only 800 KB of runtime memory.

## 8. Curated dataset format

Do not accept user datasets or arbitrary text uploads in the first release.

Each bundled dataset should be a versioned JSON file:

```json
{
  "schemaVersion": "1.0",
  "datasetId": "simple-stories-v1",
  "displayName": "Simple Synthetic Stories",
  "description": "Short educational stories written for this lab.",
  "language": "en",
  "license": "MicroComp IT educational sample",
  "provenance": "Curated and bundled with the application",
  "contentRating": "general",
  "documents": [
    {
      "id": "story-001",
      "text": "A small robot learned to sort blue and green blocks."
    }
  ],
  "recommendedValidationFraction": 0.1,
  "sha256": "<canonical-content-hash>"
}
```

Rules:

- bounded number of documents;
- bounded UTF-8 byte size;
- no HTML interpretation;
- no remote URLs;
- no executable content;
- no personal information;
- clear provenance and license;
- immutable dataset ID/version;
- normalized line endings and Unicode normalization;
- deterministic document order before seeded shuffling.

The registry should expose metadata without loading all text. Training selects by `datasetId`, never by a client-supplied path or URL.

### Tokenizer

The initial tokenizer is deterministic character-level:

- reserved tokens: `<pad>`, `<bos>`, `<eos>`, `<unk>`;
- remaining characters sorted by Unicode code point from the chosen dataset;
- optional maximum vocabulary ceiling;
- explicit normalization mode;
- no locale-dependent ordering;
- vocabulary and ID mapping saved in every model package;
- unknown input characters map to `<unk>`.

Training samples are sliding windows:

```text
input  = tokens[i : i + contextLength]
target = tokens[i + 1 : i + contextLength + 1]
```

Train/validation splitting must be deterministic by document ID where possible, preventing overlapping windows from the same document from appearing in both splits.

## 9. Training-state format

Use one shared logical training-state contract:

```json
{
  "schemaVersion": "1.0",
  "status": "paused",
  "mode": "local",
  "runId": "opaque-local-id",
  "dataset": {
    "datasetId": "simple-stories-v1",
    "sha256": "<hash>"
  },
  "model": {
    "manifestId": "microcomp-llm-v1",
    "parameterCount": 50400
  },
  "optimizer": {
    "type": "adam",
    "learningRate": 0.001,
    "beta1": 0.9,
    "beta2": 0.999,
    "epsilon": 1e-7
  },
  "schedule": {
    "epochsRequested": 5,
    "batchSize": 16,
    "validationFraction": 0.1
  },
  "progress": {
    "epoch": 2,
    "batch": 18,
    "globalStep": 94,
    "examplesSeen": 1504,
    "trainLoss": 2.41,
    "validationLoss": 2.63
  },
  "random": {
    "seed": 4242,
    "shuffleEpoch": 2,
    "shuffleOffset": 18
  },
  "history": [
    {
      "step": 94,
      "trainLoss": 2.41,
      "validationLoss": 2.63,
      "elapsedMs": 18200
    }
  ],
  "createdAt": "ISO-8601 timestamp",
  "updatedAt": "ISO-8601 timestamp"
}
```

Requirements:

- cap history samples, such as 250 points;
- do not save every batch event indefinitely;
- distinguish resumable checkpoints from inference-only models;
- save optimizer slots only for resumable checkpoints;
- use a transaction so metadata never points at missing weights;
- mark interrupted saves as invalid;
- record the selected execution backend as diagnostic metadata, not as a requirement for reloading.

## 10. Web Worker strategy

All TensorFlow.js model construction, training, evaluation, checkpoint serialization, and generation should happen in one dedicated worker per lab tab.

The main thread owns:

- DOM;
- form validation;
- charts;
- accessibility announcements;
- privacy messaging;
- IndexedDB metadata queries;
- cloud network requests.

The worker owns:

- TensorFlow.js backend initialization;
- tensors and model variables;
- dataset tokenization and batching;
- optimizer;
- training loop;
- local inference;
- tensor disposal;
- checkpoint weight extraction.

### Command protocol

Main thread to worker:

```text
PROBE_CAPABILITIES
INITIALIZE_MODEL
START_TRAINING
PAUSE_TRAINING
RESUME_TRAINING
CANCEL_TRAINING
EVALUATE
GENERATE
EXPORT_CHECKPOINT
IMPORT_CHECKPOINT
DISPOSE
```

Worker to main thread:

```text
CAPABILITIES
READY
STATE_CHANGED
PROGRESS
METRICS
TOKEN_CHUNK
CHECKPOINT_READY
COMPLETED
CANCELLED
ERROR
MEMORY_WARNING
```

Every message must contain:

- protocol version;
- opaque request/run ID;
- enumerated message type;
- bounded structured payload.

Do not pass functions, arbitrary code, URLs, or DOM-derived HTML.

### Responsiveness

- Check pause/cancel state between batches.
- Yield between batches even inside a worker so message handling remains responsive.
- Emit progress no more than four times per second.
- Transfer weight `ArrayBuffer`s rather than copying them.
- Do not send full weights during normal progress.
- Dispose batch tensors after each step.
- Run `tf.memory()` checks periodically.
- Terminate and recreate the worker after a hard cancel or unrecoverable backend/device error.
- Save a bounded checkpoint before page unload only when a completed in-memory snapshot already exists; do not promise synchronous emergency saving.

## 11. WebGPU and CPU fallback

WebGPU is useful but is not universally available. MDN currently classifies it as limited availability and secure-context-only, though it can be accessed through `WorkerNavigator.gpu`.

Backend selection must happen inside the worker:

1. Confirm secure context and worker WebGPU presence.
2. Try TensorFlow.js `webgpu`.
3. Allocate and run a small warm-up model using the same required operation families.
4. Verify finite output and clean disposal.
5. If any step fails, dispose the backend and try `wasm`.
6. If WASM initialization or artifact loading fails, try `cpu`.
7. If no backend passes, disable training and provide an explanatory compatibility message.

Recommended priority:

```text
webgpu → wasm → cpu
```

Do not use WebGL as the preferred fallback for initial worker training. WebGL worker behavior, precision variance, texture management, and OffscreenCanvas requirements add complexity. It may be evaluated later as an opt-in compatibility backend.

### User-facing capability panel

Display:

- selected backend;
- GPU acceleration available/unavailable;
- fallback reason in safe plain language;
- estimated model and training memory;
- approximate device class;
- whether the default or reduced preset was applied.

Never display raw GPU identifiers unless needed for an explicitly opened diagnostic panel.

### Device loss and memory pressure

- listen for WebGPU device loss where the backend exposes it;
- checkpoint only from a known stable state;
- offer restart on WASM after device loss;
- catch allocation failures;
- automatically reduce batch size only with visible user consent;
- never silently change architecture, context, or dataset;
- bound every preset independently from the 200K parameter cap.

## 12. Local persistence: IndexedDB first

Use IndexedDB for the first persistence release.

Why:

- model weights are small under this parameter cap;
- TensorFlow.js already supports IndexedDB model I/O;
- it has broader established browser support;
- it can store metadata, tokenizer, histories, and binary blobs;
- it avoids maintaining separate metadata and file hierarchies initially.

Recommended databases/stores:

```text
microcomp-llm-lab-v1
  models
  checkpoints
  packages
  settings
```

Model metadata should be stored by the application, even if TensorFlow.js uses its own IndexedDB records for native model artifacts.

### Storage behavior

- call `navigator.storage.estimate()` before large saves;
- request persistent storage only after a user explicitly saves a model;
- explain that browser/site-data clearing deletes local models;
- provide export as the durable backup;
- use versioned IndexedDB migrations;
- use temporary keys and one transaction for atomic promotion;
- enforce a local model count and total-byte limit;
- give users explicit delete and “delete all local models” controls.

### OPFS position

OPFS is a good later optimization for canonical package blobs and high-frequency checkpoint writes. It is available in workers and supports efficient synchronous access handles there. It should not be the first persistence implementation because:

- the models are small;
- two persistence systems increase failure cases;
- IndexedDB already meets the initial scale;
- package export still requires a user-visible download.

Keep `storage.js` behind a repository interface so OPFS can be introduced without changing UI or model contracts.

## 13. Common model manifest and package format

Use a non-executable, versioned package with extension:

```text
.mcllm
```

The package is a ZIP container, but only application-created packages are supported. Model import is deferred until strict package validation is implemented; arbitrary datasets remain unsupported.

### Package files

```text
manifest.json
tokenizer.json
weights.bin
training-state.json          # optional for inference-only export
optimizer.bin                # optional resumable checkpoint
metrics.json
dataset-reference.json
README.txt
```

Do not use Python pickle, JavaScript source, executable model code, arbitrary ONNX custom operators, or framework-native archives as the canonical format.

### Canonical weights

`weights.bin` contains concatenated little-endian float32 tensors in manifest order.

Each manifest weight entry contains:

```json
{
  "name": "block.0.attention.q.kernel",
  "shape": [48, 48],
  "dtype": "float32",
  "offset": 0,
  "byteLength": 9216,
  "sha256": "<tensor-hash>"
}
```

The importer must validate all offsets, lengths, shapes, dtypes, names, hashes, total bytes, and parameter counts before allocating model tensors.

### Manifest specification

```json
{
  "schemaVersion": "1.0",
  "format": "microcomp-llm",
  "modelId": "opaque-id",
  "displayName": "My Tiny Character Model",
  "educationalOnly": true,
  "architecture": {
    "type": "decoder-only-transformer",
    "tokenizerType": "character",
    "vocabSize": 96,
    "contextLength": 64,
    "modelWidth": 48,
    "attentionHeads": 3,
    "decoderLayers": 2,
    "feedForwardWidth": 96,
    "activation": "gelu",
    "preNormalization": true,
    "learnedPositionEmbeddings": true,
    "tiedOutputEmbedding": false,
    "useBias": true
  },
  "parameters": {
    "formulaVersion": "decoder-v1",
    "calculatedTrainable": 50400,
    "actualTrainable": 50400,
    "maximumAllowed": 200000
  },
  "tokenizer": {
    "file": "tokenizer.json",
    "sha256": "<hash>"
  },
  "weights": {
    "file": "weights.bin",
    "byteLength": 201600,
    "sha256": "<hash>",
    "tensors": []
  },
  "training": {
    "datasetId": "simple-stories-v1",
    "datasetSha256": "<hash>",
    "seed": 4242,
    "globalSteps": 500,
    "optimizer": "adam"
  },
  "compatibility": {
    "minimumManifestReader": "1.0",
    "localRuntime": "tensorflowjs",
    "cloudRuntime": "pytorch"
  },
  "files": [],
  "createdAt": "ISO-8601 timestamp"
}
```

### Import validation

When import is introduced:

- allow one `.mcllm` file only;
- cap compressed and uncompressed size;
- cap file count;
- reject absolute paths and `..` traversal;
- reject symlinks and nested archives;
- require the exact expected file names;
- parse JSON with depth and size bounds;
- reject unknown manifest major versions;
- reject unknown architectures, activations, dtypes, tensors, or tokenizer modes;
- calculate the parameter count independently;
- verify all hashes before model construction;
- show a preview and require confirmation before persistence;
- never execute package content.

This is a structured model import, not a general upload facility.

## 14. Inference and sampling

Inference remains inside the training worker for local mode.

Initial algorithm:

1. Normalize and encode the prompt.
2. Retain only the final `contextLength` tokens.
3. Run the model.
4. Select the final-position logits.
5. Apply bounded sampling controls.
6. Append one token.
7. Repeat until `<eos>` or the generation limit.

First supported controls:

- seed: integer;
- temperature: 0.1–2.0;
- top-k: 1–50 and no greater than vocabulary size;
- maximum new characters: 1–256;
- optional stop on `<eos>`;
- greedy mode represented by top-k 1.

Top-p and repetition penalties can be added later after deterministic tests are established.

Use a shared seeded pseudorandom generator rather than `Math.random()` so the same model, prompt, and sampling configuration can be replayed. Floating-point differences across backends may still cause divergence near equal probabilities; the UI and manifest should distinguish deterministic configuration from guaranteed bit-identical cross-device output.

For the first model size, recomputing the bounded context each generation step is acceptable and easier to audit. Add a key/value cache only after profiling proves it necessary.

Stream local output to the main thread in short chunks. Avoid an ARIA announcement for every character; announce generation start, periodic sentence/chunk progress, and completion.

## 15. UI state model

Use a small reducer/state machine rather than scattered DOM flags.

Suggested top-level states:

```text
booting
unsupported
ready
initializing
training
pausing
paused
evaluating
saving
completed
generating
cancelled
error
```

State domains:

- execution mode;
- privacy acknowledgement;
- capability result;
- model configuration;
- parameter budget;
- selected dataset;
- training configuration;
- progress and bounded metrics;
- local model library;
- active model;
- generation configuration;
- cloud job metadata;
- non-sensitive diagnostics.

Every transition should identify which controls are enabled. A page reload should restore saved models and user preferences, but should not falsely claim that an in-memory run survived unless a valid checkpoint exists.

## 16. Python/FastAPI backend design

Create a separate project later:

```text
llm-training-service/
  app/
    main.py
    config.py
    api/
      health.py
      jobs.py
      events.py
      inference.py
      artifacts.py
    domain/
      schemas.py
      parameter_count.py
      manifest.py
      tokenizer.py
      datasets.py
      lifecycle.py
    training/
      model.py
      trainer.py
      sampling.py
      checkpoint.py
    services/
      job_registry.py
      job_executor.py
      cleanup.py
      rate_limit.py
      package_writer.py
    datasets/
    tests/
  requirements.txt
  README.md
```

Use:

- FastAPI;
- Uvicorn;
- Pydantic;
- CPU-only PyTorch;
- NumPy only for safe array/package conversion;
- no database for the first temporary release.

PyTorch is recommended for cloud training because it provides a clear, auditable implementation of the same Transformer and optimizer. Its runtime is heavier than the model, so the Render service should not be assumed to fit a free instance. Measure memory during the cloud prototype and choose an instance with sufficient headroom.

Do not mix TensorFlow.js-native model files and PyTorch-native pickle files. Both runtimes read and write the common manifest and raw float32 weights.

### API outline

```text
GET    /health
GET    /v1/capabilities
POST   /v1/jobs
GET    /v1/jobs/{jobId}
GET    /v1/jobs/{jobId}/events
POST   /v1/jobs/{jobId}/cancel
POST   /v1/jobs/{jobId}/generate
GET    /v1/jobs/{jobId}/artifact
DELETE /v1/jobs/{jobId}
```

`POST /v1/jobs` accepts only:

- built-in dataset ID;
- enumerated architecture fields;
- bounded training fields;
- integer seed.

It returns:

- opaque random job ID;
- one-time job bearer token;
- initial status;
- creation and expiry time.

Store only a hash of the job token. Require the token for every job-specific request.

### Execution model

Run one ASGI process and one bounded training executor initially:

- `uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1`;
- in-memory job registry;
- bounded FIFO queue;
- one active CPU training job;
- small maximum queued-job count;
- training in a dedicated thread/process so the event loop remains responsive;
- progress transferred through a thread-safe bounded queue;
- cooperative cancellation between batches;
- no multi-worker Uvicorn configuration because in-memory job state would split.

If demand later requires multiple instances, add a shared queue and datastore as a separate architecture revision. Do not simulate distributed reliability with local dictionaries.

## 17. Temporary cloud job lifecycle

Suggested lifecycle:

```text
accepted
  → queued
  → initializing
  → training
  → evaluating
  → ready
  → expired/deleted
```

Alternate terminal states:

```text
cancelled
failed
timed_out
```

Initial limits:

- maximum active training jobs: 1;
- maximum queued jobs: 3;
- maximum wall-clock training time: 10 minutes;
- completed model retention: 30 minutes;
- failed/cancelled retention: 5 minutes;
- maximum generation requests per job: 20;
- maximum artifact downloads per job: 5;
- hard expiry from creation: 45 minutes.

On completion:

1. Generate the validated `.mcllm` artifact.
2. Permit bounded inference and download.
3. Display the exact expiration time in the UI.
4. Delete model object, optimizer state, event buffer, and artifact at expiry.
5. Return HTTP 410 for an expired known job until its tombstone is removed.

A cleanup coroutine runs at startup and every 60 seconds. Render's ephemeral filesystem provides an additional cleanup boundary on restart or redeploy, but it must not be the only deletion mechanism.

Cloud models are not durable. The UI must encourage download before expiration and must not imply recovery after a service restart.

## 18. Progress reporting

### Recommendation: Server-Sent Events with polling fallback

Training progress is one-way server-to-browser data, making SSE a better initial fit than WebSockets.

Advantages:

- simple event semantics;
- automatic browser reconnection;
- event IDs support bounded replay;
- works through standard HTTP infrastructure;
- easier lifecycle and authorization model;
- no bidirectional socket state.

Events:

```text
snapshot
queued
started
progress
metrics
checkpoint
ready
cancelled
failed
expired
heartbeat
```

Implementation requirements:

- require the job token without putting it in a query string where possible;
- because native `EventSource` cannot set arbitrary authorization headers, prefer a short-lived, job-scoped stream ticket exchanged through an authenticated POST, or use `fetch()` streaming to consume `text/event-stream`;
- emit an event ID;
- retain only the latest bounded event window;
- send heartbeat comments every 15–20 seconds;
- stop streams on terminal state or expiry;
- rate-limit reconnects;
- expose `GET /v1/jobs/{jobId}` as a 2–5 second polling fallback.

WebSockets add no necessary capability for first release. Pure polling is easiest but produces unnecessary repeated requests and slower feedback. Use polling only as fallback.

## 19. Render deployment design

Create a separate Render Web Service from the same repository:

```text
Service name: microcompit-llm-training
Runtime: Python
Root Directory: llm-training-service
Build Command: pip install -r requirements.txt
Start Command: uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1
Health Check Path: /health
```

Do not modify the existing website or MCP Render service.

Recommended environment variables:

```text
LLM_ALLOWED_ORIGINS=https://microcompit.com,https://www.microcompit.com
LLM_MAX_PARAMETERS=200000
LLM_MAX_ACTIVE_JOBS=1
LLM_MAX_QUEUED_JOBS=3
LLM_MAX_TRAINING_SECONDS=600
LLM_READY_RETENTION_SECONDS=1800
LLM_FAILED_RETENTION_SECONDS=300
LLM_HARD_EXPIRY_SECONDS=2700
LLM_RATE_LIMIT_PER_MINUTE=30
LLM_JOB_CREATE_LIMIT_PER_HOUR=3
LLM_MAX_REQUEST_BYTES=16384
LLM_LOG_LEVEL=info
LLM_JOB_TOKEN_SECRET=<long-random-secret>
```

Render supplies `PORT`.

Do not attach a persistent disk in the first release. Store temporary job files beneath one application-owned temporary directory and delete them explicitly. Expect all state to disappear on restart.

The health route must not import/create a model, run a training step, or require GPU/accelerator availability.

## 20. Security and resource limits

### Input restrictions

- curated dataset IDs only;
- no dataset uploads;
- no remote dataset URLs;
- no arbitrary model URLs;
- no code or custom layers;
- no Python or JavaScript execution;
- no arbitrary file paths;
- strict request schemas with unknown fields rejected;
- integer/range validation before allocation;
- package import deferred until strict validation is available.

### Model/training limits

- 200,000 trainable parameters;
- bounded context length;
- bounded vocabulary;
- bounded model width, layers, heads, and FF width;
- bounded batch size;
- bounded epochs and global steps;
- bounded history;
- bounded generation length;
- bounded concurrent/queued cloud jobs;
- wall-clock timeout;
- cancellation checks between batches.

### Memory/CPU protection

- preflight parameter and activation estimates;
- post-construction actual parameter verification;
- worker-only local compute;
- one active cloud trainer;
- tensor disposal checks;
- model/artifact byte caps;
- no unbounded logging;
- no raw weight data in logs;
- server timeouts and request body limits.

### Web security

- exact CORS allowlist;
- HTTPS only in production;
- restrictive Content Security Policy compatible with worker and WASM loading;
- `worker-src 'self'` and locally hosted ML artifacts;
- no inline executable package content;
- safe download headers;
- `X-Content-Type-Options: nosniff`;
- generic errors without stack traces;
- non-guessable IDs plus job token;
- one-way token hashes in memory;
- rate limits based on a carefully configured direct/proxy client identity;
- do not log prompts, generated text, tokens, dataset content, or model weights.

### Abuse prevention

Public job creation is the main cloud risk. Before public launch:

- enforce per-IP creation limits;
- enforce global queue capacity;
- return 429/503 with retry guidance;
- consider a privacy-preserving challenge if abuse appears;
- do not embed a privileged server API key in frontend JavaScript;
- expose no arbitrary compute knobs;
- instrument aggregate job counts, durations, failures, and expiry without content.

## 21. Privacy communication

The distinction must appear before training begins, not only in terms or documentation.

### Local mode statement

```text
Local mode runs training and generation on this device. The selected bundled
dataset, weights, prompts, and generated text are not sent to the cloud training
service. Saved models remain in this browser unless you download them.
```

Analytics should not collect prompts, model configurations detailed enough to identify content, generated text, weights, or model names.

### Cloud mode statement

```text
Cloud mode sends the selected bundled dataset ID and training configuration to
MicroComp IT's temporary training service. Prompts used with the temporary cloud
model are also sent to that service. Jobs and artifacts expire automatically.
Download the model before the displayed expiration time if you want to keep it.
```

Require an explicit acknowledgment before the first cloud job. Do not reuse that acknowledgment for a materially changed policy.

## 22. Accessibility

Target WCAG 2.2 AA.

Requirements:

- one visible page `h1`;
- semantic landmarks;
- fieldsets and legends for architecture, training, sampling, and mode;
- explicit labels and help text for every input;
- `aria-describedby` for parameter constraints and validation errors;
- native buttons and inputs;
- keyboard-operable tabs or radio groups;
- visible focus in both themes;
- no color-only local/cloud, success/error, or chart distinctions;
- text summaries for every chart;
- accessible data table for sampled loss values;
- native `<progress>` plus textual epoch/batch/step;
- throttled polite live-region announcements;
- assertive announcements only for blocking errors;
- loss values and backend status exposed as text;
- pause/cancel state announced;
- reduced-motion support for chart transitions, status pulses, and generation indicators;
- no auto-scrolling that steals focus;
- generated output in a readable region with a separate completion announcement;
- model inspector relationships represented as lists/tables, not only a canvas diagram;
- contrast verified in the site's dark and light themes;
- target sizes suitable for touch.

Do not announce every batch or character. Suggested announcements:

- training started;
- each epoch completed;
- pause/cancel completed;
- training completed/failed;
- generation completed.

## 23. Mobile behavior

Mobile is supported for learning and small local runs, but the UI must set honest expectations.

At widths below the existing site breakpoints:

- stack configuration, progress, inspector, and playground;
- use a sticky compact training-control bar only if it does not obscure content;
- collapse advanced settings behind a semantic disclosure;
- default to the Tiny preset;
- reduce default context, batch, and generation length;
- keep charts horizontally contained;
- use tables with a labeled scroll wrapper;
- avoid topology/attention matrices wider than the viewport;
- provide a text-first inspector;
- keep export/download controls available;
- warn before starting a configuration estimated to be unsuitable;
- handle orientation changes without restarting the worker;
- preserve progress when panels collapse;
- make unsupported WebGPU a normal fallback state, not an error.

Mobile browsers may suspend background tabs. Checkpoint at bounded epoch/interval boundaries and explain that navigating away can interrupt unsaved training.

Cloud mode remains usable on mobile because training occurs remotely, but privacy text and expiry/download behavior remain identical.

## 24. Testing strategy

### Pure JavaScript tests

Use Node's existing built-in test approach for modules with no DOM or TensorFlow dependency:

- parameter formula;
- configuration validation;
- preset boundaries;
- tokenizer normalization and round-trip;
- deterministic split and batching;
- seeded sampling;
- manifest validation;
- package offset/hash validation;
- training-state reducer;
- worker message schema;
- bounded history;
- import rejection cases.

### TensorFlow.js engine tests

Use a scoped lab test setup with the CPU backend:

- actual parameter count equals preflight formula;
- every valid preset is under 200K;
- over-limit configurations fail before allocation;
- forward shape and causal mask;
- future tokens do not change earlier logits;
- one training step produces finite loss;
- loss decreases on a tiny memorization fixture;
- save/reload preserves logits within tolerance;
- tensor count returns to baseline after disposal;
- cancellation and pause occur at batch boundaries;
- inference respects maximum output and sampling bounds.

### Worker/browser tests

Use a small Playwright project scoped to this lab:

- worker boot;
- WASM fallback;
- mocked WebGPU failure;
- successful supported WebGPU smoke test where CI provides it;
- UI remains responsive during training;
- progress rendering is throttled;
- pause/resume/cancel;
- IndexedDB save/reload/delete;
- offline/local runtime asset loading;
- mobile layouts;
- light/dark contrast;
- reduced motion;
- keyboard flow;
- automated accessibility scan;
- static route and asset resolution.

Do not make WebGPU availability a universal CI requirement. Maintain a separate compatible-browser/device smoke matrix.

### Python backend tests

Use `pytest` and FastAPI's test client:

- health is cheap;
- CORS;
- strict schemas;
- all architecture bounds;
- parameter formula parity;
- queue capacity;
- one-active-job enforcement;
- cancellation;
- timeout;
- expiry cleanup;
- 410 behavior;
- job token authorization;
- token not logged;
- SSE ordering, IDs, heartbeat, and terminal close;
- polling fallback;
- artifact byte/hash/manifest validation;
- no arbitrary upload/path/URL fields;
- rate limiting;
- generic errors.

### Cross-runtime parity

Golden fixtures are critical:

- identical tokenizer mapping;
- identical parameter counts and tensor names;
- JavaScript export loads in Python;
- Python export loads in JavaScript;
- fixed weights produce logits within a documented tolerance;
- greedy generation matches for fixed prompt where floating-point tolerance permits;
- every manifest file hash is verified;
- no framework-native executable serialization enters the package.

### Existing regression tests

Every phase must also run:

```text
node --test tests/cyber-lab-engine.test.js tests/cyber-lab-integration.test.js
```

and the MCP service tests when shared repository or ignore/deployment files change.

## 25. Observability

Local mode:

- diagnostics remain local;
- display backend, elapsed time, batches/sec, loss, validation loss, and memory estimates;
- do not send prompts, outputs, weights, or dataset text to analytics.

Cloud mode structured logs:

- timestamp;
- request ID;
- hashed job ID;
- state transition;
- model parameter count;
- dataset ID;
- duration;
- queue decision;
- response status;
- cleanup result.

Never log:

- job bearer token;
- prompts;
- generated text;
- tensor values;
- model weights;
- raw authorization headers;
- IP addresses beyond what is required for bounded abuse controls.

## 26. Phased roadmap

### Phase 0 — Planning and technical proof

- approve this document;
- pin TensorFlow.js versions;
- prove one causal attention forward/backward step in a worker;
- verify required operations on WebGPU and WASM;
- validate the parameter formula against actual weights;
- measure bundle, startup, and memory on representative desktop and mobile devices.

No public route is linked during the proof.

### Phase 1 — Exact first implementation milestone: local training vertical slice

Deliver:

```text
frontend/demo-lab/llm-training-simulation.html
frontend/llm-training-lab.css
frontend/llm-training-lab.js
frontend/llm-training-lab/config.js
frontend/llm-training-lab/contracts.js
frontend/llm-training-lab/parameter-count.js
frontend/llm-training-lab/tokenizer.js
frontend/llm-training-lab/datasets.js
frontend/llm-training-lab/datasets/simple-stories-v1.json
frontend/llm-training-lab/local-training-client.js
frontend/llm-training-lab/worker/training-worker.js
frontend/llm-training-lab/worker/backend-selection.js
frontend/llm-training-lab/worker/model.js
frontend/llm-training-lab/worker/trainer.js
frontend/llm-training-lab/worker/inference.js
frontend/llm-training-lab/vendor/*
tests/llm-training-lab-core.test.js
tests/llm-training-lab-integration.test.js
```

Scope:

- local mode only;
- one curated dataset;
- character tokenizer;
- Tiny and Small presets;
- live parameter count;
- hard 200K cap;
- worker-based training;
- WebGPU probe with WASM/CPU fallback;
- start, pause, resume, cancel, and reset;
- bounded loss/progress display;
- one prompt and deterministic generation panel;
- persistent local/privacy explanation;
- responsive and accessible page shell.

Explicitly excluded:

- model saving;
- export/import;
- arbitrary data;
- cloud mode;
- job APIs;
- home-page promotion.

Acceptance criteria:

1. The page loads through the current static serving path.
2. Existing navigation, theme, and footer conventions are preserved.
3. A visitor can train the Small preset for a bounded run without freezing the UI.
4. Pause, resume, and cancel respond between batches.
5. The actual trainable count equals the preflight count and never exceeds 200,000.
6. The trained model generates bounded characters from a prompt.
7. WebGPU failure automatically falls back without losing UI control.
8. The page clearly states that data stays local.
9. Keyboard, screen-reader, reduced-motion, light, dark, desktop, and mobile checks pass.
10. Existing website and cybersecurity tests remain green.

This milestone proves the highest-risk claim—real local autoregressive training without freezing the site—before persistence or cloud infrastructure expands scope.

### Phase 2 — Local model library and portable packages

- IndexedDB repository;
- save/load/delete;
- storage quota UI;
- inference-only export;
- resumable checkpoint export;
- `.mcllm` writer;
- strict `.mcllm` importer;
- corruption/hash/zip-bomb tests;
- additional curated datasets;
- model inspector and attention visualization.

No arbitrary dataset uploads.

### Phase 3 — Local performance and teaching depth

- tune WebGPU path;
- device-loss fallback;
- checkpoint cadence;
- advanced preset near the limit;
- optimizer comparison;
- validation split lessons;
- perplexity explanation;
- sampling comparison;
- cross-browser performance matrix;
- optional OPFS package/checkpoint backend.

### Phase 4 — Cloud training service

- create isolated FastAPI project;
- implement shared contracts and PyTorch model;
- implement temporary registry/queue;
- SSE plus polling fallback;
- token-protected status, inference, download, cancel, and delete;
- automatic expiration;
- Render staging service;
- cross-runtime package parity;
- explicit cloud privacy UI.

Do not enable the public Cloud tab until abuse controls and cleanup tests pass.

### Phase 5 — Production hardening and launch

- load and abuse testing;
- cold-start behavior;
- CSP and security header verification;
- full accessibility audit;
- full mobile/browser matrix;
- operational dashboards without content logging;
- failure and expiry UX;
- documentation;
- Demo Lab card;
- sitemap;
- optional home-page promotion;
- deployment and rollback checklist.

## 27. Main technical risks

### 1. Browser backend variability

WebGPU support, driver behavior, and available operations vary. Mitigation: runtime warm-up, WASM fallback, small presets, separate compatibility testing, and no promise of GPU availability.

### 2. Browser memory leaks

TensorFlow.js tensors and GPU buffers need explicit disposal. Mitigation: worker ownership, `tf.tidy()` where safe, explicit disposal, memory tests, worker restart after hard cancellation, and bounded state.

### 3. UI responsiveness

Even asynchronous training on the main thread can cause poor interaction. Mitigation: all model operations in a dedicated worker, cooperative batch boundaries, bounded progress messages, and no synchronous tensor reads in the UI.

### 4. Cross-runtime parity

TensorFlow.js and PyTorch layer conventions, tensor names, layouts, random initialization, and floating-point results can differ. Mitigation: one canonical manifest, explicit tensor layout, raw weights rather than native archives, golden fixtures, and tolerance-based logits tests.

### 5. Resume correctness

Weights alone do not resume Adam training exactly. Mitigation: distinguish inference exports from resumable checkpoints and include optimizer slots, step, shuffle state, tokenizer, dataset hash, and seed.

### 6. Storage expectations

IndexedDB/OPFS can be cleared by users or browsers. Mitigation: explicit local-storage language, quota checks, persistent-storage request after user action, export reminder, and no durability promise.

### 7. Cloud cost and abuse

Tiny models are still CPU-intensive when jobs are public. Mitigation: one trainer, bounded queue, strict presets, rate limits, timeouts, anonymous job tokens, short retention, and a suitably sized paid instance.

### 8. Cloud restart semantics

An ephemeral, in-memory service loses jobs on restart. Mitigation: state this clearly, return a recognizable gone/unavailable result, keep retention short, and encourage immediate download. Add persistence only through a future architecture change.

### 9. Package import safety

ZIP containers and model metadata can be hostile. Mitigation: defer import until bounded validation exists, permit only the app's declarative format, verify hashes/counts/paths, and never load pickle or code.

### 10. Educational misunderstanding

Visitors may confuse a tiny character model with a modern production LLM. Mitigation: persistent parameter scale, dataset scale, privacy, limitations, and “educational model” explanations throughout the experience.

## 28. Decision summary

### Recommended architecture

- Static route inside the existing Demo Lab
- Plain HTML/CSS/ES modules
- Existing site navigation, theme, tokens, cards, and footer
- TensorFlow.js model in a dedicated worker
- WebGPU with WASM/CPU fallback
- Character-level decoder-only Transformer
- Dual parameter-count enforcement
- IndexedDB first; optional OPFS later
- Safe `.mcllm` ZIP with JSON manifest and raw float32 weights
- Separate later FastAPI/PyTorch Render service
- Temporary token-protected jobs
- SSE progress with polling fallback
- No arbitrary uploads or datasets in the first release

### Exact first implementation milestone

Implement the local-only vertical slice described in Phase 1: one curated character dataset, Tiny/Small configurations, live parameter budget, worker-based TensorFlow.js training, WebGPU-to-WASM/CPU fallback, pause/resume/cancel, bounded metrics, and deterministic prompt generation. Do not add persistence, import/export, cloud APIs, or promotion until that slice proves responsive and reliable.

## 29. Primary technical references

- [TensorFlow.js training models](https://www.tensorflow.org/js/guide/train_models)
- [TensorFlow.js model save/load and IndexedDB](https://www.tensorflow.org/js/guide/save_load)
- [TensorFlow.js platform backends and memory management](https://www.tensorflow.org/js/guide/platform_environment)
- [Official TensorFlow.js repository and browser backends](https://github.com/tensorflow/tfjs)
- [ONNX Runtime Web overview](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)
- [ONNX Runtime WebGPU execution provider](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)
- [MDN Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
- [MDN WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
- [MDN Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
- [Render FastAPI deployment](https://render.com/docs/deploy-fastapi)
- [Render Web Services](https://render.com/docs/web-services)
- [Render ephemeral and persistent filesystem behavior](https://render.com/docs/disks)
