import { Gauge, HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, gaugeStyle, lineLimit, minimumScaleFactor, monospacedDigit, padding, tint, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import type { CaloriesWidgetProps } from "../types";

/**
 * "Calories left" home-screen / Lock Screen widget (iOS).
 *
 * The function body is compiled by the `'widget'` directive into a string that
 * runs in the widget extension's isolated runtime: it may only use Expo UI
 * (SwiftUI) components and modifiers, its props and the environment. Nothing
 * declared outside the function (constants, helpers, theme tokens) exists there,
 * so colours are inlined. Props arrive as JSON.
 */
const CaloriesLeftWidget = (props: CaloriesWidgetProps, environment: WidgetEnvironment) => {
  "widget";
  const energy = "#1FA971";
  const protein = "#4F8DF0";
  const secondary = "#A1A5AE";
  const left = props.kcalLeft;
  const over = left != null && left < 0;
  const big = left == null ? "–" : String(Math.abs(left));
  const caption = props.stale ? "Open Stoke" : left == null ? "No target" : over ? "kcal over" : "kcal left";
  const proteinLine = props.stale ? "To update today" : props.proteinLeftG == null ? "" : `${props.proteinLeftG} g protein left`;
  const url = "stoke://nutrition";

  if (environment.widgetFamily === "accessoryCircular") {
    return (
      <Gauge value={props.progress} modifiers={[gaugeStyle("circularCapacity"), widgetURL(url)]} currentValueLabel={<Text modifiers={[monospacedDigit(), minimumScaleFactor(0.5)]}>{big}</Text>}>
        <Text>kcal</Text>
      </Gauge>
    );
  }

  const ring = (
    <Gauge value={props.progress} modifiers={[gaugeStyle("circularCapacity"), tint(over ? "#F0A04F" : energy)]} currentValueLabel={<Image systemName="flame.fill" color={over ? "#F0A04F" : energy} />}>
      <Text>Energy</Text>
    </Gauge>
  );

  const numbers = (
    <VStack alignment="leading" spacing={2}>
      <Text modifiers={[font({ size: 30, weight: "bold", design: "rounded" }), monospacedDigit(), minimumScaleFactor(0.6), lineLimit(1)]}>{big}</Text>
      <Text modifiers={[font({ size: 13, weight: "medium" }), foregroundStyle(secondary)]}>{caption}</Text>
      {proteinLine ? <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(props.stale ? secondary : protein), lineLimit(1), minimumScaleFactor(0.7)]}>{proteinLine}</Text> : null}
    </VStack>
  );

  if (environment.widgetFamily === "systemMedium") {
    return (
      <HStack spacing={16} modifiers={[padding({ all: 4 }), widgetURL(url)]}>
        {ring}
        {numbers}
        <Spacer />
      </HStack>
    );
  }

  return (
    <VStack alignment="leading" spacing={6} modifiers={[frame({ maxWidth: 10000, maxHeight: 10000, alignment: "topLeading" }), widgetURL(url)]}>
      <HStack spacing={6}>
        {ring}
        <Spacer />
      </HStack>
      <Spacer />
      {numbers}
    </VStack>
  );
};

export default createWidget<CaloriesWidgetProps>("CaloriesLeft", CaloriesLeftWidget, { kcalLeft: null, kcalTarget: null, proteinLeftG: null, progress: 0, stale: true });
