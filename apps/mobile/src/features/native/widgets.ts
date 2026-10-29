import type { WidgetSnapshot } from "./types";

export type { WidgetSnapshot } from "./types";

/**
 * Updates the home-screen widgets with today's numbers.
 *
 * This is the Android and web variant: a no-op. The iOS implementation lives in
 * `widgets.ios.ts` (Metro picks it by platform extension).
 */
export function updateWidgets(_snapshot: WidgetSnapshot): void {}
