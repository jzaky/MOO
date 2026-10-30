# Stoke

A private, AI-native fitness and nutrition app: food logging (search, barcode, photo, label, voice, UAE dishes), a workout tracker with deterministic progression, training blocks and a plate calculator, progress and recovery tracking, adaptive nutrition targets, import from Strong, Hevy and MyFitnessPal, and a coach that works from your own data and only proposes changes. English and Arabic (right-to-left). iPhone widgets, a rest-timer Live Activity, an Apple Watch companion and Siri shortcuts are written but not yet compiled (see `docs/STATUS.md`). It is built for one user now and structured to become a multi-user service later.

| Doc | What it covers |
| --- | --- |
| [`docs/iphone-setup.md`](docs/iphone-setup.md) | **Getting the app onto your iPhone**: server on Render, cloud build with EAS |
| [`docs/STATUS.md`](docs/STATUS.md) | **What is implemented, tested, partial and planned**, and what could not be verified |
| [`docs/architecture.md`](docs/architecture.md) | System design, decisions (ADRs), data model, AI, sync, security |
| [`docs/repository-evaluation.md`](docs/repository-evaluation.md) | The 24-repository evaluation and licensing decisions |
| [`docs/design-system.md`](docs/design-system.md) | Tokens, components, screen inventory |
| [`docs/roadmap.md`](docs/roadmap.md) | Phases, acceptance tests, performance targets, risks |
| [`docs/research/`](docs/research) | Full due-diligence reports |

## Repository layout

```
apps/api            Fastify 5 + drizzle-orm + PostgreSQL 16 (RLS)
apps/mobile         Expo SDK 58 app (iOS first, Android, web for development)
packages/core       Pure domain logic: nutrition maths, targets, trend, progression, ranking…
packages/contracts  zod schemas shared by API and app
scripts/            Local database setup
```

## Setup

Requirements: Node ≥ 22, pnpm 10, and PostgreSQL 16 with the `pg_trgm` extension available.

```bash
pnpm install

# 1. Roles and databases (stoke_owner owns tables; stoke_app is the RLS-restricted runtime role)
sudo -u postgres ./scripts/dev-db-setup.sh

# 2. Schema, RLS policies and the exercise catalogue
pnpm --filter @stoke/api db:migrate
pnpm --filter @stoke/api seed

# 3. Optional: generic foods from USDA FoodData Central (CC0).
#    This also builds the UAE standard-recipe dishes from those ingredients
#    (re-run them alone with `pnpm --filter @stoke/api import:dishes`).
curl -O https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip
unzip FoodData_Central_sr_legacy_food_json_2018-04.zip
pnpm --filter @stoke/api import:fdc "$PWD/FoodData_Central_sr_legacy_food_json_2018-04.json"

# 4. Run the API (http://localhost:4000)
pnpm --filter @stoke/api dev

# 5. Run the app (see apps/mobile/README.md for device builds)
cd apps/mobile && npx expo start
```

## Configuration (API environment)

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://stoke_app:stoke_app@localhost:5432/stoke_dev` | Runtime role; RLS applies |
| `DATABASE_OWNER_URL` | `postgres://stoke_owner:stoke_owner@localhost:5432/stoke_dev` | Migrations, auth and system jobs |
| `JWT_SECRET`, `MEDIA_SIGNING_SECRET` | dev values | ≥ 32 chars. **Production refuses the dev defaults.** |
| `AI_PROVIDER` | `none` | `anthropic` (needs `ANTHROPIC_API_KEY`), `fake` (scripted, for development), or `none` (AI features return 503) |
| `AI_MODEL` | `claude-opus-5-5` | |
| `STT_URL` | – | whisper.cpp server base URL for voice logging |
| `USDA_API_KEY` | – | Optional live FDC lookups (the bulk import needs no key) |
| `OFF_USER_AGENT` | `StokeFitness/0.1 (…)` | Open Food Facts requires an identifying User-Agent |
| `CORS_ORIGINS` | `http://localhost:8081,http://localhost:19006` | Web build origins |
| `STORAGE_DIR`, `PUBLIC_BASE_URL` | `./storage`, `http://localhost:4000` | Private media and signed-URL base |
| `RATE_LIMIT_PER_MIN`, `AUTH_RATE_LIMIT_PER_MIN` | 240, 10 | Per IP |

Mobile: `EXPO_PUBLIC_API_URL` (or `extra.apiUrl` in `app.json`), and `extra.eas.projectId` for push notifications.

## Checks

```bash
pnpm --filter @stoke/core test        # 85 unit tests
pnpm --filter @stoke/api test         # 83 integration tests (needs the stoke_test database)
pnpm --filter @stoke/mobile test      # 20 unit tests (workout store, outbox, recipe editor, form check)
pnpm test                           # all of the above
pnpm -r typecheck
cd apps/mobile && npx expo export --platform web
```

CI (`.github/workflows/ci.yml`) runs the same checks on every push, with a Postgres 16 service.

## Data and licences

Food data comes from USDA FoodData Central (public domain, CC0) and Open Food Facts (© Open Food Facts contributors, [ODbL](https://opendatacommons.org/licenses/odbl/1-0/)). Products are fetched by barcode and stored with their source. The exercise catalogue is original to this project. No GPL, AGPL or share-alike code or data is included; see `docs/repository-evaluation.md`.

Nutrition and training output is an estimate and not medical advice.
