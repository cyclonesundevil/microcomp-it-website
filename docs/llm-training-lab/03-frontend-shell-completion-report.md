# Prompt 3 Completion Report: Frontend Simulation Lab Shell

Status: Complete

Completion date: July 28, 2026

Remote repository updated: No

## Requested outcome

Create a production-quality, dependency-free frontend shell for the MicroComp
IT LLM Training Simulation Lab. The page needed to reuse the website's current
design language and provide functional educational interactions without
claiming that real training was occurring.

## Routes delivered

Canonical route:

```text
/demo-lab/llm-training-simulation.html
```

Compatibility redirect:

```text
/llm-training-lab.html
```

The canonical route follows the existing nested Demo Lab convention used by
the cybersecurity simulation.

Primary page:

- [`frontend/demo-lab/llm-training-simulation.html`](../../frontend/demo-lab/llm-training-simulation.html)

## Visual integration

The page reuses:

- the shared MicroComp IT navbar;
- the shared light/dark theme controller;
- existing site typography;
- cyan and purple accent language;
- shared contact-button behavior;
- the existing footer pattern;
- card and panel visual conventions; and
- established responsive breakpoints.

Lab-specific styling is isolated in:

- [`frontend/llm-training-lab.css`](../../frontend/llm-training-lab.css)

No frontend framework, package manager, bundler, or build step was introduced.

## Sections delivered

### Introduction

The page explains:

- the visitor will eventually train a real model;
- the model is capped at 200,000 trainable parameters;
- the model is intentionally tiny;
- it is not comparable with modern commercial LLMs; and
- its output is unsuitable for consequential decisions.

### Training modes

Two mode cards are present:

1. **Train on This Device**
   - visitor hardware;
   - data remains in the browser;
   - future save/download support;
   - marked as an available interface shell; and
   - explicitly states that the local engine arrives in the next milestone.

2. **Train in the MicroComp Cloud**
   - managed Python service;
   - intended for slower devices;
   - temporary model retention;
   - download-before-expiration requirement; and
   - disabled and marked “Coming later.”

A persistent local-shell privacy notice states that the current milestone does
not train a model or transmit training data.

### Guided workflow

Six keyboard-accessible stages are implemented:

1. Data
2. Tokenization
3. Architecture
4. Training
5. Playground
6. Analysis

The stage tabs support:

- mouse/touch activation;
- Left/Right and Up/Down arrow navigation;
- Home and End keys;
- ARIA tab and tabpanel semantics;
- previous/next buttons; and
- polite screen-reader announcements.

### Data stage

The bundled `cybersecurity-alerts-v1` dataset is represented in a frontend
registry with:

- 30 total records;
- 24 training records;
- 6 validation records;
- 4,565 normalized characters;
- an 80/20 split visualization;
- sample records;
- common-character counts;
- synthetic provenance; and
- no runtime network download.

### Tokenization stage

The user can:

- enter up to 160 characters;
- see one visual chip per Unicode character;
- see each character's token ID;
- see character counts;
- identify unknown characters;
- observe unknown characters map to token ID `3`; and
- read a plain-language next-token prediction explanation.

The frontend tokenizer uses the same reserved-token order and Unicode-NFC
behavior as the Python reference.

### Architecture stage

Controls are provided for:

- context length;
- embedding dimension;
- attention heads;
- transformer layers;
- feed-forward dimension; and
- tied embeddings.

The interface displays:

- exact estimated parameter count;
- percentage of the 200,000-parameter budget;
- a progress meter;
- token and position embedding counts;
- a separate count for each decoder block;
- final normalization count;
- output bias and projection counts;
- an over-budget error;
- incompatible-head validation;
- minimum head-dimension validation; and
- a visual decoder pipeline.

The default classroom configuration exactly matches the Python reference:

```text
Vocabulary:             35
Context length:         128
Embedding dimension:    64
Attention heads:        4
Transformer layers:     3
Feed-forward dimension: 128
Tied embeddings:        false
Trainable parameters:   113,251
```

### Training stage

The training interface is a deterministic teaching preview and repeatedly
states:

```text
Simulated preview · No model is training
```

It includes:

- scripted training step;
- training loss;
- validation loss;
- elapsed time;
- tokens processed;
- a progress meter;
- a loss chart;
- sample output checkpoints;
- run, pause, resume, and cancel controls; and
- accessible status announcements.

The preview uses a pure state reducer. Pause prevents scripted progress from
advancing, resume restarts it, and cancel transitions to an explicit cancelled
state.

### Playground stage

The playground includes:

- prompt input;
- temperature slider;
- top-k input;
- maximum-token input;
- seed input;
- generated-output region; and
- deterministic sample output.

The page labels the result:

```text
Preview output · Not model-generated
```

No fake inference claim is made.

### Analysis stage

Plain-language cards explain:

- underfitting;
- overfitting;
- memorization;
- generalization;
- temperature;
- model size; and
- the limitations of sub-200K-parameter character models.

## JavaScript modules

The implementation keeps calculation and state logic separate from DOM
rendering:

```text
frontend/
  llm-training-lab.js
  llm-training-lab/
    datasets.js
    parameter-count.js
    preview-state.js
    tokenizer.js
```

Responsibilities:

- `datasets.js`: bundled dataset registry and summary calculations;
- `parameter-count.js`: pure parameter formula and configuration validation;
- `preview-state.js`: pure scripted training reducer and deterministic sample
  generation;
- `tokenizer.js`: deterministic vocabulary, encoding, decoding, token display,
  and common-character counts;
- `llm-training-lab.js`: DOM rendering and user interaction wiring.

The pure modules support both browser globals and Node `require()` so the same
logic is directly testable without a frontend framework.

## Navigation and discovery

Updated:

- [`frontend/demo-lab.html`](../../frontend/demo-lab.html)
- [`frontend/sitemap.xml`](../../frontend/sitemap.xml)

The Demo Lab directory now includes an LLM Training Simulation Lab card, and
the canonical route is registered in the sitemap.

## Accessibility

Implemented accessibility behavior includes:

- skip link;
- semantic headings and landmarks;
- properly associated form labels;
- named fieldsets;
- ARIA tab/tabpanel relationships;
- keyboard tab navigation;
- live regions for state changes;
- progressbar semantics;
- visible focus outlines;
- status text in addition to color;
- unknown-token text in addition to border color;
- explicit preview/not-training labels;
- reduced-motion handling;
- contrast-safe dark and light palettes; and
- mobile touch-sized controls.

A browser review identified and corrected:

1. a live region that initially lacked the lab's visually hidden rule; and
2. insufficient small-text contrast on the light-theme training split.

## Responsive behavior

Browser inspection covered:

- 1440 × 1000 dark mode;
- 1440 × 1000 light mode; and
- 390 × 844 light mode.

Observed layout:

- desktop uses a large grid-backed introduction, two-column mode cards, six
  visible workflow tabs, and multi-column work areas;
- tablet collapses architecture and training regions while preserving the tab
  strip;
- mobile stacks all primary panels, keeps workflow tabs horizontally
  scrollable, uses two-column compact metrics where appropriate, and changes
  stage navigation into a touch-friendly layout.

Browser checks found:

- no JavaScript console errors;
- no page errors;
- no failed local assets;
- no page-level horizontal overflow;
- correct light/dark theme application;
- invalid-configuration visibility;
- token ID `3` for unknown characters;
- correct preview pause behavior; and
- deterministic preview output.

Temporary inspection screenshots were created outside the repository and were
not added as binary project artifacts.

## Files created

```text
frontend/
  demo-lab/
    llm-training-simulation.html
  llm-training-lab.html
  llm-training-lab.css
  llm-training-lab.js
  llm-training-lab/
    datasets.js
    parameter-count.js
    preview-state.js
    tokenizer.js
tests/
  llm-training-lab.test.js
```

Files updated:

```text
frontend/demo-lab.html
frontend/sitemap.xml
```

## Test results

New LLM Training Lab tests:

```text
11 passed
```

Coverage includes:

- exact parameter-count parity;
- tied-embedding accounting;
- incompatible attention heads;
- over-budget rejection;
- bundled dataset summary;
- tokenizer round trips;
- unknown-token behavior;
- preview pause/resume/cancel state;
- deterministic playground samples;
- canonical and compatibility routes;
- local asset resolution;
- unique IDs and accessibility markers; and
- core controller event wiring.

Combined frontend regression result:

```text
84 passed
```

This consists of:

- 11 LLM Training Lab tests; and
- 73 existing cybersecurity lab tests.

The Python reference suite was also rerun:

```text
24 passed
```

JavaScript syntax checks and `git diff --check` also passed.

## Remaining integration work

The following work is intentionally deferred:

1. TensorFlow.js model construction.
2. Dedicated Web Worker training.
3. WebGPU capability probing.
4. WASM/CPU fallback execution.
5. IndexedDB or OPFS model persistence.
6. Real checkpoint export/import in the browser.
7. Browser compatibility with the Python `.mcllm` package.
8. Real trained-model generation in the playground.
9. FastAPI cloud training.
10. Cloud job progress, expiration, and deletion.

These are scope boundaries, not unresolved defects in the frontend shell.
