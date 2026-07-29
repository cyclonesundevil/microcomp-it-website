# Prompt 1 Completion Report: LLM Training Lab Architecture Plan

Status: Complete

Completion date: July 28, 2026

Remote repository updated: No

## Requested outcome

Inspect the existing MicroComp IT repository and produce a detailed
implementation plan for an educational LLM Training Simulation Lab. The plan
needed to fit the current website structure, design system, build process,
hosting setup, and deployment model without implementing the application.

## Deliverable

The completed planning document is:

- [`docs/llm-training-lab-plan.md`](../llm-training-lab-plan.md)

No production code was introduced as part of this planning prompt.

## Repository findings

The plan documented the following existing architecture:

- `frontend/` is a dependency-free static HTML, CSS, and JavaScript website.
- `frontend/demo-lab.html` is the directory for interactive demonstrations.
- Nested Demo Lab pages follow the
  `frontend/demo-lab/<experience>.html` convention.
- `frontend/styles.css` and `frontend/theme.js` provide shared design tokens,
  navigation, responsive behavior, and light/dark themes.
- `backend/app.py` is the existing Quart website and API application.
- `mcp-server/` is an independently deployable TypeScript service.
- `tests/` uses Node's built-in test runner for browser-independent logic and
  static integration contracts.
- The repository has no site-wide frontend framework, bundler, or frontend
  build step.

## Recommended architecture

The plan recommends two clearly separated execution paths:

### Local browser mode

- TensorFlow.js for automatic differentiation, optimization, and tensor
  operations.
- A dedicated Web Worker for model construction, training, evaluation,
  inference, and checkpoint serialization.
- WebGPU when a runtime capability probe succeeds.
- TensorFlow.js WASM as the primary CPU fallback.
- Plain JavaScript CPU execution only as a last compatibility fallback.
- IndexedDB for model metadata and smaller checkpoints, with OPFS considered
  for larger weight payloads where supported.
- No training data transmitted outside the browser.

### Cloud Python mode

- A separate FastAPI service rather than adding ML workloads to the existing
  Quart application.
- Temporary, anonymous, token-protected training jobs.
- Curated dataset identifiers rather than arbitrary uploads.
- Server-Sent Events for one-way progress reporting.
- Ephemeral Render storage with automatic job and artifact deletion.
- The same tokenizer, architecture rules, parameter formula, and portable
  package contract as local mode.

## Model recommendation

The planned model is a character-level, decoder-only autoregressive
Transformer with:

- learned token embeddings;
- learned absolute position embeddings;
- pre-normalized decoder blocks;
- causal multi-head self-attention;
- feed-forward layers;
- residual connections;
- final layer normalization;
- vocabulary projection;
- optional tied input/output embeddings; and
- a strict 200,000-trainable-parameter ceiling.

The parameter limit is enforced before allocation using a pure formula and
again after model construction using the framework's actual trainable weights.

## Shared contracts defined

The planning document specifies:

- parameter-count formulas;
- curated dataset structure;
- character-tokenizer behavior;
- reserved token IDs;
- training-state fields;
- inference and seeded sampling behavior;
- portable package contents;
- tensor metadata requirements;
- browser worker messages;
- local persistence behavior;
- cloud API boundaries;
- job lifecycle and expiration;
- resource and security limits;
- accessibility requirements;
- responsive/mobile behavior; and
- testing layers.

## Deployment recommendation

- Keep the website frontend static.
- Do not introduce a site-wide frontend framework.
- Do not put model training inside the existing Quart service.
- Deploy the future FastAPI trainer as a separate Render Web Service.
- Use ephemeral service storage for the initial cloud release.
- Add persistent storage only if product requirements later require longer
  retention.

## Principal risks identified

1. Browser backend compatibility and WebGPU availability vary by device.
2. Training can exhaust memory or block the UI without strict worker and
   resource boundaries.
3. Browser and Python implementations can drift in parameter math, tensor
   naming, or weight layout.
4. A model this small will produce limited and often incoherent text.
5. Users may misunderstand local versus cloud privacy without persistent,
   non-color mode labeling.
6. Export/import validation must reject malformed or unsafe packages without
   executing serialized code.

## First implementation milestone recommended by the plan

The original plan proposed a local browser vertical slice:

1. add the canonical Demo Lab route;
2. add parameter counting and bounded presets;
3. add the deterministic tokenizer and one curated dataset;
4. create the model inside a worker;
5. run a short local training loop;
6. show progress and generation; and
7. validate responsiveness, memory limits, and accessibility.

The user subsequently changed the implementation order by requesting the
Python reference model before the real browser engine. That change is recorded
in the Prompt 2 report.

## Acceptance result

All planning requirements were addressed in the Markdown plan. No runtime
tests were required because this prompt intentionally produced no
implementation code.
