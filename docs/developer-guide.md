# MicroComp IT LLM Training Laboratory — Developer Guide

## Authority and boundaries

`docs/model-specification-v1.md` is authoritative. The browser, Python
reference, and cloud service conform to it; none independently defines the
architecture.

```text
canonical specification
  ├─ Python reference and package validator
  ├─ browser worker: inference, training, replay, persistence
  └─ FastAPI service: temporary Python training and packages

shared page controller
  ├─ bundled dataset and tokenizer UI
  ├─ exact parameter calculator
  ├─ local worker client
  ├─ cloud SSE client
  ├─ common Playground
  ├─ Inside the Transformer
  └─ measured training report
```

## Frontend modules

- `datasets.js`: immutable curated dataset and split summary.
- `tokenizer.js`: UI tokenizer behavior.
- `parameter-count.js`: pure validation and layer counts.
- `local-training-client.js`: request/event boundary for the worker.
- `cloud-training-client.js`: in-memory authentication, REST, SSE, downloads.
- `training-report.js`: pure actual-session analysis.
- `transformer-visualization.js`: replay view-model helpers.
- `response-ranking.js`: equal-window candidate loss, ranking, and bounded
  next-character evidence.
- `inference-worker.js`: owns all local model tensors and persistence access.
- `training-core.js` / `training-runner.js`: AdamW and lifecycle.
- `training-storage.js`: IndexedDB records.
- `model-package.js`: strict portable ZIP writer/importer.
- `llm-training-lab.js`: DOM orchestration only.

Guided response ranking runs entirely in the worker. For browser-trained
models, the worker reconstructs the exact deterministic initialization from
the recorded seed and scores the same held-out candidates before and after
training. Average loss is length-normalized over an equal character count.
Curated responses are always labeled as ranked rather than generated.
`RANK_RESPONSE_SET` evaluates up to twelve bounded challenges in one worker
request, reusing one deterministic baseline model. The controller maps each
curated response plan to a disclosed human-readable security-area label and
reports exact held-out match counts. Those labels are presentation metadata,
not model-generated output.

The UI thread never owns live model tensors. It receives bounded educational
snapshot arrays and scalar metrics.

## Unified lifecycle

Local:

```text
page → local client → Web Worker → TensorFlow.js trainer
                              → IndexedDB → package export
```

Cloud:

```text
page → cloud client → anonymous session → queued Python job
                  ← authenticated SSE progress
                  → remote generation/download
                  → browser package validator → IndexedDB → local worker
```

The cloud API key, bearer capability, and service URL are not persisted.

## Adding a dataset

Version 1 accepts only `cybersecurity-alerts-v1`. A future dataset must be
curated, bundled, deterministic, safe to redistribute, and given a stable ID
and SHA-256. Both engines must use identical normalized content and split
semantics. Cloud request schemas must explicitly allow the new ID.

## Compatibility rules

- Recalculate parameters before allocation and after construction/import.
- Preserve canonical tensor names, shapes, ordering, and float32 layout.
- Treat package weights—not equal random initialization—as the cross-engine
  identity boundary.
- Reject unknown format majors and v1 unknown fields.
- Never deserialize executable objects.
- Never silently migrate an artifact.

See `docs/model-format.md` for the package summary and the canonical
specification for normative details.

## Tests

Frontend:

```powershell
node --test tests/*.test.js
```

Python reference:

```powershell
cd llm-training-lab/python-reference
.\.venv\Scripts\python.exe -m pytest -q
```

Cloud:

```powershell
cd llm-training-lab/cloud-service
..\python-reference\.venv\Scripts\python.exe -m pytest -q
```

The JavaScript suite includes browser/Python logits fixtures, package
round-trips, malformed-package rejection, persistence, worker training,
capability-page coverage, cloud-client behavior, report integrity, and route
checks.

## Change review

Architecture or tokenizer changes require a new architecture identifier.
Package schema additions require a later package format. UI-only explanations
must still avoid unsupported claims. Any cloud change should be reviewed for
CORS, authorization, session isolation, retention, resource limits, and
secret/log leakage.
