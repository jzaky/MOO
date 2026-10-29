# 04 — Mobile platform, health integrations, barcode & voice (technical due diligence)

Audit date: **2026-10-29**. Target: proprietary, future-commercial SaaS, AI-native fitness & nutrition app, iPhone-first, Android designed in, Expo/React Native + TypeScript.

How this was measured: source and package metadata, not READMEs alone. `npm view` (registry), `api.npmjs.org/downloads/point/last-month` (window 2026-09-28 → 2026-10-27), `npm pack expo@58.0.21` (its `bundledNativeModules.json` is the source of truth for SDK-compatible versions), shallow `git clone --filter=blob:none --shallow-since=…` to count commits and authors, plus grep and reads of native Swift/Kotlin code. GitHub REST API was unavailable, so star counts are **not reported**. "Authors" means unique commit e-mails in the window. Anything not verified by code or registry data is marked **(unverified)**.

---

## 0. Headline facts (verified)

| Item | Value | Source |
|---|---|---|
| Expo SDK | **58** (`expo@58.0.21`, npm `latest`; SDK 58.0.0 published 2026-09-29) | npm dist-tags / time |
| React Native pinned | **0.88.1** | `expo@58.0.21/bundledNativeModules.json` |
| React pinned | **19.3.0** (npm latest is 19.3.1; stay on 19.3.0) | same |
| expo-router | **~58.0.28** | same |
| expo-camera | **~58.0.14** | same |
| expo-sqlite | **~58.0.14** (vendors SQLite **3.53.3** + SQLCipher) | same + `vendor/sqlite3/sqlite3.h` |
| react-native-reanimated | **4.7.1** (+ `react-native-worklets` 0.13.0) | same |
| @tanstack/react-query | **not in bundledNativeModules** (pure JS); latest **5.105.0** (2026-10-26) | npm |
| Template defaults | TypeScript ~6.0.3, `@types/react` ~19.3.0, `experiments.typedRoutes` + `reactCompiler` = true | `templates/expo-template-default` |
| iOS min (camera module) | iOS **16.4** | `ExpoCamera.podspec` |

---

## 17. expo/expo (SDK 58)

1. **Purpose**: An RN framework and SDK. It provides managed native modules, a config-plugin/prebuild (CNG) system, Expo Router, EAS build/update, and the Expo Modules API for writing native modules.
2. **Latest version**: `expo@58.0.21` (latest; `next`=58.0.11; previous lines sdk-57 57.0.31, sdk-56 56.0.24). Pins RN 0.88.1 / React 19.3.0. Per-module bundled versions (from the tarball): expo-router ~58.0.28, expo-camera ~58.0.14, expo-sqlite ~58.0.14, expo-secure-store ~58.0.2, expo-notifications ~58.1.7, expo-haptics ~58.0.7, expo-background-task ~58.0.11, expo-image-manipulator ~58.0.16, expo-audio ~58.0.10, expo-modules-core ~58.0.28, expo-dev-client ~58.0.17.
3. **Last meaningful maintenance (measured)**: `main` HEAD 2026-10-29. **2,330 commits by 287 authors in the last 90 days** (bare tree-less clone since 2026-07-29). The SDK cadence is roughly quarterly: 56 on 2026-05-20, 57 on 2026-06-30, 58 on 2026-09-29. npm `expo` was modified 2026-10-28.
4. **License**: MIT (repo and every audited package). The template is 0BSD.
5. **Commercial-use considerations**: There is no copyleft. EAS (cloud build, update, submit) is a paid, optional service, and local builds (`expo prebuild` + Xcode/Gradle) avoid lock-in. Expo Go is a dev tool only; production ships as your own binary.
6. **Tech stack**: TypeScript/JS, Swift (iOS), Kotlin (Android), C++ JSI. CocoaPods, plus new SwiftPM support (`Package.swift` in the `expo` package; the 58.0.17/18 changelog covers the SwiftPM plugin and precompiled XCFrameworks).
7. **Key dependencies**: react-native 0.88.1, react 19.3.0, `@expo/cli` ^58.1.17, `expo-modules-core`, `expo-modules-autolinking`, `@expo/metro-config`, `babel-preset-expo`. Android camera uses CameraX 1.6.0 plus ML Kit `barcode-scanning:17.3.0` (bundled model). iOS camera uses AVFoundation plus an optional ZXingObjC companion pod.
8. **Security concerns**:
   - `expo-secure-store` wraps the Keychain and Android Keystore-backed storage. It supports `requireAuthentication` (biometric) and `keychainAccessible` (default `WHEN_UNLOCKED`; prefer `*_THIS_DEVICE_ONLY` for refresh tokens).
   - `expo-sqlite` supports SQLCipher (`useSQLCipher` plugin flag) for at-rest encryption of the health/food log. Recommended, because the data is health data.
   - OTA updates (`expo-updates`) need code-signing enabled to prevent update tampering. This is configuration, not verified here.
   - libSQL support was **removed**: the plugin warns that `useLibSQL` "no longer has any effect".
9. **Relevant components (verified in source)**:
   - **New Architecture**: mandatory. `expo-modules-core` 55.0.0 (2026-01-21) changelog says "[Android] Drop support for legacy architecture". `expo` 58.0.0-preview.0 says "dropping the legacy architecture (bridge)… RN 0.87+". Plan as New-Arch-only (Fabric/TurboModules/JSI); old-bridge-only libraries are a risk.
   - **expo-router** ~58.0.28: file-based routing, typed routes enabled in the template. ⚠ 58.0.26 shipped a **breaking change in a patch release** (`unstable_settings.anchor` behaviour, PR #51992), so pin exact versions and read changelogs on bumps.
   - **expo-camera** `CameraView`. `BarcodeType` includes `ean13`, `ean8`, `upc_a`, `upc_e`, `code128`, `qr` and more.
     - iOS uses `AVCaptureMetadataOutput`. `upc_a` is mapped to `AVMetadataObject.ObjectType.ean13` (iOS has no UPC-A type), and `normalizeBarcodeValue` strips the leading `0`. A UPC-A scan on iOS therefore returns **type `ean13` with 12 digits**. Unit tests cover this (`BarcodeScannerUtilsTests.swift`).
     - Android uses ML Kit `Barcode.FORMAT_EAN_13` / `FORMAT_UPC_A`, mapped 1:1.
     - iOS 16+ VisionKit `DataScanner` modal path (`visionDataScannerObjectToDictionary`).
     - ZXing fallback is only for pdf417, code39 and codabar.
     - Can be disabled with `barcodeScannerEnabled:false` to save size.
     - Recent fixes, which show the code is maintained but has also had bugs: Android ML Kit scanner leak, iOS scanner/session leak on every mount (#49692).
   - **expo-sqlite** ~58.0.14: async and sync API, `useSQLiteContext`/hooks, `withExclusiveTransactionAsync`, `serializeAsync`. **Session extension** (`createSessionAsync`, changesets) is useful for sync/outbox. Also `loadExtensionAsync`, FTS (`enableFTS`), SQLCipher, and `expo-sqlite/kv-store` (an AsyncStorage-compatible KV). **Drizzle**: `drizzle-orm@0.45.4` ships a `drizzle-orm/expo-sqlite` driver (verified in the tarball) and declares the peer `expo-sqlite >=14.0.0`. There is also a `expo-drizzle-studio-plugin` (0.2.1). drizzle 1.0 is at `rc.5` (not stable).
   - **expo-secure-store** ~58.0.2: see item 8. It holds small secrets only; the size limit is not verified here. Use SQLite + SQLCipher with a key stored in SecureStore for bulk data.
   - **expo-notifications** ~58.1.7: local notifications plus APNs/FCM push. Verified string: "Push notifications (remote notifications) are unavailable in Expo Go on Android since SDK 53", so a dev build is required.
   - **expo-haptics** ~58.0.7: `impactAsync`, `notificationAsync`, `selectionAsync`, `performAndroidHapticsAsync`.
   - **expo-background-task** ~58.0.11: iOS `BGProcessingTaskRequest` with `requiresNetworkConnectivity = true`; Android WorkManager. `minimumInterval` defaults to 12 h, minimum 15 min. The docs say iOS "typically runs background tasks during specific windows, such as overnight". It is **not** a reliable trigger for health sync. Use HealthKit background delivery (HKObserverQuery) for that.
   - **expo-image-manipulator** ~58.0.16: contextual `ImageManipulator.manipulate(uri)` / `useImageManipulator`, resize, crop and rotate, `SaveFormat.JPEG|PNG|WEBP`, `compress` 0–1. Good enough to downscale meal photos (for example to 1024 px long edge, JPEG 0.7) before LLM upload.
   - **expo-audio** ~58.0.10: `useAudioRecorder` with presets (HIGH_QUALITY = m4a/AAC 44.1 kHz). LINEARPCM is available on iOS. New **`AudioStream` / `useAudioStream`** gives raw PCM buffers (float32/int16, configurable sampleRate, mono default) plus `startFileRecordingAsync` (WAV/PCM). This can feed on-device ASR (whisper.rn) or a streaming upload without an extra native audio library.
   - **Expo Modules API** (expo-modules-core ~58.0.28): Swift/Kotlin DSL (`Module { Name; Function; AsyncFunction; Events; View }`), config plugins for entitlements and Info.plist, and `expo-module-template` for scaffolding. Use it for any custom native glue (for example a thin HealthKit nutrition-correlation writer if a library gap appears).
   - **Dev builds vs Expo Go**: Expo Go runs only the current SDK and only Expo-bundled native code. HealthKit (entitlement + `NSHealthShareUsageDescription`), Health Connect, Nitro modules (kingstinct, vision-camera v5), whisper.rn, Android push and SQLCipher all need a **development build** (`expo-dev-client` ~58.0.17 + `expo prebuild`/EAS). Decide on dev-build-only from day 1.
10. **Reuse difficulty**: Low (it is the platform).
11. **Integration risks**:
    - Quarterly SDK majors, each bumping RN, so plan one upgrade per quarter.
    - Breaking changes in patch releases (expo-router 58.0.26).
    - Third-party Nitro/TurboModule libraries lag RN majors. Examples: kingstinct devDeps RN 0.81.5, react-native-health-connect devDeps RN 0.86.2, versus 0.88.1 here. Each needs a build spike.
    - iOS background-task scheduling is opportunistic.
12. **Test quality**: Per-package Jest tests (48 `__tests__` TS files across the audited packages), native unit tests (62 `*Tests.swift`/`*Test.kt`), and Swift Testing for camera barcode normalization. There is large CI; not individually inspected.
13. **Maintenance outlook**: Excellent: a company-backed team with very high commit velocity.
14. **Final recommendation: ADOPT**. Use Expo SDK 58 and dev builds only. Use CNG/prebuild (do not commit `ios/` and `android/`). Pin with `npx expo install` and run `npx expo install --check` in CI.

---

## 18. TanStack/query (v5)

1. **Purpose**: Async server-state cache: queries, mutations, caching, retries, persistence.
2. **Latest version**: `@tanstack/react-query@5.105.0` (2026-10-26); dist-tags have no v6 prerelease (`previous`=4.44.0). The companion packages `@tanstack/react-query-persist-client`, `@tanstack/query-async-storage-persister` and `@tanstack/query-sync-storage-persister` are all 5.105.0.
3. **Last meaningful maintenance (measured)**: HEAD 2026-10-29. **1,699 commits since 2026-01-01** (1,042 since 2026-07-29), 149 authors. ⚠ The commits are concentrated: one contributor (Wonsuk Choi) has 1,278 commits in 2026, mostly tests and refactors (inferred from subjects); the core maintainer (Dominik Dorfmeister) has 44. Version bumps are automated.
4. **License**: MIT.
5. **Commercial-use considerations**: None. Devtools are optional.
6. **Tech stack**: TypeScript; framework-agnostic `query-core` plus adapters.
7. **Key dependencies**: `@tanstack/query-core` only; peer `react ^18 || ^19` (compatible with 19.3.0).
8. **Security concerns**:
   - A persisted cache is written in plaintext by default (AsyncStorage / the KV store). Do not persist PII or health payloads unencrypted. Use `dehydrateOptions.shouldDehydrateQuery` to allow-list, or persist into a SQLCipher DB.
   - Use a `buster` (app version or schema) and `maxAge` (both verified in `persist.ts`).
9. **Relevant components (verified)**:
   - `onlineManager.setEventListener` and `focusManager.setEventListener`. The RN docs page shows `@react-native-community/netinfo` **and** `expo-network` variants plus `AppState`.
   - `networkMode` (`online`/`always`/`offlineFirst`).
   - Optimistic updates via `onMutate` + `context.client.cancelQueries`.
   - Offline mutations: paused mutations persist, then `queryClient.resumePausedMutations()` after restore (in `PersistQueryClientProvider` `onSuccess`). This **requires `setMutationDefaults([key], { mutationFn })`**, because functions are not serializable (docs/guides/mutations.md lines 295–372).
10. **Reuse difficulty**: Low.
11. **Integration risks**:
    - It is not a sync engine. There is no conflict resolution, and mutation replay is FIFO in memory or the persisted cache.
    - For the food/workout log, treat **SQLite (Drizzle) as the source of truth with an explicit outbox table**, and use TanStack Query for server reads and for driving outbox flushes. Do not use the persisted mutation cache as the durable queue.
12. **Test quality**: Strong: 46 test files in core, react and persist-core alone, plus type tests (`*.test-d.tsx`).
13. **Maintenance outlook**: Excellent: v5 is stable and long-lived, with near-daily releases.
14. **Final recommendation: ADOPT** `@tanstack/react-query@5.105.0` + `@tanstack/react-query-persist-client` + `@tanstack/query-async-storage-persister@5.105.0`. The persister's storage can be `expo-sqlite/kv-store` or `@react-native-async-storage/async-storage@2.2.0` (the SDK-bundled version; npm latest 3.1.1 is **not** the SDK pin).

---

## 19. N0ku/react-native-nitro-healthkit

1. **Purpose**: Nitro-module wrapper that claims HealthKit (iOS) and Health Connect (Android) read/write, observers and background sync.
2. **Latest version**: `react-native-nitro-healthkit@1.0.0`, the **only** version ever published (2026-06-16).
3. **Last meaningful maintenance (measured)**: **8 commits total, 1 author**, from 2026-05-28 ("transfert from the organisation to a public repo") to 2026-06-16. Nothing in the 4.5 months since. **885 downloads/month**.
4. **License**: MIT (© 2026 N0ku).
5. **Commercial-use considerations**: The license is fine. The bus factor is 1 and there is no track record.
6. **Tech stack**: Nitro Modules (nitrogen-generated C++/Swift/Kotlin), Swift (≈2.9k LOC native total), Kotlin. Uses `androidx.health.connect:connect-client:1.1.0-alpha12` (an **alpha**; stable 1.1.0 exists).
7. **Key dependencies**: peer `react-native-nitro-modules >=0.30.0`, react/react-native `*`.
8. **Security concerns**:
   - The built-in `registerBackgroundSync` stores `apiBaseUrl` + **JWT** in the Keychain / EncryptedSharedPreferences and POSTs health data from native code (`HealthKitBackgroundSync.swift`, `URLSession` with a `Bearer` header). This is an opaque exfiltration path that bypasses your app's auth refresh, logging and consent logic.
   - `seedTestHealthData` (writes fake samples) is guarded by `#if DEBUG` on iOS.
   - It logs with NSLog.
9. **Relevant components / API coverage (verified in `HealthKit.nitro.ts` + Swift)**:
   - Reads: quantity, category, aggregated, workouts. Writes: `writeQuantityData`, `writeCategoryData`.
   - Observers: HKObserverQuery + `enableBackgroundDelivery(.immediate)`, with `HKAnchoredObjectQuery` internally.
   - **Defects**:
     - `requestAuthorization()` takes no arguments and calls `requestAuthorization(toShare: [], read: readTypes)`. **No write scopes are ever requested, so writes cannot be authorized.**
     - Only `DIETARY_ENERGY_CONSUMED` is present for nutrition (no protein, carbs, fat or micros; 7 "Dietary" mentions total in `HealthKitTypes.swift`).
     - Workout activity names (RUNNING, PILATES…) are declared as fake `HKQuantityTypeIdentifier…` strings.
     - There is no anchor exposed to JS for incremental sync (the observer callback returns a token string only).
10. **Reuse difficulty**: Medium–high (you would have to fork and fix).
11. **Integration risks**: High. Writes are broken, nutrition coverage is missing, an alpha HC client is used, it is abandoned after release, and Nitro version drift.
12. **Test quality**: Jest with mocks: 36 cases (14 + 22). Kotlin unit tests for mappers and cache. CI runs typecheck, jest and an Android Gradle test. No iOS native tests.
13. **Maintenance outlook**: Poor (single dev, dormant).
14. **Final recommendation: REJECT** (at most REFERENCE for its iOS observer and anchored-query pattern). It cannot request write permission and lacks the dietary types a nutrition app needs.

---

## 20. appeeky/expo-healthkit (`@appeeky/expo-healthkit`)

1. **Purpose**: Expo-Modules-API library for HealthKit **and** Health Connect, with one cross-platform API.
2. **Latest version**: `@appeeky/expo-healthkit@0.4.2` (2026-10-26). 8 versions since it was created on 2026-09-05.
3. **Last meaningful maintenance (measured)**: 20 commits, 5 authors, 2026-09-05 → 2026-10-27, with active feature PRs (anchored paging on Android, background delivery before JS starts). **6,192 downloads/month**.
4. **License**: ⚠ **PolyForm Shield 1.0.0** (npm says "SEE LICENSE IN LICENSE"). It is **not OSI open source**. Its "Noncompete" clause allows any purpose "except for providing any product that competes with the software or any product the licensor or any of its affiliates provides using the software". The "New Products" clause says that if the licensor later ships a competing product, you lose rights to **later versions**.
5. **Commercial-use considerations**: For a proprietary commercial fitness app, the licensor (Erencan Arica / appeeky) could create a conflict at any time by shipping a health or fitness app that uses the SDK. Using it needs legal sign-off and carries an ongoing risk. **Disqualifying for a core dependency.**
6. **Tech stack**: Expo Modules API (Swift ≈ and Kotlin, 2,165 LOC native), TypeScript, a config plugin, semantic-release.
7. **Key dependencies**: peer `expo >=53`. Health Connect client version not inspected.
8. **Security concerns**: Ships `PrivacyInfo.xcprivacy` (good). The library is young and has had no external audit.
9. **Relevant components (verified exports)**:
   - Queries: quantity, category, workouts, ECG, activity summaries, clinical records, audiograms, workout routes, correlations, heartbeat series, statistics and statistics collection, `queryAnchored`.
   - Writes: `saveQuantitySample`, `saveCategorySample`, `saveWorkout`, `saveCorrelation` (food).
   - `deleteObjects`, `enableBackgroundDelivery`, `observe`, `useHealthKitUpdates`.
   - Android maps `HKFoodType` → `NutritionRecord.name`.
   - This is the best-designed **cross-platform** API surface audited.
10. **Reuse difficulty**: Low technically. High legally.
11. **Integration risks**: The license, 0.x churn, and a two-month-old project.
12. **Test quality**: 5 Jest files (dates, errors, identifiers, index, plugin). No native tests.
13. **Maintenance outlook**: Currently active, but too young to judge.
14. **Final recommendation: REFERENCE only (REJECT as a dependency)**. Its unified API is a good model for our own `HealthAdapter` interface, but do not copy its code: PolyForm also covers derivative works.

---

## 21. matinzd/react-native-health-connect

1. **Purpose**: An RN binding for Android **Health Connect** (`androidx.health.connect`).
2. **Latest version**: `react-native-health-connect@4.1.3` (2026-08-06). 48 versions since 2022.
3. **Last meaningful maintenance (measured)**: last commit 2026-08-26 (replaced deprecated `TurboReactPackage`). **48 commits since 2025-01-01, 37 since 2026-04-29, 18 authors**. **820,477 downloads/month**.
4. **License**: MIT.
5. **Commercial-use considerations**: None from the license. Google Play requires the Health Connect permissions declaration and a privacy policy (policy detail **unverified** here).
6. **Tech stack**: Kotlin TurboModule plus an Expo module (`android-expo/`) that registers the permission-rationale delegate, and a JS config plugin (`app.plugin.js`, via `@expo/config-plugins`).
7. **Key dependencies**: `androidx.health.connect:connect-client:1.1.0` (stable; bumped in 4.1.0), minSdk 26, compileSdk 35 defaults. Peers: `expo *`, `@expo/config-plugins >=6.0.2`.
8. **Security concerns**: Standard. Request the minimum record types. Background read (`PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND`) and history (`READ_HEALTH_DATA_HISTORY`, beyond 30 days) are separate opt-in permissions (verified in `PermissionUtils.kt`).
9. **Relevant components (verified exports)**: `initialize`, `getSdkStatus`, `requestPermission`, `getGrantedPermissions`, `revokeAllPermissions`, `readRecords`, `readRecord`, `insertRecords`, `deleteRecordsByUuids`, `deleteRecordsByTimeRange`, `aggregateRecord`, `aggregateGroupByDuration`, `aggregateGroupByPeriod`, **`getChanges`** (change tokens, the Health Connect equivalent of anchors), `requestExerciseRoute`, `openHealthConnectSettings`, `openHealthConnectDataManagement`. Supports Nutrition records and `MealType`, plus `ExerciseType`, `ExerciseSegmentType` and MindfulnessSession. **Expo config plugin built in since v4.** The separate `expo-health-connect` package is deprecated and archived, as its own README says.
10. **Reuse difficulty**: Low.
11. **Integration risks**:
    - Its devDeps test against RN 0.86.2, not 0.88.1, so build verification is needed (**unverified on SDK 58**).
    - Health Connect is a system app on Android 14+ and an installable APK on Android 13 and below; `getSdkStatus` handles this.
    - There is no background executor in the library. Schedule `getChanges` from expo-background-task/WorkManager.
12. **Test quality**: ⚠ **No test files found.** CI runs `ci.yml` (lint, typecheck, build — assumed from the name, not opened in detail). The example and example-expo apps serve as manual testing.
13. **Maintenance outlook**: Good. It is the de-facto standard, many contributors, regular releases. Bus factor is moderate (matinzd).
14. **Final recommendation: ADOPT** as the single Health Connect library. Do not install `expo-health-connect`.

---

## 21a. kingstinct/react-native-healthkit (`@kingstinct/react-native-healthkit`) — leading HealthKit alternative

1. **Purpose**: Comprehensive, type-safe HealthKit bindings (iOS and visionOS) built on Nitro Modules.
2. **Latest version**: `16.2.0` (2026-10-12). 16.0.0 was 2026-09-18 and 16.1.0 was 2026-10-07. The monorepo also has `@react-native-healthkit/core` 16.2.0 and `@react-native-healthkit/health-records` 16.2.0 (clinical records split out).
3. **Last meaningful maintenance (measured)**: **540 commits since 2025-01-01, 42 since 2026-04-29, 31 authors**. Last merge 2026-10-12 (HKActivitySummaryQuery, iOS 27 RMSSD type, Xcode 26/27 CI). **1,093,431 downloads/month**.
4. **License**: MIT (© 2020 Robert Herber).
5. **Commercial-use considerations**: None from the license. App Store HealthKit rules apply (no ads or data-broker use, privacy policy, purpose strings; policy detail **unverified** here).
6. **Tech stack**: Nitro (nitrogen ^0.35) with Swift, TypeScript, bun/biome, changesets, and a TS-compiled Expo config plugin (`app.plugin.ts`: `withHealthKit`, `withHealthKitEntitlements`, `withUsageDescription`, `background` flag adds the background-delivery entitlement, default on).
7. **Key dependencies**: peers `react >=19`, `react-native >=0.79`, **`react-native-nitro-modules >=0.35`** (current 0.37.1; not Expo-pinned).
8. **Security concerns**: None specific. It is a thin native mapping, and permissions are requested per type.
9. **Relevant components (verified exports)**:
   - `requestAuthorization` (separate read and write sets), `getRequestStatusForAuthorization`, `requestPerObjectReadAuthorization`.
   - `query{Quantity,Category,Workout,Correlation,HeartbeatSeries,StateOfMind,Medication…}Samples` and their **`…WithAnchor`** variants (anchored queries).
   - `queryStatisticsForQuantity`, `queryStatisticsCollectionForQuantity`.
   - Writes: `saveQuantitySample`, **`saveCorrelationSample`** (HKCorrelation food = macros grouped as one meal), `saveWorkoutSample`, `saveCategorySample`, `saveStateOfMindSample`, `deleteObjects`.
   - `enableBackgroundDelivery`, `subscribeToChanges`, `configureBackgroundTypes` (observers registered via a launch hook), `getEarliestAuthorizedSampleDates`, `getPreferredUnits`, React hooks (`useMostRecentQuantitySample`, `useStatisticsForQuantity`, `useSubscribeToChanges`…).
   - Android: an "unavailable" stub only, and its README points to react-native-health-connect.
10. **Reuse difficulty**: Low.
11. **Integration risks**:
    - devDeps RN 0.81.5 versus our 0.88.1 (**compat with 0.88.1 unverified**; spike needed).
    - Nitro version alignment with other Nitro libraries (vision-camera v5 devDep uses nitro 0.37.0). Pin one `react-native-nitro-modules` version.
    - Major versions are frequent (16.x in Sep 2026), so expect API churn.
12. **Test quality**: Weak in code: only 4 Jest test files (257 LOC). CI covers test, typecheck, lint, swiftlint and an Xcode 26/27 example build. Safety comes largely from TypeScript types generated from the HealthKit schema.
13. **Maintenance outlook**: Good. It is the most-used HealthKit library and is actively maintained. The bus factor is concentrated on Robert Herber, with community PRs.
14. **Final recommendation: ADOPT** as the single HealthKit library.

## 21b. agencyenterprise/react-native-health (`react-native-health`)

1. **Purpose**: Legacy Objective-C HealthKit bridge.
2. **Latest version**: 1.19.0 (2024-10-15).
3. **Last meaningful maintenance (measured)**: **0 commits since 2025-01-01**. Last commit 2024-10-15. 164,065 downloads/month (legacy installs).
4. **License**: MIT.
5. **Commercial-use considerations**: The license is fine, but the project is abandoned.
6. **Tech stack**: Objective-C `RCTBridgeModule` (`RCT_EXPORT_MODULE`), with a config plugin using `@expo/config-plugins ^7.2.2` (very old).
7. **Key dependencies**: `react-native >=0.67.3`.
8. **Security concerns**: Unpatched and unmaintained native code.
9. **Relevant components**: Broad legacy method set (Dietary, Fitness, …).
10. **Reuse difficulty**: Medium.
11. **Integration risks**: High. It is a bridge module running on a New-Arch-only RN 0.88 through the interop layer (**unverified that it builds**), with no fixes for 2 years.
12. **Test quality**: None observed.
13. **Maintenance outlook**: Dead.
14. **Final recommendation: REJECT.**

## 21c. matinzd/expo-health-connect

1. **Purpose**: A former Expo config plugin for react-native-health-connect.
2. **Latest version**: 0.1.1.
3. **Last meaningful maintenance (measured)**: 2026-08-01, "docs: deprecate in favour of react-native-health-connect v4". The repo is **archived**. It still has 165,906 downloads/month, from legacy installs.
4. **License**: MIT.
5. **Commercial-use considerations**: n/a.
6. **Tech stack**: Config plugin.
7. **Key dependencies**: none.
8. **Security concerns**: n/a.
9. **Relevant components**: Superseded by v4's built-in plugin.
10. **Reuse difficulty**: n/a.
11. **Integration risks**: Duplicate permission-delegate registration if installed alongside v4.
12. **Test quality**: n/a.
13. **Maintenance outlook**: Archived.
14. **Final recommendation: REJECT** (use react-native-health-connect ≥4).

---

## 22. juliansteenbakker/mobile_scanner (Flutter)

1. **Purpose**: Flutter barcode/QR scanner plugin.
2. **Latest version**: 7.4.2 (pubspec and latest tag).
3. **Last meaningful maintenance (measured)**: 950 commits since 2025-01-01, 166 since 2026-04-29, 35 authors. Last commit 2026-10-07.
4. **License**: BSD-3-Clause.
5. **Commercial-use considerations**: Fine, but **Flutter-only**, so it does not apply to an RN stack.
6. **Tech stack**: Dart, Swift (darwin, Apple Vision `VNDetectBarcodesRequest`), Kotlin (ML Kit, bundled `barcode-scanning:17.3.0` or unbundled `play-services-mlkit-barcode-scanning:18.3.1`).
7. **Key dependencies**: CameraX, ML Kit, Apple Vision.
8. **Security concerns**: none notable.
9. **Relevant components**: A reference for backend choices only. Apple Vision on iOS versus AVFoundation metadata output, and bundled versus unbundled ML Kit.
10. **Reuse difficulty**: n/a for RN.
11. **Integration risks**: n/a.
12. **Test quality**: 47 Dart test files.
13. **Maintenance outlook**: Healthy.
14. **Final recommendation: REFERENCE** (it is not usable in RN).

## 22a. mrousavy/react-native-vision-camera (v5) — RN scanning alternative

1. **Purpose**: A high-performance RN camera with frame processors and code scanning.
2. **Latest version**: `react-native-vision-camera@5.2.3` (2026-08-20). v5.0.0 was 2026-04-16 and v4's last release was 4.7.3 (2025-11-12). There are separate packages at 5.2.3: `react-native-vision-camera-barcode-scanner`, `-worklets`, `-resizer`, `-skia`, `-location`.
3. **Last meaningful maintenance (measured)**: 310 commits since 2026-01-01, 42 since 2026-07-29, 18 authors. Last commit 2026-10-14 (CameraX executor fix). No npm release since 2026-08-20. 2,319,218 downloads/month (core); barcode-scanner 232,058/month.
4. **License**: MIT.
5. **Commercial-use considerations**: Fine. Marc Rousavy / Margelo offer paid support (**unverified**).
6. **Tech stack**: Nitro Modules (Swift, Kotlin, C++), worklets.
7. **Key dependencies**: peers `react-native-nitro-modules`, **`react-native-nitro-image`** (0.15.2). The barcode-scanner package uses **Google ML Kit on both platforms** (`GoogleMLKit/BarcodeScanning 9.0.0` pod on iOS, `com.google.mlkit:barcode-scanning:17.3.0` on Android).
8. **Security concerns**: none notable. ML Kit iOS adds Google binary pods (size and privacy-manifest review needed; **unverified**).
9. **Relevant components**:
   - Core `ScannedObject` types (AVFoundation path) include `ean-13`, `ean-8` and `upc-e`. There is **no `upc-a`**, because iOS reports UPC-A as EAN-13.
   - The ML Kit barcode-scanner `BarcodeFormat` includes `ean-13`, `ean-8` and `upc-a`, so it is consistent across platforms.
   - Frame processors would allow custom pipelines (for example nutrition-label OCR later).
10. **Reuse difficulty**: Medium.
11. **Integration risks**:
    - **No Expo config plugin found in v5 packages** (grep). Its docs say to add permissions to `app.json` and run `expo prebuild`.
    - Adds 3 Nitro peers that must align versions.
    - No JS tests found in v5 packages (0 `*.test.ts`).
    - Bigger binary.
12. **Test quality**: Weak (no unit tests found). It relies on the example app.
13. **Maintenance outlook**: Good. It is high-profile, though v5 is a fresh rewrite.
14. **Final recommendation: REFERENCE / fallback**. Adopt only if expo-camera scanning proves insufficient in field tests (low light, curved cans, damaged labels) or if frame processors are needed.

---

## 23. openai/whisper

1. **Purpose**: Reference PyTorch implementation and weights for Whisper ASR.
2. **Latest version**: PyPI `openai-whisper==20250625` (`whisper/version.py`), with no release since 2025-06-26.
3. **Last meaningful maintenance (measured)**: 21 commits since 2025-01-01 and 3 since 2026-04-29. Last commit 2026-08-31 (normalizer fix). Small 2026-07 fixes: SDPA cross-attention, JSONL output. **Low activity; effectively a reference repo.**
4. **License**: MIT for **code and model weights** (README "License" section).
5. **Commercial-use considerations**: Free for commercial self-hosting. The cost is GPU infrastructure.
6. **Tech stack**: Python, PyTorch, tiktoken, numba, (triton on Linux x86).
7. **Key dependencies**: torch, numpy, numba, tiktoken, tqdm, more-itertools.
8. **Security concerns**:
   - Model download is SHA-256 verified (`__init__.py` L57–90), and `torch.load(..., weights_only=True)` is used for torch ≥1.13.
   - Server-side, voice is health-adjacent personal data: set a retention policy, avoid logging raw audio, and use a DPA if you go hosted.
9. **Relevant components**:

   | Model | Params | VRAM | Relative speed (A100) |
   |---|---|---|---|
   | tiny | 39M | ~1 GB | ~10x |
   | base | 74M | ~1 GB | ~7x |
   | small | 244M | ~2 GB | ~4x |
   | medium | 769M | ~5 GB | ~2x |
   | large | 1550M | ~10 GB | 1x |
   | **turbo** (large-v3 optimized) | 809M | ~6 GB | ~8x |

   `.en` variants are better for tiny and base. Accuracy varies widely by language (README figure; per-model WER is in the paper, appendix D). Known failure modes are hallucinated text on silence and odd number formatting ("two hundred grams" versus "200 g"). Use VAD and number normalization.
10. **Reuse difficulty**: Low as a service. For production throughput, use a faster runtime: whisper.cpp server, faster-whisper/CTranslate2 (**unverified versions**), or a hosted API.
11. **Integration risks**:
    - Repo stagnation, so do not build on the Python package.
    - GPU ops cost.
    - Latency on the reference implementation.
12. **Test quality**: 6 pytest modules (~12 tests).
13. **Maintenance outlook**: The weights are stable and the code is minimally maintained.
14. **Final recommendation: REFERENCE** for models and license. For server-side transcription, prefer a **hosted transcription API** at MVP (OpenAI `gpt-4o-mini-transcribe`/`whisper-1`, Deepgram, AssemblyAI, Google, Azure; **names, pricing and retention terms unverified, so check before contracting**). Self-host large-v3-turbo via whisper.cpp or faster-whisper if volume or cost justifies it.

## 23a. jamsch/expo-speech-recognition (on-device / OS speech)

1. **Purpose**: Expo module wrapping iOS `SFSpeechRecognizer` and Android `SpeechRecognizer`.
2. **Latest version**: `expo-speech-recognition@58.0.1` (2026-10-29). Its versioning tracks the Expo SDK (57.x → 58.x).
3. **Last meaningful maintenance (measured)**: 63 commits since 2025-02, 23 since 2026-04-29, 8 authors (jamsch 34, plus bots). Last commit 2026-10-29. **2,974,278 downloads/month.**
4. **License**: MIT.
5. **Commercial-use considerations**: The OS speech services are free. On iOS, server-based recognition sends audio to Apple unless `requiresOnDeviceRecognition`; Apple usage limits apply (**unverified**).
6. **Tech stack**: Expo Modules API with Swift and Kotlin.
7. **Key dependencies**: peers `expo`, `react`, `react-native` (`*`).
8. **Security concerns**: Needs mic and speech permissions. With server recognition, audio goes to Apple or Google, which must be disclosed in the privacy policy.
9. **Relevant components (verified in types)**:
   - `requiresOnDeviceRecognition`.
   - **`contextualStrings`**: bias toward food and exercise vocabulary.
   - `recordingOptions.persist` saves the audio file, so the same audio can also be sent to the server ASR.
   - `audioSource` transcribes a file.
   - `androidRecognitionServicePackage`.
   - Interim results.
   - ⚠ **No iOS 26 `SpeechAnalyzer`/`SpeechTranscriber` support** (grep: 0 hits); it uses the legacy API.
10. **Reuse difficulty**: Low.
11. **Integration risks**:
    - On-device quality is variable, and Android on-device recognition is verified only on 13+ per its docs.
    - Single maintainer.
12. **Test quality**: Minimal (an Android test dir plus a `test-android.mjs` script).
13. **Maintenance outlook**: Good. It keeps pace with Expo SDKs.
14. **Final recommendation: ADOPT (optional)** for live partial transcripts and an offline fallback. Final parsing should still use server ASR plus an LLM.

---

## 24. ggml-org/whisper.cpp

1. **Purpose**: C/C++ Whisper inference on ggml (CPU NEON, Metal, Core ML/ANE encoder, Vulkan, Hexagon…). It now also runs **NVIDIA Parakeet TDT** (`convert-parakeet-to-ggml.py`) and Silero VAD.
2. **Latest version**: tag **v1.9.5** (2026-10-06).
3. **Last meaningful maintenance (measured)**: **1,801 commits since 2026-01-01** (755 since 2026-07-29), 453 authors. This includes ggml syncs from llama.cpp, which inflate the counts. HEAD 2026-10-28 ("clear VAD state when VAD is disabled").
4. **License**: MIT (© ggml authors).
5. **Commercial-use considerations**: Fine. Whisper weights are MIT. Parakeet weights are under NVIDIA's license (believed CC-BY-4.0; **unverified**).
6. **Tech stack**: C/C++, CMake; Swift/ObjC and Android examples (`whisper.objc`, `whisper.swiftui`, `whisper.android`).
7. **Key dependencies**: ggml (vendored). Core ML model generation needs Python (`ane_transformers`, `coremltools`, `openai-whisper`) at build time only.
8. **Security concerns**: Native C++ parsing model files, so ship only models with pinned SHA (hash table in `models/README.md`).
9. **Relevant components / on-device practicality**:
   - **Disk / RAM**: tiny 75 MiB / ~273 MB, base 142 MiB / ~388 MB, small 466 MiB / ~852 MB, medium 1.5 GiB / ~2.1 GB.
   - **Quantized**: `tiny-q5_1`, `base-q5_1`, `small-q5_1`, `-q8_0` are available via `download-ggml-model.sh`. Sizes for these are not in the repo table, roughly 31 / 57 / 181 MiB for q5_1 (**unverified**). large-v3-turbo-q5_0 is 547 MiB, which is too large for mobile.
   - **iPhone speed (repo data)**: bench issue #89 has **iPhone 13 Mini, iOS 16, base model, 4 threads, NEON BLAS, no Core ML: encoder 1,091 ms, load 97 ms** (2022, old commit; current builds with Metal or Core ML should be faster, **unverified**).
   - README claims Core ML encoder on ANE "more than x3 faster compared with CPU-only". The first run per device is slow while the ANE compiles. ANEForge is claimed ~2x faster than Core ML (tiny–medium, macOS-oriented instructions).
   - README demo: iPhone 13 running offline. whisper.rn README: tiny.en with Core ML on iPhone 13 Pro Max.
   - **Battery**: short push-to-talk utterances (5–15 s) with tiny or base are practical. Continuous or realtime transcription keeps CPU, GPU or ANE busy and drains battery and heat. Also: model download size (do it on Wi-Fi, on demand), and the memory footprint (base ≈400 MB) risks jetsam on older devices.
10. **Reuse difficulty**: High directly. Low through whisper.rn.
11. **Integration risks**:
    - Fast-moving C++ with ggml syncs, so pin a version.
    - App size if models are bundled (do not bundle them).
    - Accuracy of tiny/base on noisy gym audio is worse than server large-v3-turbo.
12. **Test quality**: 23 test files plus extensive CI (build-coreml, build-android, quantize, many platforms).
13. **Maintenance outlook**: Excellent.
14. **Final recommendation: REFERENCE** for on-device, used via whisper.rn in phase 2. The server-side `whisper-server` example is an option for self-hosting.

## 24a. mybigday/whisper.rn

1. **Purpose**: RN bindings for whisper.cpp (Whisper + Parakeet + Silero VAD + a realtime transcriber).
2. **Latest version**: stable **0.7.4** (2026-08-27). Prerelease 0.8.0-rc.2 (2026-10-07), which syncs whisper.cpp and adds Hexagon NPU support on Snapdragon 8 Gen 1+.
3. **Last meaningful maintenance (measured)**: 149 commits since 2025-03, 43 since 2026-04-29. ⚠ **Bus factor 1**: Jhen-Jie Hong has 142/149 commits. **129,282 downloads/month.**
4. **License**: MIT.
5. **Commercial-use considerations**: Fine. Model licenses as above.
6. **Tech stack**: C++ JSI + TurboModule (`codegenConfig`), with whisper.cpp vendored under `vendor/`. Prebuilt `rnwhisper.xcframework` and Android jniLibs.
7. **Key dependencies**: `safe-buffer`. The realtime adapter imports `@fugood/react-native-audio-pcm-stream` (can be replaced by expo-audio `AudioStream` with a custom adapter). Requires node ≥20.19.4.
8. **Security concerns**: ⚠ A **`postinstall` downloads prebuilt native binaries from GitHub releases** (SHA-256 verified per its README). This is a supply-chain point. Pin the version, or set `RNWHISPER_BUILD_FROM_SOURCE=1` / `RNWHISPER_SKIP_POSTINSTALL=1` in CI.
9. **Relevant components**:
   - `initWhisper` (Core ML via `.mlmodelc`, `useGpu`).
   - `initWhisperVad` with Silero v6.2.0 and `detectSpeech`.
   - `RealtimeTranscriber` (ring buffer, VAD, bounded memory fixes 2026-10).
   - `ParakeetContext`: Parakeet TDT 0.6B v3 q4_0 is 356 MB, too large for a default download.
   - Expo: prebuild required (works in dev builds).
10. **Reuse difficulty**: Low–medium.
11. **Integration risks**:
    - Single maintainer.
    - 0.x API, with the 0.8 RC in flight.
    - iOS podspec min 13.0.
    - Binary size of roughly 10s of MB (**unverified**).
12. **Test quality**: Jest suites for RingBuffer, VAD, memory growth, RealtimeTranscriber and adapters (about 7 files). Native is covered by the example app.
13. **Maintenance outlook**: Active but fragile.
14. **Final recommendation: ADAPT (phase 2, optional)** for an offline or privacy mode using `base.en-q5_1` (or tiny.en), downloaded on demand. Not for MVP.

---

## Recommended mobile dependency set (Expo SDK 58; versions from `expo@58.0.21/bundledNativeModules.json` unless noted)

Install with `npx expo install <pkg>` so the SDK pin is used. CI step: `npx expo install --check` (or `npx expo-doctor`).

| Package | Version | Note |
|---|---|---|
| expo | ~58.0.21 | SDK 58 |
| react / react-dom | 19.3.0 | **exact**; do not take 19.3.1 |
| react-native | 0.88.1 | New Arch only |
| typescript / @types/react | ~6.0.3 / ~19.3.0 | from template |
| expo-dev-client | ~58.0.17 | dev builds mandatory |
| expo-router | ~58.0.28 | pin exact; patch-level breaking changes observed |
| react-native-screens / react-native-safe-area-context | ~4.30.0 / ~5.10.1 | router peers |
| react-native-gesture-handler | ~3.3.0 | |
| react-native-reanimated / react-native-worklets | 4.7.1 / 0.13.0 | |
| expo-camera | ~58.0.14 | barcode via CameraView |
| expo-sqlite | ~58.0.14 | enable `useSQLCipher`; `expo-sqlite/kv-store` |
| drizzle-orm / drizzle-kit (dev) | 0.45.4 / 0.31.11 | npm latest stable; `drizzle-orm/expo-sqlite` driver + `useMigrations`; avoid 1.0 rc |
| expo-secure-store | ~58.0.2 | tokens + SQLCipher key |
| expo-notifications | ~58.1.7 | |
| expo-haptics | ~58.0.7 | |
| expo-background-task + expo-task-manager | ~58.0.11 + ~58.0.12 | opportunistic sync |
| expo-image-manipulator | ~58.0.16 | photo compression |
| expo-image | ~58.0.18 | |
| expo-audio | ~58.0.10 | recording + `AudioStream` PCM |
| expo-file-system | ~58.0.13 | |
| expo-network | ~58.0.4 | or @react-native-community/netinfo 12.0.1 for `onlineManager` |
| expo-crypto / expo-local-authentication / expo-localization | ~58.0.7 / ~58.0.2 / ~58.0.5 | |
| expo-build-properties / expo-updates | ~58.0.11 / ~58.0.19 | enable update code signing |
| @shopify/flash-list | 2.3.2 | long food lists |
| react-native-svg / @shopify/react-native-skia | 15.16.0 / 2.14.0 | charts (choose one) |
| @sentry/react-native | ~8.28.0 | |
| @react-native-async-storage/async-storage | 2.2.0 | only if not using kv-store (npm latest 3.1.1 is not the SDK pin) |
| @tanstack/react-query (+ -persist-client, query-async-storage-persister) | 5.105.0 | not SDK-pinned (JS) |
| @kingstinct/react-native-healthkit | 16.2.0 | not SDK-pinned; spike on RN 0.88.1 |
| react-native-nitro-modules | 0.37.1 | not SDK-pinned; satisfies kingstinct `>=0.35`; pin one version app-wide |
| react-native-health-connect | 4.1.3 | not SDK-pinned; includes the Expo plugin |
| expo-speech-recognition (optional) | 58.0.1 | |
| whisper.rn (phase 2, optional) | 0.7.4 | avoid 0.8.0-rc until stable |

Do **not** add: react-native-health, expo-health-connect, react-native-nitro-healthkit, @appeeky/expo-healthkit, or react-native-vision-camera (unless the fallback trigger below fires).

## Health integration recommendation

- **iOS: `@kingstinct/react-native-healthkit@16.2.0`.** **Android: `react-native-health-connect@4.1.3`.** Both are MIT, the most used (1.09M and 0.82M downloads/month), actively maintained, and expose anchored or change-token incremental sync plus nutrition writes.
- Put both behind an app-owned `HealthAdapter` TS interface: `requestPermissions(read, write)`, `readSince(anchor)`, `writeMeal(meal)`, `writeWorkout`, `subscribe`. appeeky's API shape is a design reference only, and none of its code should be copied.
- **Sync**:
  - iOS: `queryXSamplesWithAnchor` + `enableBackgroundDelivery` / `subscribeToChanges` (plugin `background: true`).
  - Android: `getChanges` tokens, with `BackgroundAccessPermission` requested only if needed and scheduled by expo-background-task.
  - Persist anchors and tokens in SQLite, and keep the app DB as the source of truth.
  - Write meals as HealthKit food **correlations** (`saveCorrelationSample`) and Health Connect `NutritionRecord`s, so they can be idempotently deleted and rewritten on edit. Store the returned UUIDs.
- **Permissions UX**: iOS never reveals whether read access was denied (`getRequestStatusForAuthorization` only tells you whether a prompt is needed), so design for "no data" rather than "denied". Health Connect history beyond 30 days needs `ReadHealthDataHistory`.
- **Before committing, run a 1–2 day spike**: a build on Expo SDK 58 / RN 0.88.1 with both libraries plus a single pinned `react-native-nitro-modules`, on a physical device. Neither library is tested upstream on RN 0.88 (devDeps are 0.81.5 and 0.86.2).
- Policy (**unverified detail**): App Store HealthKit rules forbid ad or marketing use and sale of the data, and require a privacy policy. Google Play requires the Health Connect declaration and justification of every data type.

## Barcode recommendation

- **MVP: expo-camera `CameraView`** (bundled, zero extra native dependencies). Use `barcodeScannerSettings={{ barcodeTypes: ['ean13','ean8','upc_a','upc_e'] }}`, debounce or lock after the first hit, and offer a torch toggle.
- **Mandatory normalization layer.** Convert every result to **GTIN-13** (left-pad 12-digit UPC-A with `0`), expand UPC-E to UPC-A, and validate the check digit before the OFF/DB lookup. This is needed because:
  - iOS reports UPC-A as `ean13` with the leading zero stripped (12 digits), per verified expo source.
  - Android reports `upc_a` (12 digits).
- **Fallback trigger** (decide after field-testing about 50 real products in low light and on curved packaging): switch to `react-native-vision-camera@5.2.3` + `react-native-vision-camera-barcode-scanner@5.2.3`. That gives ML Kit on both platforms, a consistent `upc-a`, and frame processors for future label OCR. The cost is Nitro + nitro-image peers, Google ML Kit iOS pods, and no Expo plugin.
- Flutter `mobile_scanner` is not applicable (reference only).

## Voice pipeline recommendation

1. **Capture**: expo-audio `useAudioRecorder`, push-to-talk, mono AAC m4a at 16 kHz (custom `RecordingOptions`; a 16 kHz mono preset is not verified, so set it explicitly). Max about 30 s. Run client-side VAD and trimming later if using whisper.rn. For live captions, run `expo-speech-recognition` in parallel with `contextualStrings` (common foods, units, exercises) and `recordingOptions.persist`.
2. **Transcribe on the server (MVP)**: use a hosted ASR API (OpenAI / Deepgram / AssemblyAI / Google, **unverified pricing and retention**, so choose one with zero-retention terms and a DPA). The self-host option is whisper large-v3-turbo via whisper.cpp server or faster-whisper on GPU (MIT weights). Pass a domain prompt or vocabulary.
3. **Parse**: LLM structured extraction of transcript → `{items:[{food, qty, unit, brand?}], meal, time}` or `{exercise, sets, reps, load}`. Map to the food DB with confidence, then show a confirmation UI. Never auto-commit, and keep the transcript for edits.
4. **Offline / privacy (phase 2)**: `whisper.rn@0.7.x` with `base.en-q5_1` (or tiny.en) downloaded on demand, Core ML encoder on iOS, and VAD. Use it only for short utterances. Expect roughly 1 s+ encoder latency for base on older iPhones without Core ML (2022 benchmark).
5. **Privacy**: treat audio as sensitive health-adjacent data. Do not store raw audio by default, delete after transcription, and disclose OS speech services (Apple/Google) in the privacy policy.

---

## Summary table

| # | Repo / package | Latest | Activity (measured) | npm dl/mo | License | Verdict |
|---|---|---|---|---|---|---|
| 17 | expo/expo (expo) | 58.0.21 (RN 0.88.1, React 19.3.0) | 2,330 commits / 287 authors in last 90 d | (expo-router 29.4M) | MIT | **ADOPT** |
| 18 | TanStack/query | 5.105.0 | 1,699 commits 2026 YTD; release 2026-10-26 | 256.3M | MIT | **ADOPT** |
| 19 | N0ku/react-native-nitro-healthkit | 1.0.0 (only) | 8 commits, 1 author, dormant since 2026-06-16 | 885 | MIT | **REJECT** (write auth broken, no macros) |
| 20 | appeeky/expo-healthkit | 0.4.2 | 20 commits / 5 authors since 2026-09-05 | 6,192 | **PolyForm Shield (non-OSS, noncompete)** | **REFERENCE** only |
| 21 | matinzd/react-native-health-connect | 4.1.3 | 48 commits / 18 authors since 2025; last 2026-08-26 | 820,477 | MIT | **ADOPT** (Android) |
| 21a | @kingstinct/react-native-healthkit | 16.2.0 | 540 commits / 31 authors since 2025; last 2026-10-12 | 1,093,431 | MIT | **ADOPT** (iOS) |
| 21b | react-native-health (agencyenterprise) | 1.19.0 (2024-10) | 0 commits since 2025 | 164,065 | MIT | **REJECT** |
| 21c | expo-health-connect | 0.1.1 | archived 2026-08-01 | 165,906 | MIT | **REJECT** (merged into rnhc v4) |
| 22 | juliansteenbakker/mobile_scanner | 7.4.2 | 166 commits since 2026-04-29 | n/a (pub.dev) | BSD-3 | **REFERENCE** (Flutter) |
| 22a | react-native-vision-camera v5 | 5.2.3 | 310 commits 2026 YTD; last release 2026-08-20 | 2,319,218 | MIT | **REFERENCE / fallback** |
| — | expo-camera CameraView | ~58.0.14 | (expo) | 10.6M | MIT | **ADOPT** for barcodes |
| 23 | openai/whisper | 20250625 | 3 commits since 2026-04-29 | n/a (PyPI) | MIT (code + weights) | **REFERENCE** (server via hosted API / whisper.cpp) |
| 23a | expo-speech-recognition | 58.0.1 | 23 commits since 2026-04-29 | 2,974,278 | MIT | **ADOPT (optional)** |
| 24 | ggml-org/whisper.cpp | v1.9.5 | 1,801 commits 2026 YTD (incl. ggml syncs) | n/a | MIT | **REFERENCE** (on-device engine) |
| 24a | whisper.rn | 0.7.4 (0.8.0-rc.2) | 43 commits since 2026-04-29; bus factor 1 | 129,282 | MIT | **ADAPT (phase 2)** |

Unverified items, consolidated:
- Star counts (API blocked).
- Exact q5_1 model sizes.
- Current-gen iPhone whisper latency.
- Hosted ASR pricing and retention.
- App Store and Play health-policy specifics.
- kingstinct and react-native-health-connect builds on RN 0.88.1.
- ML Kit iOS binary-size impact.
- Parakeet weight license.
- react-native-health on the New-Arch interop layer.
