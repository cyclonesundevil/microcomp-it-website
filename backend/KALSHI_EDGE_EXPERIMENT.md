# Kalshi Edge Lab

Experimental research surface only. Kalshi observations are not used by production picks, model math, Market Blend, CS Matrix, RSM, or RSM+.

## Import shape

Use the protected experimental page or `POST /api/nfl/experimental/kalshi-edge/import` with the existing admin secret.

```json
{
  "snapshots": [
    {
      "season": 2026,
      "week": 4,
      "game_id": "2026_04_GB_TB",
      "away_team": "GB",
      "home_team": "TB",
      "contract_side": "away_win",
      "price": 0.71,
      "observed_at": "2026-10-04T17:26:00Z",
      "source_url": "https://kalshi.com/..."
    }
  ]
}
```

Supported moneyline sides are `home_win` and `away_win`. Prices may be supplied as `price`, `mid_price`, `kalshi_mid_price`, or bid/ask fields. Spread and total markets are intentionally not analyzed until their contract mapping is explicit.

## Interpretation

The lab calibrates model home-margin projections into straight-up win probabilities, compares them to Kalshi implied probabilities, and flags trades only when the configured edge threshold is met. Simulated P/L assumes buying YES at the imported mid price, with fees set to zero until fee logic is explicitly modeled.

Calibration falls back to a documented logistic transform when historical sample size is thin. Low-confidence calibrations should be treated as exploratory signals, not betting recommendations.
