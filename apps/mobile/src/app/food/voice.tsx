import type { PortionDto } from "@stoke/contracts";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { normalizeLogText } from "../../features/native/deepLinks";
import { addExercise, addSet, getActiveWorkout, removeSet, updateSet } from "../../features/workout/store";
import { api, ApiError } from "../../lib/api";
import { defaultMealForNow, logFood, logWater, logWeight } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { todayKey } from "../../lib/ids";
import type { Exercise, Food } from "../../lib/types";
import { t, tn } from "../../i18n";
import { useTheme } from "../../theme/theme";
import { Badge, Button, Card, Field, Icon, Row, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

interface FoodDraftItem {
  parsed: { name: string; quantity: number; quantityAssumed: boolean };
  candidates: { food: Food; portion: PortionDto | null }[];
  suggestion: { food: Food; portion: PortionDto | null } | null;
}
type Draft =
  | { kind: "food"; parser: string; meal: string | null; items: FoodDraftItem[]; issues: string[] }
  | { kind: "exercise"; parser: string; entries: { parsed: { exerciseName: string; sets: number; reps: number | null; weightKg: number | null }; matches: { id: string; name: string }[] }[]; issues: string[] }
  | { kind: "body_weight"; parser: string; weightKg: number; issues: string[] }
  | { kind: "water"; parser: string; ml: number; issues: string[] }
  | { kind: "unrecognized"; parser: string; issues: string[] };

/**
 * Voice/text logging: speech → text (server Whisper when configured, or the
 * keyboard's dictation) → deterministic parser with AI fallback → DRAFT the
 * user confirms. Nothing is written until "Log".
 */
export default function VoiceLog() {
  const th = useTheme();
  // `text` arrives from deep links (stoke://log?text=…, Siri "Log food in Stoke"): prefill and parse it right away.
  const params = useLocalSearchParams<{ day?: string; text?: string }>();
  const day = params.day ?? todayKey();
  const linkText = normalizeLogText(params.text);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const rec = useAudioRecorderState(recorder);
  const [text, setText] = useState(linkText ?? "");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [chosen, setChosen] = useState<Record<number, number>>({});
  const [off, setOff] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parse = async (input: string) => {
    setBusy(true);
    setError(null);
    try {
      setDraft(await api<Draft>("/v1/log/parse", { body: { text: input, day } }));
      setChosen({});
      setOff({});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Couldn't understand that."));
    } finally {
      setBusy(false);
    }
  };

  // Parse each linked text once (a new link while the sheet is open parses the new text).
  const parsedLink = useRef<string | null>(null);
  useEffect(() => {
    if (!linkText || parsedLink.current === linkText) return;
    parsedLink.current = linkText;
    setText(linkText);
    void parse(linkText);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- parse once per incoming text
  }, [linkText]);

  const startRecording = async () => {
    setError(null);
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) return setError(t("Microphone access is off. You can type instead, or use the keyboard's dictation key."));
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    haptic("light");
  };

  const stopRecording = async () => {
    await recorder.stop();
    haptic("light");
    const uri = recorder.uri;
    if (!uri) return;
    setBusy(true);
    try {
      const form = new FormData();
      if (Platform.OS === "web") form.append("audio", await (await fetch(uri)).blob(), "voice.webm");
      else form.append("audio", { uri, name: "voice.m4a", type: "audio/m4a" } as unknown as Blob);
      const res = await api<{ text: string; draft: Draft }>("/v1/voice/transcribe", { method: "POST", form });
      setText(res.text);
      setDraft(res.draft);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "stt_unavailable" ? t("Server transcription isn't set up. Type, or use your keyboard's microphone key.") : e instanceof ApiError ? e.message : t("Transcription failed."));
    } finally {
      setBusy(false);
    }
  };

  // Pre-select the server's suggestion only; a look-alike candidate must be chosen by the user.
  const pick = (i: number) => chosen[i] ?? (draft?.kind === "food" && draft.items[i]?.suggestion ? 0 : -1);

  const commit = () => {
    if (!draft) return;
    if (draft.kind === "food") {
      const meal = draft.meal ?? defaultMealForNow();
      draft.items.forEach((it, i) => {
        if (off[i]) return;
        const c = it.candidates[pick(i)];
        // Only the chosen food's own portion; never another candidate's.
        if (c?.portion) logFood({ food: c.food, portion: c.portion, day, meal });
      });
    } else if (draft.kind === "body_weight") logWeight(day, draft.weightKg);
    else if (draft.kind === "water") logWater(day, draft.ml);
    else if (draft.kind === "exercise") {
      if (!getActiveWorkout()) return setError(t("Start a workout first; these sets will be added to it."));
      for (const e of draft.entries) {
        const m = e.matches[0];
        if (!m) continue;
        addExercise({ id: m.id, name: m.name, loadProfile: "machine", equipment: "", primaryMuscles: [] } as unknown as Exercise);
        const rowId = getActiveWorkout()!.exercises.at(-1)!.id;
        for (let s = getActiveWorkout()!.exercises.at(-1)!.sets.length; s < e.parsed.sets; s++) addSet(rowId);
        const row = getActiveWorkout()!.exercises.find((x) => x.id === rowId)!;
        // Keep exactly the spoken number of sets, prefilled with the spoken load and reps (not yet marked done).
        row.sets.slice(0, e.parsed.sets).forEach((set) => updateSet(rowId, set.id, { ...(e.parsed.weightKg != null ? { weightKg: e.parsed.weightKg } : {}), ...(e.parsed.reps != null ? { reps: e.parsed.reps } : {}) }));
        row.sets.slice(e.parsed.sets).forEach((set) => removeSet(rowId, set.id));
      }
    }
    haptic("success");
    router.back();
  };

  // Every included item must have an amount, so nothing is silently dropped.
  const included = draft?.kind === "food" ? draft.items.filter((_, i) => !off[i]) : [];
  const needsAmount = draft?.kind === "food" ? draft.items.filter((it, i) => !off[i] && !it.candidates[pick(i)]?.portion).length : 0;
  const foodReady = included.length > 0 && needsAmount === 0;
  const canLog = draft && draft.kind !== "unrecognized" && (draft.kind !== "food" || foodReady);

  return (
    <Screen close title={t("Say or type it")} subtitle={t("“Two eggs and toast”, “weighed 82.4 kg”, “3 sets of bench at 80 kg”")} footer={draft ? <Button title={t("Log")} onPress={commit} disabled={!canLog} /> : undefined}>
      <Row gap={10} align="flex-end">
        <View style={{ flex: 1 }}>
          <Field value={text} onChangeText={setText} placeholder={t("What did you eat or do?")} multiline returnKeyType="done" onSubmitEditing={() => text.trim() && void parse(text.trim())} accessibilityLabel={t("Log text")} />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={rec.isRecording ? t("Stop recording") : t("Start recording")} onPress={() => void (rec.isRecording ? stopRecording() : startRecording())} style={{ width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: rec.isRecording ? th.c.danger : th.c.accent }}>
          <Icon name={rec.isRecording ? "pause" : "mic"} size={22} color="textInverse" />
        </Pressable>
      </Row>
      {rec.isRecording ? <T variant="footnote" color="danger">{t("Recording… {s} s · tap to stop", { s: Math.round(rec.durationMillis / 1000) })}</T> : null}
      <Button title={t("Understand")} kind="secondary" onPress={() => void parse(text.trim())} disabled={!text.trim()} loading={busy} />
      {error ? <T variant="footnote" color="danger">{error}</T> : null}

      {draft ? (
        <Card>
          <Stack gap={12}>
            <Row justify="space-between">
              <T variant="label" color="textTertiary">{t("Draft")}</T>
              <Badge label={draft.parser === "ai" ? t("AI interpreted") : t("Matched exactly")} tone={draft.parser === "ai" ? "info" : "neutral"} />
            </Row>
            {draft.kind === "food"
              ? draft.items.map((it, i) => (
                  <Stack key={i} gap={6}>
                    <Row justify="space-between">
                      <T variant="headline" style={{ flex: 1, opacity: off[i] ? 0.4 : 1 }}>{it.parsed.quantityAssumed ? "" : `${it.parsed.quantity} × `}{it.parsed.name}</T>
                      <Button title={off[i] ? t("Include") : t("Skip")} kind="ghost" size="sm" onPress={() => setOff((o) => ({ ...o, [i]: !o[i] }))} />
                    </Row>
                    {it.candidates.length ? (
                      <Row gap={6} wrap>
                        {it.candidates.map((c, j) => (
                          <Pressable key={c.food.id} onPress={() => setChosen((s) => ({ ...s, [i]: j }))} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: (pick(i)) === j ? th.c.accent : th.c.border }}>
                            <T variant="footnote" color={(pick(i)) === j ? "accent" : "text"}>{c.portion ? c.food.name.slice(0, 40) : t("{name} (choose amount)", { name: c.food.name.slice(0, 40) })}</T>
                          </Pressable>
                        ))}
                      </Row>
                    ) : (
                      <T variant="footnote" color="warning">{t("No match found; use search to add it.")}</T>
                    )}
                  </Stack>
                ))
              : draft.kind === "body_weight"
                ? <T variant="headline">{t("Body weight {kg} kg", { kg: draft.weightKg })}</T>
                : draft.kind === "water"
                  ? <T variant="headline">{t("Water {ml} ml", { ml: draft.ml })}</T>
                  : draft.kind === "exercise"
                    ? draft.entries.map((e, i) => <T key={i} variant="headline">{e.matches[0]?.name ?? e.parsed.exerciseName}: {e.parsed.sets} × {e.parsed.reps ?? "?"}{e.parsed.weightKg ? ` @ ${e.parsed.weightKg} kg` : ""}</T>)
                    : null}
            {draft.issues.map((iss) => <T key={iss} variant="footnote" color="warning">{iss}</T>)}
            {needsAmount ? <T variant="footnote" color="warning">{tn(needsAmount, "One item needs a choice: pick the right food (with an amount), skip it, or add it from search.", "{n} items need a choice: pick the right food (with an amount), skip it, or add it from search.")}</T> : null}
          </Stack>
        </Card>
      ) : null}
    </Screen>
  );
}
