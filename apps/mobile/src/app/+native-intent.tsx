import { resolveDeepLink } from "../features/native/deepLinks";
import { getActiveWorkout } from "../features/workout/store";

/**
 * Rewrites incoming native deep links (Siri / App Shortcuts, widgets, the rest
 * Live Activity, Android launcher shortcuts) to app routes before Expo Router
 * resolves them. See `features/native/deepLinks.ts` for the URL table.
 * Unknown URLs pass through unchanged. Must never throw.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return resolveDeepLink(path, { hasActiveWorkout: getActiveWorkout() != null }) ?? path;
  } catch {
    return path;
  }
}
