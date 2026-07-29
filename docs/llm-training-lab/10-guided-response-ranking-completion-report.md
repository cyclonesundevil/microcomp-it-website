# Completion Report: Guided Response Ranking

Status: Complete

Completion date: July 29, 2026

Remote repository updated: No

## Outcome

Stage 5 is now a Prediction Lab centered on measurable, readable results.
Open-ended character generation remains available only as an advanced
limitations experiment.

## Human-consumability extension

The primary result now leads with a plain-language decision:

- model-selected security area and complete response plan;
- held-out reference area and response plan;
- explicit `Matched reference` or `Selected a different plan` outcome; and
- a short explanation that does not require interpreting loss values.

Security-area names are disclosed presentation labels attached to curated
candidate plans. They are not described as generated classifications.

Users can also evaluate all six held-out alerts in one bounded worker request.
The scorecard reports baseline and trained match totals and shows the selected
and reference plan for every alert. Technical rank, loss, and character
probability evidence remains available in an expandable section.

The recommended activity:

1. selects an alert/response pair from the held-out validation split;
2. presents four complete readable response candidates;
3. scores the same number of characters for every candidate;
4. ranks candidates by average next-character cross-entropy loss;
5. reconstructs the browser model's deterministic untrained initialization;
6. compares baseline and trained rank/loss for the correct response;
7. identifies the model-selected and correct held-out responses;
8. exposes the top five actual character probabilities at each evaluated
   position; and
9. generates a plain-language verdict from measured rank and loss changes.

No candidate is represented as generated text. The model only scores the
curated responses.

## Worker and privacy boundary

`RANK_RESPONSES` executes inside the existing model-owning Web Worker. The UI
thread receives only:

- candidate IDs and readable text;
- average loss;
- normalized relative ranking score;
- top-1 character accuracy;
- predicted character IDs; and
- five bounded probabilities for the inspected correct-response positions.

It does not receive model weight tensors.

Exact baseline comparison is enabled for models trained by the browser engine.
An imported Python/cloud model does not share the browser engine's initial
weight bits, so the UI does not claim an exact before/after comparison.

## Human usability

- Every main result is a complete readable response.
- Correct and selected responses use explicit text labels, not color alone.
- A wrong selection remains educational and is reported plainly.
- The character microscope connects aggregate ranking to actual probabilities.
- Tables scroll horizontally on small screens and summaries stack responsively.
- Open generation is collapsed and labeled as a failure-mode experiment.

## Additional defect resolved

A page-level `[hidden]` rule now prevents flex/grid declarations from forcing
local-only or cloud-only controls visible. Temporary cloud model actions no
longer appear after a local training run.

## Files created

```text
frontend/llm-training-lab/response-ranking.js
tests/llm-response-ranking.test.js
docs/llm-training-lab/10-guided-response-ranking-completion-report.md
```

## Files updated

```text
frontend/demo-lab/llm-training-simulation.html
frontend/llm-training-lab.css
frontend/llm-training-lab.js
frontend/llm-training-lab/inference-worker.js
frontend/llm-training-lab/local-training-client.js
docs/user-guide.md
docs/developer-guide.md
tests/llm-integrated-v1.test.js
```

## Verification

The dedicated tests cover:

- finite equal-length candidate scoring;
- normalized relative scores;
- bounded top-five probabilities;
- variable candidate lengths;
- malformed and excessive input rejection;
- worker/client/page protocol exposure;
- bounded full-validation-set ranking;
- plain-language single-alert and scorecard surfaces; and
- reliable hidden-state styling.

Complete frontend, browser training, browser/Python compatibility, model
package, persistence, route, and existing website regression:

```text
node --test tests/*.test.js
127 passed
0 failed
```
