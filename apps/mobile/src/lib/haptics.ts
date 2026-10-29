import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/** Restrained haptics: selection ticks, light confirmations, success for saves/sets, heavy only for PRs. */
export function haptic(kind: "selection" | "light" | "medium" | "success" | "warning" | "pr"): void {
  if (Platform.OS === "web") return;
  try {
    switch (kind) {
      case "selection":
        void Haptics.selectionAsync();
        break;
      case "light":
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case "medium":
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case "success":
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case "warning":
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case "pr":
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
    }
  } catch {
    /* haptics are best-effort */
  }
}
