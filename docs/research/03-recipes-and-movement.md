# 03 — Recipes, Movement Analysis & Exercise Data: Technical Due Diligence

Date: 2026-10-29. Scope: repos 12–16 plus exercise-dataset comparison (free-exercise-db, workout-cool, wger fixtures, wrkout/exercises.json lineage).
Method: shallow/partial clones in `/tmp/claude-0/-home-user-MOO/cffd883f-6a68-5db6-8b31-dcd87a8d00ca/scratchpad/research/` (`mealie`, `tandoor`, `mediapipe` sparse, `pose-trainer`, `exercises`, `free-exercise-db`, `wrkout-exercises`, `workout-cool`, `wger-wger-project`); tags via `git ls-remote --tags`; "12-month" = commits since 2025-10-29 on the default branch (`git log --since`); PyPI/npm/Maven metadata fetched live; GitHub issue threads read via WebFetch. Anything not confirmed from source/metadata is marked **(unverified)**.

Ground rule applied throughout: **no GPL/AGPL code copied into the proprietary app**. Where a copyleft project is useful, only ideas, public specs (schema.org), and its *permissively licensed dependencies* are reused. Dataset licenses are assessed separately from code licenses.

---

## 12. mealie-recipes/mealie

1. **Purpose** — Self-hosted recipe manager: URL import, ingredient parsing (NLP/brute/OpenAI), meal planning with rules, shopping lists, cookbooks, multi-tenant groups → households.
2. **Latest version** — `v3.29.0` (tag commit 2026-10-17; `pyproject.toml` version 3.29.0).
3. **Last meaningful maintenance** — HEAD 2026-10-29. 1,570 commits in 12 months; 930 excluding Crowdin/l10n/renovate/dep bumps. Human committers: Hayden (376), Michael Genson (184). Very active.
4. **License** — AGPL-3.0-only (`LICENSE`, `pyproject.toml` `license = "AGPL-3.0-only"`).
5. **Commercial-use considerations** — AGPL §13: any network-served modified version must offer full corresponding source to users. Copying any Mealie code (Python or the Nuxt frontend composables) into our backend/app would force AGPL on the combined work. **Do not copy code.** Its key dependencies are permissive and can be used directly or ported (see 7). Mealie also bypasses bot protection (browser TLS impersonation via `httpx-curl-cffi`, optional FlareSolverr) — fine for self-hosters, a ToS/legal exposure for a commercial SaaS scraping publishers at scale.
6. **Tech stack** — Python 3.14, FastAPI 0.156, SQLAlchemy 2.1 + Alembic, Pydantic 2, SQLite/PostgreSQL (`psycopg2` extra); frontend Nuxt 4 / Vue 3.5 / Vuetify 4; `uv`, Taskfile, Docker.
7. **Key dependencies (license)** — `recipe-scrapers==15.13.0` (MIT; released 2026-10-18; 4 releases/12 mo; depends on `extruct`, `beautifulsoup4`, `isodate`); `extruct==0.18.0` (BSD-3; last release 2024-11-08, stale); `ingredient-parser-nlp==2.9.1` (MIT; 2026-10-13; 6 releases/12 mo); `pint` (BSD) for units; `rapidfuzz` (MIT) for food/unit matching; `openai` SDK; `yt-dlp` (Unlicense) for video-recipe import; `httpx-curl-cffi`.
   - **ingredient-parser-nlp** (inspected wheel): CRF sequence labeller; model shipped as `ingredient_parser/en/data/model.en.json.gz` (585 KB, quantized 16-bit weights, JSON) + 35-d GloVe embeddings (3.4 MB) + `fdc_ingredients.csv.gz` (USDA FDC "foundation foods" matching). No longer needs `python-crfsuite` at runtime (deps: `nltk`, `pint`, `numpy`). Labels: QTY, UNIT, SIZE, PREP, COMMENT, PURPOSE, OTHER + BIO name tags. Reported accuracy 98.05% word / 94.98% sentence. Model card states model, training data and scripts are MIT. **Data-provenance caveat:** training sentences come from NYT ingredient-phrase-tagger (Apache-2.0), the archive.org "recipes-en-201706" scrape (Cookstr, BBC Food, AllRecipes), and 2024 scrapes of Tastecooking/Bon Appétit. MIT label notwithstanding, the underlying sentences are scraped third-party content; the *model weights* are low risk to ship, re-distributing the *training corpus* is higher risk **(legal opinion needed, unverified)**.
8. **Security concerns** — Good: `mealie/pkgs/safehttp/transport.py` blocks private/loopback/link-local/CGNAT/reserved IPs, resolves once and pins the resolved IP into curl (anti DNS-rebinding), validates every redirect hop; `_read_capped` byte cap and `SCRAPER_TIMEOUT` (anti-DoS). Risks: arbitrary-URL fetching is inherently SSRF-prone; `yt-dlp` + ffmpeg pipelines process untrusted media; OpenAI key storage; LDAP/OIDC surface. CodeQL + Trivy workflows present. Historical advisories exist **(specific CVEs unverified)**.
9. **Relevant components (paths)** —
   - URL import strategy chain: `mealie/services/scraper/scraper_strategies.py` — `RecipeScraperPackage` (calls `recipe_scrapers.scrape_html(html, org_url, supported_only=False)` = schema.org "wild mode" fallback for any site), `RecipeScraperOpenAI` (LLM extraction via `mealie/services/recipe/import_workflow/`), `RecipeScraperOpenAITranscription` (yt-dlp + Whisper for videos), `RecipeScraperOpenGraph` (`extruct` OpenGraph last resort).
   - Normalisation: `mealie/services/scraper/cleaner.py` (713 lines: ISO-8601 durations, yield strings, HowToSection/HowToStep flattening, image selection).
   - Fetching: `mealie/services/scraper/fetch.py`, `mealie/pkgs/safehttp/{fetch,transport,flaresolverr}.py`.
   - Ingredient parsing: `mealie/services/parser_services/ingredient_parser.py` (`NLPParser` → `ingredient_parser.parse_ingredient(s, custom_units=db_units)`, `BruteForceParser`, `OpenAIParser`; `RegisteredParser` enum default `nlp`), `parser_utils/unit_utils.py` (pint).
   - Scaling: frontend `frontend/app/composables/recipes/use-scaled-amount.ts` (`amount*scale`, `toFixed(3)`, fraction display), `calculateScaleFromYield`, `use-unit-conversion.ts`; meal-plan per-entry scale (`MealPlanScaleControl`, migration test `tests/unit_tests/test_meal_plan_recipe_scale_migration.py`).
   - Meal planning: `mealie/routes/households/controller_mealplan.py` (`POST /random` from household rules → `QueryFilterBuilder`), `controller_mealplan_rules.py`, `controller_mealplan_ical.py`.
   - Shopping lists: `mealie/services/household_services/shopping_lists.py` (`can_merge`/`merge_items` by food+unit, recipe references, on-hand foods, label matching).
   - Tenancy: `mealie/db/models/group/` and `mealie/db/models/household/` (group = top-level tenant; households share recipes inside a group, own meal plans/shopping lists/cookbooks).
   - API: `mealie/routes/__init__.py` — single `/api` router composed of `app, auth, users, households, groups, recipe, organizers, shared, comments, parser, unit_and_foods, admin, validators, explore`; OpenAPI auto-generated by FastAPI; Pydantic→TS codegen (`pydantic-to-typescript2`).
10. **Reuse difficulty** — Code: N/A (AGPL, do not reuse). Concepts: low. Dependencies: low on Python backend; medium if porting to TypeScript (see recommendation).
11. **Integration risks** — Our backend is TypeScript: `recipe-scrapers` and `ingredient-parser-nlp` are Python, so either (a) a small Python microservice, or (b) TS reimplementation. Scraping publishers commercially: copyright in recipe text/photos (ingredient lists are largely factual; instructions/photos are protected), site ToS, anti-bot circumvention — do not replicate Mealie's TLS-impersonation/FlareSolverr approach.
12. **Test quality** — Strong: 163 backend `test_*.py` (unit, integration, multitenant, e2e dirs), 57 frontend `*.test.ts` (incl. scaling and unit-conversion composables), dedicated `test-backend.yml`, `test-frontend.yml`, `e2e.yml`, CodeQL.
13. **Maintenance outlook** — Excellent; two core humans + bots; bus factor ~2.
14. **Final recommendation: REFERENCE** — Use as the product/UX and domain-model reference (households, rule-based meal plan, shopping-list merge rules, parser fallback chain). Do **not** copy code. Directly **ADOPT** its permissive building blocks:
   - URL import in TS: fetch with our own SSRF-safe client → extract `<script type="application/ld+json">` (+ `@graph`, `@type` arrays, microdata fallback) → validate against `schema-dts` (Apache-2.0) `Recipe` types → normalise with `iso8601-duration` (MIT). Optionally run `recipe-scrapers` (MIT) in a Python sidecar for site-specific quirks. LLM fallback (structured output) when no JSON-LD.
   - Ingredient parsing: `ingredient-parser-nlp` (MIT) in a Python sidecar is the most accurate option; TS alternatives `parse-ingredient` 3.1.0 (MIT, regex/rule-based, active 2026-10-28), `numeric-quantity`/`format-quantity` (MIT) for fractions; porting the CRF inference (JSON weights + feature functions) to TS is feasible but medium effort **(unverified effort estimate)**.

---

## 13. TandoorRecipes/recipes (Tandoor)

1. **Purpose** — Self-hosted recipe manager with meal planning, shopping lists, supermarkets/categories, food hierarchy & substitutes, unit conversions, food "properties" (nutrition) with USDA FDC lookup, inventory/pantry, AI import, many importers.
2. **Latest version** — `2.7.2` (tag commit 2026-10-27; 199 tags total; 2.7.0 on 2026-10-23).
3. **Last meaningful maintenance** — HEAD 2026-10-27 (develop). 1,166 commits in 12 months (858 non-merge); vabene1111 260, smilerz 130, dependabot 106. Very active.
4. **License — VERIFIED from `LICENSE.md`**: **AGPL-3.0 with the "Commons Clause" License Condition v1.0** prepended. Text: the license "does not grant to you, the right to Sell the Software", where Sell includes providing "for a fee or other consideration (including … fees for hosting or consulting/support services …) a product or service whose value derives, entirely or substantially, from the functionality of the Software". README: "Beginning with version 0.10.0 … GNU AGPL v3 … with a common clause selling exception"; versions before 0.10.0 (≤ 2020-06-29) were MIT. So this is **not OSI open source**; it is source-available + copyleft. (AGPL §7 lets recipients strip "further restrictions", but the copyright holder imposed it and intends a paid hosted offering — `stripe` is in `requirements.txt` — so treat the clause as binding; legal counsel should confirm.)
5. **Commercial-use considerations** — Worst of both worlds for us: AGPL copyleft **plus** a prohibition on selling services deriving value from it. **No code, templates or bundled data reuse.** Pre-0.10.0 MIT code is 6+ years stale and irrelevant. Its companion dataset `TandoorRecipes/open-tandoor-data` (foods, units, conversions, supermarket categories) states ODbL (schema) + Database Contents License (WebFetch of README; **unverified detail**) — ODbL share-alike applies to derived databases; avoid or isolate.
6. **Tech stack** — Python/Django 5.2, DRF 3.18 + drf-spectacular (OpenAPI), PostgreSQL, Redis, django-allauth (MFA/social/SAML), django-scopes (tenant "Space" scoping), django-treebeard (food/keyword trees); frontend Vue 3.5 + Vuetify 3 (`vue3/`), Vite.
7. **Key dependencies** — `recipe-scrapers==15.13.0` (MIT), `microdata`, `beautifulsoup4`, `litellm` (AI providers), `requests_hardened` (SSRF filter), `pytubefix` (YouTube), `thefuzz`, `icalendar`, `stripe`, `boto3`, `python-ldap`.
8. **Security concerns** — `cookbook/helper/HelperFunctions.py::safe_request` uses `requests_hardened` with IP filter (no loopback), timeouts (2,10). `FDC_API_KEY` defaults to USDA `DEMO_KEY` (`recipes/settings.py:175`, rate-limited, shared). `api.py` is a 3,547-line monolith → review burden. Many importers parse untrusted archives/HTML (Paprika, Mealie, etc.).
9. **Relevant components (paths)** —
   - URL import: `cookbook/views/api.py` (~L2720–2936: `scrape_html(org_url=…, html=…, supported_only=False)`), `cookbook/helper/recipe_url_import.py` (529 lines, maps scraper → internal JSON-LD-like shape).
   - Ingredient parsing: `cookbook/helper/ingredient_parser.py` (344 lines, hand-written rule-based tokenizer: fractions, unicode fractions, alternate measurements, comma notes, automations-based aliasing) — **not** NLP.
   - Nutrition/properties: models `PropertyType` (with `fdc_id`), `Property`, `FoodProperty`; `cookbook/helper/property_helper.py` (sums food properties × converted amounts per recipe; flags missing values); FDC import `api.py` ~L1130–1190 (`GET https://api.nal.usda.gov/fdc/v1/food/{fdc_id}` → maps nutrient IDs to property types) and FDC search ~L3147; `cookbook/helper/fdc_helper.py` (dev script).
   - Units/scaling: `cookbook/helper/unit_conversion_helper.py` (base-unit + per-food `UnitConversion`), `vue3/src/components/dialogs/RecipeScalingDialog.vue`.
   - Meal plan/shopping/pantry: models `MealType`, `MealPlan`, `ShoppingList`, `ShoppingListRecipe`, `ShoppingListEntry`, `Supermarket*`, `InventoryLocation`, `InventoryEntry`, `InventoryLog`, `Food.onhand_users`; `cookbook/helper/shopping_helper.py`, `cookbook/helper/food_availability_helper.py` (on-hand/inventory/substitute availability queries); `UserPreference.mealplan_autoexclude_onhand`, `shopping_add_onhand`.
   - Importers: `cookbook/integration/*.py` (cooklang, paprika, mealie, nextcloud, plantoeat, recipekeeper …) — useful list of formats to support.
10. **Reuse difficulty** — Code: prohibited. Concepts: low.
11. **Integration risks** — Licensing contamination if engineers read and transcribe code; keep any clean-room spec written by someone who documents behaviour, not code.
12. **Test quality** — Moderate: 63 `test_*.py` under `cookbook/tests/` (api, views, other), pytest-django + factoryboy; `ci.yml`, CodeQL.
13. **Maintenance outlook** — Strong; primary maintainer + one core contributor (bus factor ~2); commercial hosted plan aligns incentives.
14. **Final recommendation: REFERENCE (concepts only; stricter than Mealie)** — Best reference for *nutrition-from-ingredients* modelling (property types keyed to FDC nutrient IDs, per-food reference amount/unit, food-specific unit conversions, missing-data flags) and pantry/inventory-aware shopping. Implement our own on USDA FDC directly (FDC data is public domain / CC0 **(verify per dataset in nutrition report)**). Do not use code or open-tandoor-data.

---

## 14. google-ai-edge/mediapipe

1. **Purpose** — Google's cross-platform on-device ML framework; "Tasks" API includes **Pose Landmarker** (BlazePose GHUM 3D): 33 landmarks (`kNumPoseLandmarks = 33`, `mediapipe/tasks/cc/vision/pose_landmarker/pose_topology.h`), normalized image landmarks + 3D world landmarks (metres, hip-centred), optional segmentation masks, `numPoses`.
2. **Latest version** — `v1.2.0` (tag 2026-10-28). Artifacts: PyPI `mediapipe 1.2.0` (Apache-2.0; wheels macOS arm64, manylinux x86_64/aarch64, Windows), npm `@mediapipe/tasks-vision 1.2.0` (Apache-2.0, 2026-10-27), Maven `com.google.mediapipe:tasks-vision 1.2.0` (lastUpdated 2026-10-28), iOS via `Package.swift` (SwiftPM, iOS ≥15, product `MediaPipeTasksVision`) and CocoaPods `MediaPipeTasksVision` **(pod version unverified)**.
3. **Last meaningful maintenance** — HEAD 2026-10-28; 817 commits in 12 months (MediaPipe Team bot-export 469, Sebastian Schmidt 263). Very active, Google-staffed.
4. **License** — Code Apache-2.0 (`LICENSE`). **Models: Apache-2.0** — verified in the official model card PDF (`Model Card BlazePose GHUM 3D.pdf`: "LICENSED UNDER Apache License, Version 2.0").
5. **Commercial-use considerations** — Permissive; keep NOTICE/attribution. Model card intended uses explicitly include "Fitness and repetition counting" and "3D pose measurements (angles / distances)". Limitations: single person, ≤ ~4 m from camera, head must be visible, not for metric-accurate depth, "not intended for human life-critical decisions. The primary intended application is entertainment" → **avoid medical/injury-prevention claims** in marketing. Surveillance/identity recognition explicitly out of scope.
6. **Tech stack** — C++ graph framework (Bazel), TFLite/LiteRT + XNNPack/GPU delegates; bindings: Java/Kotlin (Android), Obj-C/Swift (iOS), Python, TypeScript/WASM (web).
7. **Key dependencies** — TFLite/LiteRT, OpenCV (desktop/Python), protobuf, abseil. Model files (`float16`, measured sizes): `pose_landmarker_lite.task` 5.78 MB, `_full` 9.40 MB, `_heavy` 30.66 MB (`storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_{lite,full,heavy}/float16/latest/…`). Model card perf (Pixel 3): Lite ~44 FPS CPU / ~49 FPS GPU; Full ~18 CPU / ~40 GPU; Heavy ~4 FPS CPU.
8. **Security concerns** — Native code processing camera frames (memory safety in C++); fetch models over HTTPS from `/latest/` URLs = supply-chain drift → **bundle and checksum-pin** model files in the app. Camera/body video is sensitive personal data: keep on-device by default.
9. **Relevant components (paths)** — `mediapipe/tasks/cc/vision/pose_landmarker/` (graph, result, topology, tests); `mediapipe/tasks/ios/vision/pose_landmarker/sources/MPPPoseLandmarker{,Options,Result}.{h,mm,m}`; `mediapipe/tasks/java/com/google/mediapipe/tasks/vision/poselandmarker/PoseLandmarker.java`; `mediapipe/tasks/web/vision/pose_landmarker/pose_landmarker.ts` (`detect`, `detectForVideo`, options `numPoses`, `outputSegmentationMasks`); `mediapipe/tasks/python/vision/pose_landmarker.py`; running modes `IMAGE` / `VIDEO` (synchronous, monotonic timestamps) / `LIVE_STREAM` (async result callback, drops frames under load) in `mediapipe/tasks/python/vision/core/vision_task_running_mode.py`. Legacy `mediapipe/python/solutions` still in tree but superseded by Tasks API — build on Tasks.
10. **Reuse difficulty** — Using the SDK: low on native/web/Python. **React Native: no official binding** → medium (custom native module or community wrapper).
11. **Integration risks** — React Native ecosystem wrappers (npm metadata, checked 2026-10-29), all MIT, all small/young:
    | Package | Latest | Notes |
    |---|---|---|
    | `expo-mediapipe-pose` | 0.3.0 (2026-09-24, 1 version) | Expo Module; targets Expo SDK 57 / RN 0.86 / React 19.2; camera+photo+video; dev build required; peer dep `effect` |
    | `react-native-mediapipe-posedetection` | 0.4.0 (2026-01-20) | VisionCamera frame-processor plugin + config plugin; New Architecture only |
    | `@thinksys/react-native-mediapipe` | 0.0.21 (2026-04-10) | Pose-only component, own camera view |
    | `react-native-mediapipe` (cdiddy77) | 0.6.0 (2024-12-12) | VisionCamera-based; mainly object detection; stale |
    | `expo-mediapipe` | 0.4.1 (2026-06-13) | Pulls `@modelcontextprotocol/sdk` + web `tasks-vision 0.10.35` as runtime deps — odd supply chain, avoid |
    | `@gymbrosinc/react-native-mediapipe-pose` | 1.0.8 | README: "TEST PACKAGE … DO NOT USE IN PRODUCTION" — reject |
    Expo Go cannot load any of these (dev client / prebuild needed). Performance on low-end Android, thermal throttling in 5–10 min sets, and JS-thread bridging of 33×4 floats @30 Hz are the main risks.
12. **Test quality** — High: C++ graph/result tests per task (`pose_landmarker_test.cc`, `pose_landmarker_graph_test.cc`, `pose_landmarks_detector_graph_test.cc`), TS `pose_landmarker_test.ts`; Google internal CI (not visible).
13. **Maintenance outlook** — Strong (Google AI Edge), though Google has historically deprecated MediaPipe APIs (Legacy Solutions → Tasks); pin versions.
14. **Final recommendation: ADOPT** (SDK + Pose Landmarker Lite/Full models, Apache-2.0) via a **thin in-house Expo Module** (see "Pose analysis feasibility path"); community wrappers are REFERENCE/fork-only.

---

## 15. stevenzchen/pose-trainer

1. **Purpose** — 2018 Stanford course project/paper "Pose Trainer: Correcting Exercise Posture using Pose Estimation": OpenPose keypoints → per-exercise feedback for bicep curl, front raise, shoulder press, shoulder shrug.
2. **Latest version** — No tags/releases. HEAD `7d54c52` (2021-09-05).
3. **Last meaningful maintenance** — 2021-09-05 ("Update pose trainer to work with the latest OpenPose release"); 0 commits in 12 months; 44 commits total. README: "experimental, and is no longer maintained or supported. It is not expected to work."
4. **License** — GPL-3.0 (`LICENSE`).
5. **Commercial-use considerations** — GPL: do not copy code. Also depends on OpenPose (CMU, **non-commercial academic license**; commercial use needs a paid license **(OpenPose license terms unverified here)**) — irrelevant if we use MediaPipe. Ideas/thresholds from the paper are not copyrightable as methods.
6. **Tech stack** — Python, NumPy, Matplotlib; notebooks with SciPy (`medfilt`), scikit-learn (`KNeighborsClassifier`); Windows-only OpenPose 1.7.0 binary.
7. **Key dependencies** — OpenPose (external), numpy, scipy, scikit-learn.
8. **Security concerns** — None relevant (offline research code); `main.py` shells out to OpenPose via `subprocess`.
9. **Relevant components (paths)** — `evaluate.py` (**rule-based**: picks the more visible side, builds 2D limb vectors, computes angles via `arccos` of normalized dot products, compares per-rep **range/min/max thresholds** "learned from analysis", e.g. bicep curl: upper-arm/torso angle range > 35° → "upper arm moving", min upper-arm/forearm angle > 70° → "not curling fully"); `DTW-*.ipynb` (**DTW + 2-NN classifier**: `KNeighborsClassifier(n_neighbors=2, metric=DTWDistance)` on median-filtered angle sequences to classify correct vs incorrect reps); `parse.py`/`pose.py` (OpenPose JSON → PoseSequence, normalisation by torso length); `poses_compressed/` (labelled keypoint sequences per exercise).
10. **Reuse difficulty** — Code: not reusable (GPL, OpenPose, Windows). Method: trivial to re-implement (~200 lines TS).
11. **Integration risks** — Thresholds were tuned on a tiny dataset (≈100 videos, **unverified count**) and 2D side-view OpenPose; must be re-tuned on BlazePose landmarks and our camera placements.
12. **Test quality** — None (no tests, no CI).
13. **Maintenance outlook** — Dead/archived in practice.
14. **Final recommendation: REFERENCE** — Cite the paper for the two-tier design: (a) deterministic angle/threshold rules for explainable feedback and (b) DTW-to-template similarity for "form score". Re-implement from the paper, not the code.

---

## 16. exercemus/exercises

1. **Purpose** — Curated single-file exercise list (`exercises.json`) for the exercemus app; claims curation from exercemus, wger.de and wrkout/exercises.json.
2. **Latest version** — No tags. Branches `main` (HEAD `0ee5b74`, 2025-07-31) and `minified` (`minified-exercises.json`).
3. **Last meaningful maintenance** — 2025-07-31 (external contributor "updated and removed html elements"); before that 2022-09-24. **0 commits in last 12 months**; 57 commits total. Effectively unmaintained.
4. **License** — Repo `LICENSE`: MIT (© 2022 exercemus). README: "All code … is under the MIT License … However, all exercises in this repository have a license associated with them that you must follow." → **MIT does not cover the data.**
5. **Commercial-use considerations / PROVENANCE (measured)** —
   - `exercises` array: **872** entries. Matched by name against the repo's own source dumps: **852 from wrkout/exercises.json** (`original_source_data/exercises_json/`), **0 wger-only**, **20 hand-added** (e.g. "Barbell Bench Press", "Hammer Curl", "Dips (Chest Focus)"). Only **1** of 872 carries a `license` field ("CC-BY-SA 3", with `license_author`); the other 871 have none.
   - `exercises_to_merge` array (also shipped inside `exercises.json`): **190** wger records — 94 CC-BY-SA 3.0, 70 CC-BY-SA 4.0, 26 CC0, with authors.
   - wrkout lineage: wrkout/exercises.json claims "Open Public Domain" (Unlicense), but its `CONTRIBUTING.md` says the images "have been scrapped off the internet, therefore l do not own the copy right … advise against using them in comercial projects"; exercemus itself committed `d04978a` "Removed exercises.json source data as images are copyrighted". wrkout issue #305: a commenter reverse-image-matched the images to Bodybuilding.com; the maintainer later claimed they were self-made 3D renders (contradiction unresolved). Text origin is undocumented; the instruction style ("This will be your starting position.") suggests the same commercial source **(unverified)**.
   - **Can we ship it?** Not cleanly. The 852 wrkout-derived texts have doubtful chain of title (a public-domain dedication by someone who may not hold the copyright conveys nothing). The 190 wger records are CC-BY-SA and lost/kept attribution inconsistently. If used at all: strip `exercises_to_merge`, treat it as "unknown provenance", and use only non-copyrightable facts (exercise names, muscle/equipment classification) — then author our own instructions.
6. **Tech stack** — JSON + Python scripts (`validate.py`, `minify.py`, `original_source_data/combine.py`, per-source `parser.py`).
7. **Key dependencies** — None (stdlib Python).
8. **Security concerns** — None (static data). Embedded YouTube URLs (24 entries) are third-party content.
9. **Relevant components (paths)** — `exercises.json` (top-level keys `categories`[8], `equipment`[16], `muscles`[21], `muscle_groups` map, `exercises`, `exercises_to_merge`); per-exercise fields: `name`, `category`, `equipment[]`, `primary_muscles[]`, `secondary_muscles[]`, `instructions[]` (all 872) and sparse `variation_on`/`variations_on` (75/1), `description` (42), `video` (24), `aliases` (4), `tips` (3), `tempo` (1), `license`/`license_author` (1); `images/` is empty (0 images).
10. **Reuse difficulty** — Data loads trivially; legal cleanup is the hard part.
11. **Integration risks** — Provenance/copyright (above); no stable IDs (name is key); inconsistent key `variations_on` vs `variation_on`; no images.
12. **Test quality** — `validate.py` basic schema/consistency script; no CI.
13. **Maintenance outlook** — Dormant.
14. **Final recommendation: REJECT as a shipping dataset** (REFERENCE only for its compact taxonomy: 8 categories, 16 equipment, 21 muscles, muscle-group map, and the `variation_on` graph idea).

---

## Exercise dataset comparison

Counts measured from files in the clones on 2026-10-29.

| Dataset | Data license (as stated) | Effective assessment | Count | Fields | Images | Share-alike / attribution |
|---|---|---|---|---|---|---|
| **wger** (`wger/exercises/fixtures/exercise-base-data.json` + `translations.json`, AGPL code repo; data licensed separately) | Per-exercise: CC-BY-SA 4.0 (719), CC-BY-SA 3.0 (133), CC0 (20) — licence IDs from `wger/core/fixtures/licenses.json` | **Clean, documented chain of title**: each record carries `license`, `license_author`, `license_author_url`, `license_object_url`, `license_derivative_source_url` | 872 exercise bases with English translation; 2,035 translations (multi-language), 118 aliases | uuid, category, muscles, muscles_secondary, equipment, variation_group, name, description (HTML), language, per-record licence/author | Separate image/video models, each with own licence (many CC-BY-SA) — counts not measured in fixtures | **Yes** (BY-SA): attribution per record + licence link; adapted dataset must stay CC-BY-SA; app code is *not* affected (data and software are separate works). CC-BY-SA 4.0 §2(a)(5)(B) forbids DRM that restricts recipients → also publish our adapted exercise dataset openly (e.g. public JSON) to stay safe with app-store distribution. CC0 subset: no obligations |
| **yuhonas/free-exercise-db** | Unlicense (public-domain dedication) | **Text: doubtful provenance** (fork of wrkout/exercises.json; origin undocumented). **Images: high risk** — maintainer (issue #2): "I actually have no idea where the images are from or if they are royalty free so usage would be at your own risk"; upstream says images were scraped | 876 (`dist/exercises.json`); 873 with images | id, name, force, level, mechanic, equipment, primaryMuscles, secondaryMuscles, instructions[], category (7 values), images[] | 1,746 JPGs (2 per exercise, 105 MB) | None claimed; but Unlicense from a non-owner provides no protection |
| **exercemus/exercises** | Code MIT; data "per-exercise license" (871/872 missing) | Doubtful (852 from wrkout lineage) + 190 CC-BY-SA/CC0 wger records in `exercises_to_merge` | 872 (+190 to merge) | see §16.9 | 0 | Unclear; BY-SA for wger subset |
| **workout-cool** (`data/sample-exercises.csv`, `scripts/import-exercises-with-attributes.ts`) | Repo MIT | Only a **4-exercise sample** (18 CSV rows, FR+EN); full DB not public. README's suggestion for more data is an LLM prompt (`scripts/import-exercises-with-attributes.prompt.md`) that fabricates YouTube URLs from a third-party channel (@fit-distance) | 4 | id, name/name_en, description/_en (HTML), full_video_url, full_video_image_url, introduction/_en, slug/_en, attribute_name/value (TYPE, PRIMARY_MUSCLE, SECONDARY_MUSCLE, EQUIPMENT, MECHANICS_TYPE) | YouTube embeds/thumbnails (third-party, not licensed for redistribution) | n/a — not a dataset. Its Prisma attribute model (`prisma/schema.prisma` `Exercise`/`ExerciseAttribute*`) is a usable schema reference |
| wrkout/exercises.json (upstream of free-exercise-db & exercemus) | Unlicense | Same risks as free-exercise-db; maintainer now sells a commercial dataset at wrkout.xyz | 873 | similar to free-exercise-db | 2/exercise, "scraped off the internet" per CONTRIBUTING.md | — |

### Recommendation — seed exercise dataset

**Seed from the wger exercise database, licensed per record under CC BY-SA 4.0 (719/872 English records), CC BY-SA 3.0 (133) and CC0 1.0 (20).** CC BY-SA 3.0 records may be relicensed as CC BY-SA 4.0 when adapted (BY-SA 4.0 is a compatible later version), so the adapted catalog ships as **CC BY-SA 4.0** with per-exercise author attribution. Implementation rules:
1. Keep the wger-derived catalog as a **separate data layer** (`exercise_catalog` tables + `source`, `license`, `author`, `source_url` columns); show attribution in the exercise detail screen + an "Open data licences" page; publish the adapted catalog as a downloadable CC BY-SA 4.0 JSON.
2. Keep our **own original content** (instructions, coaching cues, AI-generated text, commissioned images/videos, rep-counting configs) in separate tables keyed by our IDs, so it is a separate work and not an adaptation of wger records (legal review recommended on the collection-vs-adaptation boundary).
3. Import only images whose own licence is CC0/CC-BY/CC-BY-SA with author recorded; commission or render our own demo media for the top ~150 exercises.
4. Use free-exercise-db only as a **facts/taxonomy cross-check** (names, force/level/mechanic enums, muscle mapping) — never ship its images or verbatim instructions. Reject exercemus and workout-cool as data sources.

If the business refuses any share-alike data: use the 20 CC0 wger records + names/classifications (facts) from free-exercise-db + fully original instructions/media. Wger is also covered in the wger report; its AGPL **code** must not be reused (data licence ≠ code licence).

---

## Pose analysis feasibility path

**Goal:** squat and push-up rep counting + joint-angle trends (knee/hip/elbow/trunk) in an Expo app.

**Recommended path: on-device MediaPipe Pose Landmarker through a thin in-house Expo Module + VisionCamera frame processor; server-side Python only for optional offline "form report" analysis.**

1. **Native module (ADOPT, ~2–4 engineer-weeks, unverified estimate).** Expo Modules API (Swift + Kotlin) wrapping `MediaPipeTasksVision` (iOS SwiftPM/CocoaPods, iOS ≥15) and `com.google.mediapipe:tasks-vision:1.2.0` (Android). Integrate as a `react-native-vision-camera` v5 (MIT, 5.2.3) frame-processor plugin so frames never cross the JS bridge; use `LIVE_STREAM` mode (async listener, monotonic timestamps), model **Lite** default (5.8 MB) with Full (9.4 MB) on capable devices; bundle `.task` files with SHA-256 pinning; GPU delegate where stable, CPU fallback. Emit only `33 × (x, y, z, visibility, presence)` + world landmarks at 15–30 Hz to a worklet / JS. Requires dev client / EAS build (no Expo Go). Use `expo-mediapipe-pose` 0.3.0 and `react-native-mediapipe-posedetection` 0.4.0 (MIT) as code references or a starting fork, not as long-term dependencies.
2. **Rep counting (pure TS, shared package, unit-testable).**
   - Angles: 3-point angle from **world landmarks** (metres, hip-centred; less perspective error) with a 2D fallback; squat = hip–knee–ankle (23/25/27, 24/26/28) + trunk lean (shoulder–hip vs vertical); push-up = shoulder–elbow–wrist (11/13/15, 12/14/16) + body-line hip angle (shoulder–hip–ankle).
   - Pick side by visibility (pose-trainer trick); gate on `visibility > ~0.6`.
   - Smooth with One-Euro or EMA filter; **hysteresis state machine** (e.g. squat: UP when knee > 160°, DOWN when < 100°; rep counted on DOWN→UP; push-up elbow > 155° / < 90°) — thresholds per exercise in config and tuned on our own labelled clips.
   - Per-rep metrics: min angle (depth), ROM, tempo (ecc/con time), trunk-lean max, left/right asymmetry → persisted as compact time-series for trend charts. Optional DTW similarity to a reference rep (pose-trainer approach) for a "form consistency" score.
3. **Web.** `@mediapipe/tasks-vision` 1.2.0 (Apache-2.0, WASM/WebGL) for an Expo-web/dashboard build; same TS rep-counting package.
4. **Server-side (optional, phase 2).** Python `mediapipe` 1.2.0 Tasks `PoseLandmarker` in `VIDEO` mode on uploaded clips for asynchronous detailed reports/re-analysis, model evaluation and threshold tuning. Downsides: upload bandwidth, GPU/CPU cost, and body-video privacy (sensitive personal data; explicit consent, short retention, encryption, no training use without consent). Not suitable for real-time counting.
5. **Constraints from the model card to design around.** Single person; ≤ ~4 m; head visible (push-ups filmed from the side at floor level often lose the head → place phone side-on at ~1–2 m); jitter under low light/occlusion; "not intended for life-critical decisions" → frame feedback as coaching, not medical/injury advice.
6. **Alternative considered.** Google ML Kit Pose Detection (also 33 BlazePose landmarks) via VisionCamera plugins — governed by ML Kit terms rather than Apache-2.0 and Android/iOS-only **(unverified)**; keep as fallback if MediaPipe iOS integration stalls.

---

## Summary

| # | Repo | Version | 12-mo commits | License (verified) | Reuse in proprietary app | Recommendation |
|---|---|---|---|---|---|---|
| 12 | mealie-recipes/mealie | v3.29.0 (2026-10-17) | 1,570 (930 non-bot) | AGPL-3.0-only | No code. Use its permissive deps: recipe-scrapers (MIT), extruct (BSD-3), ingredient-parser-nlp (MIT, CRF model MIT; training-data provenance caveat), pint (BSD) | **REFERENCE** |
| 13 | TandoorRecipes/recipes | 2.7.2 (2026-10-27) | 1,166 (858 non-merge) | **AGPL-3.0 + Commons Clause v1.0** (no right to "Sell"; MIT only before v0.10.0, 2020) | No code, no open-tandoor-data (ODbL/DbCL, unverified) | **REFERENCE (concepts only)** |
| 14 | google-ai-edge/mediapipe | v1.2.0 (2026-10-28) | 817 | Apache-2.0 code; Pose Landmarker models Apache-2.0 (model card) | Yes, via in-house Expo Module + VisionCamera | **ADOPT** |
| 15 | stevenzchen/pose-trainer | none (HEAD 2021-09-05) | 0 | GPL-3.0 (+ OpenPose non-commercial dependency) | No code; method from paper | **REFERENCE** |
| 16 | exercemus/exercises | none (HEAD 2025-07-31) | 0 | Code MIT; data per-record, 871/872 unlabeled; 852 from wrkout lineage, 190 CC-BY-SA/CC0 wger records embedded | Not cleanly shippable | **REJECT** (taxonomy reference only) |
| — | yuhonas/free-exercise-db | none (HEAD 2026-09-27) | 5 | Unlicense (provenance doubtful; images likely infringing) | Facts/taxonomy only; no images/verbatim text | REFERENCE |
| — | workout-cool exercise data | — | — | MIT code; 4 sample exercises only | Schema idea only | REFERENCE (schema) |
| — | **wger exercise data** | fixtures in wger repo | — | CC BY-SA 4.0 (719) / CC BY-SA 3.0 (133) / CC0 (20) per record | Yes, as separate attributed share-alike data layer | **ADOPT as seed dataset** |

Unverified items to close before launch: legal review of Commons Clause interplay with AGPL §7; ingredient-parser-nlp training-data provenance; wrkout/free-exercise-db text origin; per-image licences in wger media; open-tandoor-data licence text; ML Kit terms; effort estimates.
