# Repository evaluation and licensing decisions

A summary of the due diligence in `docs/research/01–04`, which hold each repository's full 14-point evaluation: purpose, activity, licence, data licence, architecture, quality, tests, security, fit, effort, risks, alternatives, reusable parts and recommendation. All facts were checked on 2026-10-28/29.

**Classification:**
- **ADOPT:** used as a dependency or data source.
- **ADAPT:** permissively licensed code we may modify and embed, keeping its notice.
- **REFERENCE:** studied for design only; no code or data copied.
- **REJECT:** not used.

**Licensing rule applied throughout:** no GPL, AGPL, non-commercial or "source-available" code, and no share-alike data, enters the proprietary codebase. ODbL data (Open Food Facts) is used as a separable, attributed database.

## Decision matrix

| # | Repository | Code licence | Data licence | Classification | What Stoke takes from it |
| --- | --- | --- | --- | --- | --- |
| 1 | CodeWithCJ/SparkyFitness | Custom non-commercial, source-available | – | **REJECT** | Nothing. The licence forbids commercial derivative use. |
| 2 | simonoppowa/OpenNutriTracker | GPL-3.0 | FDC CC0; BLS/INDB CC BY 4.0 | **REFERENCE** | Design ideas only: offline diary, a canonical per-100 g nutrient vector. |
| 3 | wger-project/wger | AGPL-3.0+ | Exercises mostly CC BY-SA | **REFERENCE** | Progression and routine concepts. Exercise data **not** imported (share-alike); Stoke wrote its own catalogue. |
| 4 | Snouzy/workout-cool | MIT | None stated | **REFERENCE** | Nothing copied. Its training engine is too thin to base ours on. |
| 5 | wger-project/flutter | AGPL-3.0+ (store exception) | Per entry | **REFERENCE** | Gym-mode interaction and offline-first sync shape. |
| 6 | openfoodfacts/openfoodfacts-server | AGPL-3.0 | ODbL + DbCL; images CC BY-SA | **ADOPT data and API; REJECT code** | Live barcode lookup with attribution. Products stored with source and id. |
| 7 | openfoodfacts/openfoodfacts-dart | Apache-2.0 | – | **REFERENCE** | Field semantics. Stoke calls the REST API directly from TypeScript. |
| 8 | openfoodfacts/openfoodfacts-androidapp | Apache-2.0 | – | **REFERENCE** | Scan-flow UX: continuous scan, quick-view card, "add missing product". |
| 9 | openfoodfacts/openfoodfacts-ios | Apache-2.0 (archived 2023) | – | **REJECT** | Nothing. Archived; Expo's camera covers scanning. |
| 10 | openfoodfacts/robotoff | AGPL-3.0 | Models AGPL / CC BY-NC-SA | **REFERENCE** (architecture) | The idea of separate prediction stages with human confirmation. No code or models. |
| 11 | foodvision-bench | MIT | Dataset unpublished | **REJECT** | Nothing. No data, hard-coded vendor scores. |
| 12 | mealie-recipes/mealie | AGPL-3.0 | – | **REFERENCE** | Meal-plan rules, shopping-list merge, ingredient-parser fallback chain. |
| 13 | TandoorRecipes/recipes | AGPL-3.0 + Commons Clause | – | **REFERENCE** | Nutrition-from-ingredients modelling concepts. |
| 14 | google-ai-edge/mediapipe | Apache-2.0 (Pose Landmarker models Apache-2.0) | – | **ADOPT** | Pose Landmarker (tasks-vision 1.1.1, lite model) runs in a shared page: WebView on device, iframe on web (ADR-11). Analysis runs on the device. |
| 15 | stevenzchen/pose-trainer | GPL-3.0 (+ OpenPose non-commercial) | – | **REFERENCE** | The paper's method: explainable angle and threshold rules. Re-implemented from scratch. |
| 16 | exercemus/exercises | MIT code | Per-record, mostly unlabelled; includes CC BY-SA | **REJECT** (as a dataset) | Taxonomy ideas only. |
| 17 | expo/expo (SDK 58) | MIT | – | **ADOPT** | App framework, Router, camera, audio, SQLite, notifications. |
| 18 | TanStack/query v5 | MIT | – | **ADOPT** | Server state, persisted cache, online manager. |
| 19 | N0ku/react-native-nitro-healthkit | MIT | – | **REJECT** | Single maintainer, dormant, broken write auth. Replaced by `@kingstinct/react-native-healthkit` (MIT, ADOPT). |
| 20 | appeeky/expo-healthkit | PolyForm Shield (non-OSS) | – | **REFERENCE** only | Nothing. Non-compete licence. |
| 21 | matinzd/react-native-health-connect | MIT | – | **ADOPT** | Android Health Connect reads. |
| 22 | juliansteenbakker/mobile_scanner | BSD-3 (Flutter) | – | **REFERENCE** | Wrong stack. Expo `CameraView` barcode scanning is used instead. |
| 23 | openai/whisper | MIT (code and weights) | – | **REFERENCE** | Served through a whisper.cpp server or a hosted API, behind the speech seam. |
| 24 | ggml-org/whisper.cpp | MIT | – | **REFERENCE** (engine) | The server's `/inference` contract is implemented and tested against a stub. |

### Additional sources evaluated
| Source | Licence | Classification | Use |
| --- | --- | --- | --- |
| USDA FoodData Central (Foundation, SR Legacy, FNDDS) | CC0 | **ADOPT** | Generic food base. SR Legacy is bulk-imported (7,793 foods). Branded is US-centric (36 UAE GTINs of 2.01 M) and is not relied on. |
| @kingstinct/react-native-healthkit | MIT | **ADOPT** | iOS HealthKit reads with anchored queries. |
| react-native-vision-camera v5 | MIT | **REFERENCE / fallback** | Only if `CameraView` scanning proves insufficient. |
| expo-speech-recognition | MIT | **ADOPT (optional)** | On-device dictation fallback. Not yet wired. |
| whisper.rn | MIT | **ADAPT (later)** | On-device transcription, if server STT is unavailable. |
| wger exercise data | CC BY-SA 3.0/4.0 (some CC0) | **Not used** | The research suggested it as attributed seed data. Stoke chose an original catalogue to keep the dataset free of share-alike obligations (ADR-9). |

## Notable findings that shaped the build
- **Open Food Facts in the UAE.** About 9,500 products; 51.8% have complete macros. Anonymous search is unreliable (about 10 requests/minute, frequent 503s), but product reads by barcode work (about 15/minute). Stoke therefore uses barcode lookup live, searches its local catalogue first, and caches products.
- **OFF data quality.**
  - Energy can be present only as kJ; Stoke converts it and flags it.
  - Sodium is stored in grams; Stoke converts it to mg.
  - Serving units sometimes contradict the per-100 basis; such servings are dropped.

  All three behaviours are tested against real recorded responses.
- **Health libraries.** The obvious HealthKit choices were either dormant or non-OSS. `@kingstinct/react-native-healthkit` was the maintained MIT option.
- **Voice.** On-device Whisper is possible, but a phase-1 private app is simpler with server-side transcription behind a seam.
