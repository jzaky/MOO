# Status

What exists, what has been verified, and what has not. Updated 2026-10-29.

**Legend**
- **Tested:** implemented and covered by automated tests that run against a real PostgreSQL 16 database (API) or as pure unit tests (core).
- **Implemented:** code exists and typechecks. Verification was manual (web render, live run) or is not possible in this environment. The note says which.
- **Partial:** usable, but part of the specified behaviour is missing. The note says what.
- **Planned:** not built.

**Test suites.** `@stoke/core` has 111 unit tests. `@stoke/api` has 99 integration tests against Postgres, including row-level-security isolation. `@stoke/mobile` has 44 unit tests covering the live-workout store, the offline outbox, the recipe editor, the form-check session, deep links, widget layouts, the watch and Live Activity bridges, and Arabic translation coverage. Run all of them with `pnpm test`. **CI** (GitHub Actions) runs typecheck, all three suites against a Postgres 16 service, and the web bundle on every push.

## Verification limits in this environment

These could not be exercised here and must be verified on hardware or with credentials before they are called done:

| Area | Why not verified | What *is* verified |
| --- | --- | --- |
| Claude API calls (photo recognition, label reading, menu estimates, coach, free-text parsing) | No API key in the build environment | The full request and response path, using a fake provider that returns schema-validated structured output. Schema rejection, tool grounding, consent gates and the append-only history replay are all tested. The Anthropic adapter compiles against SDK 1.3.0 but has not made a live call. |
| iOS/Android builds, HealthKit, Health Connect, camera, barcode scanning, microphone, push delivery, the form-check WebView, widgets, the rest Live Activity, the Apple Watch app, Siri shortcuts | No simulator, device or Xcode | Mobile code typechecks. The web build exports every route. Screens were rendered and driven in Chromium at 390×844 against a live API with seeded data. The form check ran end to end in Chromium with real squat footage as the camera feed. Server-side health ingest and push planning are tested. |
| Live Open Food Facts and USDA API calls | The tests use recorded fixtures | Mapping is tested against real recorded OFF responses (Nutella, Coca-Cola) and USDA records. The SR Legacy bulk import of 7,793 foods ran successfully. |
| whisper.cpp transcription server | Not installed | The client is tested against a local stub server that checks the multipart contract. Transcription-to-draft is tested with a fake speech-to-text service. |

## Feature ledger

### Platform and security
| Feature | State | Notes |
| --- | --- | --- |
| Email and password auth (argon2id), 15-minute JWTs, rotating refresh tokens with reuse detection | Tested | |
| Per-IP rate limiting on credential endpoints | Tested | |
| Row-Level Security on every user table; runtime role is not the table owner | Tested | Reads and writes across users are refused even with crafted SQL. |
| Account deletion (password + "DELETE"), including stored media | Tested | |
| Full JSON data export | Tested | Includes only the requesting user's data. |
| Audit events for profile, targets, consent and AI-applied changes | Implemented | Written in the same transaction as the change. No test asserts them directly yet. |
| CORS for the web build | Tested | PUT, PATCH and DELETE were blocked until 2026-10-29; a regression test now covers this. |
| Production refuses development secrets | Implemented | |
| Subscriptions, usage events, feature flags (tables only) | Partial | Schema exists for future SaaS use. No billing. |

### Onboarding and targets
| Feature | State | Notes |
| --- | --- | --- |
| Plan preview: Mifflin–St Jeor or Katch–McArdle, activity, goal rate | Tested | Calorie floor (1,200 kcal female, 1,500 kcal male) and a 25% maximum deficit are enforced. |
| Onboarding completion (profile, goals, targets, first weigh-in) | Tested | |
| Seven-step mobile onboarding | Implemented | Rendered on web. |
| Versioned manual target edits that never rewrite history | Tested | The settings screen adds macro and energy consistency warnings and a below-floor warning. |

### Nutrition
| Feature | State | Notes |
| --- | --- | --- |
| Food catalogue: USDA SR Legacy (CC0), Open Food Facts (ODbL) on demand, private user foods | Tested | Missing nutrients stay `null`, never 0. |
| Barcode lookup: GTIN check digit, UPC-A to EAN-13, cache, private-product precedence | Tested | Scanner UI not device-verified. |
| Food search: pg_trgm retrieval plus the tested `@stoke/core` ranker | Tested | Ranks by head food, category prefixes, processed forms, typos and personal history. Locally p50 is 112 ms and p95 170 ms over 7,793 foods. |
| Diary: idempotent upserts, last-writer-wins, tombstones, nutrient snapshot frozen at log time | Tested | |
| Quick add, copy meal, saved meals, recents with last portion, favourites, water, day completion | Tested | |
| Food corrections that do not alter past entries | Tested | |
| Recipes with per-serving nutrition, loggable as a food, text and URL import | Tested | URL import includes an SSRF guard. The mobile list, detail and editor (live per-serving preview) were driven on web; the editor logic is unit-tested. |
| Ingredient matching (recipe drafts, text and voice logging) | Tested | Suggests the best-ranked food only when it shares a real word with the line. Unit synonyms (tablespoon = tbsp). Volume converts through the food's own volume servings. A count with no matching serving asks for an amount; it never falls back to an arbitrary first serving. |
| Photo meal recognition: separate stages, confidence tiers, ranges, consent gate, confirm-only logging | Tested (fake AI) | Before/after leftover fraction is supported in the model output. |
| Nutrition label reading into a reviewable draft | Tested (fake AI) | |
| Restaurant menus with printed values kept separate from estimates | Tested (fake AI) | Mobile screen (photo or pasted text) driven on web with scripted AI output. Estimated dishes are logged with the `ai_estimate` label. |
| Text logging: deterministic parser first, AI fallback | Tested | |
| Voice logging: transcribe, parse, confirm | Tested (fake speech-to-text) | Mobile recording screen implemented; not device-verified. |
| Adaptive targets from intake and EWMA weight trend | Tested | Capped at 150 kcal per step and needs 14 complete days. Reports an adherence gap rather than cutting further. Applied only on approval. |
| Meal plans from the user's recipes and saved meals; grocery list minus pantry | Tested | No dish repeats within a day when alternatives exist. Water is left off grocery lists, and cooked-weight items are labelled. Recipes can be tagged for breakfast, lunch, dinner or snacks, and plans respect the tags. Mobile plan, grocery and pantry screens were driven on web. |
| UAE dishes as standard recipes (23: shawarma, machboos, mandi, harees, luqaimat, karak, manakish, foul, fattoush…) | Tested | Each dish is a list of USDA ingredients in grams; nutrition is computed in code, never typed in. Each shows its ingredients, any closest-USDA substitutions and an "estimate" label. A nutrient is reported only if every ingredient has it. Searchable in English and Arabic. Recipes are typical home/restaurant versions, not measured dishes. |
| Pork and alcohol flags | Tested | Read from the food's name, the Open Food Facts ingredient list and labels, and the alcohol value; handles "turkey bacon", "beef gelatin", wine vinegar and alcohol-free drinks. Users with a halal diet see them in search. The app says it is a reading aid, not a halal certification. |
| Import from Strong, Hevy and MyFitnessPal (CSV) | Tested | Preview before saving; exercise names matched only when they clearly agree, otherwise created as custom exercises; idempotent re-import; MyFitnessPal blanks stay unknown. Mobile screen driven on web with a real Strong-format file. |

### Training
| Feature | State | Notes |
| --- | --- | --- |
| Original exercise catalogue: 83 exercises, aliases, alternatives, equipment | Tested | Written in-house. See the licensing notes in `repository-evaluation.md`. |
| Deterministic program generator: split, equipment, time budget | Tested | |
| Programs with versioning; edits create new versions | Tested | |
| Live workout: local-first, rest timer, set types, RIR, substitutions, pause and resume, offline | Tested (store) | The store has unit tests for: no pre-applied load increases, local persistence, rest timer and finish snapshot. Server sync of the session is tested. The UI was rendered on web. |
| Progression (double, linear and RPE) with equipment-aware load steps | Tested | Load changes are never applied without the user tapping "Use suggestion". |
| PR detection, e1RM (Epley + RIR), weekly hard sets per muscle | Tested | |
| Training blocks and deloads | Tested | Programs run in blocks (default 4 build weeks + 1 deload). In a deload week, workouts start with ~60% of the sets, 2 more reps in reserve and one load step lighter. One-off deloads can be scheduled; a fatigue check suggests one when several main lifts regress. Nothing changes without the user choosing it. Train tab and pre-start screen driven on web. |
| Plate calculator | Tested | Per-side plates for barbell lifts, kg (20 kg bar) or lb (45 lb bar); shows the closest loadable weight when plates can't make it exactly. |
| Form check: on-device pose tracking, rep counting, depth, tempo, asymmetry | Tested (web) | MediaPipe Pose Landmarker in a shared page (WebView on device, iframe on web). Analysis runs locally. Regression-tested on landmarks from real squat footage: 6 of 6 reps. **Device WebView camera not verified.** Measured about 4 fps in headless CPU Chromium; device frame rate unknown. Needs network on first use to fetch the runtime and model (about 6 MB). |

### Progress and recovery
| Feature | State | Notes |
| --- | --- | --- |
| Weigh-ins with original units, EWMA trend, sufficiency gate, goal progress | Tested | |
| Circumference measurements and summary | Tested | |
| Body-fat estimate from waist and neck (US Navy method) | Tested | Shown as an estimate with its typical error (about ±3.5 points); needs height, waist, neck (and hips for women). |
| Progress photos: private storage, HMAC-signed short-lived URLs, side-by-side compare | Tested | Compare UI rendered on web. |
| Health ingest (HealthKit / Health Connect), dedupe on source record id, body mass to weigh-ins | Tested | Per-day steps and sleep use the single most complete source, so phone and watch are not double counted. |
| Mobile health readers (anchored HealthKit queries; Health Connect windowed reads) | Implemented | **Not device-verified.** Health Connect HRV is RMSSD and is deliberately not mapped to SDNN. |
| Recovery summary: signals against personal baseline, no composite score | Tested | |
| Daily check-ins (fatigue, soreness) | Tested | |
| Correlations with a "not causation" caveat | Partial | The statistics and wording are unit-tested in core. The `/v1/insights/correlations` route has no integration test. |

### Coach
| Feature | State | Notes |
| --- | --- | --- |
| Tool-using coach over the user's real data (13 tools) | Tested (fake AI) | Each tool runs in its own RLS transaction. Tool traffic is kept out of the visible transcript. |
| Proposals only: programs, substitutions, targets; refused below the floor; action history | Tested | |
| Health data used only with consent | Tested | |
| Weekly review, Today overview, suggestions | Tested | |

### iPhone extras
| Feature | State | Notes |
| --- | --- | --- |
| Home-screen widgets (calories left, next workout) and rest-timer Live Activity | Implemented | Built with `expo-widgets`. Layouts render in the widget runtime on Linux and are unit-tested; the store starts, updates and ends the Live Activity. **Swift/SwiftUI rendering not compiled or run.** |
| Apple Watch companion (current set, rest timer, "complete set") | Implemented | Watch app and phone module written in Swift; the JS side and message protocol are tested, duplicate taps are ignored. **Not compiled (no Xcode).** Weights are shown in kg only. |
| Siri / App Shortcuts and `stoke://` deep links (log food, start workout, weigh-in) | Partial | Deep links are tested and work in the JS bundles for iOS and Android. App Intents Swift is written but not compiled. Android static shortcuts are generated. |

### Language
| Feature | State | Notes |
| --- | --- | --- |
| Arabic with right-to-left layout | Implemented | Every screen's text goes through `t()`; a test fails if any string lacks an Arabic translation or a placeholder differs. Arabic plural forms are handled. Western digits are kept. On the web the switch is immediate; on iOS and Android the layout direction changes after reopening the app. The coach replies in Arabic. Server-generated explanations (progression reasons, insights, warnings) and food and exercise names stay in English. Widgets and the watch app are English. |

### Notifications
| Feature | State | Notes |
| --- | --- | --- |
| Preferences, quiet hours, DST-safe local scheduling, no guilt copy | Tested | |
| Delivery job, idempotent across reruns | Tested | Expo push delivery itself is not verified. It needs an EAS project id and a device. |

### Offline and sync
| Feature | State | Notes |
| --- | --- | --- |
| Outbox with coalescing, backoff and retry classification | Tested | Client unit tests cover coalescing, ordering, stop-on-retryable, failed-on-validation, persistence, and sending ops enqueued mid-flush. The server side (idempotency, last-writer-wins, clock-skew clamp) is tested. |
| Persisted query cache (SQLite-backed localStorage) | Implemented | |

## Known limitations
- **Search.** The ranker is heuristic. Ambiguous one-word queries ("bread") return a reasonable variety rather than a canonical default.
- **Food data.** UAE product coverage in Open Food Facts is thin (about 9,500 products, 52% with complete macros), and anonymous OFF search is rate-limited. Barcode lookup is the reliable path; search uses the local catalogue first.
- **Push.** Push needs `extra.eas.projectId`. Without it, settings says so instead of failing silently.
- **Health on Android.** HRV and distance are not imported, because Health Connect's units and semantics differ from HealthKit's.
- **Native verification.** Native modules (HealthKit, Health Connect, camera, WebView) need a development build. Expo Go cannot load them.
- **Arabic.** Server-generated explanations and catalogue names are English. The Arabic was written without a native-speaker review; have one before release.
- **Form check.** Squat and push-up only, from one camera view. Counts and angles, not a safety assessment. The MediaPipe runtime and model are loaded from jsDelivr and Google storage at runtime (version-pinned); no video or images are sent anywhere.
