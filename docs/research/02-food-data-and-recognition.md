# 02: Food data sources and food recognition (technical due diligence)

**Audit date:** 2026-10-29. **Method:**
- Each repo was cloned into the scratchpad with `--filter=blob:limit=200k --shallow-since=2025-10-01`. iOS fell back to `--depth 1`, and foodvision-bench is a full clone.
- I inspected the source, configs, tests and CI directly.
- Versions come from `git ls-remote --tags`, CHANGELOG files and manifests.
- "Commits/12 mo" means `git rev-list --count --since=2025-10-29 HEAD`, merges included. "Non-bot" excludes dependabot, renovate and Crowdin/translation commits.
- Archived status was read from github.com via WebFetch.
- **Live measurements** hit `world.openfoodfacts.org` (v2/v3/v3.6), `search.openfoodfacts.org`, `robotoff.openfoodfacts.org`, the full OFF CSV export (downloaded 2026-10-29, 1.52 GB) and the FDC bulk files (Foundation JSON plus Branded CSV of 2026-10-29).
- All requests used `User-Agent: MOO-DueDiligence/0.1 (research)`.

**Context:** proprietary commercial SaaS: Expo/React Native + TypeScript mobile, TypeScript backend + PostgreSQL; the primary market is the UAE. Hard rules:
- **No GPL/AGPL code in our codebase.**
- **Dataset licenses are assessed separately from code licenses.**
- "Reference" means read the code for ideas, then write our own implementation clean-room.

> **Headline findings**
> 1. **OFF's UAE coverage is moderate and its quality is uneven.** 9,529 products are tagged `en:united-arab-emirates`. Only **51.8%** have energy + protein + carbs + fat, **36.0%** have a parsed `serving_quantity`, **73.0%** have a front image, and only **17.4%** have all three.
>    - Coverage is much better for popular items: among products with ≥5 unique scans, 81% have complete macros and 56% have all three.
>    - Arabic text is almost absent: **0.9%** of UAE products have an Arabic product name.
> 2. **OFF changed its nutrition schema in API v3.5 (schema 1003, still "under active development").** The legacy flat `nutriments.*_100g` map is only a *downgraded view* of the new `nutrition.input_sets[] / aggregated_set` structure. The aggregated set **merges in nutrients estimated from the ingredient list** (`source: "estimate"`), and it **prefers "prepared" values over "as sold"**. An importer that reads `aggregated_set` naively will ingest estimated values (for Nutella, 61 estimated nutrients, many of them 0) as if they were label facts.
> 3. **Robotoff's nutrition-extraction model `openfoodfacts/nutrition-extractor` is CC-BY-NC-SA-4.0 (non-commercial)**, because it is a LayoutLMv3 fine-tune. The other OFF models are AGPL-3.0, and Robotoff's code is AGPL-3.0. None of these may be embedded in our product.
>    - The public endpoint works, but on the one UAE bilingual label I tested it **mis-assigned every macro**.
> 4. **foodvision-bench looks like promotional content, not a benchmark.** I recommend REJECT; the evidence is in §6.
> 5. **USDA FDC is CC0 (public domain), but its Branded data is US-only.** Of 2,010,212 Branded records, only **36 have a UAE (629) GTIN prefix**.
>    - FDC is the right base for generic and whole foods, but not for UAE barcodes.
>    - **Only 22% of Foundation Foods carry nutrient 1008 (Energy kcal).** Most carry only the Atwater energy nutrients 2047/2048, so an importer that reads only 1008 loses about 75% of Foundation energy values.

---

## 1. openfoodfacts/openfoodfacts-server (Product Opener)

1. **Purpose:** the backend of Open Food Facts: product database, web site, read/write API (v0–v3.6), taxonomies, ingredient parsing, Nutri-Score/NOVA/Green-Score computation, data-quality checks, and the CSV/JSONL/Parquet exports. For us its value is the **API and the data**, not the code.
2. **Latest version:** `v2.117.0` (CHANGELOG dated 2026-10-28; `version.txt` = 2.117.0). Release-please manages releases, and the cadence is roughly weekly.
3. **Last meaningful maintenance activity (measured):**
   - Last commit 2026-10-28 ("taxonomy(food): add artificial spiced flavor ingredient #15187").
   - **1,771 commits in 12 months**, about 1,511 of them non-bot.
   - Top authors: Freso (465), moon-rabbitOFF (168), Stéphane Gigandet (160).
   - API schema changes landed recently: v3.5 (new nutrition schema; the changelog date reads "2025-126-01", i.e. late 2025) and v3.6 (tags_sources, 2026-05-27).
4. **License:**
   - **Code:** **AGPL-3.0** (`LICENSE`, `COPYRIGHT`).
   - **Data:** the database is under **ODbL 1.0**, individual contents under **DbCL 1.0**, and **product images under CC-BY-SA 3.0** (`docs/api/index.md`, terms-of-use page). The terms also warn that images may contain third-party copyright and trademarks (packaging artwork).
5. **Commercial-use considerations:**
   - **Code:** do not copy any code (AGPL). Calling the HTTP API or importing the dumps does not bring AGPL obligations into our code.
   - **Data:** the terms state the licences allow "all purposes, including commercial use", subject to attribution and share-alike. The practical consequences:
     - (a) **Attribution:** show an "Open Food Facts, ODbL" notice wherever OFF-derived data is shown, plus credit for images. The exact wording is to be confirmed by legal.
     - (b) **ODbL share-alike (§4.4):** if we publicly use a *Derivative Database* (OFF rows modified or merged with our corrections), we must offer that derivative database, or the means to rebuild it, under ODbL. Mitigation:
       - store OFF data **unmodified, in a separate schema**, as a "Collective Database" alongside our proprietary data;
       - keep user corrections as separate overlay rows, or contribute them back upstream;
       - **legal review is required**.
     - (c) **Images (CC-BY-SA 3.0):** hotlinking or caching them unmodified with attribution is fine. Crops or edits are adaptations and must be shared alike. Packaging trademarks are a separate issue.
     - (d) Commercial users are asked to fill in the API usage form (`docs/api/index.md`).
6. **Tech stack:**
   - Perl 5 (`lib/ProductOpener/*.pm`, 96 `requires` in `cpanfile`) with Apache/mod_perl.
   - MongoDB for products, plus file storage (`.sto` files), PostgreSQL (Minion job queue), Redis, memcached and Keycloak (`Keycloak.pm`).
   - Frontend built with gulp/webpack; services orchestrated with Docker Compose.
7. **Key dependencies:** MongoDB, Minion/PostgreSQL, Redis (events and rate limiter), Keycloak (auth), Imager/ImageMagick, taxonomies under `taxonomies/`, and Robotoff (external ML).
8. **Security concerns (for us as API consumers):**
   - (a) Data is crowd-sourced and unvalidated, so treat all fields as untrusted input. Sanitize text and never render HTML from it.
   - (b) **Anonymous search is heavily throttled.** Measured:
     - Search (`/api/v2/search` and `/cgi/search.pl`) returned **HTTP 503 or 401 on 23 of 25 logged attempts**. Pages beyond 1 were always 503 ("not available to anonymous users").
     - Product reads succeeded **22/22** at about 14/min.
     - The code sets `rate_limit_product = 100`/min, `rate_limit_search = 10`/min and facet limits of 5/min anonymous (`lib/ProductOpener/Config.pm` L198–217). The docs say 15 req/min/IP for product reads and 10 for search (`docs/api/index.md` §Rate limits), with possible IP bans.
     - A global 503 limiter also applies.
   - (c) Requests **without a User-Agent still returned 200**, but the docs require `AppName/Version (email)`.
   - (d) The project has no bug bounty (`SECURITY.md`).
   - (e) Image URLs are public CDN URLs, so they raise no privacy issue for reads. Do not upload user photos to OFF without explicit consent, because uploads become CC-BY-SA public.
9. **Relevant components (read for semantics only, AGPL):**
   - `lib/ProductOpener/API.pm` L778–792: API version → schema version map. 3.5 → 1003 is the new nutrition schema; 3.6 → 1004 is tags_sources.
   - `lib/ProductOpener/ProductSchemaChanges.pm`: the 1002↔1003 nutrition up- and downgrade. L840–915 compute `_serving` from `_100g` only if `serving_quantity > 0`, and compute `_100g` from `_serving` **only if `serving_quantity > 5`**.
   - `lib/ProductOpener/Nutrition.pm`:
     - L309–330: set priority. Preparation: `prepared` before `as_sold`. Source: `manufacturer` > `packaging` > `usda` > `estimate`. Per: `100g` > `100ml` > `1l` > `1kg` > `serving`.
     - `generate_nutrient_aggregated_set_from_sets` (L245); `convert_nutrient_to_100g` (L609).
   - `lib/ProductOpener/NutritionEstimation.pm`: the estimate-from-ingredients logic (CIQUAL-based).
   - `lib/ProductOpener/Units.pm` L379–440: `normalize_serving_size` parses the first `<number><unit>` in `serving_size` and converts it to g/ml, which yields `serving_quantity` and `serving_quantity_unit`.
   - `lib/ProductOpener/Products.pm` L477–600: `normalize_code`, which handles GS1 AI/Digital Link and leading-zero normalisation.
   - Docs: `docs/api/ref-barcode-normalization.md`, `docs/api/ref-api-and-product-schema-change-log.md`, `docs/api/ref-v3.md`, OpenAPI `docs/api/ref/api-v3.yaml`.
   - Data quality: `DataQualityFood.pm` defines tags such as `en:nutrition-...-energy-value-in-kcal-does-not-match-value-in-kj`.
10. **Reuse difficulty:** code reuse is N/A (Perl, AGPL, monolith). Consuming the data is moderate. The schema is large and is changing in v3.5+, and several fields are polymorphic: `serving_quantity` is a number in the API and a string in Parquet, and `brands` is a string or a list depending on the endpoint.
11. **Integration risks:**
    - (a) Schema churn: v3.5 is still flagged "under active development", so pin an explicit API version in the URL (`/api/v2/` or `/api/v3.6/`).
    - (b) Rate limits and 503s, so lookups need a local mirror.
    - (c) Data quality issues (§8 below).
    - (d) **Search indices disagree.** `search.openfoodfacts.org` (search-a-licious) returned 4,064 UAE products while the v2 Mongo search returned 9,379. In a check, 30 of the 100 most popular v2 results were missing from search-a-licious, mostly multi-country products. search-a-licious also does not index `serving_quantity`, `ingredients_text` or `image_nutrition_url`.
    - (e) ODbL compliance in our data model.
12. **Test quality:**
    - 118 unit and 66 integration test files under `tests/` (Perl `.t`, with expected-result JSON). Nutrition coverage includes `tests/unit/nutrition.t`, `nutrition_aggregated_set.t`, `nutrition_estimation.t` and `units.t`.
    - CI: `pull_request.yml`, CodeQL, API linting (redocly).
    - Good for a project of this kind. The test suite was not run here.
13. **Maintenance outlook:** very healthy. Funded non-profit, many contributors, frequent releases. The risk is churn, not abandonment.
14. **Final recommendation:** **ADOPT the data and API (dumps plus live API) / REJECT the code.**
    - Mirror the OFF JSONL or Parquet dump into a separate Postgres schema and apply the daily deltas (`static.openfoodfacts.org/data/delta/index.txt`, verified present).
    - Use the live `GET /api/v2/product/{code}` (or `/api/v3.6/`) only for cache misses and freshness checks. Our user volume will exceed 15–100/min/IP from a server, so either proxy through a cache or call from the client with our own UA. The docs say limits apply per user IP for mobile apps.
    - Never use OFF search for search-as-you-type; search our mirror instead.

## 2. openfoodfacts/openfoodfacts-dart

1. **Purpose:** the official Dart/Flutter SDK for OFF. It covers product read/write, search, taxonomies, Robotoff questions and insights, Open Prices, Folksonomy, events and knowledge panels, and it powers the official "smooth-app" Flutter app.
2. **Latest version:** `v3.31.1` (2026-10-19; `pubspec.yaml` 3.31.1). Note that `version.txt` still says 2.5.2, which is stale.
3. **Last meaningful maintenance activity (measured):** last commit 2026-10-20. **95 commits in 12 months**, about 52 non-bot. The main human contributor is monsieurtanuki (27). v3.31.1 is titled "new nutrition fine-tuning #1291", so the SDK tracks the v3.5 nutrition schema: `ProductQueryVersion.latestVersion = v3_5` in `lib/src/utils/product_query_version.dart`.
4. **License:** **Apache-2.0**.
5. **Commercial-use considerations:** Apache-2.0 is compatible with proprietary use: keep the NOTICE and attribution. The OFF data terms still apply to any data it fetches.
6. **Tech stack:** pure Dart (259 source files). JSON (de)serialisation through `json_annotation` and generated `*.g.dart` files.
7. **Key dependencies:** `http ^1.6.0`, `json_annotation`, `path`, `meta`. The dependency surface is minimal.
8. **Security concerns:** low. It ships no credentials. Write calls send user credentials or cookies to OFF, which must be handled carefully if ever used. It includes a client-side rate limiter (`too_many_requests_manager.dart`: 10/min search, 100/min product).
9. **Relevant components:**
   - `lib/src/model/nutrition/nutrition_set.dart`, `nutrition_set_key.dart`, `nutrition_helper.dart`: the **cleanest readable reference for the new v3.5 nutrition schema**.
   - `lib/src/model/nutriments.dart`, `lib/src/model/nutrient.dart`: the legacy flat model.
   - `lib/src/utils/barcodes_validator.dart`: EAN-8/13 and UPC check digits.
   - `lib/src/utils/product_fields.dart`, `lib/src/utils/unit_helper.dart`, `lib/src/robot_off_api_client.dart`, `lib/src/open_food_search_api_client.dart`.
10. **Reuse difficulty:** high for us. It is Dart, and our planned stack is TypeScript, so it can only be used directly if Flutter is chosen. For TypeScript, the official **`@openfoodfacts/openfoodfacts-nodejs`** (repo `openfoodfacts/openfoodfacts-js`, **Apache-2.0**, `2.0.0-alpha.36`, last commit 2026-10-28, with `src/off-v2.ts`, `off-v3.ts` and `robotoff.ts`) is the equivalent. It is still alpha, and I did not audit it in depth.
11. **Integration risks:** tied to the OFF schema churn. Its tests (`test/api_*_test.dart`) hit live servers, so they are flaky by nature.
12. **Test quality:** 49 test files. Most are live-API integration tests, plus offline JSON round-trip tests (`json_conversion_test.dart`, `product_from_json_test.dart`, `barcode_validator_test.dart`). CI runs `test-sdk.yml` and a pub.dev score check.
13. **Maintenance outlook:** good. It is the SDK behind OFF's flagship app.
14. **Final recommendation:**
    - **If Flutter is chosen: ADOPT.**
    - **For the planned Expo/TS stack: REFERENCE.** Use its nutrition-set models as the spec for our TS types, and evaluate `@openfoodfacts/openfoodfacts-nodejs` (Apache-2.0) or a thin client of our own.

## 3. openfoodfacts/openfoodfacts-androidapp

1. **Purpose:** the legacy native Android OFF scanner app. Per its README it is now used only for the Open Beauty, Pet Food and Products Facts apps on F-Droid, and the food app moved to `smooth-app` (Flutter).
2. **Latest version:** `v3.10.2` (2023-04-06; `version.txt` 3.10.2). There has been no release since.
3. **Last meaningful maintenance activity (measured):**
   - Last commit 2026-09-22 (dependabot).
   - **82 commits in 12 months, 70 of them by dependabot.** About 11 are non-bot: CI fixes on 2026-06-29, "Add version code in user agent", and image-URL domain fixes.
   - Last README edit (2026-08-22) clarifies that it is legacy. **Not archived** (WebFetch: no archive banner).
4. **License:** **Apache-2.0**.
5. **Commercial-use considerations:** permissive. Bundled Google **ML Kit** barcode scanning (`com.google.mlkit:barcode-scanning:17.0.0`) is under Google's proprietary ML Kit terms, not Apache.
6. **Tech stack:** Kotlin (298 files) plus Java (32 files). Hilt/Dagger, Retrofit 2.9 with Jackson, RxJava, Room-style DAO (unverified), ZXing (`zxing-android-embedded 3.6.0`, `zxing core 3.5.3`) and ML Kit.
7. **Key dependencies:** listed under 6. `okhttp3 logging-interceptor 3.12.13` is very old.
8. **Security concerns:** old dependency versions (OkHttp 3.12, Retrofit 2.9, Hilt 2.48), and the app is effectively unmaintained. Irrelevant unless we reused it.
9. **Relevant components (barcode and nutrition workflow reference):**
   - `app/src/main/java/openfoodfacts/github/scrachx/openfood/features/scan/ContinuousScanActivity.kt`, `CameraView.kt`, `ZXCameraView.kt`, `WorkflowState.kt`: continuous scanning with a quick-view bottom sheet. This is good UX reference.
   - `features/simplescan/SimpleScanActivity.kt`, `SimpleScanScannerOptions.kt`.
   - `features/product/edit/nutrition/ProductEditNutritionFactsFragment.kt`, `ProductEditNutritionViewModel.kt`: the per-100g vs per-serving entry UI with units and modifiers (`<`, `~`).
   - `models/ProductNutriments.kt`, `models/Nutriment.kt`, `features/adapters/CalculatedNutrimentsGridAdapter.kt`: per-portion scaling.
10. **Reuse difficulty:** high. It is native Android in Kotlin and our stack is React Native, so it can only serve as a UX and flow reference.
11. **Integration risks:** N/A (not integrated). It targets the legacy pre-1003 nutrition schema, so its nutrition model is outdated.
12. **Test quality:** 57 test files (unit and androidTest). An "Android Integration" CI workflow exists. Coverage is unverified.
13. **Maintenance outlook:** **legacy, dependency bumps only.** It will likely be archived eventually (unverified).
14. **Final recommendation:** **REFERENCE** for scan-flow UX only: continuous scan, a quick-view card, and adding a missing product with photos. Take nothing from it for the data model.

## 4. openfoodfacts/openfoodfacts-ios

1. **Purpose:** the old native iOS OFF app (Swift), superseded by `smooth-app`.
2. **Latest version:** the newest tag is `3.4.4` (date unverified; tags also include `1.0-17`…`1.0-19`).
3. **Last meaningful maintenance activity (measured):** last commit **2023-09-05** ("Update Localizable.strings #1010"), with 0 commits in 12 months. **Archived:** the GitHub banner reads "This repository was archived by the owner on Sep 5, 2023. It is now read-only." (WebFetch).
4. **License:** **Apache-2.0**.
5. **Commercial-use considerations:** permissive, but the code is three years stale.
6. **Tech stack:** Swift and UIKit with XIBs (164 Swift files), built with Carthage. Realm 3.19, Alamofire 4.8 and Kingfisher 5.8.
7. **Key dependencies:** `Cartfile` lists Alamofire 4.8.2, AlamofireObjectMapper (fork branch "migrate-to-swift-4"), Realm-cocoa v3.19.0, Kingfisher 5.8.3, Sentry-cocoa 5.2.2, swifter "stable" and others. All are 2019–2020 era.
8. **Security concerns:** abandoned dependencies. N/A unless reused.
9. **Relevant components:** `Sources/ViewControllers/Products/Search/ScannerViewController.swift`, `ScannerResultViewController.swift`, `Sources/Views/Products/Search/Scanner/ScanProductSummaryView.swift`, `Sources/Network/`.
10. **Reuse difficulty:** very high. It is obsolete Swift/UIKit with Carthage.
11. **Integration risks:** N/A.
12. **Test quality:** 46 test files (`Tests/`, `UITests/`, snapshot tests). The CI is disabled (`disabled-travis.yml`).
13. **Maintenance outlook:** dead (archived).
14. **Final recommendation:** **REJECT.** Use it as a historical reference at most. `expo-camera` or `react-native-vision-camera` with built-in barcode scanning covers this.

## 5. openfoodfacts/robotoff

1. **Purpose:** OFF's ML service. It generates *predictions* and *insights* (category, brand, labels, weight, packager codes, nutrition values, ingredient lists, logos, image orientation and more) from product images and OCR, and serves "questions" for crowd validation. Inference runs on NVIDIA Triton.
2. **Latest version:** `v1.85.14` (CHANGELOG 2026-10-20; `pyproject.toml` 1.85.14). The repo has 223 `v1.x` tags, managed with release-please.
3. **Last meaningful maintenance activity (measured):** last commit 2026-10-26 ("fix(triton): fix load-model command #1979"). **136 commits in 12 months**, about 97 non-bot, mainly Raphaël Bournhonesque (62).
4. **License:**
   - **Code:** **AGPL-3.0-only** (`LICENCE`, `pyproject.toml`).
   - **Models** (Hugging Face model cards, fetched live):
     - `openfoodfacts/nutrition-extractor`: **CC-BY-NC-SA-4.0** (base `microsoft/layoutlmv3-large`, itself CC-BY-NC-SA). **Non-commercial.**
     - `nutrition-table-yolo`: **AGPL-3.0** (Ultralytics YOLOv8).
     - `ingredient-detection`: **AGPL-3.0**.
     - `front_image_classification`: **AGPL-3.0** (YOLO11).
   - Training datasets (`openfoodfacts/nutrient-detection-layout` and others) are derived from OFF images (CC-BY-SA); their licenses were not individually verified.
5. **Commercial-use considerations:**
   - **We cannot embed the code, or any of these model weights, in a proprietary product.** The NC license prohibits commercial use outright. AGPL weights served over a network to our users would trigger source-disclosure obligations for the combined work (legal opinion needed). Ultralytics also offers commercial licenses for YOLO.
   - **Calling the public API** (`robotoff.openfoodfacts.org`) does not bring code-license obligations, but:
     - it has no SLA;
     - the `nutrition-extractor` license plausibly extends to its outputs being used commercially (unverified, legal question);
     - sending our users' photos to a third party is a privacy and consent issue.
6. **Tech stack:** Python 3 with Falcon 3.1 and gunicorn; PostgreSQL via peewee; Redis/RQ workers; Elasticsearch 8; MongoDB (reads the OFF DB); Triton gRPC (`models/docker-compose.yml`, `tritonserver:25.02`, needs a GPU); HF transformers 4.53; OpenCV; DuckDB; Google Cloud Batch and Storage. OCR comes from **Google Cloud Vision** JSON stored next to OFF images.
7. **Key dependencies:** `transformers~=4.53.3`, `tritonclient[grpc]==2.65.0`, `falcon~=3.1.3`, `peewee`, `elasticsearch~=8.18`, `pymongo`, `Pillow<10.4`, `openfoodfacts==3.4.5` (Python SDK), `google-cloud-*`. Full list in `pyproject.toml`; `uv.lock` is present.
8. **Security concerns:**
   - `GET /api/v1/predict/nutrition?image_url=…&ocr_url=…` (`robotoff/app/api.py` L436–481) fetches **arbitrary caller-supplied URLs** server-side. Only `/images/crop` checks `CROP_ALLOWED_DOMAINS` (`settings.py` L373, `api.py` L716). That is an SSRF-shaped surface on their side, and a reason not to self-host it naively.
   - Public, unauthenticated endpoints with no SLA.
9. **Relevant components:**
   - `robotoff/prediction/nutrition_extraction.py`: LayoutLMv3 token classification over image + OCR, with post-processing into `energy-kcal_100g` and similar keys. **Reference only.**
   - `robotoff/prediction/ocr/`: regex and grammar extractors, e.g. `nutrient.py` and weight/quantity extraction (AGPL; ideas only).
   - `robotoff/insights/importer.py` L1480–1720: how `nutrient_extraction` insights are deduplicated and validated.
   - `robotoff/app/api.py` L1827–1866: the route table (`/api/v1/insights/{barcode}`, `/questions/{barcode}`, `/predict/nutrition`, `/images/predict`).
   - `models/models.toml`: model repo IDs and pinned revisions.
10. **Reuse difficulty:** prohibitive (AGPL and NC). The API is easy to call, but `predict/nutrition` needs a Google Vision OCR JSON URL, so it does not take a raw user photo.
11. **Integration risks (measured):**
    - Live call on `6291030201022` (Al Rawabi low-fat milk, bilingual EN/AR label). The `.json.gz` OCR URL failed (`download_error`); the plain `.json` URL succeeded in about 1 s and returned 7 entities, **all macros mislabeled** against the stored, plausible OFF values:

      | Field | Robotoff | Stored OFF value |
      |---|---|---|
      | `energy-kj_100g` | 43 | 43 kcal |
      | `saturated-fat_100g` | 1.2 | fat 1.2 |
      | `proteins_100g` | 5.1 (score 0.60) | carbs 5.1, protein 3 |
      | `carbohydrates_100g` | 0.9 (score 0.40) | sat-fat 0.9 |

      Only `serving_size: 200 ml` looked right. This is n = 1, so it is anecdotal, but it suggests weak performance on GCC bilingual and column-swapped tables.
    - `GET /api/v1/insights/3017620422003` returned `{"status":"no_insights"}`. `GET /api/v1/questions/6291056030507` returned a category question. Questions could feed a "help improve this product" feature, but that is low value.
12. **Test quality:** about 100 test files (`tests/unit`, `tests/integration`, `tests/ml`), plus a `quality_check.yml` CI and codecov. Good.
13. **Maintenance outlook:** active (core OFF infrastructure), with a single primary maintainer, which is a bus-factor concern.
14. **Final recommendation:** **REFERENCE (architecture only). REJECT embedding its code or models.**
    - Build our own label-OCR pipeline: on-device OCR (ML Kit text recognition or Apple Vision), then an LLM or vision-LLM structured extraction into our nutrient schema, validated by Atwater and kJ/kcal consistency checks. Evaluate it on a UAE label set we collect ourselves.
    - Optionally *read* existing Robotoff `nutrient_extraction` insights for OFF products as low-confidence hints. Only do this after legal sign-off on the NC model's outputs.

## 6. foodvision-bench/foodvision-bench

1. **Purpose (as claimed):** a "reproducible evaluation harness" scoring photo-based calorie estimation (MAPE on kcal) on a 231-meal "USDA-weighed" set (`mini-231`), with a monthly leaderboard. Every snapshot shows the commercial app "PlateLens" leading both tiers.
2. **Latest version:** tags go up to `v0.2.1`, while CHANGELOG/README say `0.3.6` (2026-09-02). A `benchmarks/results/2026-10.json` file exists although the README shows the September snapshot.
3. **Last meaningful maintenance activity (measured):** last commit 2026-10-01. 51 commits in total, all within 12 months (first 2025-11-03). **49 of 51 commits come from one pseudonymous identity** (`Foodvision Bench Contributors <foodvision-bench@private.rocks>`), and **43 of 51 commit timestamps fall on exactly :00 seconds**, which suggests they were scripted or backdated.
4. **License:** MIT. The test-set images are claimed CC-BY-4.0 in `docs/test-sets.md`, but **they are not published**: no images or download link exist anywhere in the repo.
5. **Commercial-use considerations:** the license is permissive, but there is nothing of value to use.
6. **Tech stack:** Python ≥3.10, a small package (`src/foodvision_bench/`, 71 files, 452 KB), optional open-clip.
7. **Key dependencies:** optional `open-clip-torch` and `datasets` (Food-101 loader).
8. **Security concerns:** none technically. The concern is **credibility and astroturfing risk** if it is cited in product or marketing claims.
9. **Relevant components:**
   - `src/foodvision_bench/metrics.py`: MAPE and top-1, which is trivial.
   - `src/foodvision_bench/systems/clip_baseline.py`: the "portion estimation" is a **fixed kcal-per-label lookup** (`LABEL_TO_KCAL`, 20 labels), so it does not estimate portions at all.
   - `src/foodvision_bench/systems/vendors/_base.py`: vendor adapters **raise NotImplementedError and return hard-coded numbers** (`VendorNumbers`).
   - `src/foodvision_bench/data/test_sets.py`: a registry of names and counts only.
10. **Reuse difficulty:** low, but there is nothing worth reusing.
11. **Integration risks (red flags):**
    - (a) `pip install foodvision-bench` is in the README, but **PyPI returns 404**.
    - (b) The ground-truth dataset is unavailable, so no result can be reproduced.
    - (c) Internal inconsistencies:
      - "five cuisine buckets" vs six;
      - Calorie Mama is given as 8.8% and 8.5% in the same README;
      - MacroFactor is given as 4.8% and 4.9%;
      - "231 images" vs each plate being shot on 2 phones × 2 angles.
    - (d) It covers **kcal only**: "Macro- and micronutrient error are out of scope". There is no portion-size or volume ground truth exposed.
12. **Test quality:** 28 unit tests (`tests/test_metrics.py`, `test_systems.py`, `test_cli.py`) covering arithmetic and registry wiring. CI runs ruff and pytest.
13. **Maintenance outlook:** unknown and untrustworthy.
14. **Final recommendation:** **REJECT.** It is not usable as a benchmark: no data, hard-coded vendor scores, and apparently promotional. If we need a food-image benchmark, build our own UAE and Levantine meal set with weighed ground truth. Public alternatives worth evaluating (unverified here):
    - Nutrition5k (Google, CC-BY-4.0): has per-dish calories, mass and macros, so it covers portions.
    - Food-101 and UEC-Food-256: classification only.

---

## 7. USDA FoodData Central (FDC)

- **API:** `https://api.nal.usda.gov/fdc/v1`, with endpoints `/food/{fdcId}`, `/foods` (multi-id), `/foods/list` and `/foods/search` (verified in the OpenAPI spec `fdc.nal.usda.gov/api-spec/fdc_api.json`, v1.0.0). Schemas: `BrandedFoodItem`, `FoundationFoodItem`, `SRLegacyFoodItem`, `SurveyFoodItem`, `FoodPortion`, `NutrientConversionFactors`.
- **Key and rate limits:**
  - A free api.data.gov key is required.
  - Documented limit: **1,000 requests/hour/IP** for a normal key (api-guide page). `DEMO_KEY` gets 30/hour and 50/day per IP.
  - **Measured:** `DEMO_KEY` from this environment returned **HTTP 429** with `x-ratelimit-limit: 10` and `retry-after: 30567`, because the shared egress IP was already exhausted. So no live API responses were captured; all FDC analysis below comes from the bulk files.
- **License:** the api-guide states: "USDA FoodData Central data are in the public domain… published under **CC0 1.0**". Citing "FoodData Central" as the source is requested but not required. This is the cleanest licence of all the sources.
- **Data types (measured where marked):**

  | Type | Content | Size / release |
  |---|---|---|
  | **Foundation** | Analytical values for generic and raw foods, rich metadata | **424 foods** in release 2026-10-29 (measured); semi-annual releases (2025-12-18, 2026-04-30, 2026-10-29 present) |
  | **SR Legacy** | Frozen 2018 Standard Reference | JSON zip 13.5 MB, release 2018-04; about 7.8k foods (unverified) |
  | **FNDDS (Survey)** | As-eaten foods with portions (WWEIA) | latest bulk 2024-10-31 |
  | **Branded** | GS1/label data from manufacturers | **2,010,212 records** (measured) |

  - Foundation detail (measured): **only 95 (22%) carry nutrient 1008 Energy kcal**; 279 carry 2047 (Atwater General) and 200 carry 2048 (Atwater Specific). 374 (88%) have *some* energy and 50 have none. 291 have `foodPortions` with `gramWeight`.
  - Branded detail (measured): `market_country` is "United States" (1,986,471), "US" (22,624) or "New Zealand" (1,117). **GTINs with UAE prefix 629: 36; KSA prefix 628: 8.** Brand-owner substring hits for UAE brands are near zero (Al Islami 1; the "americana" hits are probably US brands, unverified).
- **Bulk downloads (verified via HEAD/GET):**
  - `https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_csv_2026-10-29.zip` (485 MB, all types);
  - `…branded_food_csv_2026-10-29.zip` (452 MB);
  - `…foundation_food_json_2026-10-29.zip`;
  - `…sr_legacy_food_json_2018-04.zip`;
  - `…survey_food_json_2024-10-31.zip`.
  - The download page lists every historical release.
- **Pitfalls:**
  - (a) Energy: use 1008, falling back to 2048 then 2047 (kcal). 1062 is kJ. Record which ID was used.
  - (b) Carbohydrate: use 1005 (by difference); 1050 (by summation) is rare (30 of 424 Foundation foods).
  - (c) Fat: use 1004 (total lipid); 1085 (NLEA) is an alternative.
  - (d) Units differ from OFF: FDC sodium is **mg** (1093) and vitamins are in mg or µg. OFF stores everything in **g**.
  - (e) Branded: `foodNutrients` amounts are **per 100 g/ml** and derived from the label, while `labelNutrients` are **per serving** (`servingSize` + `servingSizeUnit`, plus `householdServingFullText`).
  - (f) Branded data is US-market only and of no use for UAE barcodes.
  - (g) An FDC ID changes when a food is updated (new `fdcId` with `foodUpdateLog`), so store `(dataType, fdcId, publicationDate)`.
- **Recommendation:** **ADOPT Foundation, SR Legacy and FNDDS as the generic-food base** (CC0, no share-alike, so they can be freely merged into our proprietary DB). **Do not rely on Branded for the UAE**; it is optional for US imports.

## 8. UAE coverage measurement (raw numbers)

**A. Counts of products tagged `en:united-arab-emirates`:**

| Source | Count |
|---|---|
| OFF CSV export (`en.openfoodfacts.org.products.csv.gz`, Last-Modified 2026-10-28; 4,879,512 products in total) | **9,529** |
| `GET /api/v2/search?countries_tags_en=united-arab-emirates` (live MongoDB count) | **9,379** |
| `search.openfoodfacts.org` (search-a-licious ES index) | 4,064 (index is incomplete, see §1.11) |

**B. Completeness from the full CSV export.** Here "complete macros" means energy (kcal, kJ or generic `energy_100g`) **and** proteins **and** carbs **and** fat per 100 g are present. "All 3" means complete macros + `serving_quantity` + front image.

| Population | N | complete macros | `serving_quantity` | front image | nutrition image | ingredients_text | **all 3** | kJ-only (no kcal) | no energy |
|---|---|---|---|---|---|---|---|---|---|
| **UAE** | 9,529 | **51.8%** (4,938) | **36.0%** (3,428) | **73.0%** (6,955) | 29.9% (2,846) | 9.7% (921) | **17.4%** (1,658) | 0.18% (17) | 47.0% (4,477) |
| UAE, GS1 prefix 629 (UAE-registered barcodes) | 3,031 | 58.8% | 43.1% | 65.4% | – | – | 18.8% | – | – |
| UAE, GS1 628 (KSA barcodes) | 384 | 54.9% | 34.4% | 90.6% | – | – | 27.3% | – | – |
| **UAE, ≥5 unique scans** | 142 | **81.0%** | 60.6% | 97.2% | – | – | **56.3%** | – | – |
| UAE, ≥20 unique scans | 15 | 93.3% | 80.0% | 93.3% | – | – | 80.0% | – | – |
| KSA | 17,640 | 30.6% | 21.8% | 84.5% | 14.5% | 8.1% | 12.4% | 0.13% | 68.2% |
| Kuwait ∪ Qatar ∪ Oman ∪ Bahrain | 12,382 | 37.4% | 25.7% | 83.5% | 22.1% | 10.4% | 14.0% | 0.11% | 61.9% |
| World | 4,879,512 | 70.6% | 32.0% | 72.9% | 48.2% | 27.6% | 14.8% | 0.16% | 27.9% |

UAE quality signals:
- `data_quality_errors_tags` non-empty: 276 (2.9%).
- kcal vs 4P+4C+9F off by >25% (for kcal > 20): 179 of 4,700 checked (3.8%).
- kJ/kcal ratio far from 4.184: 212 products.
- Physically impossible per-100 g values (>950 kcal or >100 g): 13.
- `serving_quantity` > 1000: 5.
- Product name containing Arabic script: **81 (0.9%)**.
- Modified within the last 12 months: 4,755 (49.9%).

**C. v2 search page 1 (the 100 most popular UAE products by `popularity_key`):** complete macros 75, `serving_quantity` 53, front image 97, ingredients_text 47, any Arabic name or ingredients 22, kJ-only 0, all three 48. `image_nutrition_url` was not returned by search, so it was not measured there.

**D. Hand-picked UAE brand barcodes (22, found via search-a-licious with `brands:` + `countries_tags:"en:united-arab-emirates"`, then fetched with `GET /api/v2/product/{code}.json`; all 22 returned HTTP 200):**

| Barcode | Brand / product | kcal | P/C/F | serving_size → serving_quantity | front img | nutr img | Notes |
|---|---|---|---|---|---|---|---|
| 6281007040655 | Almarai yoghurt full fat | ✓ | ✓ | 170 g → 170 | ✓ | ✓ | **kJ 176 vs kcal 70.58 mismatch (DQ error)**; about 20 micronutrients entered as 0 |
| 6281007040235 | Almarai fresh milk | ✓ | **carbs missing** | 62.5ml → 62.5 | ✓ | ✓ | |
| 6281007055376 | Almarai apple juice | ✓ | ✓ | – | ✓ | ✓ | |
| 6281007031202 | Almarai cooking cream | ✓ | ✓ | 30 ml → 30 | ✓ | ✓ | |
| 6291100850044 | Al Ain water | ✓ (0) | ✓ (0) | – | ✓ | ✗ | legitimate zeros |
| 6291056060504 | Al Ain Farms yoghurt | ✓ | ✓ | – | ✓ | ✓ | |
| 6291056002474 | Al Ain Farms Greek yoghurt | ✓ | ✓ | 280.0g → 280 | ✗ | ✗ | |
| 6291056030507 | Al Ain Farms fresh milk | ✗ | ✗ | – | ✓ | ✗ | no nutrition at all |
| 6291030201022 | Al Rawabi low-fat milk | ✓ | ✓ | "1 portion (2000 ml)" → **2000** | ✓ | ✓ | serving = whole pack |
| 6291030108703 | Al Rawabi cheese triangle | ✗ | ✗ | – | ✓ | ✗ | no nutrition |
| 6281050829948 | Americana chicken burger | ✓ | ✓ | 100 g → 100 | ✗ | ✗ | |
| 6281050114280 | Americana nuggets | ✓ | ✓ | 100 g → 100 | ✓ | ✓ | |
| 6281050115034 | Americana beef meatball | ✓ | ✓ | 100 g → 100 | ✓ | ✓ | |
| 6271002118411 | KDD milk chocolate (drink) | ✓ | ✓ | 100ml → 100 | ✓ | ✓ | **83 kcal vs 1014.94 kJ (DQ error)**; per=100g but serving in ml |
| 6294003582036 | Nestlé Fitness granola | **✗ (kJ only: 1733)** | ✓ | – | ✓ | ✓ | |
| 6294003597849 | Nestlé KitKat Chunky Lotus | ✓ | ✓ | 1 serving (41.5 g) → 41.5 | ✓ | ✗ | |
| 6291001000029 | Masafi | ✓ | ✓ | – | ✓ | ✓ | only one with Arabic name and ingredients |
| 6291016000038 | Lacnor lemonade | ✓ | ✓ | 200ml → 200 | ✓ | ✓ | |
| 6291016011027 | Lacnor milk | ✓ | ✓ | "100g" → 100 | ✓ | ✓ | per=100ml but serving in g |
| 6291031000136 | Marmum milk | ✓ | ✓ | – | ✓ | ✓ | |
| 6291031002819 | Marmum protein choc milk | ✓ | ✓ | 300 ml → 300 | ✓ | ✓ | |
| 6291002150013 | Al Islami breaded chicken | ✓ | ✓ | 100 g → 100 | ✗ | ✗ | |

**Sample totals (n = 22):**

| Metric | Result |
|---|---|
| Complete energy + P/C/F | **19/22 (86%)** |
| kcal present | 19/22 |
| kJ-only | 1 |
| No nutrition at all | 2 |
| `serving_size` / `serving_quantity` | **14/22 (64%)** |
| Front image | **19/22 (86%)** |
| Nutrition-table image | 15/22 (68%) |
| Ingredients | 8/22 (36%) |
| Arabic ingredients | 1/22 |
| **All three (macros + serving_quantity + front image)** | **10/22 (45%)** |
| Data-quality errors | 2/22 |

This sample is biased toward products already in OFF and somewhat scanned. **The miss rate for real UAE shelf items, i.e. barcodes absent from OFF, is not measured**; that needs a store-shelf sample.

**E. Other measured behaviour:**
- Unknown barcode → v2 returns `{"status":0,"status_verbose":"product not found"}` with **HTTP 404**; v3 returns `{"status":"failure","result":{"id":"product_not_found"}}` with HTTP 404.
- `03017620422003` is normalised to `3017620422003`.
- Nutella (`3017620422003`) has **no top-level `serving_size`** in v2, even though its v3.6 `input_sets` contain a manufacturer per-serving set (`per_quantity: 15 g`). Do not rely on `serving_size` alone.

## 9. Importer field mapping

**Fetch:**
- **Mirror:** the JSONL dump (`https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz`, 13.3 GB, refreshed daily), the Parquet dump (`huggingface.co/datasets/openfoodfacts/product-database` `food.parquet`, 8.0 GB, where `nutriments` is a list of structs `{name, value, 100g, serving, unit, prepared_*}`), or the CSV (1.5 GB, `_100g` columns only, with no `_serving` and no `nutrition_data_per`).
- **Live lookup:** `GET https://world.openfoodfacts.org/api/v2/product/{barcode}.json?fields=code,product_name,product_name_en,product_name_ar,brands,quantity,product_quantity,product_quantity_unit,serving_size,serving_quantity,serving_quantity_unit,nutrition_data_per,nutrition_data_prepared_per,no_nutrition_data,nutriments,image_front_url,image_nutrition_url,image_ingredients_url,ingredients_text,ingredients_text_ar,countries_tags,data_quality_errors_tags,data_quality_warnings_tags,last_modified_t,rev,schema_version` with `User-Agent: MOO/<ver> (<contact email>)`.
- **Phase 2:** move to `/api/v3.6/product/{code}` and read `nutrition.input_sets[]` for per-set provenance.

**Legacy flat map (`nutriments`, API ≤ v3.4 / downgraded view).** All `_100g` values are per 100 g, or per 100 ml when `nutrition_data_per` is `100ml`.

| Our field | OFF key | Unit in OFF | Notes |
|---|---|---|---|
| energy_kcal_100 | `energy-kcal_100g` | kcal | if absent: `energy-kj_100g / 4.184`, flagged `derived:kj_to_kcal`; if only `energy_100g`, it is **kJ** (`energy_unit` = kJ) |
| energy_kj_100 | `energy-kj_100g` (else `energy_100g`) | kJ | |
| protein_g_100 | `proteins_100g` | g | |
| carbs_g_100 | `carbohydrates_100g` | g | EU/GCC labels give available carbs; US labels give total carbs incl. fibre (ambiguous by region) |
| sugars_g_100 | `sugars_100g` | g | |
| added_sugars_g_100 | `added-sugars_100g` | g | often estimated; see the `_modifier` and `nutriments_estimated` pitfalls below |
| fat_g_100 | `fat_100g` | g | |
| sat_fat_g_100 | `saturated-fat_100g` | g | |
| trans_fat_g_100 | `trans-fat_100g` | g | |
| fiber_g_100 | `fiber_100g` | g | |
| sodium_mg_100 | `sodium_100g × 1000` | **g** in OFF | `salt_100g ≈ sodium × 2.5`; OFF computes one from the other (`sodium_modifier: "~"`) |
| cholesterol_mg_100 | `cholesterol_100g × 1000` | g | |
| vitamins and minerals | `<nid>_100g` | **g** (e.g. vitamin-a 6.6e-05 g) | convert to mg/µg ourselves |
| per-serving value | `<nid>_serving` | same | present only if `serving_quantity > 0`; prefer recomputing from `_100g × serving_quantity / 100` |
| basis | `nutrition_data_per` ∈ `100g`, `100ml`, `serving` | | when `serving`, `_100g` is back-computed **only if `serving_quantity > 5`** (`ProductSchemaChanges.pm` L855) |
| prepared values | `<nid>_prepared_100g` + `nutrition_data_prepared_per` | | for powders and concentrates; keep separate and never mix with as-sold |
| serving_g_or_ml | `serving_quantity` (number) + `serving_quantity_unit` (`g` or `ml`) | | parsed from the free text `serving_size` by `normalize_serving_size`: the first `<num><unit>`, converted to g/ml. ml is **not** converted to g (no density) |
| package_size | `product_quantity` + `product_quantity_unit` | | parsed from `quantity` |
| modifiers | `<nid>_modifier` ∈ `<`, `~`, `>`, `-` | | `<` means an upper bound (e.g. "<0.5 g"); `~` means approximate or computed; `-` means **not specified on the label** (absent from the value maps) |

**New schema (v3.5+, `nutrition`):**
- `nutrition.input_sets[]`: each set has `{source: manufacturer|packaging|usda|estimate, preparation: as_sold|prepared, per: 100g|100ml|serving|1l|1kg, per_quantity, per_unit, nutrients: {nid: {value, value_string, unit, modifier, value_computed}}}`.
- `nutrition.aggregated_set`: `{preparation, per, nutrients: {nid: {value, unit, source, source_index, source_per, modifier}}}`.
- Import rule:
  1. Take the highest-priority set with `source ≠ estimate` and `preparation = as_sold`, at per `100g`/`100ml`.
  2. Fall back to its `serving` set together with `per_quantity`.
  3. Store estimate-sourced nutrients only with `provenance = off_estimate` and never show them as label facts.
  4. Keep `value_computed` (OFF's own Atwater and kJ cross-check) as a QA signal.

**Pitfalls the importer must handle:**
1. **Missing ≠ 0.** An absent key is unknown and must be stored as NULL. Never coerce to 0. A daily-total UI must show "incomplete" rather than summing NULLs as 0.
2. **Explicit 0 may be a placeholder.** Example: Almarai yoghurt has vitamins A, C, D, E and K, iron and zinc all at 0. Flag micronutrient zeros as `low_confidence` unless they come from the manufacturer source.
3. **kJ-only records:** 0.18% in the UAE (17), 0.16% worldwide. Derive kcal = kJ / 4.184 with a `derived` flag. Generic `energy_100g` is always kJ.
4. **kJ/kcal inconsistency:** 212 UAE products. Recompute 4P + 4C + 9F (+ 2 × fibre for EU labels, optionally) and flag products more than 25% off (3.8% of UAE products). Reject impossible per-100 g values.
5. **Serving semantics:**
   - `serving_quantity` can be the **whole pack** (Al Rawabi: 2000 ml).
   - It can be in **ml while the basis is per 100 g** (KDD), or in g while the basis is per 100 ml (Lacnor milk).
   - Clamp it to `product_quantity` and flag mismatched units.
   - When g and ml are mixed, treat density as 1 only with a flag.
6. **Basis:** honour `nutrition_data_per`, `100ml` vs `100g`. For liquids, our portion picker must work in ml.
7. **Prepared vs as-sold:** the aggregated set prefers *prepared* values, so check `preparation` explicitly.
8. **Estimates:** `nutriments_estimated` (v2), or `source: "estimate"` (v3.5+), are ingredient-based guesses (CIQUAL). Exclude them by default.
9. **Barcodes:**
   - Normalise like OFF does: digits only; pad 9–12-digit codes to 13; keep 8-digit codes at 8.
   - Validate the check digit.
   - Handle GS1 DataMatrix and Digital Link (the server's `normalize_code_with_gs1_ai`).
   - Treat in-store variable-weight codes (prefix 2x) as non-lookups.
10. **Language:** UAE records are 99% non-Arabic. Store per-language name and ingredient fields (`product_name_ar`, `ingredients_text_ar`) and fall back to `en`.
11. **Polymorphism:** `brands` is a string in the API but a list in search-a-licious; `serving_quantity` is a number in the API but a string in Parquet.
12. **Provenance:** store `code`, `rev` and `last_modified_t`, and re-fetch when the delta files show changes.

**USDA FDC → our fields (per 100 g):**

| Our field | Nutrient ID |
|---|---|
| Energy (kcal) | 1008, else 2048, else 2047 |
| Energy (kJ) | 1062 |
| Protein | 1003 |
| Carbohydrate | 1005 (by difference), else 1050 |
| Fat | 1004, else 1085 |
| Saturated fat | 1258 |
| Total sugars | 2000 |
| Fibre | 1079 |
| Sodium | 1093 (mg) |
| Cholesterol | 1253 (mg) |

IDs other than 1003/1004/1005/1008/1050/1085/2047/2048 come from FDC's standard nutrient table and were not re-verified against `nutrient.csv` here. Portions come from `foodPortions[].gramWeight` plus `measureUnit` and `modifier`.

## 10. Recommended combination: OFF + USDA + user foods, with provenance

1. **Storage (PostgreSQL):**
   - `src_off.product` holds the unmodified OFF rows (JSONB raw plus extracted columns), refreshed from the daily dump and deltas. Keep it **physically separate** to manage ODbL share-alike.
   - `src_fdc.food` holds FDC (CC0) data and may be merged freely.
   - `app.food` is our canonical food entity.
   - `app.food_source_link(food_id, source ∈ {off, fdc_foundation, fdc_sr_legacy, fdc_fndds, fdc_branded, user, moo_curated, ai_label_ocr, ai_photo_estimate}, source_id, source_version, license ∈ {ODbL/DbCL, CC0, user-private, proprietary}, fetched_at)`.
2. **Nutrient values table:** `app.food_nutrient(food_id, nutrient_code, amount NULLABLE, unit, basis ∈ {100g, 100ml, serving}, preparation, provenance_source, provenance_detail (e.g. "off:packaging", "off:estimate", "fdc:2048", "derived:kj_to_kcal"), confidence, qa_flags[])`. A NULL amount means unknown.
3. **Log entries snapshot the nutrient values** at log time, together with `food_source_link` and version, so later OFF edits do not rewrite history.
4. **Resolution order:**
   - **Barcode:** our user/curated overlay first, then the OFF mirror (non-estimate sets), then the live OFF API on a miss.
   - **Not found:** prompt a label-photo capture, then our own OCR+LLM extraction (`ai_label_ocr`, which must pass QA rules and be user-confirmed). Optionally contribute it to OFF with the user's consent; uploaded photos become CC-BY-SA.
   - **Generic or homemade foods and recipes:** FDC Foundation, then SR Legacy, then FNDDS (FNDDS for portions).
   - **Regional dishes** (machboos, harees, shawarma, hummus, labneh, ...): a `moo_curated` table built from FDC ingredients with recipe yields. FDC lacks most Gulf dishes (unverified, needs a check).
   - **Photo estimate:** `ai_photo_estimate` with explicit low confidence, editable by the user.
5. **User custom foods** are private by default (licence `user-private`), so they never enter any database that is publicly redistributed.
6. **Attribution UI:** a per-food "Source: Open Food Facts (ODbL)" or "USDA FoodData Central" line, image credits for OFF images, and an about/licences page.
7. **Legal to-dos:** an ODbL derivative-database analysis for our overlay model; whether CC-BY-SA image caching is acceptable; whether outputs of NC models (Robotoff) may be used; and the OFF API usage form.

## 11. Summary table

| Item | Version (measured) | Last activity / 12-mo commits | Code licence | Data / model licence | Recommendation |
|---|---|---|---|---|---|
| openfoodfacts-server | v2.117.0 (2026-10-28) | 2026-10-28 / 1,771 | AGPL-3.0 | ODbL + DbCL; images CC-BY-SA 3.0 | **ADOPT data and API** (mirror + live fallback); REJECT code |
| openfoodfacts-dart | v3.31.1 (2026-10-19) | 2026-10-20 / 95 | Apache-2.0 | – | ADOPT if Flutter; otherwise **REFERENCE** (use `@openfoodfacts/openfoodfacts-nodejs`, Apache-2.0, alpha, for TS) |
| openfoodfacts-androidapp | v3.10.2 (2023-04-06) | 2026-09-22 / 82 (70 bot) | Apache-2.0 | ML Kit under Google terms | **REFERENCE** (scan UX only) |
| openfoodfacts-ios | 3.4.4 (date unverified) | 2023-09-05 / 0; **archived 2023-09-05** | Apache-2.0 | – | **REJECT** |
| robotoff | v1.85.14 (2026-10-20) | 2026-10-26 / 136 | AGPL-3.0-only | nutrition-extractor **CC-BY-NC-SA-4.0**; YOLO/NER models AGPL-3.0 | **REFERENCE** architecture; REJECT code and models |
| foodvision-bench | 0.3.6 claimed / tag v0.2.1 | 2026-10-01 / 51 (49 from one pseudonym) | MIT | dataset unpublished | **REJECT** |
| USDA FDC | release 2026-10-29 | semi-annual | – | **CC0** | **ADOPT** Foundation, SR Legacy, FNDDS; Branded is US-only (36 UAE GTINs of 2.01 M) |

**Unverified items:** the SR Legacy food count; the FNDDS 2025+ release; the Robotoff training-dataset licences; whether NC licences extend to API outputs; the Android test coverage; the release date of the iOS 3.4.4 tag; how many real UAE shelf barcodes are missing from OFF; the FDC nutrient IDs beyond those listed as verified; and Gulf-dish coverage in FDC.
