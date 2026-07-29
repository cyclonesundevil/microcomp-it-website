# MicroComp IT LLM Training Laboratory Version 1.0 Release Checklist

## Canonical model

- [x] Architecture identifier and format version are fixed.
- [x] Reserved IDs, normalization, tensors, shapes, and formulas are documented.
- [x] Every engine rejects configurations above 200,000 parameters.
- [x] Browser and Python deterministic fixtures verify tokenizer, tensors, and logits.

## Local experience

- [x] Training and inference execute in a Web Worker.
- [x] AdamW, validation, clipping, deterministic seeds, pause/resume/cancel work.
- [x] Charts display measured values.
- [x] Replay snapshots drive Inside the Transformer.
- [x] Completed models persist in IndexedDB.
- [x] Save/load/rename/delete/duplicate/export/import are available.

## Cloud experience

- [x] FastAPI jobs are bounded, authenticated, isolated, observable, and temporary.
- [x] The page creates an anonymous session and consumes authenticated SSE.
- [x] Cloud generation and package download are integrated.
- [x] Cloud packages can be validated, stored, and loaded locally.
- [x] Expiration and deletion behavior is visible.
- [x] No operator secret is committed or embedded in the public page.

## Education and accessibility

- [x] Dataset, tokenization, architecture, training, Playground, and Analysis share one workflow.
- [x] What Happened During Training uses actual recorded measurements.
- [x] Insufficient evidence is stated instead of fabricated.
- [x] Inside the Transformer covers token flow, embeddings, attention, logits,
      probabilities, selection, and layer outputs.
- [x] Controls have labels, keyboard operation, focus styles, and live status.
- [x] Meaning does not depend on color alone.
- [x] Desktop, tablet, and mobile layouts are responsive.

## Security and privacy

- [x] No arbitrary dataset upload exists.
- [x] Model imports never execute serialized code.
- [x] ZIP traversal, extras, oversize, checksums, shapes, and versions are checked.
- [x] Cloud API key and bearer capability remain memory-only in the page.
- [x] Cloud CORS uses an explicit allowlist.
- [x] Logs omit secrets and prompts.
- [x] Resource, rate, queue, lifetime, and disk limits are configured.

## Documentation

- [x] User guide.
- [x] Deployment guide.
- [x] Developer guide.
- [x] Model-format guide.
- [x] Canonical model specification.
- [x] Milestone completion reports.

## Release validation

- [x] Run the complete JavaScript test suite on the release candidate.
- [x] Run the Python reference test suite on the release candidate.
- [x] Run the cloud-service test suite on the release candidate.
- [ ] Complete a manual local training and replay run in current Chrome.
- [ ] Complete a manual cloud train/download/continue-local run over HTTPS.
- [ ] Verify current Firefox and Safari capability/fallback messages.
- [ ] Verify keyboard-only and 200% zoom operation.
- [ ] Confirm Render secrets, CORS origin, one worker, and retention settings.
- [ ] Confirm production privacy copy and support contact.
- [ ] Record the deployed static and cloud version identifiers.

The unchecked items require release-environment or manual browser evidence;
automated local results belong in the Version 1.0 completion report.
