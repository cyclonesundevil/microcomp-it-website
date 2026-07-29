# MicroComp Tiny LLM Portable Model Format

This is a practical guide. `docs/model-specification-v1.md` remains the
normative contract.

## Extension and container

The application uses `.microcomp-model` for downloads. The bytes are a ZIP
container compatible with canonical format `1.0` (also described as `.mcllm`
in the architecture specification).

It contains exactly five root files:

```text
manifest.json
tokenizer.json
training-config.json
training-history.json
weights.bin
```

No folders, extra entries, encryption, symlinks, or executable serialization
are allowed.

## Model identity

```text
architecture_identifier =
microcomp.char-decoder-transformer.pre-norm.v1

format_version = 1.0
parameter_limit = 200000
```

The manifest repeats model configuration, vocabulary/context sizes, exact
parameter count, dataset ID and hash, engine ID, timestamp, tensor table, and
file-integrity records.

## Weights

`weights.bin` concatenates finite IEEE-754 float32 tensors:

- tensor names in ascending lexicographic order;
- canonical shapes from the specification;
- little-endian bytes;
- C row-major values;
- contiguous offsets; and
- no internal header or padding.

Each tensor has a SHA-256 over its exact byte slice. Each non-manifest file has
a separate SHA-256 and byte length in `manifest.json`.

The canonical serialized linear weight layout is
`[out_features, in_features]`. Implementations with another internal layout
transpose only at the framework boundary.

## Tokenizer

The tokenizer is character-level, NFC-normalized, and includes fixed IDs:

| ID | Token |
| ---: | --- |
| 0 | `<pad>` |
| 1 | `<bos>` |
| 2 | `<eos>` |
| 3 | `<unk>` |

Dataset characters follow in ascending Unicode code-point order.

## Training documents

`training-config.json` records exact model and training settings.
`training-history.json` retains at most 250 scalar events. A portable package
is an inference checkpoint with educational history; it does not contain Adam
optimizer state and does not promise exact optimizer continuation.

Browser-only replay snapshots are intentionally not part of format 1.0.

## Validation limits

Importers enforce:

- 20 MiB compressed and uncompressed package limits;
- 2 MiB per JSON file;
- 256 tensor records;
- 250 history events;
- exact file and JSON schemas;
- parameter formula and unique tensor count;
- tensor names, shapes, order, offsets, dtypes, layout, and finite values; and
- file and tensor SHA-256 checksums.

Validation completes before model use. Unknown versions, checksum mismatches,
unsafe paths, over-budget configurations, and unexpected content fail
explicitly.

## Interoperability

Browser, cloud, and Python packages use the same format. A cloud download can
be imported directly into IndexedDB and loaded by the browser worker. A
browser-exported package validates in Python without conversion. Float32
parameter bits survive a load/save round trip, while ZIP compression,
timestamps, and JSON formatting may differ.
