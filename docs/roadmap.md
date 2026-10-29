# Roadmap, acceptance tests and risks

The phases follow the specification. "Done" means every acceptance test listed passes in the automated suites (`pnpm test`) or has a recorded manual check. CI (GitHub Actions) runs them on every push. `STATUS.md` is the live ledger.

## Phases

| Phase | Scope | State | Acceptance tests (✓ automated, ◻ manual or pending) |
| --- | --- | --- | --- |
| 0 | Research, licensing, architecture, design system | Done | ✓ Docs in `docs/`. ✓ No copyleft or share-alike code or data in the repo. |
| 1 | Foundation: auth, RLS, profiles, onboarding, targets | Done | ✓ Token rotation and reuse revocation. ✓ Cross-user reads and writes refused by RLS. ✓ Calorie floor and deficit cap. ✓ Account deletion removes media. |
| 2 | Nutrition: catalogue, barcode, diary, recipes, AI food logging | Backend done; mobile partial | ✓ Missing nutrients stay null. ✓ Idempotent last-writer-wins upserts. ✓ History unchanged by corrections. ✓ AI drafts never auto-log. ✓ Search ranks "Bananas, raw" first for "banana". ◻ Scan 20 real UAE products on device; record hit rate and corrections. ✓ Recipe and menu screens. ✓ Ingredient matching never substitutes a look-alike food. |
| 3 | Training: catalogue, generator, live workout, progression, form check | Done; device check pending | ✓ Generated program fits time and equipment. ✓ PRs and next targets. ✓ Load increase requires confirmation. ✓ Form check counts 6 of 6 reps on real footage. ◻ Full workout offline on device (airplane mode), then sync. ◻ Form check frame rate and accuracy on an iPhone. |
| 4 | Progress: weight trend, measurements, photos, health | Done; device check pending | ✓ Trend withheld until data suffices. ✓ Signed photo URLs. ✓ Health dedupe across sources. ◻ HealthKit and Health Connect permission and sync on devices. |
| 5 | Coach | Done (fake provider) | ✓ Tool-grounded answers. ✓ Proposals only. ✓ Consent gate. ◻ Twenty-question live evaluation with the Claude API: grounding, refusal of unsafe targets, tone. |
| 6 | Adaptive nutrition and insights | Done | ✓ Capped adjustment with evidence. ✓ Adherence gap. ✓ Insufficient data. ✓ Correlation caveat. |
| 7 | Voice, notifications, meal planning, offline polish | Backend done; mobile partial | ✓ Quiet hours and DST. ✓ Delivery idempotency. ✓ Grocery consolidation. ✓ Voice-to-draft. ◻ Push on device. ✓ Meal-plan and grocery screens. ✓ Client outbox and workout store unit tests. |
| 8 | Hardening and SaaS readiness | Not started | ◻ Load test (200 concurrent users, p95 < 300 ms on reads). ◻ Backup and restore drill. ◻ Error monitoring. ◻ Billing and quotas design. ◻ Privacy policy and data-processing review. |

## Next steps, in order
1. Build a development build on an iPhone (`npx expo run:ios`). Verify HealthKit, camera, barcode, microphone, push and the form-check WebView, and record the results in `STATUS.md`.
2. Run the live Claude evaluation (food photos, labels, menus and coach) with a real key, and tune prompts from the failures.
3. Add meal tags to recipes (breakfast/lunch/dinner/snack) so plans respect them.
4. If form-check frame rates on device are too low, replace the WebView with a native module behind the same message contract (ADR-11).

## Performance targets

| Target | Budget | Measured (local, 2026-10-29) |
| --- | --- | --- |
| Food search (local catalogue) | p95 < 250 ms | p50 112 ms, p95 170 ms over 7,793 foods |
| Today screen API | < 150 ms | 41 ms |
| Weight trend / training analytics | < 100 ms | 9 ms / 12 ms |
| Log food (tap to visible) | Instant (optimistic) | Outbox write is synchronous; the UI updates before the network |
| Cold start to Today | < 2 s on a recent iPhone | ◻ not measured (no device) |
| AI photo recognition | < 10 s | ◻ not measured (no key) |

## Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Photo calorie estimates are wrong | High | Medium | Separate stages, ranges and confidence tiers. Confirm before logging. Never presented as exact. |
| Sparse UAE packaged-food data | High | Medium | Barcode-first. Private foods. Label reading. Corrections are kept per user. |
| Open Food Facts rate limits and outages | Medium | Low | Local catalogue first. Cache products. Clear "not found → add it" path. |
| HealthKit / Health Connect API churn | Medium | Medium | Adapter seam per platform. Server dedupe. No writes back to the stores. |
| LLM gives unsafe advice | Low | High | Tools only; arithmetic and limits in code. Calorie floor enforced in the tool. Medical-advice disclaimer. Proposals need approval. |
| Sensitive data sent to the AI provider | Low | High | Per-feature consent. Progress photos never sent. Meal photos deleted unless kept. |
| Licence contamination | Low | High | Licensing rule in `repository-evaluation.md`. Original exercise data. OFF data kept separable and attributed. |
| Data loss offline | Low | High | Outbox persisted on device. Idempotent upserts. Local workout store survives restarts. |
| Single-user assumptions leak into the design | Medium | Medium | `user_id` on every row and RLS from day one. Commercial tables exist. |
| Model or SDK deprecation | Medium | Low | Provider seam. Model id in config. Fake provider keeps tests independent. |
