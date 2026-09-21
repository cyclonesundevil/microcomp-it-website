# NFL API v1 Contract

The `/api/v1/nfl/*` endpoints are the stable client contract for future mobile clients. They currently preserve the response shape of the existing web endpoints while giving app clients a versioned path.

## Read endpoints

- `GET /api/v1/nfl/models`
- `GET /api/v1/nfl/teams`
- `GET /api/v1/nfl/upcoming?scope=upcoming`
- `GET /api/v1/nfl/week-performance?season=YYYY&week=N`
- `GET /api/v1/nfl/predict`
- `GET /api/v1/nfl/history`
- `GET /api/v1/nfl/backtest`
- `GET /api/v1/nfl/dashboard`
- `GET /api/v1/nfl/live`

## Admin endpoint

- `POST /api/v1/nfl/refresh`

Requires the same `X-NFL-Refresh-Token` header as the legacy route.

## Compatibility notes

- Legacy `/api/nfl/*` routes remain available for the website.
- Public upcoming reads are cache-first and do not trigger expensive rebuilds.
- Weekly performance grades completed games only after final scores are present in the NFL results feed.
- Manual refresh/rebuild requires the admin refresh token.
- Upcoming manual matchup predictions may apply upcoming-only safeguards when the selected teams exactly match a scheduled upcoming game.
