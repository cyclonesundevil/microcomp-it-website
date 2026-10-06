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

Supported moneyline sides are `home_win` and `away_win`. Supported total-points sides are `over` and `under`, with `total_line` identifying the O/U threshold. Prices may be supplied as `price`, `mid_price`, `kalshi_mid_price`, or bid/ask fields. Spread markets are intentionally not analyzed until their contract mapping is explicit.

## Automatic Kalshi API refresh

The protected experimental page also exposes **Fetch From Kalshi API**, backed by:

```text
POST /api/nfl/experimental/kalshi-edge/refresh
```

The refresh reads Kalshi `KXNFLGAME` and `KXNFLTOTAL` markets from the Trade API, matches paired `Team wins` contracts and total-points contracts to the current NFL Predictor schedule, normalizes those contracts into the same snapshot shape above, and imports them into the local Kalshi Edge Lab store. Add `season` and `week` query parameters to refresh a specific slate, for example:

```text
POST /api/nfl/experimental/kalshi-edge/refresh?season=2026&week=5
```

Useful environment variables:

```env
KALSHI_API_BASE_URL=https://external-api.kalshi.com
KALSHI_API_KEY=your-key-id
KALSHI_API_SECRET=backend\kalshi-private-key.key
```

The current moneyline and total-points refresh uses public market-data endpoints, but the key variables are kept available for authenticated Kalshi calls when needed.

## Interpretation

The lab calibrates model home-margin projections into straight-up win probabilities and model total projections into O/U probabilities, compares them to Kalshi implied probabilities, and flags trades only when the configured edge threshold is met. Simulated P/L assumes buying YES at the imported mid price, with fees set to zero until fee logic is explicitly modeled.

Calibration falls back to a documented logistic transform when historical sample size is thin. Low-confidence calibrations should be treated as exploratory signals, not betting recommendations.
