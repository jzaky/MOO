# Design system and screen specification

Dark-first, calm and dense where it helps: a tool used several times a day, often mid-workout or mid-meal. Source of truth: `apps/mobile/src/theme/tokens.ts`, `src/ui/primitives.tsx`, `src/ui/charts.tsx`.

## Principles
1. **One-handed and fast.** The most common actions (log food, start or resume a workout, complete a set, log weight) take one or two taps from the tab they live on.
2. **Honest numbers.** Estimates are labelled as estimates with ranges, missing values show "–" rather than 0, and confidence is shown wherever AI produced a value.
3. **Suggest, never impose.** Changes from the coach, the adaptive engine or progression appear as proposals with a reason and an explicit accept action.
4. **No guilt.** Copy is neutral: "92 g left", never "you failed". No streak-shaming, and reminders respect quiet hours.
5. **Every screen has loading, empty and error states.** Skeletons for loading, an empty state with one next action, and an error state with a retry. A sync banner explains offline mode.

## Tokens
| Token | Dark | Use |
| --- | --- | --- |
| `bg` / `surface` / `surfaceRaised` / `surfaceSunken` | #0B0C0E / #141519 / #1B1D22 / #0F1013 | Page, cards, raised controls, input wells |
| `text` / `textSecondary` / `textTertiary` | #F2F3F5 / #A1A5AE / #6B7079 | Primary, supporting and de-emphasised text |
| `accent` | #7CF0B4 | Primary actions, selection, focus ring |
| `warning` / `danger` | #F4C66A / #F28B82 | Cautions (e.g. below the calorie floor) and destructive actions |
| **Data colours** | energy #1FA971, protein #4F8DF0, carbs #BC8A1F, fat #B266D6, fibre #6E9E2A, water #2A9BC4 | Chart marks only, never text |

The data colours were run through the dataviz palette validator against the dark surface. They pass the lightness band, the chroma floor, colour-vision-deficiency separation for adjacent pairs, and contrast. A light palette is fully defined, so light mode needs no screen changes.

**Spacing** 2/4/8/12/16/20/24/32/48. **Radius** 8/12/16/22/pill. **Type:** the system sans (SF Pro / Roboto / Inter on web). Metrics use the same sans with tabular figures; there is no decorative display face.

## Components
- **`primitives.tsx`:**
  - Text and layout: `T` (typography variants), `Card`, `Row`, `Stack`, `Divider`, `SectionHeader`.
  - Controls: `Button` (primary/secondary/ghost/danger; sm/md/lg; loading), `IconButton`, `Chip`, `Segmented`, `Stepper`, `ListRow`.
  - `Field` with label, suffix and error, and a focus ring drawn by the container.
  - States: `EmptyState`, `ErrorState`, `Skeleton`, `Badge`.
  - `Icon`, which maps SF Symbols to Material Symbols.
- **`charts.tsx`:**
  - `ProgressRing`, `MacroBar`.
  - `LineChart`: 2 px lines, end marker of at least 8 px with a surface ring, touch scrub as the tooltip equivalent, one y-axis.
  - `Legend` (always shown for two or more series), `BarList` (bars at most 24 px with rounded ends), `StatTile`.
- **Other:** `Screen` (safe areas, large title, back/close, pull to refresh, keyboard avoidance, width cap for web and iPad), `SyncBanner`, `ActionSheet`.

**Accessibility.**
- Every control has a role and a label, and hit targets are at least 44 pt.
- Set rows announce the set number, type and unit.
- The rest timer is a polite live region.
- Charts have titles and expose values through scrubbing.

## Navigation
Five tabs: **Today · Nutrition · Train · Progress · Coach**. These are native tabs on iOS and Android, and headless tabs on web. Modal and sheet routes sit above the tabs; the live workout is a full-screen modal with swipe-to-dismiss disabled.

## Screen inventory

| Screen | Route | Purpose | Loading / empty / error | State |
| --- | --- | --- | --- | --- |
| Welcome, Sign in, Sign up | `/welcome`, `/sign-in`, `/sign-up` | Account access | Inline field errors; rate-limit message | Built |
| Onboarding (7 steps) | `/onboarding` | Body, goal, activity, diet, training, schedule; plan preview with explanations | Plan preview skeleton; validation per step | Built |
| Today | `/(tabs)` | Greeting, quick log, energy ring + macros, water, next workout, recovery check-in, insights | Skeletons; "no targets yet"; error + retry | Built |
| Nutrition | `/(tabs)/nutrition` | Day navigator, totals, meals with entries, move/delete, weekly summary | Skeleton; empty meal "Add" prompts | Built |
| Add food (search) | `/food/search` | Search, recents, favourites, meal chips, entry to scan/photo/voice/custom/quick add | Recents when the query is empty; "no results → create custom food" | Built |
| Food detail | `/food/[id]` | Portion picker (servings or grams), live nutrient preview, completeness note, favourite | Missing nutrients shown as "–" | Built |
| Barcode scan | `/food/scan` | Continuous scan, product card, unknown-product path | Permission prompt; not-found guidance | Built (device-unverified) |
| Meal photo | `/food/camera` | Capture one or more photos; before/after for leftovers | Consent gate if photo analysis is off | Built (device-unverified) |
| Recognition review | `/food/review` | Components with confidence tier, ranges, alternatives; edit before logging | Items the server marks as needing input start unselected | Built |
| Voice log | `/food/voice` | Record, transcribe, parsed draft to confirm | "Transcription not configured" fallback | Built (device-unverified) |
| Custom food, Quick add | `/food/custom`, `/food/quick-add` | Manual entry; quick add requires energy | Field validation | Built |
| Train | `/(tabs)/train` | Resume banner, program days, suggested program, weekly sets, recent workouts | Empty "Suggest a program" | Built |
| Pre-start / Live workout | `/workout/active` | Sets with previous values, suggestion button, rest timer, set types, pause, finish | Works offline; discard confirmation | Built |
| Exercise picker / info | `/workout/exercise-picker` | Search by name, muscle, equipment; alternatives | Empty search state | Built |
| Workout summary | `/workout/summary/[id]` | Volume, PRs, comparison, next targets (pending confirmation) | Skeleton | Built |
| Progress | `/(tabs)/progress` | Weight trend (scale dots + EWMA), rate, goal progress, measurements, photos with compare, strength e1RM, recovery | "Not enough weigh-ins" with guidance | Built |
| Weigh-in / Measurements | `/weigh-in` | Weight and circumferences in user units | Validation | Built |
| Coach | `/(tabs)/coach` | Ask (chat with suggested prompts), Suggestions (accept/reject), This week | "AI not configured" message; per-message retry | Built |
| Settings | `/settings` | Profile and units, targets (versioned edit), health connection, notifications and quiet hours, AI consent, export, sign out, delete account | Skeletons; per-section error and retry | Built |
| Recipes | `/recipes`, `/recipes/[id]` | List; detail with per-serving nutrition, log servings, two-step delete | Empty state explains how matching works | Built |
| Recipe editor | `/recipes/edit` | Paste ingredients or a link → reviewed matches, amounts, live per-serving preview | Unmatched or uncertain lines are highlighted and not counted | Built |
| Meal plan | `/plan` | Build a week from own recipes and saved meals; per-day totals vs targets; log a planned meal | Empty state with meal choice; server explains when recipes are missing | Built |
| Grocery list, Pantry | `/plan/grocery/[id]`, `/plan/pantry` | Check-off by category; "I have this" adds to pantry; pantry subtracts from lists | Empty list explains why | Built |
| Restaurant menu | `/food/menu` | Photo or text; dishes ranked by fit with what is left today; printed vs estimate labels | Consent and AI-unavailable messages; manual fallback | Built |
| Form check | `/workout/form-check` | Squat or push-up; set-up guidance, skeleton overlay, live rep count, results with per-rep depth and tempo | Model loading, camera denied, "no person in view", and too-little-tracked states | Built (device unverified) |
