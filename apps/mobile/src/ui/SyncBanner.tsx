import { useOnlineManager } from "../lib/useOnline";
import { t, tn } from "../i18n";
import { flush, useOutbox } from "../lib/outbox";
import { useTheme } from "../theme/theme";
import { Pressable, View } from "react-native";
import { Icon, T } from "./primitives";

/** Unobtrusive status: offline / unsynced changes / items the server rejected. */
export function SyncBanner() {
  const th = useTheme();
  const online = useOnlineManager();
  const ops = useOutbox();
  const failed = ops.filter((o) => o.failed).length;
  const pending = ops.length - failed;
  if (online && !pending && !failed) return null;
  const text = failed
    ? tn(failed, "{n} change couldn't be saved. Tap to review.", "{n} changes couldn't be saved. Tap to review.")
    : !online
      ? pending
        ? tn(pending, "Offline · {n} change will sync automatically", "Offline · {n} changes will sync automatically")
        : t("Offline · showing saved data")
      : tn(pending, "Syncing {n} change…", "Syncing {n} changes…");
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={text} onPress={() => void flush()} style={{ marginHorizontal: 16, marginBottom: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: failed ? th.c.dangerMuted : th.c.surfaceRaised }}>
        <Icon name={failed ? "info" : online ? "sync" : "offline"} size={14} color={failed ? "danger" : "textSecondary"} />
        <T variant="footnote" color={failed ? "danger" : "textSecondary"}>
          {text}
        </T>
      </View>
    </Pressable>
  );
}
