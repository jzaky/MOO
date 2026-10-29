# Stoke mobile app

Expo SDK 58 / React Native 0.88 / Expo Router. iPhone first, Android supported, web build for development and review.

See the repository root `README.md` for setting up the API and database, and `docs/STATUS.md` for what is implemented and verified.

## Run

```bash
pnpm install                       # from the repository root
cd apps/mobile
EXPO_PUBLIC_API_URL=http://<your-machine-ip>:4000 npx expo start
```

- **Web:** press `w` (the API's `CORS_ORIGINS` must include the dev server origin, default `http://localhost:8081`).
- **Device:** HealthKit, Health Connect, the camera and push notifications need a development build (`npx expo run:ios` / `npx expo run:android`, or EAS Build). They do not work in Expo Go.
- **Push notifications** need an EAS project id in `app.json` → `extra.eas.projectId`.

## Layout

| Path | What |
| --- | --- |
| `src/app/` | Routes (Expo Router). `(tabs)/` holds Today, Nutrition, Train, Progress, Coach. |
| `src/features/workout/` | Local-first live workout store and set/rest components. |
| `src/features/health/` | Apple Health (`adapter.ios.ts`) and Health Connect (`adapter.android.ts`) readers, plus upload/sync. |
| `src/lib/` | API client (token refresh), offline outbox, persisted query cache, data hooks. |
| `src/ui/`, `src/theme/` | Design system primitives, charts and tokens. |

## Checks

```bash
npx tsc --noEmit
npx expo export --platform web     # bundles every route; catches import errors
```
