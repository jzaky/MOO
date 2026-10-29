import { HStack, Image, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { activityBackgroundTint, font, foregroundStyle, frame, lineLimit, monospacedDigit, multilineTextAlignment, padding, tint } from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";
import type { RestActivityProps } from "../types";

/**
 * Rest-timer Live Activity (Lock Screen banner + Dynamic Island).
 *
 * The countdown is SwiftUI's system timer text (`Text(timerInterval:countsDown:)`),
 * so it ticks on its own without any updates from the app. When the rest is
 * over the activity becomes stale (staleDate = endsAt) and shows "Rest done".
 * Runs in the isolated widget runtime: no outside references, props are JSON.
 */
const RestActivity = (props: RestActivityProps, environment: LiveActivityEnvironment) => {
  "widget";
  const accent = "#7CF0B4";
  const secondary = "#A1A5AE";
  const done = environment.isStale === true;
  const lower = new Date(Math.min(props.startedAt, props.endsAt));
  const upper = new Date(props.endsAt);
  const timer = (size: number, maxWidth: number) =>
    done ? (
      <Text modifiers={[font({ size: Math.max(13, size * 0.6), weight: "semibold" }), foregroundStyle(accent)]}>{size < 20 ? "Done" : "Rest done"}</Text>
    ) : (
      <Text timerInterval={{ lower, upper }} countsDown modifiers={[font({ size, weight: "semibold", design: "rounded" }), monospacedDigit(), foregroundStyle(accent), multilineTextAlignment("trailing"), frame({ maxWidth })]} />
    );
  const progress = done ? null : <ProgressView timerInterval={{ lower, upper }} countsDown modifiers={[tint(accent)]} />;

  return {
    banner: (
      <VStack spacing={8} modifiers={[padding({ all: 16 }), activityBackgroundTint("#0B0C0E")]}>
        <HStack spacing={12}>
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[font({ size: 13, weight: "medium" }), foregroundStyle(secondary)]}>Rest</Text>
            <Text modifiers={[font({ size: 17, weight: "bold" }), foregroundStyle("#F2F3F5"), lineLimit(1)]}>{props.exerciseName}</Text>
            <Text modifiers={[font({ size: 13 }), foregroundStyle(secondary), lineLimit(1)]}>{props.setLabel}</Text>
          </VStack>
          <Spacer />
          {timer(34, 120)}
        </HStack>
        {progress}
      </VStack>
    ),
    compactLeading: <Image systemName="timer" color={accent} />,
    compactTrailing: timer(15, 52),
    minimal: <Image systemName="timer" color={accent} />,
    expandedLeading: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ leading: 4 })]}>
        <Image systemName="timer" color={accent} />
        <Text modifiers={[font({ size: 12 }), foregroundStyle(secondary)]}>Rest</Text>
      </VStack>
    ),
    expandedTrailing: timer(28, 110),
    expandedBottom: (
      <VStack alignment="leading" spacing={4}>
        <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>{props.exerciseName}</Text>
        <Text modifiers={[font({ size: 13 }), foregroundStyle(secondary), lineLimit(1)]}>{props.setLabel}</Text>
        {progress}
      </VStack>
    ),
  };
};

export default createLiveActivity<RestActivityProps>("RestTimer", RestActivity);
