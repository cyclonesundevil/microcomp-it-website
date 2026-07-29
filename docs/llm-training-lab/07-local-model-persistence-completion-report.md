# Completion Report: Local Model Persistence

Status: Complete

Completion date: July 28, 2026

Remote repository updated: No

## Requested outcome

Add completed-model persistence and a usable browser model library to the LLM
Training Simulation Lab. Users can save, list, load, rename, duplicate, delete,
export, and import models without moving model tensors onto the UI thread.

## Storage strategy

The lab uses IndexedDB because it is available in the existing worker target,
supports structured-clone storage of `Float32Array` tensors, and does not
require a file-system permission prompt.

```text
Database: microcomp-llm-training-lab
Version:  2
Store:    completed-models
Key:      runId
```

Only records with `status: "completed"` can be written. Running, paused,
cancelled, and failed training state is still excluded.

Each completed record contains:

- user-visible name;
- dataset identifier and checksum;
- architecture identifier and exact parameter count;
- tokenizer and model configuration;
- training configuration and final metrics;
- bounded training history and replay observations;
- canonical float32 tensors;
- creation/completion time; and
- preview text.

Newly trained models are saved automatically after successful completion.
Imported models are saved only after full package validation. Duplicate creates
an independent IndexedDB record with a new identifier and creation time.
Deletion also disposes an in-memory inference copy when that model is loaded.

The displayed model size is the actual package size for imports and a
raw-tensor-plus-metadata estimate for models trained in the browser. IndexedDB
implementation overhead is browser-specific and is not included.

## My Models

Stage 5 now contains a responsive, keyboard-accessible **My Models** library.
Every model card shows:

- name;
- dataset;
- parameter count;
- training steps;
- validation loss;
- creation time;
- size; and
- checkpoint preview text.

Available actions:

- Load;
- Rename;
- Duplicate;
- Export;
- Delete;
- Import; and
- Refresh.

Loading reconstructs the CPU reference inference model inside the existing Web
Worker. The Playground is enabled immediately and generates from that stored
model. The UI thread receives metadata, metrics, replay observations, and
generated text, but never owns model tensors.

## Export compatibility

Downloads use the requested `.microcomp-model` extension. The bytes are a
specification-v1 ZIP with exactly:

```text
manifest.json
tokenizer.json
training-config.json
training-history.json
weights.bin
```

No browser-only metadata or replay file is added to the package.

Exports preserve:

- canonical lexicographic tensor order;
- canonical tensor names and shapes;
- contiguous offsets;
- row-major float32 values;
- little-endian byte order;
- exact parameter count;
- exact v1 manifest fields;
- per-tensor SHA-256;
- per-file SHA-256; and
- the 20 MiB package and 2 MiB JSON limits.

The ZIP writer uses uncompressed entries. Compression and ZIP timestamps are
not model semantics. A load/export round trip preserves every float32
parameter bit.

The Python reference importer now accepts `.microcomp-model` as a filename
alias for `.mcllm`. Both extensions contain the same canonical format; the
architecture and package versions were not changed.

## Import compatibility and security

The browser imports both stored and standard DEFLATE ZIP entries. The latter
was verified against a package exported by the Python reference
implementation.

Validation occurs before the model is stored or constructed:

1. Enforce the 20 MiB compressed and uncompressed limits.
2. Parse and preflight the ZIP central directory.
3. Reject encryption, multi-disk archives, ZIP64, duplicate files, nested
   paths, traversal, symbolic-link records, unsupported methods, and any file
   outside the exact five-file set.
4. Check ZIP CRC-32 values.
5. Parse bounded UTF-8 JSON with exact-field schemas.
6. Reject unknown package and architecture versions.
7. Recalculate the parameter formula.
8. Reconstruct expected tensor names, ordering, shapes, offsets, and sizes.
9. Verify all file and tensor SHA-256 digests with Web Crypto.
10. Reject unexpected tensors, parameter mismatches, shape mismatches,
    truncated weights, and non-finite float32 values.
11. Validate tokenizer, training configuration, and training-history schemas.

The importer accepts only declarative JSON and raw float32 bytes. It does not
use `eval`, dynamic modules, pickle, framework object deserialization, HTML
injection, or any other executable serialization.

## Tests

JavaScript:

```powershell
node --test tests/*.test.js
```

```text
110 passed
0 failed
```

The new persistence/package suite covers:

- exact five-file layout and extension;
- float32 bit-preserving export/import;
- metadata and preview preservation;
- corrupt ZIP rejection;
- pre-extraction oversized-package rejection;
- file checksum rejection;
- unknown-version rejection;
- unexpected-tensor rejection;
- parameter-count mismatch rejection;
- tensor-shape mismatch rejection;
- browser export validated directly by Python; and
- Python DEFLATE export imported directly by the browser validator.

Python reference:

```powershell
cd llm-training-lab/python-reference
.\.venv\Scripts\python.exe -m pytest -q
```

```text
31 passed
0 failed
```

Chrome 150 desktop worker smoke:

```text
PASS
```

The browser smoke performs:

```text
train
  -> save to IndexedDB
  -> list
  -> load
  -> rename
  -> duplicate
  -> export
  -> checksum-verified import
  -> load imported model
  -> deterministic generation comparison
  -> delete test records
```

The complete operation ran in a real Web Worker and used a real IndexedDB
database.

An initial repository-root Python test command also discovered unrelated
legacy backend probes whose optional Twilio, Quart, requests, WebSocket, and
Google SDK dependencies are not installed in the model reference environment.
Those probes are outside this milestone; the scoped Python reference suite
passes fully.

## Files created

```text
docs/llm-training-lab/07-local-model-persistence-completion-report.md
frontend/llm-training-lab/model-package.js
tests/llm-model-persistence.test.js
```

## Files updated

```text
frontend/demo-lab/llm-training-simulation.html
frontend/llm-training-lab.css
frontend/llm-training-lab.js
frontend/llm-training-lab/inference-worker.js
frontend/llm-training-lab/local-training-client.js
frontend/llm-training-lab/training-storage.js
llm-training-lab/python-reference/microcomp_llm/portable.py
tests/browser-training-smoke.html
```

## Remaining limitations

1. IndexedDB is browser-local and can be cleared by the user, privacy settings,
   or storage pressure. Export is the durable backup path.
2. OPFS is not used because IndexedDB already supports the bounded model size
   and required typed-array records without additional capability branching.
3. The package intentionally omits Learning Explorer replay matrices and
   optimizer state because specification v1 defines exactly five files.
   Imported models therefore support inference immediately but do not recreate
   browser-only replay observations.
4. Store and DEFLATE ZIP methods are supported. Less common ZIP compression
   methods are rejected explicitly.
5. The Python writer continues to emit `.mcllm`; its reader accepts both
   `.mcllm` and `.microcomp-model`.
