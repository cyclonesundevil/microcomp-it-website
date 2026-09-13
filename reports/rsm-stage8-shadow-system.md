# Stage 8 - Prospective Shadow Observation System

This is a research-only observation ledger. It records frozen-model fair margins, timestamped market spreads, reconstructed lineup confidence, explanations, candidate-anomaly labels, and pre-kickoff line movement. It does not generate betting recommendations or perform automated wagering.

## Frozen configuration

- Model hash: `679b088a793e0b3f56e946e3dc4c06e5d1b274827375b058bf03e85617f5b1fe`
- Rule hash: `afbe5518089b3e9ed55e28063f8836b8c11c05abf509cd622deafe94717746e8`
- Anomaly-definition hash: `1aeb53395566e4897dde44c72dfa47894e781687eede4b98f3f426f20b273d11`
- Frozen feature count: 18
- Frozen ridge alpha: 100.0
- Source fitting period: 2021-2022. Stage 7C thresholds remain unchanged. No 2023-2025 outcome is used by capture or reporting.

## Capture safeguards

- Prediction receipt, model features, lineup snapshot, and market retrieval must all be timezone-aware and strictly pre-kickoff.
- Feature keys must exactly equal the frozen Stage 7C feature set.
- Outcome, result, wager, stake, bet, and recommendation fields are rejected.
- Only spread observations are accepted; O/U anomaly modeling is not implemented.
- Records are hash-chained and protected by SQLite triggers against update or deletion.

## Current shadow ledger

- Ledger valid: True
- Observations: 0
- Games: 0
- Sportsbooks: none yet
- Candidate-anomaly observations: 0

Line movement is measured relative to the first captured frozen-model fair margin for each game and sportsbook. Closing-line value is not computed, because Stage 8 has no outcomes and a line labeled CLOSING still depends on source timestamp integrity.

STOP: this system is not deployed, does not place wagers, does not recommend sides, and does not evaluate or retune on 2023-2025 outcomes.
