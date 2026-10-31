import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from "expo-router/ui";
import { router } from "expo-router";
import { Platform, Pressable, useWindowDimensions, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { QuickWheel, useQuickWheel } from "../../features/command/QuickWheel";
import { t } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { useTheme } from "../../theme/theme";
import { fireFill, Icon, T, type IconName } from "../../ui/primitives";

/**
 * One tab bar on every platform: four tabs around a raised "+".
 * Tap "+" for the command bar (log, ask, start anything); hold it for the quick-action wheel.
 * The coach lives in the command bar and on Today, so it has no tab of its own.
 */
function TabButton({ isFocused, icon, label, ref: _ref, ...props }: TabTriggerSlotProps & { icon: IconName; label: string }) {
  const accent = useTheme().c.accent;
  // expo-router's slot ref type predates RN 0.88's element refs; the trigger works without forwarding it.
  void _ref;
  return (
    <Pressable {...props} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: !!isFocused }} aria-selected={!!isFocused} style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 3, height: 64 }}>
      <Icon name={icon} size={21} color={isFocused ? "text" : "textTertiary"} />
      <T variant="caption" weight="700" color={isFocused ? "text" : "textTertiary"} style={{ fontSize: 10 }}>
        {label}
      </T>
      {isFocused ? <View style={{ position: "absolute", bottom: 6, width: 4, height: 4, borderRadius: 2, backgroundColor: accent }} /> : null}
    </Pressable>
  );
}

function PlusButton({ onHold }: { onHold: () => void }) {
  const th = useTheme();
  return (
    <View style={{ width: 72, alignItems: "center" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("Log, ask or start anything")}
        accessibilityHint={t("Hold for quick actions")}
        accessibilityActions={[{ name: "longpress", label: t("Quick actions") }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === "longpress" && onHold()}
        onPress={() => {
          haptic("light");
          router.push("/log");
        }}
        onLongPress={onHold}
        delayLongPress={320}
        style={({ pressed }) => [
          fireFill(th, 140),
          { width: 58, height: 58, marginTop: -26, borderRadius: 20, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.94 : 1 }] },
          Platform.OS === "web" ? ({ boxShadow: "0 12px 30px -6px rgba(255,90,40,0.7)" } as ViewStyle) : { shadowColor: "#FF5A28", shadowOpacity: 0.6, shadowRadius: 16, shadowOffset: { width: 0, height: 10 }, elevation: 10 },
        ]}
      >
        <Icon name="add" size={28} color="textInverse" />
      </Pressable>
    </View>
  );
}

export default function TabsLayout() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const barWidth = Math.min(width - 24, 560);
  const wheel = useQuickWheel();
  const tabs = [
    { name: "index", href: "/", icon: "today", label: t("Today") },
    { name: "nutrition", href: "/nutrition", icon: "nutrition", label: t("Food") },
    { name: "train", href: "/train", icon: "train", label: t("Train") },
    { name: "progress", href: "/progress", icon: "progress", label: t("Progress") },
  ] as const;
  const glass = Platform.OS === "web" ? ({ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" } as ViewStyle) : null;
  return (
    <Tabs>
      <TabSlot style={{ flex: 1 }} />
      <QuickWheel {...wheel} bottom={insets.bottom + 14} />
      <TabList asChild>
        {/* The triggers must be direct children of this view: the tab router reads them from here. */}
        {/* One plain style object: TabList's slot merges styles and can't take an array. */}
        <View style={{ position: "absolute", bottom: Math.max(insets.bottom, 10) + 4, left: (width - barWidth) / 2, width: barWidth, height: 64, flexDirection: "row", alignItems: "center", borderRadius: 26, backgroundColor: "rgba(20,22,25,0.92)", borderWidth: 1, borderColor: th.c.border, ...glass }}>
          <TabTrigger name={tabs[0].name} href={tabs[0].href} asChild>
            <TabButton icon={tabs[0].icon} label={tabs[0].label} />
          </TabTrigger>
          <TabTrigger name={tabs[1].name} href={tabs[1].href} asChild>
            <TabButton icon={tabs[1].icon} label={tabs[1].label} />
          </TabTrigger>
          <PlusButton onHold={wheel.open} />
          <TabTrigger name={tabs[2].name} href={tabs[2].href} asChild>
            <TabButton icon={tabs[2].icon} label={tabs[2].label} />
          </TabTrigger>
          <TabTrigger name={tabs[3].name} href={tabs[3].href} asChild>
            <TabButton icon={tabs[3].icon} label={tabs[3].label} />
          </TabTrigger>
          {/* Reachable from the command bar and Today; registered so links to /coach keep working. */}
          <TabTrigger name="coach" href="/coach" style={{ display: "none" }} />
        </View>
      </TabList>
    </Tabs>
  );
}
