# NFL Predictor Mobile

React Native Expo preview app for the NFL predictor. This app is read-only and consumes the versioned mobile API contract documented in `../../docs/ios-api-contract.md`.

Default API base URL:

```text
https://www.microcompit.com
```

## Features

- Upcoming Week cards
- Model Signals cards
- Weekly Algorithm Performance
- Per-algorithm performance trend detail
- Loading, error, empty, and stale-cache states

The app does not include login, payments, push notifications, admin refresh, or write workflows.

## Run on Windows with Expo Go

Install Node.js LTS, then from this folder:

```powershell
npm install
npm run typecheck
npm start
```

Install **Expo Go** on your Android phone and scan the QR code shown by Expo.

If you prefer an emulator, install Android Studio, create an Android Virtual Device, then run:

```powershell
npm run android
```

## Project structure

```text
App.tsx
src/config/api.ts
src/types/api.ts
src/services/nflApi.ts
src/components/
src/screens/
```

## Notes

- The app uses mobile cards instead of wide desktop tables.
- Spread displays use the backend `market_favorite_relative_spread` field.
- Model Signals are comparison tools only, not recommendations.
- The first version intentionally avoids extra navigation/charting dependencies.
