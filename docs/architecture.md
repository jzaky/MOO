# Architecture

MOO is a private, single-user fitness and nutrition app, built so it can later become a multi-user SaaS without a rewrite. This document records the shape of the system and the decisions behind it.

## System overview

```
┌────────────────────────── apps/mobile (Expo SDK 58) ──────────────────────────┐
│ Expo Router screens · design system · TanStack Query (persisted cache)        │
│ Outbox (offline writes) · local-first live workout · HealthKit / Health       │
│ Connect readers · camera / barcode / audio capture                            │
└───────────────▲───────────────────────────────────────────────┬───────────────┘
                │ HTTPS JSON (zod contracts)                      │ multipart (photos, audio)
┌───────────────┴──────────────── apps/api (Fastify 5) ───────────▼───────────────┐
│ routes → services → repositories              AI provider seam (Claude / fake)  │
│ auth (argon2id, JWT, rotating refresh)        speech seam (whisper.cpp)         │
│ food sources (OFF, USDA)                      media storage (signed URLs)       │
│ jobs (notifications)                                                            │
└───────────────┬──────────────────────────────────────────────────────────────────┘
                │ drizzle-orm; every request in `asUser(userId)` → RLS
┌───────────────▼──────────────── PostgreSQL 16 ─────────────────────────────────┐
│ pg_trgm search · Row-Level Security on all user tables · versioned targets and │
│ programs · nutrient snapshots on diary entries · audit events                  │
└────────────────────────────────────────────────────────────────────────────────┘

packages/core       pure domain logic: nutrition maths, targets, adaptive engine, trend,
                    progression, program generator, parsers, search ranking, planners
packages/contracts  zod request/response schemas shared by API and app
```

## Module boundaries

| Module | Owns | Must not |
| --- | --- | --- |
| `packages/core` | All arithmetic and rules: nutrient scaling and summing, targets and safety limits, EWMA trend, adaptive checks, progression, PR detection, program generation, log parsing, search ranking, notification planning, rep counting | Do I/O, read clocks implicitly, or depend on the API or the app |
| `packages/contracts` | Wire schemas and their validation | Contain business rules |
| `apps/api` routes | HTTP shape, auth, validation, transactions | Compute nutrition or progression themselves (they call core) |
| `apps/api` services and repositories | Queries, persistence, provider adapters | Bypass `asUser` for user data |
| AI provider | Turning images and text into *structured* drafts, and coach tool selection | Do arithmetic, write data, or skip schema validation |
| `apps/mobile` | Presentation, offline queueing, device integrations | Decide nutrition values, targets or load changes on its own |

## Key decisions (ADRs)

**ADR-1: TypeScript modular monolith.** One API process with clear internal modules and one Postgres database. A private single-user app gains nothing from services. Module boundaries (above), plus `user_id` on every row, keep a later split possible. *Rejected:* microservices, and Firebase/Supabase as the system of record (lock-in, and weaker control of RLS and migrations).

**ADR-2: Expo (React Native) for mobile.** iPhone first, with Android from the same code. Expo SDK 58 provides Expo Router native tabs, camera barcode scanning, audio and SQLite. The health libraries (`@kingstinct/react-native-healthkit`, `react-native-health-connect`) are MIT and maintained. *Rejected:* Flutter. It would split the language from the TypeScript domain core, and the best Flutter references (wger, OpenNutriTracker) are GPL or AGPL anyway.

**ADR-3: Postgres Row-Level Security as the isolation boundary.** The API connects as `moo_app`, which is a member of `moo_runtime` and does not own the tables. Every request runs inside a transaction that sets `app.user_id`, and policies compare against `app_user_id()`. Shared catalogue rows (`owner_user_id IS NULL`) are readable by all. A separate owner connection is used only for auth, shared-catalogue upserts and named jobs. A forgotten `WHERE user_id = …` therefore cannot leak data. Tests try exactly that.

**ADR-4: Deterministic core; the LLM never does arithmetic.** Models return structured observations: food identity, portion estimates with ranges, label fields, and coach tool calls. Code computes nutrients, targets, trends and progression. Model output is validated against zod schemas, and invalid output is rejected rather than repaired.

**ADR-5: Nothing changes without confirmation.** AI recognition, voice and text parsing produce drafts. Coach changes are recommendations that the user accepts or rejects. The adaptive engine proposes. Load increases in a workout need a tap. Targets and programs are versioned, so history is never rewritten.

**ADR-6: Missing is not zero.** Nutrient values are nullable end to end. Sums report how many entries lacked a value. Energy can be derived from kJ, with a flag. No value is invented.

**ADR-7: Offline-first writes with idempotent upserts.** The client generates UUIDs. Writes are `PUT /resource/:id` with a `clientUpdatedAt`, merged last-writer-wins with a clamp for clock skew. Deletes are tombstones. The outbox coalesces repeated writes to the same resource and retries with backoff. Server fan-out writes use deterministic UUIDs, so replays are no-ops.

**ADR-8: Food data by provenance.** Generic foods come from USDA FoodData Central (CC0, bulk-imported). Packaged foods come from Open Food Facts by barcode (ODbL; attributed; stored with source and id). Private foods are user-owned. Each diary entry stores a nutrient snapshot, so catalogue corrections never change history.

**ADR-9: Original exercise catalogue.** wger's exercise data is CC BY-SA, which would put a share-alike obligation on a proprietary dataset. exercemus and free-exercise-db have unclear provenance. MOO therefore ships its own 83-exercise catalogue. See `repository-evaluation.md`.

**ADR-10: No synthetic recovery score.** Sleep, resting heart rate, HRV, training load and check-ins are each compared with the user's own baseline and explained in words. A single opaque number would imply precision the inputs don't have.

**ADR-11: Form check runs MediaPipe's web runtime in a WebView.** The research recommended a thin native Expo module around MediaPipe Pose Landmarker. Instead, one self-contained page (MediaPipe tasks-vision, version-pinned) runs in a WebView on iOS and Android and in an iframe on web. The trade-off: likely lower frame rate than native GPU code, and a first-use download of about 6 MB. In exchange, the tracking code is identical on every platform and was verified end to end here with real footage, which a native module could not be. Only landmark coordinates cross into the app; analysis is the tested `@moo/core` code running locally. If device frame rates prove too low, the page's message contract (`start`/`stop` in, `frames`/`status` out) is the seam a native module would implement.

**ADR-12: Food matches are suggested, never substituted.** Ingredient and spoken-food matching pre-selects only the best-ranked food, and only if it shares a real word with what the user wrote. Amounts are converted only through the food's own data (servings, volume servings). Anything else is shown as "needs your choice" rather than filled in, because a confident wrong match (e.g. "za'atar" → a cup of currants) fabricates nutrition.

## Data model (summary)

Every user-owned table has `user_id` and an RLS policy. Times are `timestamptz`. Diary days are `YYYY-MM-DD` in the user's time zone at the time of logging.

| Area | Tables |
| --- | --- |
| Identity | `users`, `refresh_tokens` (hashed, family id), `profiles` (units, time zone, preferences, AI consent), `audit_events` |
| Goals and targets | `goals`, `nutrition_targets` (versioned by `effective_from`; basis `estimated` / `adapted` / `manual`) |
| Foods | `foods` (shared or private; per-100 nutrients; source and id; completeness), `food_servings`, `food_favorites` |
| Diary | `food_logs` (portion and nutrient snapshot; provenance), `water_logs`, `diary_days` (complete/incomplete), `saved_meals`, `recipes`, `recipe_ingredients`, `food_recognitions` (AI drafts, photo retention flag) |
| Training | `exercises`, `workout_programs` (versioned), `workout_templates`, `template_exercises`, `workout_sessions`, `session_exercises`, `set_logs`, `personal_records` |
| Body | `body_measurements` (original value and unit kept), `progress_photos` |
| Health | `health_observations` (unique on user, provider and source record), `daily_checkins` |
| Coach | `coach_conversations`, `coach_messages` (native content kept for replay), `coach_recommendations`, `coach_actions` |
| Planning | `meal_plans`, `meal_plan_items`, `grocery_lists`, `grocery_items`, `pantry_items` |
| Notifications | `notification_preferences`, `push_tokens`, `notification_deliveries` (dedupe key) |
| Commercial (future) | `subscriptions`, `usage_events`, `feature_flags` |

Migrations live in `apps/api/migrations`. `0001_rls` holds the grants and policies; later migrations append policies for new tables.

## AI architecture

- **Seam.** `AiProvider` has two methods: `structured(task, schema, input)` and `agentStep(conversation, tools)`. Implementations:
  - `AnthropicProvider`: Claude via `@anthropic-ai/sdk`, structured outputs with zod, server-side fallback on overload.
  - `FakeAiProvider`: queued, deterministic responses, used in tests.
  - `DisabledAiProvider`: returns 503 with a clear message.
- **Food photos.** The stages are separate:
  1. Identify components, each with confidence and alternatives.
  2. Estimate portions as a range.
  3. Match foods in the catalogue (deterministic search).
  4. Compute nutrients (core).
  5. Assign a confidence tier: high ≥ 0.8, medium ≥ 0.5, otherwise low.

  The result is a draft. Only items the user confirms are logged. Photos are deleted after confirm or discard unless the user opted to keep them.
- **Coach.** An agent loop of at most 8 steps runs over 13 tools. Read tools query the user's data, each in its own RLS transaction. Propose tools create `coach_recommendations`; they cannot write targets or programs directly. The nutrition-target tool refuses intakes below the calorie floor. Health data is available only with consent. The full native message history is stored and replayed append-only.
- **Data sent to the provider.** Only what the feature needs. Meal and label photos are sent only when photo analysis is on. Progress photos are never sent. The coach receives tool results, not raw tables.

## Sync design

| Concern | Approach |
| --- | --- |
| Identity | Client UUID per record; server accepts PUT for create and update |
| Ordering | `clientUpdatedAt` last-writer-wins; server clamps future timestamps |
| Deletes | Tombstones (`deletedAt`), so offline deletes win over stale updates |
| Retries | Outbox with exponential backoff; 4xx (except 429) is not retried and is surfaced |
| Reads offline | TanStack Query cache persisted to SQLite-backed storage |
| Live workout | Entire session lives on device; periodic snapshot `PUT /v1/workouts/:id`; finishing marks it complete |
| Health data | HealthKit anchors and Health Connect cursor are stored only after the server accepts a batch; server dedupes on source record id |

## Security and privacy

- **Credentials.** argon2id password hashes. Access tokens last 15 minutes. Refresh tokens rotate; reusing one revokes its whole family. Credential endpoints are rate-limited per IP.
- **Authorization.** RLS (ADR-3) is the boundary, plus route-level auth.
- **Media.** Stored outside the web root. Served only through HMAC-signed URLs that expire.
- **Outbound requests.** Recipe URL import has an SSRF guard that blocks private and loopback addresses.
- **Logging.** Request logs redact the authorization and cookie headers and all request and response bodies (bodies can hold health data).
- **User rights.** Account deletion removes rows and stored media. Export returns all of the user's own data as JSON.
- **Configuration.** Production refuses to start with development secrets.

## Commercialization readiness

User ids are on every row, isolation lives in the database, and subscriptions, usage events and feature flags already have tables. Turning on multi-user mode is therefore mostly product and operations work: sign-up policy, billing, quotas on AI calls, and hosting. It does not require restructuring the data. Licensing decisions (`repository-evaluation.md`) avoid copyleft code and share-alike data in the proprietary core. Open Food Facts data stays attributed and kept separable, as ODbL requires.
