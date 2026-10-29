import { useMutation } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { File as FsFile } from "expo-file-system";
import { router } from "expo-router";
import { useState } from "react";
import { Platform, Switch, View } from "react-native";
import { api, ApiError } from "../lib/api";
import { qk } from "../lib/data";
import { haptic } from "../lib/haptics";
import { queryClient } from "../lib/query";
import { useTheme } from "../theme/theme";
import { Badge, Button, Card, Chip, Divider, Row, SectionHeader, Segmented, Stack, T } from "../ui/primitives";
import { Screen } from "../ui/Screen";

type Choice = "auto" | "create" | "skip";
interface Preview {
  source: "strong" | "hevy" | "mfp_nutrition" | "mfp_measurements";
  sourceLabel: string;
  rowsRead: number;
  workouts: { count: number; sets: number; range: { from: string; to: string } | null };
  meals: { count: number; days: number; range: { from: string; to: string } | null };
  weights: { count: number; range: { from: string; to: string } | null };
  exercises: { name: string; sets: number; match: { id: string; name: string } | null }[];
  warnings: string[];
}
interface Result {
  workouts: { imported: number; alreadyPresent: number };
  sets: number;
  meals: { imported: number; alreadyPresent: number };
  weights: { imported: number; alreadyPresent: number };
  exercisesCreated: string[];
  daysMarkedComplete: number;
}

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");
const span = (r: { from: string; to: string } | null) => (r ? (r.from === r.to ? r.from : `${r.from} to ${r.to}`) : "");

const HOW = [
  { app: "Strong", steps: "Settings → Export Strong Data. Pick the CSV file." },
  { app: "Hevy", steps: "Profile → Settings → Export & Import Data → Export Workouts. Pick the CSV file." },
  { app: "MyFitnessPal", steps: "Use MyFitnessPal's data export, unzip it, and pick the Nutrition Summary or Measurement Summary CSV (one at a time)." },
];

async function readPicked(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  if (Platform.OS === "web") return asset.file ? asset.file.text() : (await fetch(asset.uri)).text();
  return new FsFile(asset.uri).text();
}

export default function ImportScreen() {
  const th = useTheme();
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [unit, setUnit] = useState<"kg" | "lb">("kg");
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [markComplete, setMarkComplete] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const preview = useMutation({ mutationFn: (v: { text: string; unit: "kg" | "lb" }) => api<Preview>("/v1/import/preview", { body: { text: v.text, weightUnit: v.unit } }) });
  const commit = useMutation({
    mutationFn: () => {
      const exerciseChoices = Object.fromEntries(Object.entries(choices).filter(([, c]) => c !== "auto"));
      return api<Result>("/v1/import/commit", { body: { text, weightUnit: unit, exerciseChoices, markDaysComplete: markComplete } });
    },
    onSuccess: () => {
      haptic("success");
      for (const k of [qk.workouts, qk.weight, qk.analytics, qk.today, ["diary"]]) void queryClient.invalidateQueries({ queryKey: k });
    },
  });

  const pick = async () => {
    setReadError(null);
    const r = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain", "application/csv", "*/*"], copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets[0]) return;
    try {
      const content = await readPicked(r.assets[0]);
      setText(content);
      setFileName(r.assets[0].name);
      setChoices({});
      commit.reset();
      preview.mutate({ text: content, unit });
    } catch {
      setReadError("Couldn't read that file. Pick the CSV file itself (unzip MyFitnessPal exports first).");
    }
  };
  const changeUnit = (u: "kg" | "lb") => {
    setUnit(u);
    if (text) preview.mutate({ text, unit: u });
  };

  const p = preview.data;
  const r = commit.data;
  const unitMatters = p && (p.source === "strong" || p.source === "mfp_measurements");

  if (r) {
    return (
      <Screen close title="Import complete" footer={<Button title="Done" onPress={() => router.back()} />}>
        <Card>
          <Stack gap={8}>
            {r.workouts.imported || r.workouts.alreadyPresent ? <T variant="body">{r.workouts.imported} workouts ({r.sets} sets) imported{r.workouts.alreadyPresent ? `; ${r.workouts.alreadyPresent} were already here` : ""}.</T> : null}
            {r.meals.imported || r.meals.alreadyPresent ? <T variant="body">{r.meals.imported} meals imported{r.meals.alreadyPresent ? `; ${r.meals.alreadyPresent} were already here` : ""}.</T> : null}
            {r.weights.imported || r.weights.alreadyPresent ? <T variant="body">{r.weights.imported} weigh-ins imported{r.weights.alreadyPresent ? `; ${r.weights.alreadyPresent} were already here` : ""}.</T> : null}
            {r.exercisesCreated.length ? <T variant="footnote" color="textSecondary">New custom exercises: {r.exercisesCreated.join(", ")}.</T> : null}
            {r.daysMarkedComplete ? <T variant="footnote" color="textSecondary">{r.daysMarkedComplete} days marked complete.</T> : null}
            <T variant="caption" color="textTertiary">Importing the same file again won't create duplicates.</T>
          </Stack>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      close
      title="Import history"
      subtitle="From Strong, Hevy or MyFitnessPal"
      footer={p ? <Stack gap={6}>{commit.error ? <T variant="footnote" color="danger">{errText(commit.error)}</T> : null}<Button title={`Import from ${p.sourceLabel}`} loading={commit.isPending} onPress={() => commit.mutate()} /></Stack> : undefined}
    >
      {!p ? (
        <>
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            {HOW.map((h, i) => (
              <View key={h.app}>
                {i ? <Divider /> : null}
                <Stack gap={2} style={{ paddingVertical: 12 }}>
                  <T variant="headline">{h.app}</T>
                  <T variant="footnote" color="textSecondary">{h.steps}</T>
                </Stack>
              </View>
            ))}
          </Card>
          <Button title={preview.isPending ? "Reading…" : "Choose export file"} icon="add" loading={preview.isPending} onPress={() => void pick()} />
          {readError ? <T variant="footnote" color="danger">{readError}</T> : null}
          {preview.error ? <T variant="footnote" color="danger">{errText(preview.error)}</T> : null}
          <T variant="caption" color="textTertiary">You'll see exactly what will be imported before anything is saved. Nothing is sent anywhere except your own Stoke account.</T>
        </>
      ) : (
        <>
          <Card>
            <Stack gap={6}>
              <Row justify="space-between">
                <T variant="headline">{p.sourceLabel}</T>
                <Badge label={fileName ?? "file"} />
              </Row>
              {p.workouts.count ? <T variant="body">{p.workouts.count} workouts · {p.workouts.sets} sets · {span(p.workouts.range)}</T> : null}
              {p.meals.count ? <T variant="body">{p.meals.count} meals over {p.meals.days} days · {span(p.meals.range)}</T> : null}
              {p.weights.count ? <T variant="body">{p.weights.count} weigh-ins · {span(p.weights.range)}</T> : null}
              {p.warnings.map((w) => <T key={w} variant="footnote" color="warning">{w}</T>)}
            </Stack>
          </Card>
          {unitMatters ? (
            <View style={{ gap: 6 }}>
              <T variant="footnote" color="textSecondary">Weights in this file are in</T>
              <Segmented options={[{ value: "kg", label: "kilograms" }, { value: "lb", label: "pounds" }]} value={unit} onChange={changeUnit} />
            </View>
          ) : null}
          {p.meals.count ? (
            <Card>
              <Row justify="space-between">
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <T variant="body">Mark these days as complete</T>
                  <T variant="footnote" color="textSecondary">Only if you logged everything you ate on them. Complete days are used to adapt your targets.</T>
                </View>
                <Switch accessibilityLabel="Mark imported days complete" value={markComplete} onValueChange={setMarkComplete} trackColor={{ true: th.c.accent, false: th.c.track }} />
              </Row>
            </Card>
          ) : null}
          {p.exercises.length ? (
            <>
              <SectionHeader title={`Exercises (${p.exercises.length})`} />
              <T variant="footnote" color="textSecondary">Matched to Stoke's catalogue only when the names clearly agree. Others become your own custom exercises.</T>
              <Card padded={false} style={{ paddingHorizontal: 14 }}>
                {p.exercises.map((e, i) => {
                  const c = choices[e.name] ?? "auto";
                  return (
                    <View key={e.name}>
                      {i ? <Divider /> : null}
                      <Stack gap={6} style={{ paddingVertical: 12 }}>
                        <Row justify="space-between" align="flex-start">
                          <T variant="body" style={{ flex: 1 }}>{e.name}</T>
                          <T variant="caption" color="textTertiary">{e.sets} sets</T>
                        </Row>
                        <T variant="footnote" color={e.match && c === "auto" ? "accent" : "textSecondary"}>
                          {c === "skip" ? "Won't be imported" : c === "create" || !e.match ? "Will be created as a custom exercise" : `→ ${e.match.name}`}
                        </T>
                        <Row gap={6} wrap>
                          {e.match ? <Chip label="Use match" selected={c === "auto"} onPress={() => setChoices((s) => ({ ...s, [e.name]: "auto" }))} /> : null}
                          <Chip label="Create new" selected={c === "create" || (!e.match && c === "auto")} onPress={() => setChoices((s) => ({ ...s, [e.name]: e.match ? "create" : "auto" }))} />
                          <Chip label="Skip" selected={c === "skip"} onPress={() => setChoices((s) => ({ ...s, [e.name]: "skip" }))} />
                        </Row>
                      </Stack>
                    </View>
                  );
                })}
              </Card>
            </>
          ) : null}
          <Button title="Choose a different file" kind="ghost" size="sm" onPress={() => { preview.reset(); setText(null); }} />
        </>
      )}
    </Screen>
  );
}
