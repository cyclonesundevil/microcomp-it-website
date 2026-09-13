# RSM Checkpoint One Review

## Outcome

Checkpoint-one infrastructure successfully generated ratings for 2,962 current-roster players and all 32 NFL teams using the nflverse depth-chart snapshot timestamped `2026-09-11T12:21:50Z`. The existing NFL predictor was not changed or replaced.

Generated artifacts:

- `reports/rsm-player-ratings.csv`
- `reports/rsm-team-ratings.csv`
- `reports/rsm-data-quality.md`
- ignored reproducibility snapshot at `backend/data/rsm/derived/rsm-checkpoint1.json`

Each output identifies `RSM-v0.1-checkpoint1`. Raw sources have a local manifest containing retrieval timestamps, byte counts, source URLs, and SHA-256 digests.

## Sanity checks

The player ordering has reasonable initial face validity in several groups. The leading QB group includes Josh Allen, Lamar Jackson, Jared Goff, Patrick Mahomes, and Jordan Love. The leading edge group includes Myles Garrett, Brian Burns, Danielle Hunter, Nick Bosa, and Trey Hendrickson. The leading interior defensive group includes Jeffery Simmons, Leonard Williams, Calais Campbell, Chris Jones, and DeForest Buckner.

The stable-ID join correctly carries players to their current teams and connects GSIS roster IDs to PFR snap IDs through nflverse's player mapping. No name-based join is used for rating observations.

Opportunity shrinkage keeps players without history at the 50 replacement prior with high uncertainty. Recent observations receive the configured five-season weights, and same-season observations at or after the prediction week are rejected by the loader.

## Sanity warnings

This checkpoint is a data and rating foundation, not a production prediction model.

- Many ratings remain low confidence: 2,474 of 2,962 current-roster players, largely because the roster contains inactive, developmental, and rookie players without meaningful NFL samples.
- Current expected-starter joins are 779 of 780 selected slots. The unmatched slot remains explicit.
- Individual OL values use snap availability and experience only. They do not claim to measure pressure allowed or block win rate.
- Defensive back ratings rely on public disruption and box-score coverage events, not complete target EPA allowed.
- The 0-100 scale is directionally useful but still compressed for some position groups. It requires external validation before labels such as “elite” are displayed to users.
- nflverse does not currently provide post-2024 historical injury reports, so current injury-aware replacement is limited to roster status and depth order.

## Gate decision

Infrastructure and leakage tests pass, and the required 32-team table exists. The checkpoint is accepted as a provisional research foundation. Heavy score optimization and the locked two-season test remain blocked behind point-in-time historical lineup reconstruction and a stronger metric-coverage review. RSM is intentionally not added to the production model selector yet.
