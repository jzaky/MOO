import { router, type Href } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Platform, Pressable, View, type ViewStyle } from "react-native";
import { t } from "../../i18n";
import { useToday } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { useTheme } from "../../theme/theme";
import { Icon, T, type IconName } from "../../ui/primitives";
import { getActiveWorkout } from "../workout/store";

export function useQuickWheel() {
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => {
    haptic("medium");
    setVisible(true);
  }, []);
  const close = useCallback(() => setVisible(false), []);
  return { visible, open, close };
}

/** Positions on an arc above the "+" (dx, dy from its centre). */
const ARC: [number, number][] = [
  [-118, -46],
  [-66, -116],
  [0, -138],
  [66, -116],
  [118, -46],
];

/**
 * Hold "+" → five shortcuts fan out above it. Tap one, or tap anywhere else to close.
 * Reduce Motion: items appear in place without the spring.
 */
export function QuickWheel({ visible, close, bottom }: { visible: boolean; close: () => void; bottom: number }) {
  const th = useTheme();
  const today = useToday();
  const [k] = useState(() => new Animated.Value(0));
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
  }, []);
  useEffect(() => {
    if (!visible) return void k.setValue(0);
    if (reduce) return void k.setValue(1);
    Animated.spring(k, { toValue: 1, useNativeDriver: Platform.OS !== "web", friction: 6, tension: 90 }).start();
  }, [visible, reduce, k]);
  if (!visible) return null;

  const next = today.data?.workout?.scheduledToday ?? today.data?.workout?.nextInRotation ?? null;
  const go = (href: Href) => {
    haptic("light");
    close();
    router.push(href);
  };
  const items: { icon: IconName; label: string; run: () => void }[] = [
    { icon: "barcode", label: t("Scan"), run: () => go("/food/scan") },
    { icon: "camera", label: t("Plate"), run: () => go("/food/camera") },
    { icon: "mic", label: t("Voice"), run: () => go("/food/voice") },
    { icon: "train", label: t("Workout"), run: () => go(getActiveWorkout() || !next ? "/workout/active" : { pathname: "/workout/active", params: { templateId: next.id } }) },
    { icon: "scale", label: t("Weigh-in"), run: () => go("/weigh-in") },
  ];
  const blur = Platform.OS === "web" ? ({ backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" } as ViewStyle) : null;

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }} accessibilityViewIsModal>
      <Pressable accessibilityRole="button" accessibilityLabel={t("Close quick actions")} onPress={close} style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: th.c.overlay }, blur]} />
      <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: bottom + 32, alignItems: "center" }}>
        {items.map((it, i) => {
          const [dx, dy] = ARC[i]!;
          const style = {
            opacity: k.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
            transform: [{ translateX: k.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) }, { translateY: k.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) }, { scale: k.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
          };
          return (
            <Animated.View key={it.label} style={[{ position: "absolute", bottom: 0 }, style]}>
              <Pressable accessibilityRole="button" accessibilityLabel={it.label} onPress={it.run} style={({ pressed }) => ({ width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", gap: 2, backgroundColor: pressed ? th.c.surfacePressed : th.c.surfaceRaised, borderWidth: 1, borderColor: th.c.border })}>
                <Icon name={it.icon} size={20} color="accentGold" />
                <T variant="caption" weight="700" style={{ fontSize: 10 }}>
                  {it.label}
                </T>
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}
