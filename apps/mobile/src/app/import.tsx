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
import { fmtDay, t, tn } from "../i18n";

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

const errText = (e: unknown) => (e instanceof ApiError ? e.message : t("Something went wrong. Try again."));
const dateFull = (d: string) => fmtDay(d, { year: "numeric", month: "short", day: "numeric" });
const span = (r: { from: string; to: string } | null) => (r ? (r.from === r.to ? dateFull(r.from) : t("{from} to {to}", { from: dateFull(r.from), to: dateFull(r.to) })) : "");

// App names stay in English; the steps name each app's own (English) menus.
const how = () => [
  { app: "Strong", steps: t("Settings → Export Strong Data. Pick the CSV file.") },
  { app: "Hevy", steps: t("Profile → Settings → Export & Import Data → Export Workouts. Pick the CSV file.") },
  { app: "MyFitnessPal", steps: t("Use MyFitnessPal's data export, unzip it, and pick the Nutrition Summary or Measurement Summary CSV (one at a time).") },
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
      setReadError(t("Couldn't read that file. Pick the CSV file itself (unzip MyFitnessPal exports first)."));
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
      <Screen close title={t("Import complete")} footer={<Button title={t("Done")} onPress={() => router.back()} />}>
        <Card>
          <Stack gap={8}>
            {r.workouts.imported || r.workouts.alreadyPresent ? <T variant="body">{tn(r.workouts.imported, "{n} workout imported ({sets} sets).", "{n} workouts imported ({sets} sets).", { sets: r.sets })}{r.workouts.alreadyPresent ? ` ${tn(r.workouts.alreadyPresent, "{n} was already here.", "{n} were already here.")}` : ""}</T> : null}
            {r.meals.imported || r.meals.alreadyPresent ? <T variant="body">{tn(r.meals.imported, "{n} meal imported.", "{n} meals imported.")}{r.meals.alreadyPresent ? ` ${tn(r.meals.alreadyPresent, "{n} was already here.", "{n} were already here.")}` : ""}</T> : null}
            {r.weights.imported || r.weights.alreadyPresent ? <T variant="body">{tn(r.weights.imported, "{n} weigh-in imported.", "{n} weigh-ins imported.")}{r.weights.alreadyPresent ? ` ${tn(r.weights.alreadyPresent, "{n} was already here.", "{n} were already here.")}` : ""}</T> : null}
            {r.exercisesCreated.length ? <T variant="footnote" color="textSecondary">{t("New custom exercises: {names}.", { names: r.exercisesCreated.join(", ") })}</T> : null}
            {r.daysMarkedComplete ? <T variant="footnote" color="textSecondary">{tn(r.daysMarkedComplete, "{n} day marked complete.", "{n} days marked complete.")}</T> : null}
            <T variant="caption" color="textTertiary">{t("Importing the same file again won't create duplicates.")}</T>
          </Stack>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      close
      title={t("Import history")}
      subtitle={t("From Strong, Hevy or MyFitnessPal")}
      footer={p ? <Stack gap={6}>{commit.error ? <T variant="footnote" color="danger">{errText(commit.error)}</T> : null}<Button title={t("Import from {app}", { app: p.sourceLabel })} loading={commit.isPending} onPress={() => commit.mutate()} /></Stack> : undefined}
    >
      {!p ? (
        <>
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            {how().map((h, i) => (
              <View key={h.app}>
                {i ? <Divider /> : null}
                <Stack gap={2} style={{ paddingVertical: 12 }}>
                  <T variant="headline">{h.app}</T>
                  <T variant="footnote" color="textSecondary">{h.steps}</T>
                </Stack>
              </View>
            ))}
          </Card>
          <Button title={preview.isPending ? t("Reading…") : t("Choose export file")} icon="add" loading={preview.isPending} onPress={() => void pick()} />
          {readError ? <T variant="footnote" color="danger">{readError}</T> : null}
          {preview.error ? <T variant="footnote" color="danger">{errText(preview.error)}</T> : null}
          <T variant="caption" color="textTertiary">{t("You'll see exactly what will be imported before anything is saved. Nothing is sent anywhere except your own Stoke account.")}</T>
        </>
      ) : (
        <>
          <Card>
            <Stack gap={6}>
              <Row justify="space-between">
                <T variant="headline">{p.sourceLabel}</T>
                <Badge label={fileName ?? t("file")} />
              </Row>
              {p.workouts.count ? <T variant="body">{tn(p.workouts.count, "{n} workout", "{n} workouts")} · {tn(p.workouts.sets, "{n} set", "{n} sets")} · {span(p.workouts.range)}</T> : null}
              {p.meals.count ? <T variant="body">{tn(p.meals.count, "{n} meal", "{n} meals")} · {tn(p.meals.days, "{n} day", "{n} days")} · {span(p.meals.range)}</T> : null}
              {p.weights.count ? <T variant="body">{tn(p.weights.count, "{n} weigh-in", "{n} weigh-ins")} · {span(p.weights.range)}</T> : null}
              {p.warnings.map((w) => <T key={w} variant="footnote" color="warning">{w}</T>)}
            </Stack>
          </Card>
          {unitMatters ? (
            <View style={{ gap: 6 }}>
              <T variant="footnote" color="textSecondary">{t("Weights in this file are in")}</T>
              <Segmented options={[{ value: "kg", label: t("kilograms") }, { value: "lb", label: t("pounds") }]} value={unit} onChange={changeUnit} />
            </View>
          ) : null}
          {p.meals.count ? (
            <Card>
              <Row justify="space-between">
                <View style={{ flex: 1, paddingEnd: 12 }}>
                  <T variant="body">{t("Mark these days as complete")}</T>
                  <T variant="footnote" color="textSecondary">{t("Only if you logged everything you ate on them. Complete days are used to adapt your targets.")}</T>
                </View>
                <Switch accessibilityLabel={t("Mark imported days complete")} value={markComplete} onValueChange={setMarkComplete} trackColor={{ true: th.c.accent, false: th.c.track }} />
              </Row>
            </Card>
          ) : null}
          {p.exercises.length ? (
            <>
              <SectionHeader title={t("Exercises ({count})", { count: p.exercises.length })} />
              <T variant="footnote" color="textSecondary">{t("Matched to Stoke's catalogue only when the names clearly agree. Others become your own custom exercises.")}</T>
              <Card padded={false} style={{ paddingHorizontal: 14 }}>
                {p.exercises.map((e, i) => {
                  const c = choices[e.name] ?? "auto";
                  return (
                    <View key={e.name}>
                      {i ? <Divider /> : null}
                      <Stack gap={6} style={{ paddingVertical: 12 }}>
                        <Row justify="space-between" align="flex-start">
                          <T variant="body" style={{ flex: 1 }}>{e.name}</T>
                          <T variant="caption" color="textTertiary">{tn(e.sets, "{n} set", "{n} sets")}</T>
                        </Row>
                        <T variant="footnote" color={e.match && c === "auto" ? "accent" : "textSecondary"}>
                          {c === "skip" ? t("Won't be imported") : c === "create" || !e.match ? t("Will be created as a custom exercise") : t("Match: {name}", { name: e.match.name })}
                        </T>
                        <Row gap={6} wrap>
                          {e.match ? <Chip label={t("Use match")} selected={c === "auto"} onPress={() => setChoices((s) => ({ ...s, [e.name]: "auto" }))} /> : null}
                          <Chip label={t("Create new")} selected={c === "create" || (!e.match && c === "auto")} onPress={() => setChoices((s) => ({ ...s, [e.name]: e.match ? "create" : "auto" }))} />
                          <Chip label={t("Skip")} selected={c === "skip"} onPress={() => setChoices((s) => ({ ...s, [e.name]: "skip" }))} />
                        </Row>
                      </Stack>
                    </View>
                  );
                })}
              </Card>
            </>
          ) : null}
          <Button title={t("Choose a different file")} kind="ghost" size="sm" onPress={() => { preview.reset(); setText(null); }} />
        </>
      )}
    </Screen>
  );
}
