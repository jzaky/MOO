import type { MovementAnalysis, MovementKind } from "@stoke/core";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PoseCamera } from "../../features/form/PoseCamera";
import { analyzeSession, MOVEMENT_GUIDE } from "../../features/form/session";
import type { PoseCameraHandle, PoseFrame, PoseStatus } from "../../features/form/types";
import { haptic } from "../../lib/haptics";
import { useTheme } from "../../theme/theme";
import { StatTile } from "../../ui/charts";
import { Badge, Button, Card, Chip, Divider, IconButton, Row, SectionHeader, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function Results({ analysis, onAgain }: { analysis: MovementAnalysis; onAgain: () => void }) {
  const guide = MOVEMENT_GUIDE[analysis.movement];
  const conf = Math.round(analysis.trackingConfidence * 100);
  return (
    <Screen close title={`${guide.label} check`} subtitle="Counts and angles from one camera view" footer={<Row gap={8}><Button title="Try again" kind="secondary" onPress={onAgain} style={{ flex: 1 }} /><Button title="Done" onPress={() => router.back()} style={{ flex: 1 }} /></Row>}>
      <Row gap={8} align="stretch">
        <StatTile label="Reps counted" value={String(analysis.repCount)} />
        <StatTile label="Tracking" value={`${conf}`} unit="%" hint={conf >= 70 ? "good" : "low: results less reliable"} />
      </Row>
      {analysis.repCount ? (
        <>
          <SectionHeader title="Each rep" />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            <Row style={{ paddingVertical: 10 }}>
              <T variant="caption" color="textTertiary" style={{ width: 44 }}>Rep</T>
              <T variant="caption" color="textTertiary" style={{ flex: 1 }}>Lowest angle</T>
              <T variant="caption" color="textTertiary" style={{ width: 70, textAlign: "right" }}>Down</T>
              <T variant="caption" color="textTertiary" style={{ width: 70, textAlign: "right" }}>Up</T>
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
          <T variant="caption" color="textTertiary">Lowest angle is the {guide.measures}; smaller means deeper.</T>
        </>
      ) : (
        <Card><T variant="subhead" color="textSecondary">No full repetitions were detected. Make sure your whole body stays in frame and each rep goes all the way down and back up.</T></Card>
      )}
      {analysis.observations.length ? (
        <>
          <SectionHeader title="What the camera saw" />
          <Card><Stack gap={8}>{analysis.observations.map((o) => <T key={o} variant="body">{o}</T>)}</Stack></Card>
        </>
      ) : null}
      <Card>
        <Stack gap={6}>
          {analysis.limitations.map((l) => <T key={l} variant="footnote" color="textSecondary">{l}</T>)}
          <T variant="footnote" color="textSecondary">For pain or injury, talk to a qualified professional.</T>
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
  const guide = MOVEMENT_GUIDE[movement];

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
      <Row justify="space-between" style={{ position: "absolute", top: insets.top + 8, left: 12, right: 12 }}>
        <IconButton icon="close" label="Close" onPress={() => router.back()} bg="surfaceRaised" />
        {!recording ? (
          <Row gap={6}>
            {(Object.keys(MOVEMENT_GUIDE) as MovementKind[]).map((k) => <Chip key={k} label={MOVEMENT_GUIDE[k].label} selected={movement === k} onPress={() => setMovement(k)} />)}
          </Row>
        ) : <Badge label={tracking ? "tracking" : "no person in view"} tone={tracking ? "accent" : "warning"} />}
        <IconButton icon="sync" label="Switch camera" onPress={() => setFacing((f) => (f === "user" ? "environment" : "user"))} bg="surfaceRaised" />
      </Row>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: insets.bottom + 16, paddingTop: 14, paddingHorizontal: 16, backgroundColor: "rgba(11,12,14,0.92)", gap: 12 }}>
        {status.s === "loading" ? (
          <Row gap={10} justify="center"><ActivityIndicator color={th.c.accent} /><T variant="subhead">{status.message ?? "Starting camera"}…</T></Row>
        ) : status.s === "error" ? (
          <Stack gap={8}><T variant="subhead" color="danger" align="center">{status.message}</T><Button title="Close" kind="secondary" onPress={() => router.back()} /></Stack>
        ) : recording ? (
          <Stack gap={10} style={{ alignItems: "center" }}>
            <T variant="caption" color="textSecondary">Reps</T>
            <T variant="metricL" accessibilityLiveRegion="polite">{liveReps}</T>
            <Button title="Stop and review" onPress={stop} style={{ alignSelf: "stretch" }} />
          </Stack>
        ) : (
          <Stack gap={10}>
            <T variant="footnote" color="textSecondary" align="center">{guide.setup}</T>
            {result === "too_short" ? <T variant="footnote" color="warning" align="center">Not enough of the set was tracked to analyse. Check that your whole body is visible, then try again.</T> : null}
            <Button title={`Start ${guide.label.toLowerCase()} set`} icon="play" onPress={start} />
            <T variant="caption" color="textTertiary" align="center">Analysed on this device; video is never uploaded or saved.</T>
          </Stack>
        )}
      </View>
    </View>
  );
}
