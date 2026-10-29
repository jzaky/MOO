import type { MovementAnalysis, MovementKind } from "@stoke/core";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PoseCamera } from "../../features/form/PoseCamera";
import { analyzeSession } from "../../features/form/session";
import type { PoseCameraHandle, PoseFrame, PoseStatus } from "../../features/form/types";
import { haptic } from "../../lib/haptics";
import { useTheme } from "../../theme/theme";
import { StatTile } from "../../ui/charts";
import { Badge, Button, Card, Chip, Divider, IconButton, Row, SectionHeader, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";
import { t } from "../../i18n";

const secs = (ms: number) => t("{s} s", { s: (ms / 1000).toFixed(1) });
const MOVEMENTS: MovementKind[] = ["squat", "push_up"];

function movementGuide(kind: MovementKind): { label: string; title: string; start: string; setup: string; measures: string } {
  return kind === "push_up"
    ? { label: t("Push-up"), title: t("Push-up check"), start: t("Start push-up set"), setup: t("Place the phone on the floor side-on, 1.5–2 m away, so your head, hands and feet are all in frame."), measures: t("Lowest angle is the elbow angle at the bottom of each rep; smaller means deeper.") }
    : { label: t("Squat"), title: t("Squat check"), start: t("Start squat set"), setup: t("Stand side-on to the camera, 2–3 m away, with your whole body in frame. Prop the phone at about hip height."), measures: t("Lowest angle is the knee angle at the bottom of each rep; smaller means deeper.") };
}

function Results({ analysis, onAgain }: { analysis: MovementAnalysis; onAgain: () => void }) {
  const guide = movementGuide(analysis.movement);
  const conf = Math.round(analysis.trackingConfidence * 100);
  return (
    <Screen close title={guide.title} subtitle={t("Counts and angles from one camera view")} footer={<Row gap={8}><Button title={t("Try again")} kind="secondary" onPress={onAgain} style={{ flex: 1 }} /><Button title={t("Done")} onPress={() => router.back()} style={{ flex: 1 }} /></Row>}>
      <Row gap={8} align="stretch">
        <StatTile label={t("Reps counted")} value={String(analysis.repCount)} />
        <StatTile label={t("Tracking")} value={`${conf}`} unit="%" hint={conf >= 70 ? t("good") : t("low: results less reliable")} />
      </Row>
      {analysis.repCount ? (
        <>
          <SectionHeader title={t("Each rep")} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            <Row style={{ paddingVertical: 10 }}>
              <T variant="caption" color="textTertiary" style={{ width: 44 }}>{t("Rep")}</T>
              <T variant="caption" color="textTertiary" style={{ flex: 1 }}>{t("Lowest angle")}</T>
              <T variant="caption" color="textTertiary" style={{ width: 70, textAlign: "right" }}>{t("Down")}</T>
              <T variant="caption" color="textTertiary" style={{ width: 70, textAlign: "right" }}>{t("Up")}</T>
            </Row>
            {analysis.reps.map((r) => (
              <View key={r.index}>
                <Divider />
                <Row style={{ paddingVertical: 10 }}>
                  <T variant="subhead" style={{ width: 44 }}>{r.index}</T>
                  <T variant="subhead" style={{ flex: 1 }}>{Math.round(r.minAngle)}°</T>
                  <T variant="subhead" color="textSecondary" style={{ width: 70, textAlign: "right" }}>{secs(r.eccentricMs)}</T>
                  <T variant="subhead" color="textSecondary" style={{ width: 70, textAlign: "right" }}>{secs(r.concentricMs)}</T>
                </Row>
              </View>
            ))}
          </Card>
          <T variant="caption" color="textTertiary">{guide.measures}</T>
        </>
      ) : (
        <Card><T variant="subhead" color="textSecondary">{t("No full repetitions were detected. Make sure your whole body stays in frame and each rep goes all the way down and back up.")}</T></Card>
      )}
      {analysis.observations.length ? (
        <>
          <SectionHeader title={t("What the camera saw")} />
          <Card><Stack gap={8}>{analysis.observations.map((o) => <T key={o} variant="body">{o}</T>)}</Stack></Card>
        </>
      ) : null}
      <Card>
        <Stack gap={6}>
          {analysis.limitations.map((l) => <T key={l} variant="footnote" color="textSecondary">{l}</T>)}
          <T variant="footnote" color="textSecondary">{t("For pain or injury, talk to a qualified professional.")}</T>
        </Stack>
      </Card>
    </Screen>
  );
}

export default function FormCheck() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ movement?: string }>();
  const [movement, setMovement] = useState<MovementKind>(params.movement === "push_up" ? "push_up" : "squat");
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [status, setStatus] = useState<{ s: PoseStatus; message?: string }>({ s: "loading" });
  const [recording, setRecording] = useState(false);
  const [liveReps, setLiveReps] = useState(0);
  const [tracking, setTracking] = useState(false);
  const [result, setResult] = useState<MovementAnalysis | "too_short" | null>(null);
  const cam = useRef<PoseCameraHandle>(null);
  const frames = useRef<PoseFrame[]>([]);
  // A ref, not state: the last batch arrives just after Stop and must still be kept.
  const collecting = useRef(false);
  const guide = movementGuide(movement);

  const onFrames = (batch: PoseFrame[]) => {
    setTracking(batch.some((f) => f.lm));
    if (!collecting.current) return;
    frames.current.push(...batch);
    const a = analyzeSession(movement, frames.current);
    if (a && a.repCount !== liveReps) {
      setLiveReps(a.repCount);
      haptic("selection");
    }
  };
  const start = () => {
    frames.current = [];
    setLiveReps(0);
    setResult(null);
    setRecording(true);
    collecting.current = true;
    cam.current?.start();
    haptic("medium");
  };
  const stop = () => {
    cam.current?.stop();
    setRecording(false);
    // Final frames arrive with the "stopped" status; analyse then.
  };
  const onStatus = (s: PoseStatus, message?: string) => {
    setStatus({ s, message });
    if (s === "stopped") {
      collecting.current = false;
      setResult(analyzeSession(movement, frames.current) ?? "too_short");
      haptic("success");
    }
  };

  if (result && result !== "too_short") return <Results analysis={result} onAgain={() => setResult(null)} />;

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <PoseCamera ref={cam} facing={facing} onStatus={onStatus} onFrames={onFrames} />
      <Row justify="space-between" style={{ position: "absolute", top: insets.top + 8, start: 12, end: 12 }}>
        <IconButton icon="close" label={t("Close")} onPress={() => router.back()} bg="surfaceRaised" />
        {!recording ? (
          <Row gap={6}>
            {MOVEMENTS.map((k) => <Chip key={k} label={movementGuide(k).label} selected={movement === k} onPress={() => setMovement(k)} />)}
          </Row>
        ) : <Badge label={tracking ? t("tracking") : t("no person in view")} tone={tracking ? "accent" : "warning"} />}
        <IconButton icon="sync" label={t("Switch camera")} onPress={() => setFacing((f) => (f === "user" ? "environment" : "user"))} bg="surfaceRaised" />
      </Row>
      <View style={{ position: "absolute", start: 0, end: 0, bottom: 0, paddingBottom: insets.bottom + 16, paddingTop: 14, paddingHorizontal: 16, backgroundColor: "rgba(11,12,14,0.92)", gap: 12 }}>
        {status.s === "loading" ? (
          <Row gap={10} justify="center"><ActivityIndicator color={th.c.accent} /><T variant="subhead">{status.message ?? t("Starting camera")}…</T></Row>
        ) : status.s === "error" ? (
          <Stack gap={8}><T variant="subhead" color="danger" align="center">{status.message}</T><Button title={t("Close")} kind="secondary" onPress={() => router.back()} /></Stack>
        ) : recording ? (
          <Stack gap={10} style={{ alignItems: "center" }}>
            <T variant="caption" color="textSecondary">{t("Reps")}</T>
            <T variant="metricL" accessibilityLiveRegion="polite">{liveReps}</T>
            <Button title={t("Stop and review")} onPress={stop} style={{ alignSelf: "stretch" }} />
          </Stack>
        ) : (
          <Stack gap={10}>
            <T variant="footnote" color="textSecondary" align="center">{guide.setup}</T>
            {result === "too_short" ? <T variant="footnote" color="warning" align="center">{t("Not enough of the set was tracked to analyse. Check that your whole body is visible, then try again.")}</T> : null}
            <Button title={guide.start} icon="play" onPress={start} />
            <T variant="caption" color="textTertiary" align="center">{t("Analysed on this device; video is never uploaded or saved.")}</T>
          </Stack>
        )}
      </View>
    </View>
  );
}
