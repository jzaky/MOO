import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from "expo-router/ui";
import { Pressable, View } from "react-native";
import { useTheme } from "../../theme/theme";
import { Icon, T, type IconName } from "../../ui/primitives";

/** Web has no system tab bar; a headless tab layout mirrors the mobile bar. */
function TabButton({ isFocused, icon, label, ref: _ref, ...props }: TabTriggerSlotProps & { icon: IconName; label: string }) {
  // expo-router's slot ref type predates RN 0.88's element refs; the trigger works without forwarding it.
  void _ref;
  return (
    <Pressable {...props} accessibilityRole="tab" accessibilityState={{ selected: !!isFocused }} style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingVertical: 8 }}>
      <Icon name={icon} size={22} color={isFocused ? "accent" : "textTertiary"} />
      <T variant="caption" color={isFocused ? "text" : "textTertiary"}>
        {label}
      </T>
    </Pressable>
  );
}

export default function WebTabsLayout() {
  const th = useTheme();
  const tabs: { name: string; href: "/" | "/nutrition" | "/train" | "/progress" | "/coach"; icon: IconName; label: string }[] = [
    { name: "index", href: "/", icon: "today", label: "Today" },
    { name: "nutrition", href: "/nutrition", icon: "nutrition", label: "Nutrition" },
    { name: "train", href: "/train", icon: "train", label: "Train" },
    { name: "progress", href: "/progress", icon: "progress", label: "Progress" },
    { name: "coach", href: "/coach", icon: "coach", label: "Coach" },
  ];
  return (
    <Tabs>
      <TabSlot style={{ flex: 1 }} />
      <TabList asChild>
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", backgroundColor: th.c.surface, borderTopWidth: 1, borderTopColor: th.c.hairline, paddingBottom: 6 }}>
          {tabs.map((t) => (
            <TabTrigger key={t.name} name={t.name} href={t.href} asChild>
              <TabButton icon={t.icon} label={t.label} />
            </TabTrigger>
          ))}
        </View>
      </TabList>
    </Tabs>
  );
}
