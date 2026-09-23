# RSM+ experimental matchup layer

RSM+ is an additive NFL predictor algorithm exposed as `rsm_plus`.

It does not replace or modify the existing `rsm_stage7c` RSM model. The frozen RSM artifacts, coefficients, thresholds, and outputs remain unchanged. RSM+ starts with the current RSM projection and applies a conservative, bounded unit-mismatch adjustment for display and comparison.

## What RSM+ does

RSM+ reuses the existing RSM roster/unit snapshot fields where available and evaluates coarse unit-vs-unit mismatches:

- QB vs opponent pass rush
- QB vs opponent coverage/secondary
- offensive line pass protection vs opponent pass rush
- offensive line run strength vs opponent front seven
- receiver/TE group vs opponent secondary
- rushing/RB group vs opponent front seven
- weakest-link coverage and pressure comparisons

The first implementation caps the margin adjustment at +/- 2.5 points. The adjustment is intentionally conservative and was not tuned against ATS or O/U results.

## What RSM+ is not

RSM+ is not a true player-vs-player tracking model. Current limitations include:

- no verified WR/CB speed matching;
- no route/alignment-specific coverage matching;
- no verified pregame injury/lineup feed beyond the existing snapshot/availability overlay;
- no betting recommendation, stake, lock, or advantage claim.

## Output fields

When available through the common prediction shape, RSM+ includes:

- `pred_margin`
- `pred_total`
- `spread_edge`
- `total_edge`
- `eligible`
- `base_rsm_margin`
- `matchup_adjustment`
- `raw_matchup_adjustment`
- `data_confidence`
- `matchup_explanations`
- `matchup_contributions`
- `model_notes`

`data_confidence` is currently `LOW` because the mismatch layer is based on coarse unit features rather than verified player-vs-player alignment data.

## Public status

RSM+ is labeled `Experimental` in `/api/v1/nfl/models`, Upcoming Week: All Algorithms, mobile upcoming payloads, and Model Signals metadata.
