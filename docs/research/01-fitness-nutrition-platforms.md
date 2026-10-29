# 01: Open-source fitness and nutrition platforms (technical due diligence)

**Audit date:** 2026-10-29. **Auditor method:** I cloned each repo with `git clone --filter=blob:none --shallow-since=2025-01-01` (workout-cool was deepened the same way) and inspected the source, schemas, manifests, tests and CI workflows directly. "Last 12 months" means commits since 2025-10-29, counted with `git rev-list --count --since=2025-10-29 HEAD`; the count includes merge commits. Release dates come from git tag creator dates. Star and issue counts come from github.com HTML pages (WebFetch) and are approximate. The GitHub REST API was not used.

**Context:** our product is a proprietary commercial SaaS: Expo/React Native + TypeScript on mobile, a TypeScript backend (Fastify/Hono) and PostgreSQL. Hard rule: **no GPL/AGPL code, and no code under a non-commercial license, goes into our codebase.** "Reference" below means *study the ideas and data model, then write our own implementation clean-room*. It never means copying files, SQL DDL or translated code.

> **Headline finding:** SparkyFitness is **not MIT/open source**. Its `LICENSE` is a custom **non-commercial, source-available** license with a share-alike clause for derivatives, a contributor-assignment clause and automatic termination. This is the most legally restrictive repo in the set, more so than the GPL/AGPL ones.

---

## 1. CodeWithCJ/SparkyFitness

1. **Purpose:** a self-hosted, all-in-one health tracker covering food diary, exercise and workouts, water, sleep, body measurements, fasting, mood, symptoms, cycle and pregnancy, medications/GLP-1, and an AI chat assistant. It has a web SPA, an Expo mobile app with HealthKit/Health Connect sync, a Garmin microservice and about 25 third-party integrations.
2. **Latest version:** `v1.10.0` (tag 2026-10-28; `version.txt` = 1.10.0). The release train is weekly to biweekly: v1.7.3 on 09-27, v1.8.0 on 10-07, v1.9.0 on 10-20 and v1.10.0 on 10-28, managed with release-please.
3. **Last maintenance activity:** last commit 2026-10-28 (helm chart bump, merge of PR #3252). **8,333 commits in the last 12 months** and 6,124 in the last 6 months. Monthly volume is accelerating: 153 in 2025-11, 756 in 2026-03, 1,124 in 2026-08 and **2,165 in 2026-10**. There are 177 distinct author names. The top authors are CodeWithCJ, with 1,924 commits plus aliases `codewithcj001` (587) and `"CodewithCJ"` (519), then Jerrys-modz (1,197) and apedley (848). The repo has `AGENTS.md`/`CLAUDE.md` in every package, which suggests heavily AI-assisted development; review depth per commit is unverified. About 6.5k stars and 162 open issues.
4. **License:** custom **"non-commercial purposes only"** license in `LICENSE`, last changed 2025-06-21 and 2025-07-12. The README states: "SparkyFitness is source-available, not open source". Its clauses:
   - §1: no use "directly or indirectly" in any commercial product.
   - §2: derivative works, defined to include "new works that incorporate substantial portions", must carry the same non-commercial terms.
   - §6: contributors assign all rights to the author.
   - §7: the license terminates automatically on breach.
   - CI enforces PR license agreements (`.github/workflows/pr-license-enforcement.yml`).
5. **Commercial-use considerations:** **we cannot use any code, SQL migrations, prompts (`SparkyFitnessServer/prompts/*.md`) or assets in a commercial SaaS** without written permission from the author. Copying `db_schema_backup.sql` DDL or the prompt files would be the riskiest move. Feature ideas and general data-modelling concepts are not copyrightable. Even so, the team should not keep this repo open while writing the equivalent modules, and should document a clean-room process. A commercial license from the author is the only path to reuse.
6. **Tech stack:**
   - pnpm monorepo: `SparkyFitnessServer`, `SparkyFitnessFrontend`, `SparkyFitnessMobile`, `shared`, `SparkyFitnessGarmin`, `docs`.
   - Server: Node, **Express 5** + TypeScript (tsx), raw SQL via `pg`/`pg-format` (no ORM), PostgreSQL with **row-level security**.
   - Web: Vite + React 19 + Radix/shadcn + TanStack Query.
   - Mobile: **Expo SDK 57 / RN 0.86** + TanStack Query + zustand + uniwind (Tailwind).
   - Garmin: Python FastAPI.
   - Deployment: Docker, Helm, Nix, Umbrel.
7. **Key dependencies:**
   - Server: `better-auth` 1.7 (passkey, SSO/OIDC, API keys, Expo), `ai` 7 with `@ai-sdk/anthropic|openai|google`, `@modelcontextprotocol/sdk`, `zod` 4, `express-validator`, `swagger-jsdoc`/`redoc-express`, `@garmin/fitsdk`, `sharp`, `heic-convert`, `node-cron`, `nodemailer`.
   - Mobile: `@kingstinct/react-native-healthkit`, `react-native-health-connect` (patched), `@assistant-ui/react-native`, `victory-native`, `@shopify/react-native-skia`, `expo-widgets`, `expo-camera`.
   - Garmin: `garminconnect` pinned from git (an unofficial Garmin Connect client) plus `curl-cffi` and `ua-generator`, which do browser impersonation.
8. **Security concerns:**
   - (a) The license itself is the legal risk.
   - (b) 21 security-flavoured commit subjects in 12 months, including an SQL-injection fix in `measurementRepository`, food-provider SSRF fixes via DNS-resolution guarding (`utils/outboundUrlPolicy.ts`), a demo-SSO SSRF fix, advisory `GHSA-jh96-mj9m-x796` and a CORS hardening. Response is active, but these bug classes kept recurring.
   - (c) Uploads are served by `express.static` under `/api/uploads` with a **deny-list** of sensitive subtrees (`check-in`, `pregnancy`, `symptoms`) in `SparkyFitnessServer.ts` around line 502. Everything else is public by path.
   - (d) Garmin integration scrapes with impersonation, which carries terms-of-service and account-ban risk.
   - (e) User AI keys are encrypted with AES using an env key (`security/encryption.ts`), which is a good pattern.
   - (f) RLS keyed on `current_setting('app.user_id')` (`db/rls_policies.sql`, 1,083 lines) gives defense in depth.
   - (g) Very high commit velocity raises regression risk.
9. **Relevant components** (all reference-only):
   - **DB:** `SparkyFitnessServer/db/migrations/` holds 287 migrations dated 2025-07-03 to 2026-10-28. `db_schema_backup.sql` defines 127 tables. Key tables: `foods`, `food_variants`, `food_entries`, `meal_types`, `exercise_entries`, `exercise_entry_sets`, `workout_presets`, `workout_plan_templates`, `water_intake_entries`, `user_dashboard_layouts`, `family_access`.
   - **API:** 68 v1 route files in `SparkyFitnessServer/routes/*.ts` and 23 v2 files in `routes/v2/`, mounted in `SparkyFitnessServer.ts` (`/api/...`, `/api/v2/...`). 114 services. OpenAPI via swagger-jsdoc.
   - **AI:**
     - `ai/providerDispatch.ts`: multi-provider abstraction over anthropic, openai, google, mistral, groq, xai, openrouter, perplexity, ollama and openai_compatible.
     - `ai/tools/*.ts`: about 40 domain tool modules covering food, exercise, vision, coach, meal plans, water and more.
     - `ai/mcp/mcpAdapter.ts` + `ai/mcp/toolAccess.ts`: an MCP server with per-tool read/write classification for read-only API keys.
     - `routes/chatRoutes.ts` and `routes/v2/foodAssistantRoutes.ts`.
   - **Integrations** (`integrations/`): openfoodfacts, usda, fatsecret, nutritionix, cnf, swissfood, livsmedelsverket, mealie, tandoor, wger, freeexercisedb (yuhonas, Unlicense), garmin, fitbit, oura, polar, strava, withings, coros, intervals, hevy, liftosaur, googlehealth.
   - **Mobile:** `SparkyFitnessMobile/src/components/ActiveWorkout*.tsx`, `src/services/healthkit/`, `src/services/healthconnect/`, `backgroundSyncService.ts`.
10. **Reuse difficulty:** **legally prohibited** for us. Technically it would be moderate: same language and similar stack. But it is Express rather than Fastify, uses raw SQL, and the server is a very broad monolith.
11. **Integration risks:** license breach and termination; dependence on unofficial Garmin APIs; a 287-migration schema with heavy denormalization (`exercise_entries` has more than 50 columns, including copied exercise metadata). Even if licensed, upstream drift at roughly 70 commits per day would make staying in sync impractical.
12. **Test quality:**
    - Server: 632 test files with about 6.8k `it`/`test` cases (vitest + supertest), including 32 `*integration*` tests run against **Postgres 18** in `ci-tests.yml`.
    - Mobile: 790 test files with about 10.5k cases (jest-expo + RN Testing Library).
    - Web: 274 files with about 2.3k cases (jest).
    - CI also runs lint (`--max-warnings 0`), knip and a schema-backup check.
    - This is strong quantitatively. Test quality per case is unverified.
13. **Maintenance outlook:** very active, with a single owner who controls the license and holds contributor assignments. The licensing posture is deliberate, so a relicense to OSS is unlikely (unverified). Possible path: ask the author for a commercial license.
14. **Final recommendation: REJECT** (for any code, SQL or prompt reuse). Under the non-commercial license, with its derivative-works and termination clauses, any incorporation into our SaaS is infringement. It is the most feature-complete benchmark in this set, and that is a reason for more caution, not less. Use only the *product feature list* for competitive scoping, at the level of ideas, written up independently. If its MCP/AI-tool architecture is strategically important, the only compliant route is a negotiated commercial license.

**Design takeaways for our app** (concepts, re-derived independently):
- **Food identity vs serving:** split `food` (name, brand, barcode, provider + external id) from `food_variant`. Each variant is one serving definition (`serving_size`, `serving_unit`, `is_default`) with its *own* nutrient vector, plus `source ∈ {manual, ai_estimate, imported}` and `ai_confidence`.
- **Snapshot on log:** `food_entries` copies name, brand, serving and all nutrients at log time, so history survives later edits or deletion of the food. Keep `source`/`source_id` for provenance.
- **User-defined meal types** live in a table, not an enum (`meal_types`, `user_meal_visibilities`).
- **Set model:** a set row carries `set_number`, `set_type`, `reps`, `weight`, `duration`, `distance`, `rest_time`, `rpe`, `rir`, `is_pr` and `completed_at`. Entries carry `superset_group` and `sort_order`. Exercises carry a `modality` (for example `weight_reps`) that drives the input UI.
- **Water** entries reference a container (`container_id`, `hydration_factor`) and can link to a `food_entry` (water contributed by food or drinks).
- **Per-user dashboard layout** stored as `user_dashboard_layouts(page_key, layout jsonb, hidden jsonb)`.
- **Delegated access** through `family_access` + `created_by_user_id`/`updated_by_user_id`, enforced by Postgres RLS on `app.user_id`.
- **AI-native pattern:** one domain tool layer shared by in-app chat *and* an MCP endpoint, with an explicit read/write map so read-only API keys default to deny.

---

## 2. simonoppowa/OpenNutriTracker (ONT)

1. **Purpose:** a privacy-focused, offline-first mobile calorie and macro tracker built in Flutter, with an encrypted local diary, food search (Open Food Facts, USDA FDC, and its own Supabase "multi-source" food backend), barcode scanner, recipes, fasting, weight log, activity (MET-based) and optional BYO-key AI meal parsing.
2. **Latest version:** `v2.5.0` (pubspec `2.5.0+67`, tag 2026-10-23). Earlier: v1.5.0 on 2026-05-28, v2.0.0 on 07-15, v2.3.0 on 09-10 and v2.4.0 on 09-26.
3. **Last maintenance activity:** last commit 2026-10-23 (iOS export hotfix, PR #1452). **967 commits in the last 12 months**, 909 in the last 6 months, from 47 authors: Simon Oppowa 458 and Jordan Lee 363. Activity was *bursty*. 2025 was near-dormant, with 66 commits from January to September 2025 and none in November or December 2025. The project restarted in 2026, with a spike of 408 commits in 2026-05 and then 78 to 165 per month from July to October. About 2.8k stars and 154 open issues.
4. **License:** **GPL-3.0** (app, `LICENSE`). The companion backend `simonoppowa/opennutritracker-backend` is also **GPL-3.0** (last commit 2026-09-18).
5. **Commercial-use considerations:** GPL-3.0 is copyleft. Copying or translating any Dart or SQL into our app would force the combined work under GPL. **No code reuse.**
   - **Formulas** such as IOM 2005 EER, Compendium METs and the 4/4/9 kcal factors are public science. We should re-implement them from the primary sources cited in `lib/core/utils/url_const.dart` (National Academies, WHO, PubMed), not from ONT's code.
   - **Food data:** the *datasets* ONT's backend imports have their own licenses, independent of GPL: USDA FDC **CC0**, BLS 4.0 **CC BY 4.0** (attribute Max Rubner-Institut), INDB **CC BY 4.0**, TBCA "free with attribution" (exact terms unverified). Per `ont-backend/README.md`, all of these can be ingested by our own pipeline.
6. **Tech stack:** Flutter/Dart, clean architecture (`lib/features/<f>/{data,domain,presentation}`), **BLoC** (`flutter_bloc`) + `provider` + `get_it` DI, **Hive CE** local DB with AES encryption, Supabase client for food search, Sentry. Backend: Supabase Postgres with a `food_summary` materialized view (`ont-backend/sql/schema.sql`, 663 lines) plus Python import scripts.
7. **Key dependencies:** `hive_ce` 2.20, `flutter_secure_storage` 10, `supabase_flutter` 2.17, `mobile_scanner` 7, `health` 13, `sentry_flutter` 9, `envied` (build-time env obfuscation), `fl_chart`, `home_widget`, `flutter_local_notifications`, `http`, `json_serializable`. Dev: `mockito`, `integration_test`, `build_runner`.
8. **Security concerns:**
   - The Supabase URL and anon key are compiled into the binary (`lib/core/utils/env.dart`). `envied` obfuscation is not secrecy, so security rests entirely on backend RLS and grants (unverified).
   - BYO AI keys are stored in secure storage (`lib/core/utils/ai_credential_storage.dart`) and sent straight from the device to the provider. Meal photos and text go to third parties.
   - Sentry telemetry is included.
   - Local data is encrypted: `HiveAesCipher` with the key in the secure enclave/keystore (`lib/core/utils/hive_db_provider.dart`, around lines 122 and 168). This is good practice.
9. **Relevant components** (reference only):
   - Calculators in `lib/core/utils/calc/`: `tdee_calc.dart` (IOM 2005, including a non-binary profile option), `pal_calc.dart`, `met_calc.dart`, `macro_calc.dart` (defaults 60/25/15 for carbs/fat/protein), `bmi_calc.dart`, `weight_moving_average.dart`, `workout_compensation_calc.dart`, `day_boundary_calc.dart`, `dri_reference.dart`.
   - Storage: `lib/core/data/dbo/*_dbo.dart` (Hive types `intake_dbo`, `meal_dbo`, `meal_nutriments_dbo`, `tracked_day_dbo`, `recipe_dbo`, `water_intake_dbo`, `weight_log_dbo`).
   - Search: `lib/features/add_meal/data/data_sources/sp_food_data_source.dart` (Supabase search, over-fetch then rank), `off_data_source.dart`, `dto/fdc/`.
   - AI: `lib/features/add_meal/data/anthropic_meal_items_api.dart` (pinned `claude-haiku-4-5`, forced tool call, `max_tokens` 1024, 20 s timeout), `openai_meal_items_api.dart`, `util/meal_text_parser.dart` (local fallback).
   - Diary integrity: `lib/core/utils/tracked_day_reconciler.dart` and `tracked_day_total_repair.dart`.
   - Backend: `ont-backend/sql/schema.sql` (`food`, `nutrient`, `food_nutrient`, `food_portion`, `measure_unit`, `food_translation`, `food_alias`, `food_summary` MV).
10. **Reuse difficulty:** **prohibited** (GPL). It would also be technically non-transferable: Dart/Flutter versus our TS/RN, and Hive versus SQLite or WatermelonDB.
11. **Integration risks:**
    - GPL contamination if any developer ports code.
    - The bursty maintenance history.
    - Dependence on their hosted Supabase if anyone used its food API. Don't: the endpoint is not a public product and has no SLA.
    - OFF data is ODbL (share-alike on the *database*), which applies if we mirror OFF.
12. **Test quality:** 289 `*_test.dart` files with about **3,021** `test`/`testWidgets` cases (flutter_test + mockito + integration_test). `default_workflow.yml` runs `flutter analyze`, `just test` and a dedicated **DST test job** (`just test_dst`), plus an l10n check and an iOS pod-install check. This is strong for a mobile app.
13. **Maintenance outlook:** currently active, with two main maintainers and frequent store releases (`deployed/NN` tags). The 2025 dormancy shows bus-factor risk.
14. **Final recommendation: REFERENCE.** GPL-3.0 rules out any code reuse, and the stack does not match. Its value is in *design*: an encrypted offline-first diary, a canonical per-100g nutrient vector, a multi-source food ingestion schema, DST- and day-boundary-aware day bucketing, and a careful AI-meal-parsing contract with a local fallback. Re-implement formulas from the primary literature, and build our own ingestion pipeline straight from FDC (CC0) and BLS/INDB (CC BY) with attribution.

**Design takeaways for our app:**
- **Canonical per-100 g nutrient vector** (24 fixed columns), plus `default serving` and a `food_portion` table (portion name, gram weight). Store everything internally in grams/ml and convert only at the UI.
- **Search read model:** a denormalized `food_summary` materialized view plus a `food_translation(locale, name)` table, so search and i18n are separate from the normalized source tables. Over-fetch (5×) and re-rank, preferring foods that have a usable portion.
- **Intake = embedded meal snapshot** + amount + unit + meal type + datetime. Keep a `TrackedDay` rollup (kcal and macro totals vs goal) but make it **recomputable**, with reconciler/repair jobs.
- **Day boundaries and DST:** compute "today" in the user's timezone and test DST transitions explicitly.
- **AI meal parsing contract:** forced tool/JSON schema, a small pinned model, item names and counts only (nutrition resolved from the DB, not from the LLM), a hard timeout, and a fallback to a deterministic parser.
- **Data provenance per row:** `backendSource`, `dataVersion` and a `machineTranslatedName` flag.

---

## 3. wger-project/wger (server)

1. **Purpose:** a self-hostable workout, nutrition and weight manager (Django) with a large crowd-sourced, multilingual **exercise database**, routines with **rule-based progression**, workout logs and sessions, nutrition plans and diary (OFF/USDA ingredients), body weight and measurements, a gallery, trophies, and a full REST API used by the Flutter app.
2. **Latest version:** **2.7** (tag 2026-09-03). Earlier: 2.6 on 2026-06-17, 2.5 on 04-15, 2.4 on 01-18 and 2.3 on 2025-04-05. Development runs as a rolling release (`SECURITY.md`). `wger/version.py` sets `MIN_APP_VERSION 2.1.0`.
3. **Last maintenance activity:** last commit 2026-10-28 (reportlab 5.1.0 bump). **1,354 commits in the last 12 months** and 817 in the last 6 months, from 105 authors. **Roland Geider has 938 commits (about 69%)**, dependabot 112. Monthly counts run from 37 to 240. About 7.2k stars, 1.1k forks and 190 open issues.
4. **License:** **code is AGPL-3.0-or-later** (`LICENSE.txt`, file headers). Per the README, **exercise and ingredient data is under Creative Commons, per entry**, and documentation is CC-BY-SA-4.0.
   - Every `Exercise`, `Translation` and `ExerciseImage` inherits `AbstractLicenseModel` (`wger/utils/models.py`) with TASL fields: `license`, `license_title`, `license_object_url`, `license_author`, `license_author_url`, `license_derivative_source_url`. The **default is CC-BY-SA 4.0** (`CC_BY_SA_4_LICENSE_ID = 2` in `wger/utils/constants.py`).
   - Measured licenses in the shipped fixtures (`wger/exercises/fixtures/`):

     | Fixture | Records | CC-BY-SA-4 | CC-BY-SA-3 | CC0 |
     |---|---|---|---|---|
     | `exercise-base-data.json` | 872 exercises | 719 | 133 | **20** |
     | `translations.json` | 2,035 translations | 1,606 | 344 | **85** |

   - Images and videos are not in the repo. They sync from wger.de with per-object license fields. Their license distribution is unverified, but I expect them to be mostly CC-BY-SA.
   - Ingredients from Open Food Facts are **ODbL** (license id 5).
5. **Commercial-use considerations:**
   - **Code:** AGPL §13 means anyone who runs a modified wger as a network service must offer its source. We must not copy or port any wger code into our TS backend.
   - **Running unmodified wger as a separate service:** this is possible and our app would be a separate work talking over HTTP, but that is an arm's-length claim that needs legal sign-off. It would also force a Django + Celery + Redis stack and a second user model into our infrastructure.
   - **Data:**
     - The CC0 subset (20 exercises, 85 translations) is free to use.
     - CC-BY-SA content can be used commercially, but it requires attribution (TASL) per item. **Share-alike** means our *modified* versions of those descriptions and images must be released under CC-BY-SA. A combined exercise DB containing SA items should keep them as identifiable, separately licensed records.
     - OFF-derived ingredients bring ODbL share-alike on any derived *database*.
6. **Tech stack:** Python ≥3.12, **Django 6.0**, DRF 3.18, PostgreSQL (psycopg 3), Celery + Redis, django-allauth (MFA, OIDC IdP), simplejwt, drf-spectacular (OpenAPI), django-axes, django-storages/boto3, easy-thumbnails, uv. **PowerSync** sync handlers (`wger/manager/powersync.py`, `wger/utils/powersync.py`) back the app's offline mode.
7. **Key dependencies:** `django[argon2]~=6.0.7`, `djangorestframework~=3.18.2`, `djangorestframework-simplejwt`, `drf-spectacular`, `django-allauth[mfa,idp-oidc]`, `django-axes`, `celery[redis]`, `django-simple-history`, `openfoodfacts~=5.4`, `nh3` (HTML sanitizing), `reportlab`, `pillow`.
8. **Security concerns:**
   - There is no formal security process: `SECURITY.md` says to "mention @rolandgeider in an issue or email", with no supported versions.
   - Recent commits fix authorization gaps: "Enforce the permission on the gym admin config edit view", "Require add_exercise permission to create exercises", "Fix ingredient permission issue" and "Fix two bugs in the test base classes that hid permission checks". The test base classes themselves had hidden broken permission checks.
   - CodeQL is enabled (`.github/workflows/codeql-analysis.yml`) and Dependabot is active.
   - If we self-hosted it, we would inherit Django admin surface, gym multi-tenancy and allauth configuration.
9. **Relevant components:**
   - **Routine engine:**
     - `wger/manager/models/routine.py`: `Routine(start, end, is_template, is_public, fit_in_week)` with `date_sequence()` and `data_for_iteration()`.
     - `day.py`: `Day(order, type, is_rest, need_logs_to_advance, config)`.
     - `slot.py`: a `Slot` groups exercises, which is how supersets are modelled.
     - `slot_entry.py`: `SlotEntry(exercise, repetition_unit, repetition_rounding, weight_unit, weight_rounding, type, class_name, config)`.
     - `abstract_config.py`: `AbstractChangeConfig(slot_entry, iteration, value, operation ∈ {+,−,replace}, step ∈ {abs, percent, na}, repeat, requirements JSON)`, `unique(slot_entry, iteration)`.
     - Concrete `SetsConfig`/`MaxSetsConfig`, `WeightConfig`/`MaxWeightConfig`, `RepetitionsConfig`/`MaxRepetitionsConfig`, `RiRConfig`/`MaxRiRConfig` and `RestConfig`/`MaxRestConfig` (the Max variants give ranges).
     - `config_calculations/calculations.py` provides pluggable progression classes.
   - **Logs:** `models/log.py`: `WorkoutLog(session, exercise, routine, slot_entry, iteration, repetitions, repetitions_target, weight, weight_target, rir, rir_target, rest, rest_target, units, next_log)`. `models/session.py`: `WorkoutSession(routine, day, datetime_start, datetime_end, notes, impression)`.
   - **Exercises:** `wger/exercises/models/base.py` (`Exercise`: uuid, category, muscles, muscles_secondary, equipment, variation_group), `translation.py`, `exercise_alias.py`, `image.py`, `video.py`, `muscle.py` (16 muscles with `is_front` and Latin + common `name_en` for a body map), `wger/exercises/sync.py`.
   - **Nutrition:** `wger/nutrition/models/ingredient.py` (per-100 g energy, protein, carbs, sugar, fat, sat fat, fiber, sodium; `code`, `source_name`, `source_url`, `remote_id`, nutriscore, vegan/vegetarian), `ingredient_weight_unit.py` (`name`, `gram`), `plan.py`, `meal.py`, `meal_item.py`, `log.py`, `sources.py` (WGER/OFF/USDA), `management/commands/import-off-products.py`, `import-usda-products.py`.
   - **API:** 50 `router.register` routes in `wger/urls.py` (`/api/v2/...`): routine, day, slot, slot-entry, the config endpoints, workoutlog, workoutsession, exerciseinfo, ingredient, nutritionplan, nutritiondiary, weightentry, measurement and more. OpenAPI via drf-spectacular.
10. **Reuse difficulty:** code reuse is **prohibited** (AGPL) and in a mismatched stack. Data reuse is **moderate**. Pull from the public `https://wger.de/api/v2` (used by SparkyFitness in `integrations/wger/wgerService.ts`) or from the fixtures, filter by `license`, and store the TASL fields per record.
11. **Integration risks:** share-alike obligations leaking into our curated exercise content if editors modify CC-BY-SA text or images. Attribution UI requirements apply per exercise. Heavy dependence on one maintainer. Running a Django service would add AGPL compliance and ops burden (Celery, Redis, PowerSync). Image quality and coverage vary (crowd-sourced; unverified).
12. **Test quality:** 169 `test*.py` files with about **1,662** `def test_` methods. Shared mixins (`wger/core/tests/base_testcase.py::WgerTestCase`, `api_base_test.py::ApiBaseResourceTestCase`) generate CRUD and permission tests per resource. CI (`ci.yml`) runs `coverage run ./manage.py test --parallel auto` and uploads lcov to Coveralls, alongside ruff, a linter and CodeQL. The fix to "test base classes that hid permission checks" shows those mixins had blind spots.
13. **Maintenance outlook:** healthy and long-lived (project since 2012, regular releases, Weblate translations, more than 100 contributors), but with a **bus factor of about 1** (69% of commits are by one person).
14. **Final recommendation: REFERENCE** for code, plus a **selective data source** for exercise content. AGPL rules out copying, and the Django/Celery stack makes a sidecar service a poor fit. The progression model is the best-designed training-engine data model in this set. Its exercise DB is the largest openly licensed one, but mostly CC-BY-SA. Our decision: **do not run wger as a service**, and **do not use it as the code foundation**. Re-implement the routine, slot, change-config and log model in our TS backend. Optionally seed our exercise catalog from wger records, importing CC0 items freely. Import CC-BY-SA items only if we (a) keep the per-record TASL fields, (b) show attribution in the app, and (c) accept publishing our edits to those items under CC-BY-SA. Otherwise commission or write original content.

**Design takeaways for our app:**
- **Program hierarchy:** `Routine → Day(order, is_rest, need_logs_to_advance) → Slot (superset container) → SlotEntry(exercise, units, rounding)`.
- **Progression as data:** each training variable (sets, weight, reps, RIR, rest) has per-iteration change rules `{iteration, value, op: +|−|=, step: abs|%, repeat, requirements}`. Each also has a parallel `Max*` rule to express ranges (for example 8–12 reps). Pluggable `class_name` covers custom algorithms. This is our engine's core.
- **Logs store target and actual** (`weight` vs `weight_target`, `rir` vs `rir_target`, and so on), plus `iteration` and `slot_entry` FKs, so adherence and auto-progression decisions are simple queries.
- **Exercise = language-neutral base + translations + aliases + variation_group.** Model muscles as a primary/secondary M2M against a muscle table with `is_front` for the body-map SVG. Equipment is M2M.
- **Per-record content licensing** (TASL fields) on exercise, translation, image and video. Copy this even for our own content, because it makes later licensing audits trivial.
- **Household servings:** `IngredientWeightUnit(name, grams)` per ingredient, with logs as `amount × unit`.
- **UUID primary keys** on syncable rows, plus a min-client-version handshake (`MIN_APP_VERSION`).

---

## 4. Snouzy/workout-cool

1. **Purpose:** a Next.js web app for building quick workouts: pick equipment, then target muscles, then exercises (shuffle or swap), run a session with a timer, and see statistics. It adds premium programs (week, session, exercise), leaderboard, billing (Stripe and RevenueCat), ads (Ezoic/AdSense) and a peptide calculator. It is a rewrite by the main contributor to the abandoned workout.lol.
2. **Latest version:** `v1.3.2` (tag 2025-12-07; `package.json` 1.3.2). There have been no tags since.
3. **Last maintenance activity:** last commit **2026-09-20**, an ads fix for premium users (#254). **65 commits in the last 12 months** and **3 in the last 6 months**: a peptide calculator on 2026-07-31 (×2) and the 09-20 ads fix. 48 of the 65 came in 2026-03. Effectively there is **one author** ("Mathias" / "Mat B."). The full history starts 2025-06-11, with 469 commits. Recent work is monetization rather than training features. About 8.7k stars and 44 open issues.
4. **License:** **MIT** (`LICENSE`, © 2023 Mathias Bradiceanu). **Exercise data has no stated license.**
   - The repo ships only `data/sample-exercises.csv`: **3 exercises** (ids 157, 163 and 164) across 19 attribute rows.
   - Videos and thumbnails are **YouTube embeds** (`youtube.com/embed/...`, `img.youtube.com/vi/...`) from the "fit-distance" channel, which is also listed as a sponsor (`src/components/ads/custom/sponsor-config.ts`).
   - `scripts/import-exercises-with-attributes.prompt.md` is an **LLM prompt to generate exercise CSVs**.
   - The full production exercise DB is **not public**, and its provenance is unverified. The README notes that workout.lol failed because of exercise-video licensing costs.
5. **Commercial-use considerations:** MIT code can be copied with the copyright notice kept. **No usable exercise dataset comes with it.** The YouTube embeds are third-party content. Embedding them is governed by YouTube ToS, and we would gain no rights to the videos. Exercise descriptions are LLM-generated with unclear originality, so don't import production data scraped from workout.cool.
6. **Tech stack:** **Next.js 16.2 App Router**, React 19, TypeScript, **Prisma 6.5 + PostgreSQL**, better-auth (with an `@better-auth/expo` plugin, which points to an external mobile client; unverified), next-safe-action server actions + 36 REST `route.ts` handlers under `app/api/`, TanStack Query, zustand, Tailwind + daisyUI + Radix, next-international (6 locales), Docker.
7. **Key dependencies:** `next@16.2.1`, `@prisma/client`/`prisma ^6.5`, `better-auth ^1.2.7`, `next-safe-action`, `zod ^3.24`, `stripe 18.2.1`, `@openpanel/nextjs`, `recharts`, `react-hook-form`, `nodemailer`, `crypto-js` (unmaintained library), `npm` listed as a *runtime* dependency (an oddity).
8. **Security concerns:**
   - Third-party ad scripts (Ezoic/AdSense) are loaded into the app (`src/components/ads/`), which raises privacy, CSP and consent issues. There is a consent banner.
   - `crypto-js` is used.
   - Spot check: `app/api/workout-sessions/user/[userId]/route.ts` ignores the path `userId` and uses the session user, so it is not an IDOR.
   - Webhooks: `RevenueCatWebhookEvent` stores raw payloads with processed/retry fields. Signature verification is unverified.
   - Single maintainer with low cadence means slow patching.
9. **Relevant components:**
   - **Schema** (`prisma/schema.prisma`, 734 lines; the migrations are squashed into `prisma/migrations/0_init`):
     - Exercises: `Exercise` (`name`/`nameEn`, `description`/`descriptionEn`, `fullVideoUrl`, `slug`/`slugEn`). Attributes are EAV: `ExerciseAttributeName`, `ExerciseAttributeValue`, `ExerciseAttribute`. One mixed `ExerciseAttributeValueEnum` holds types, muscles, equipment and mechanics together.
     - Sessions: `WorkoutSession` (startedAt, endedAt, duration, muscles[], rating) → `WorkoutSessionExercise(order)` → `WorkoutSet(setIndex, types[], valuesInt[], valuesSec[], units[], completed)`.
     - Programs: `Program` → `ProgramWeek` → `ProgramSession` → `ProgramSessionExercise` → `ProgramSuggestedSet`, plus `UserProgramEnrollment` and `UserSessionProgress`.
     - Billing: `SubscriptionPlan`, `PlanProviderMapping`, `Subscription`, `License`, `RevenueCatWebhookEvent`.
   - **Builder:** `src/features/workout-builder/` (`actions/get-exercises-by-muscle.action.ts`, `shuffle-exercise.action.ts`, `pick-exercise.action.ts`, `ui/muscle-selection.tsx`, `ui/muscles/*-group.tsx` SVG body map with unverified provenance, `model/workout-builder.store.ts`).
   - **Session:** `src/shared/lib/workout-session/workout-session.local.ts` (localStorage-first) + `/api/workout-sessions/sync`.
   - **Stats:** `app/api/exercises/[exerciseId]/statistics/{one-rep-max,weight-progression,volume}/route.ts`. The 1RM route comments "Lombardi formula" but implements `w × (1 + reps/30)`, which is **Epley**. That is a minor correctness and documentation bug.
10. **Reuse difficulty:** low legally (MIT). For our needs, moderate to high technically: Next.js server actions and Prisma do not map onto Fastify/Hono + RN, and the schema needs a redesign (below). Small UI and utility pieces are portable with attribution.
11. **Integration risks:**
    - The schema does not scale to a training engine:
      - Sets store *parallel arrays* (`types[]`, `valuesInt[]`, `valuesSec[]`, `units[]`), which are hard to query or index, with no RPE/RIR, rest, targets or PR flags.
      - i18n is done as **per-language columns** (`titleEn`, `titleEs`, `titlePt`, `titleRu`, `titleZhCn`, repeated on every program, week and session table).
      - The mixed attribute enum needs a migration for every new muscle or piece of equipment.
      - There is no progression model.
      - Programs are static templates.
    - There is no exercise dataset.
    - The project's direction is drifting toward ads and side tools.
12. **Test quality:** **4 test files with about 31 cases** (vitest): `src/components/ads/AdScripts.test.tsx` and three peptide-calculator tests. **No tests cover the workout, session, program or billing logic.** CI (`.github/workflows/ci.yml`) runs `pnpm lint` and `pnpm build` only, with no test step.
13. **Maintenance outlook:** declining for our purposes. One maintainer, no release in more than 10 months, and recent commits focused on monetization. A popular repo (8.7k stars), but not an engine to depend on.
14. **Final recommendation: REFERENCE** (with optional small **ADAPT** of MIT UI or utility snippets, keeping the notice). MIT makes reuse legal, but **its workout architecture should not be our training-engine foundation**. The set model uses untyped parallel arrays, there are no targets versus actuals and no progression rules, i18n is column-per-language, and the attribute enum is monolithic. There are effectively no tests, and the only "exercise DB" is 3 sample rows plus LLM-generated content around third-party YouTube embeds. wger's routine model (re-implemented clean-room) is the better foundation. Borrow workout-cool's *UX flow* (equipment → muscles → exercises, shuffle/swap, local-first session, simple stats) and its provider-agnostic billing tables as patterns.

**Design takeaways for our app:**
- **Quick-workout builder UX:** stepper of equipment → muscle (tappable SVG body map) → suggested exercises per muscle, with **shuffle** (same muscle and equipment) and **pick** actions. This is a good "generate a workout" baseline before AI personalization.
- **Local-first active session** (device store + idempotent `/sync` endpoint) so the gym flow works offline.
- **Program enrollment model:** `UserProgramEnrollment` + `UserSessionProgress(started/completed)` on top of `Program → Week → Session → Exercise → SuggestedSet`. Keep the shape, but use typed set rows and a translations table.
- **Billing:** provider-agnostic `SubscriptionPlan` + `PlanProviderMapping(provider, externalId)` + a raw webhook event log with `processed`/`retryCount` for idempotent RevenueCat/Stripe processing. This is directly relevant to a mobile SaaS.
- **Avoid:** parallel-array sets, per-locale columns, and a mixed enum for muscles, equipment and type.

---

## 5. wger-project/flutter (wger mobile app)

1. **Purpose:** the official wger client (Android, iOS, web, desktop) for routines, **gym mode** (guided logging), nutrition diary, body weight and measurements, gallery and health import. It is offline-capable via PowerSync.
2. **Latest version:** **2.1.1** (pubspec `2.1.1+280`, tag 2026-10-03). Earlier: 2.1.0 on 08-28, 2.0.5 on 08-21, 2.0.4 on 08-11 and 2.0.3 on 07-29.
3. **Last maintenance activity:** last commit 2026-10-25 ("Make it more obvious when an edit takes place"). **1,615 commits in the last 12 months** and 1,011 in the last 6 months, from 124 authors. Roland Geider has 1,177 (about 73%), dependabot 83. PowerSync offline work started 2025-10-21, with 38 PowerSync-related commits in 12 months. About 989 stars and 68 open issues.
4. **License:** **AGPL-3.0-or-later with an app-store exception** (README §License, section-7 additional permission). The initial exercise and ingredient data is additionally under per-entry Creative Commons licenses.
5. **Commercial-use considerations:** no code reuse. The app-store exception only helps people who distribute wger itself. It does not permit incorporating the code into proprietary apps. Different language (Dart) in any case.
6. **Tech stack:** Flutter/Dart, **Riverpod 3** (+ `riverpod_generator`), `freezed`/`json_serializable`, **Drift (SQLite) + drift_sqlite_async + PowerSync 2.4** for offline sync, `flutter_secure_storage`, `connectivity_plus`, `health_bridge`, `fl_chart`, `flutter_zxing` (barcode), `video_player`.
7. **Key dependencies:** `powersync ^2.4.0`, `drift ^2.35`, `flutter_riverpod ^3.3`, `freezed`, `http`, `shared_preferences`, `flutter_typeahead`, `table_calendar`, `flex_color_scheme`. Dev: `mockito`, `fake_async`, `network_image_mock`, `drift_dev`.
8. **Security concerns:** a token-based API client whose tokens sit in secure storage. PowerSync requires a separate sync service with JWT auth, which adds attack and ops surface (unverified details). There is no SECURITY.md in this repo, so the server's informal process applies. CodeQL is enabled (`codeql-analysis.yml`).
9. **Relevant components** (patterns only):
   - Gym mode:
     - `lib/features/routines/providers/gym_state.dart` (`PageType`, `SlotPageType`, `PageEntry`, `SlotPageEntry`, `GymModeState`): a precomputed page sequence for the day's workout.
     - `gym_state_notifier.dart` and `gym_log_notifier.dart`.
     - `plate_weights.dart` + `screens/settings_plates_screen.dart` (plate calculator).
     - `screens/gym_mode.dart`.
   - Data: `routines_repository.dart`, `workout_logs_repository.dart`, `workout_session_repository.dart` (repository/notifier split).
   - Offline: `lib/database/powersync/tables/routines.dart` (also `exercise.dart`, `nutrition.dart`, `measurements.dart`).
   - Handshake: `lib/core/update_app_screen.dart`, `update_server_screen.dart` (server/app minimum-version handshake), `lib/core/powersync_unreachable_screen.dart`.
10. **Reuse difficulty:** prohibited (AGPL) and non-transferable (Dart to TS/RN).
11. **Integration risks:** none if used as reference only. If someone ported widgets or logic: AGPL contamination.
12. **Test quality:** 191 `*_test.dart` files with about **2,048** `test`/`testWidgets` cases (flutter_test, mockito, fake_async; golden/screenshot driver in `test_driver/`). CI: `ci.yml`, `analyze.yml` and per-platform builds (android, apple, linux, web, windows).
13. **Maintenance outlook:** active and tied to the server's lifecycle. Same single-maintainer concentration.
14. **Final recommendation: REFERENCE.** AGPL code in Dart with no reuse path. Its value is the **gym-mode interaction model** and the **offline-first sync architecture** (local SQLite as source of truth, a sync engine to Postgres, an explicit "server unreachable" state). Our RN app should replicate these with permissively licensed tooling, for example expo-sqlite + Drizzle with our own sync, PowerSync's RN SDK after reviewing its license, or WatermelonDB.

**Design takeaways for our app:**
- **Gym mode as a precomputed page sequence:** build a flat list of pages (start → per-slot exercise intro → each set → rest timer → summary) from the day's routine data. Navigation is then a pointer into that list, which makes supersets and skips deterministic.
- **Pre-fill each set from computed targets** (the routine's per-iteration config) and log actuals alongside the targets.
- **Plate calculator** with user-configurable available plates and bar weight.
- **Offline-first:** local DB is the source of truth, a background sync engine, explicit connectivity states, and a min-version gate that blocks the app when the server API is incompatible.

---

## Cross-cutting conclusions

- **No repo is ADOPT-able** for a proprietary TS SaaS. Licensing removes three outright (SparkyFitness: non-commercial; ONT: GPL-3; wger and wger-flutter: AGPL-3). The only permissive one (workout-cool, MIT) is architecturally too weak to build on.
- **Training engine foundation:** re-implement a wger-style `Routine/Day/Slot/SlotEntry/ChangeConfig/Log(target vs actual)` model in TypeScript + Postgres, written clean-room from this document, not from the source.
- **Exercise data:** there is no high-quality, permissively licensed source in this set. Options, in order:
  1. wger CC0 subset (small).
  2. yuhonas/free-exercise-db (used by SparkyFitness), which is **Unlicense/public domain** per its `LICENSE.md`. I fetched this; provenance of the underlying text and images is unverified.
  3. wger CC-BY-SA, isolated and with attribution plus share-alike accepted for those records.
  4. Commissioned original content and media. Budget for video, which is what sank workout.lol.
- **Food data:** ingest primary datasets directly: USDA FDC (CC0), BLS 4.0 (CC BY 4.0), OFF (ODbL, share-alike on the derived DB; keep OFF in a separate table or service boundary and follow ODbL). Don't depend on ONT's hosted Supabase or wger.de at runtime.

## Summary table

| Repo | License (code / data) | Latest version | Last commit | Commits, last 12 mo | Tests (files / cases) | Stack fit | Classification | Most important finding |
|---|---|---|---|---|---|---|---|---|
| CodeWithCJ/SparkyFitness | **Custom non-commercial, source-available** (not OSS) / n/a | v1.10.0 (2026-10-28) | 2026-10-28 | 8,333 | about 1,700 / about 19.7k (vitest, jest-expo, jest; PG18 integration) | Very high (Expo RN + TS + PG) | **REJECT** | License forbids commercial use and derivatives; most similar stack, but legally untouchable |
| simonoppowa/OpenNutriTracker | GPL-3.0 (app and backend) / FDC CC0, BLS and INDB CC BY 4.0 | v2.5.0 (2026-10-23) | 2026-10-23 | 967 (bursty; dormant late 2025) | 289 / about 3,021 (flutter_test + DST job) | Low (Flutter/Hive) | **REFERENCE** | Good offline-first, per-100 g nutrient and food-ingestion design; re-derive from public datasets and formulas |
| wger-project/wger | AGPL-3.0+ / mostly CC-BY-SA (872 exercises: 852 SA, 20 CC0); OFF ODbL | 2.7 (2026-09-03) | 2026-10-28 | 1,354 | 169 / about 1,662 (Django TestCase + coverage) | Low (Django/Celery) | **REFERENCE** (code) + selective data source | Best progression data model (per-iteration change rules, target vs actual logs); exercise data is share-alike, not free |
| Snouzy/workout-cool | MIT / **none stated** (3 sample exercises, YouTube embeds, LLM-generated CSV prompt) | v1.3.2 (2025-12-07) | 2026-09-20 | 65 (3 in last 6 mo) | 4 / about 31 (none on workout logic; CI has no test step) | Medium (TS/Prisma/PG, but Next.js) | **REFERENCE** (minor ADAPT of UI bits) | Legal to reuse, but schema (parallel-array sets, per-locale columns, no progression) and absent exercise DB rule it out as engine foundation |
| wger-project/flutter | AGPL-3.0+ with app-store exception / CC per entry | 2.1.1 (2026-10-03) | 2026-10-25 | 1,615 | 191 / about 2,048 | Low (Flutter/Riverpod/Drift) | **REFERENCE** | Gym-mode page-sequence state machine and PowerSync offline-first architecture worth emulating |

**Unverified items, collected:**
- SparkyFitness per-commit review depth and its willingness to grant a commercial license.
- ONT backend RLS/grants; exact TBCA terms.
- Licenses of wger.de images and videos (only fixtures were measured).
- PowerSync auth details.
- workout-cool production exercise DB provenance, SVG body-map provenance and webhook signature checks.
- free-exercise-db upstream content provenance.
