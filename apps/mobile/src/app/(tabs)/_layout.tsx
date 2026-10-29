import { NativeTabs } from "expo-router/native-tabs";
import { useTheme } from "../../theme/theme";

/** System tab bar (Liquid Glass on iOS 26, Material on Android). Five tabs, no more. */
export default function TabsLayout() {
  const th = useTheme();
  return (
    <NativeTabs tintColor={th.c.accent} iconColor={{ default: th.c.textTertiary, selected: th.c.accent }} labelStyle={{ default: { color: th.c.textTertiary }, selected: { color: th.c.text } }} backgroundColor={th.c.bg}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sun.max.fill" md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="nutrition">
        <NativeTabs.Trigger.Label>Nutrition</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="fork.knife" md="restaurant" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="train">
        <NativeTabs.Trigger.Label>Train</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="dumbbell.fill" md="fitness_center" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="progress">
        <NativeTabs.Trigger.Label>Progress</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.line.uptrend.xyaxis" md="monitoring" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="coach">
        <NativeTabs.Trigger.Label>Coach</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sparkles" md="auto_awesome" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
