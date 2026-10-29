import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, lineLimit, minimumScaleFactor, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import type { NextWorkoutWidgetProps } from "../types";

/**
 * "Next workout" widget (iOS). See CaloriesLeftWidget for the rules of the
 * `'widget'` runtime (no outside references, Expo UI components only).
 */
const NextWorkoutWidget = (props: NextWorkoutWidgetProps, environment: WidgetEnvironment) => {
  "widget";
  const accent = "#7CF0B4";
  const secondary = "#A1A5AE";
  const url = "stoke://workout/start";
  const title = props.name ?? "Plan a workout";
  const action = props.inProgress ? "Tap to resume" : props.name ? "Tap to start" : "Open Train";

  if (environment.widgetFamily === "accessoryRectangular") {
    return (
      <VStack alignment="leading" spacing={1} modifiers={[widgetURL(url)]}>
        <Text modifiers={[font({ size: 12, weight: "semibold" })]}>{props.label}</Text>
        <Text modifiers={[font({ size: 15, weight: "bold" }), lineLimit(2), minimumScaleFactor(0.7)]}>{title}</Text>
      </VStack>
    );
  }

  return (
    <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: 10000, maxHeight: 10000, alignment: "topLeading" }), widgetURL(url)]}>
      <HStack spacing={6}>
        <Image systemName="figure.strengthtraining.traditional" color={accent} size={18} />
        <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(props.inProgress ? accent : secondary)]}>{props.label}</Text>
      </HStack>
      <Spacer />
      <Text modifiers={[font({ size: 20, weight: "bold", design: "rounded" }), lineLimit(2), minimumScaleFactor(0.6)]}>{title}</Text>
      <Text modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle(secondary)]}>{action}</Text>
    </VStack>
  );
};

export default createWidget<NextWorkoutWidgetProps>("NextWorkout", NextWorkoutWidget, { name: null, label: "No plan yet", inProgress: false });
