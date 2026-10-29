import { Modal, Pressable, View } from "react-native";
import { t } from "../i18n";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/theme";
import { Icon, T, type IconName } from "./primitives";

export interface SheetAction {
  label: string;
  icon?: IconName;
  destructive?: boolean;
  onPress: () => void;
}

/** Bottom action sheet for contextual actions (one level only; never stacked). */
export function ActionSheet({ visible, title, actions, onClose }: { visible: boolean; title?: string; actions: SheetAction[]; onClose: () => void }) {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel={t("Dismiss")} style={{ flex: 1, backgroundColor: th.c.overlay }} onPress={onClose} />
      <View style={{ backgroundColor: th.c.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 10, paddingBottom: insets.bottom + 10, paddingHorizontal: 12 }}>
        <View style={{ alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: th.c.border, marginBottom: 8 }} />
        {title ? (
          <T variant="footnote" color="textSecondary" align="center" style={{ paddingVertical: 8 }} numberOfLines={2}>
            {title}
          </T>
        ) : null}
        {actions.map((a) => (
          <Pressable
            key={a.label}
            accessibilityRole="button"
            onPress={() => {
              onClose();
              a.onPress();
            }}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, height: 52, borderRadius: 12, backgroundColor: pressed ? th.c.surfacePressed : "transparent" })}
          >
            {a.icon ? <Icon name={a.icon} size={18} color={a.destructive ? "danger" : "text"} /> : null}
            <T variant="body" color={a.destructive ? "danger" : "text"}>
              {a.label}
            </T>
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" onPress={onClose} style={{ height: 52, alignItems: "center", justifyContent: "center", marginTop: 4 }}>
          <T variant="headline" color="textSecondary">
            {t("Cancel")}
          </T>
        </Pressable>
      </View>
    </Modal>
  );
}
