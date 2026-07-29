# MicroComp IT LLM Training Laboratory — User Guide

## What this lab is

The lab trains and explores a real character-level decoder-only transformer with
a strict ceiling of 200,000 trainable parameters. It is an educational model,
not a smaller equivalent of a commercial assistant. Its output is not
cybersecurity advice.

Open:

```text
/demo-lab/llm-training-simulation.html
```

## Shared workflow

Both training modes use the bundled `cybersecurity-alerts-v1` synthetic
dataset, the same architecture controls, exact parameter formula, generation
controls, analysis language, and `.microcomp-model` package.

1. **Data** shows the fixed training/validation split and character counts.
2. **Tokenization** converts characters to canonical token IDs.
3. **Architecture** validates the configuration and 200,000-parameter ceiling.
4. **Training** reports measured loss, tokens, elapsed time, and checkpoints.
5. **Prediction Lab** ranks readable held-out responses and provides an
   advanced free-generation limitations experiment.
6. **Analysis** explains the actual run without inventing unavailable metrics.

## Train on this device

Select **Train on This Device**, choose a valid configuration, and start
training. Model tensors and optimization stay in a Web Worker so the page
remains responsive. Pause, resume, and cancel operate at safe training
boundaries. Only completed runs are saved to IndexedDB.

Replay snapshots drive **Inside the Transformer**:

- token flow;
- embedding evolution;
- attention heads;
- logits and next-token probabilities;
- selected next token; and
- layer-output magnitudes.

## Train in the MicroComp Cloud

Select **Train in the MicroComp Cloud**, enter the service URL and
operator-issued access key, and connect. The key and anonymous bearer
capability remain in page memory and are cleared when the page closes.

Cloud loss and progress arrive from the Python service using Server-Sent
Events. Cloud jobs expire after 60 minutes of inactivity and no later than six
hours after creation. The displayed expiration time is authoritative for the
current response.

After completion:

- **Download model** saves a portable package.
- **Save and continue locally** downloads the package, validates every file and
  tensor checksum, stores it in IndexedDB, and loads it in the local worker.
- **Delete cloud copy** immediately removes the server-side job and artifacts.

Cloud packages retain scalar training history but not browser replay tensors.
Detailed synchronized transformer replay therefore belongs to local training.

## Prediction Lab and model interaction

The recommended activity presents an alert from the validation split and four
complete, readable response candidates. The worker measures average
next-character loss for the same number of characters in every candidate.
It compares:

- the model's deterministic untrained browser initialization;
- the completed trained model;
- the rank and loss of the correct held-out response; and
- the top five character probabilities at a selected position.

The model ranks curated responses; it does not generate or rewrite them. A
wrong selection remains a valid result because the interface identifies it and
explains whether training improved the correct response's rank.

The plain-language result appears before technical evidence. It shows the
model-selected security area and response plan beside the held-out reference.
Security-area names are human labels attached to the curated plans; they are
not generated classifications. Choose **Evaluate all held-out alerts** to see
the trained and untrained match totals plus a readable row for every
validation alert. Expand **Inspect the measured ranking evidence** only when
rank, loss, and character probabilities are useful.

Models trained by another engine do not have an identical browser
initialization. Save a cloud model locally for inference, but train a browser
model in the lab when an exact before/after ranking comparison is required.

## Advanced open-ended generation

Load any completed browser model or use a still-active cloud model. Enter a
prompt and adjust:

- **Temperature**: lower concentrates probability; higher increases variety.
- **Top-k**: restricts sampling to the most likely characters.
- **Maximum tokens**: bounds generated length.
- **Seed**: makes sampling reproducible within the selected engine.

Free generation is deliberately secondary and labeled **Why tiny models
struggle with open-ended generation**. The tiny model remains an autocomplete
model; it has no chat instruction tuning or factual grounding.

## My Models

Browser models can be loaded, renamed, duplicated, exported, or deleted.
Import accepts only `.microcomp-model` packages. Imports reject unknown
versions, unsafe ZIP entries, unexpected tensors, mismatched shapes or
parameter counts, non-finite weights, and checksum failures.

Browser storage is site-specific and can be removed by clearing site data.
Export important models for durable backup.

## What Happened During Training?

The report appears after a completed run or after loading a model with history.
It uses captured dataset, parameter, token, loss, validation, and generation
settings. If history is insufficient, it says so. Generalization and
overfitting statements are evidence descriptions, not claims of understanding.

## Accessibility and mobile use

The workflow, mode cards, forms, replay controls, and model actions are keyboard
accessible. Status changes use live regions and visible text, not color alone.
On narrow displays, cards and reports become a single column. Local training on
a phone can be slow; cloud mode is the practical alternative when a trusted
service is available.
