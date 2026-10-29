import type { WidgetSnapshot } from "./types";
import { caloriesTimeline, nextWorkoutProps } from "./widgetSnapshot";
import CaloriesLeftWidget from "./widgets/CaloriesLeftWidget";
import NextWorkoutWidget from "./widgets/NextWorkoutWidget";

export type { WidgetSnapshot } from "./types";

let lastKey: string | null = null;

/**
 * Updates the "Calories left" and "Next workout" widgets (iOS, expo-widgets).
 * Identical snapshots are skipped so re-renders of Today don't reload widgets.
 * Never throws: widgets are a best-effort surface.
 */
export function updateWidgets(snapshot: WidgetSnapshot): void {
  const key = JSON.stringify(snapshot);
  if (key === lastKey) return;
  try {
    CaloriesLeftWidget.updateTimeline(caloriesTimeline(snapshot));
    NextWorkoutWidget.updateSnapshot(nextWorkoutProps(snapshot));
    lastKey = key;
  } catch (e) {
    if (__DEV__) console.warn("[widgets] update failed", e);
  }
}
