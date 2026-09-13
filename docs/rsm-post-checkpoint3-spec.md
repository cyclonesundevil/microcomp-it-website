# NFL Roster Strength Model — Continue After Checkpoint 3

IMPORTANT:

This project previously followed a larger RSM implementation specification.

The following work is ALREADY COMPLETE and must NOT be rebuilt unless a failing test proves something is broken:

* Player Strength Ratings (PSR)
* five-year player-history processing
* offensive-line ratings
* offensive unit ratings
* defensive unit ratings
* kicker/player roster integration where already implemented
* team roster-strength calculations
* baseline expected-score model
* matchup-to-score mapping
* initial historical score evaluation
* coefficient/model fitting
* calibration performed during development
* RSM-v1 validation

This corresponds to completion of ORIGINAL CHECKPOINT 3:

player ratings
→ unit ratings
→ matchup strength
→ expected points
→ fitted/calibrated RSM-v1
→ validation

DO NOT restart the project.

DO NOT re-run broad repository exploration unless required to understand an existing implementation.

DO NOT redesign completed systems merely because another architecture is possible.

Reuse the existing implementation.

The remaining objective is to determine whether RSM-v1 actually provides reliable predictive value against NFL spreads and totals without leakage or overfitting.

Work through the following stages ONE AT A TIME.

At the end of each stage:

1. run relevant tests;
2. fix failures caused by the stage;
3. update `docs/rsm-progress.md`;
4. summarize findings;
5. STOP.

Do NOT automatically continue to the next stage.

==================================================
STAGE 4 — HISTORICAL INTEGRITY AUDIT
====================================

Do NOT rebuild RSM-v1.

Audit the historical data pipeline feeding the existing RSM model.

The purpose is to establish that historical predictions genuinely used information available before kickoff.

Verify:

* historical starting lineups
* replacement players
* injury availability
* player statistics
* season statistics
* roster membership
* trades
* depth-chart changes
* market-line timestamps

For every historical game at time T:

NO information produced after T may be used.

Specifically test against:

* future games from the same season
* final-season statistics applied to earlier weeks
* future roster changes
* future injuries
* future player performance
* actual game result leakage

If historical lineup reconstruction already exists, validate it rather than rewriting it.

Where lineup quality varies, classify historical lineup confidence as:

HIGH
MEDIUM
LOW

Create or update:

`reports/rsm-lineup-data-quality.md`

Report:

* number of historical games
* percentage with complete expected starters
* percentage with reconstructed starters
* percentage HIGH/MEDIUM/LOW confidence
* missing player histories
* missing injury information
* missing market data
* any leakage risks discovered

Add automated point-in-time leakage tests.

If a real leakage defect is discovered:

fix only the necessary pipeline component,
rerun affected tests,
document the change.

Do NOT optimize ATS or O/U performance during this stage.

STOP after Stage 4.

==================================================
STAGE 5 — LOCKED WALK-FORWARD BACKTEST
======================================

Use the existing RSM-v1 model.

Do NOT rebuild player ratings or unit models.

Before running this stage, establish explicit:

TRAINING PERIOD
VALIDATION PERIOD
LOCKED TEST PERIOD

The LOCKED TEST PERIOD must not be used to:

* select features
* select coefficients
* choose season weights
* choose position weights
* tune hyperparameters
* choose confidence thresholds
* choose model architecture

Use chronological walk-forward evaluation.

Never use random train/test splitting for games.

Evaluate the TWO MOST RECENT COMPLETE NFL SEASONS where valid data exists.

Keep:

REGULAR SEASON

and

PLAYOFFS

completely separate.

---

## REGULAR SEASON

For every eligible regular-season game containing a valid historical spread and total, produce:

ExpectedAwayPoints
ExpectedHomePoints

PredictedMargin
PredictedTotal

MarketSpread
MarketTotal

SpreadEdge
TotalEdge

ATSSelection
OUSelection

HomeCoverProbability
AwayCoverProbability

OverProbability
UnderProbability

Win probabilities where supported.

Do not silently eliminate low-confidence predictions from the primary accuracy measurement.

Primary ATS result:

correct ATS selections / all eligible non-push games

Primary O/U result:

correct O/U selections / all eligible non-push games

Confidence-filtered subsets may be reported separately.

---

## MARKET DATA

Use one consistent market convention.

Prefer closing consensus spread and total immediately before kickoff if those data already exist.

Verify spread sign conventions.

Example:

Home -3

must mean the same thing throughout:

* database
* model
* reports
* grading code

Add explicit tests for spread grading.

---

## METRICS

Report:

ATS wins
ATS losses
ATS pushes
ATS percentage

OU wins
OU losses
OU pushes
OU percentage

Expected-score MAE
Margin MAE
Total MAE
RMSE where useful

95% confidence intervals for ATS and O/U accuracy.

Also report performance:

by season
by week
home vs away
favorite vs underdog
spread-size bucket
total bucket
prediction-confidence bucket

---

## PLAYOFFS

Evaluate playoff games separately.

Report:

Playoff ATS
Playoff O/U
Playoff score MAE
Playoff margin MAE
Playoff total MAE

Do NOT aggressively refit specifically to playoff games.

The sample is too small.

---

## RESULT INTEGRITY

The target remains:

ATS > 60%
O/U > 60%

But this is NOT a requirement.

If the result is:

ATS 55.8%
O/U 57.1%

report exactly that.

Never modify the locked test repeatedly until 60% appears.

Create/update:

`reports/rsm-backtest.md`

STOP after Stage 5.

==================================================
STAGE 6 — DIAGNOSTICS, ABLATION, AND MODEL COMPARISON
=====================================================

Only begin this stage after the locked RSM-v1 backtest exists.

The purpose is to understand WHY the model performed as it did.

Do not indiscriminately optimize against the locked test period.

---

## A. EXISTING MODEL COMPARISON

Compare:

MODEL A
Existing NFL predictor

MODEL B
RSM-v1

Evaluate both on exactly the same eligible games and market lines.

Report:

ATS
O/U
score MAE
margin MAE
total MAE

---

## B. ENSEMBLE

Construct:

MODEL C
Existing predictor + RSM ensemble

Learn ensemble weights using TRAINING/VALIDATION data ONLY.

Do not use the locked test period to choose ensemble weights.

A simple starting structure is:

EnsembleExpectedPoints =
alpha * RSM

* beta * ExistingModel

with approximately:

alpha + beta = 1

Use a more appropriate regularized formulation if justified.

Evaluate the frozen ensemble on the same locked games.

---

## C. FEATURE ABLATION

Determine which RSM components actually add predictive value.

Run controlled ablations such as:

FULL RSM

minus QB PSR

minus offensive-line rating

minus receiver strength

minus rushing strength

minus defensive front

minus secondary

minus injuries / replacement players

minus matchup interactions

minus recent-form component

minus older multi-year history

Evaluate changes in:

score MAE
margin MAE
total MAE
ATS
O/U

Create:

`reports/rsm-ablation-results.csv`

and:

`docs/rsm-ablation-analysis.md`

Do not interpret small noisy changes as strong conclusions.

---

## D. HISTORY-WINDOW ANALYSIS

Test whether the full five-year history actually helps.

Using training/validation methodology, compare reasonable history windows such as:

1 year
2 years
3 years
5 years

Do not automatically assume five years is optimal.

Pay special attention to position differences.

Older history may be more useful for:

QB
OL

and less useful for positions with short performance peaks.

---

## E. OVERFITTING CHECK

Compare:

training
validation
locked test

Flag large performance deterioration.

Also compare year-to-year stability.

Example warning:

Season A ATS = 63%
Season B ATS = 49%

should NOT be presented as a stable 56% predictive edge without qualification.

---

## F. CALIBRATION

Check probabilities.

If RSM assigns approximately:

60% ATS probability

those predictions should historically win near 60%.

Evaluate calibration for:

ATS
O/U
moneyline if available

Report Brier score where appropriate.

Create calibration tables or plots if the project already supports them.

---

## G. EXPLAINABILITY

Use existing rating components to show the major drivers of selected game predictions.

For example:

QB matchup: +2.3 points
OL vs pass rush: -0.8
WR vs secondary: +1.1
run game: +0.4
defensive matchup: -1.0
home field: +1.3

This should explain the existing prediction.

Do not create arbitrary explanations disconnected from the actual model.

---

## FINAL COMPARISON REPORT

Update:

`reports/rsm-backtest.md`

with a concise comparison:

Existing Predictor

ATS: ___
O/U: ___
Margin MAE: ___
Total MAE: ___

RSM-v1

ATS: ___
O/U: ___
Margin MAE: ___
Total MAE: ___

Ensemble

ATS: ___
O/U: ___
Margin MAE: ___
Total MAE: ___

Then answer:

1. Does player-level roster information improve predictions?
2. Does RSM beat the existing predictor?
3. Does the ensemble beat both?
4. How much predictive value comes from QB ratings?
5. Does offensive-line modeling materially help?
6. Do defensive player ratings materially help?
7. Does injury/replacement-player modeling help?
8. Is five years of player history justified?
9. Is performance stable across seasons?
10. Is ATS performance statistically credible?
11. Is O/U performance statistically credible?
12. Was >60% ATS achieved on untouched data?
13. Was >60% O/U achieved on untouched data?
14. What is the highest-value next improvement?

Accuracy is more important than reaching the 60% target.

STOP after Stage 6.

Do not begin another optimization cycle unless specifically instructed.
