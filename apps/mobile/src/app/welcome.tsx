import { router } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/theme";
import { Button, Icon, Stack, T } from "../ui/primitives";

export default function Welcome() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const points: { icon: "nutrition" | "train" | "progress" | "coach"; title: string; body: string }[] = [
    { icon: "nutrition", title: "Log food in seconds", body: "Barcode, photo, voice or your usual meals." },
    { icon: "train", title: "Train with a plan", body: "Fast set logging and sensible progression." },
    { icon: "progress", title: "See real trends", body: "Smoothed weight, strength and consistency." },
    { icon: "coach", title: "A coach that uses your data", body: "Suggestions you approve, never silent changes." },
  ];
  return (
    <View style={{ flex: 1, backgroundColor: th.c.bg, paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24, paddingHorizontal: 24, justifyContent: "space-between" }}>
      <Stack gap={28} style={{ maxWidth: 520, width: "100%", alignSelf: "center" }}>
        <View style={{ gap: 10 }}>
          <T variant="label" color="accent">
            Stoke
          </T>
          <T variant="display" style={{ fontSize: 40, lineHeight: 46 }}>
            Your nutrition, training and progress in one place.
          </T>
        </View>
        <Stack gap={18}>
          {points.map((p) => (
            <View key={p.title} style={{ flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: th.c.surfaceRaised, alignItems: "center", justifyContent: "center" }}>
                <Icon name={p.icon} size={18} color="accent" />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <T variant="headline">{p.title}</T>
                <T variant="subhead" color="textSecondary">
                  {p.body}
                </T>
              </View>
            </View>
          ))}
        </Stack>
      </Stack>
      <Stack gap={10} style={{ maxWidth: 520, width: "100%", alignSelf: "center" }}>
        <Button title="Create account" onPress={() => router.push("/sign-up")} />
        <Button title="I already have an account" kind="ghost" onPress={() => router.push("/sign-in")} />
      </Stack>
    </View>
  );
}
