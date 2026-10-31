import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Platform, Pressable, TextInput, View, type TextStyle } from "react-native";
import { candidateNutrients, canCommit, commitDraft, defaultPick, foodStatus, intentOf, matchWorkout, type Draft } from "../features/command/draft";
import { getActiveWorkout, useActiveWorkout } from "../features/workout/store";
import { fmtNum, t, tn } from "../i18n";
import { api, ApiError } from "../lib/api";
import { describePortion, qk, useRecentFoods, useToday } from "../lib/data";
import { haptic } from "../lib/haptics";
import { todayKey } from "../lib/ids";
import type { Program } from "../lib/types";
import { useTheme } from "../theme/theme";
import { Button, Icon, IconButton, Row, Stack, T, type IconName } from "../ui/primitives";
import { Screen } from "../ui/Screen";

/**
 * The command bar: one input for everything. Deterministic and instant on-device:
 * a question goes to the coach, "start …" starts a workout, anything else is parsed
 * into a draft (the server's text parser, with AI only as a fallback) that you confirm.
 */
export default function CommandBar() {
  const th = useTheme();
  const params = useLocalSearchParams<{ text?: string }>();
  const day = todayKey();
  const today = useToday();
  const recents = useRecentFoods();
  const active = useActiveWorkout();
  const programs = useQuery({ queryKey: qk.programs, queryFn: async () => (await api<{ items: Program[] }>("/v1/programs")).items });
  const [text, setText] = useState(params.text ?? "");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<number, number>>({});
  const [off, setOff] = useState<Record<number, boolean>>({});
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intent = text.trim() ? intentOf(text) : null;
  const days = useMemo(() => {
    const list = programs.data ?? [];
    const prog = list.find((p) => p.status === "active") ?? list[0];
    return (prog?.days ?? []).map((d) => ({ id: d.id, name: d.name }));
  }, [programs.data]);
  const next = today.data?.workout?.scheduledToday ?? today.data?.workout?.nextInRotation ?? null;
  const workout = intent?.kind === "start" ? matchWorkout(intent.query, days, next) : null;
  // A draft belongs to the exact text it was parsed from; editing the text hides it.
  const shownDraft = draft && draftFor === text.trim() ? draft : null;

  const parse = async (input: string) => {
    setBusy(true);
    setError(null);
    try {
      const d = await api<Draft>("/v1/log/parse", { body: { text: input, day } });
      setDraft(d);
      setDraftFor(input);
      setChosen({});
      setOff({});
      setOpen({});
      haptic("selection");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Couldn't understand that."));
    } finally {
      setBusy(false);
    }
  };

  const ask = (q: string) => router.dismissTo({ pathname: "/coach", params: { ask: q } });
  const start = () => {
    if (active || getActiveWorkout()) return router.replace("/workout/active");
    if (workout) router.replace({ pathname: "/workout/active", params: { templateId: workout.id } });
  };
  const run = (value = text) => {
    const v = value.trim();
    if (!v) return;
    const i = intentOf(v);
    if (i.kind === "ask") return ask(i.question);
    if (i.kind === "start") return start();
    void parse(v);
  };
  const use = (value: string) => {
    setText(value);
    run(value);
  };

  // Totals for the confirm row: computed on-device from the chosen foods (same core code as the server).
  const n = today.data?.nutrition;
  const picked = shownDraft?.kind === "food" ? shownDraft.items.map((it, i) => (off[i] ? null : it.candidates[defaultPick(shownDraft, i, chosen)] ?? null)) : [];
  const kcal = picked.reduce((a, c) => a + (c ? (candidateNutrients(c)?.energyKcal ?? 0) : 0), 0);
  const left = n?.targets ? Math.round(n.targets.energyKcal - n.totals.energyKcal - kcal) : null;
  const ready = canCommit(shownDraft, chosen, off);
  const { included, needsAmount } = shownDraft ? foodStatus(shownDraft, chosen, off) : { included: 0, needsAmount: 0 };

  const commit = () => {
    if (!shownDraft) return;
    const err = commitDraft(shownDraft, day, chosen, off);
    if (err) return setError(err);
    haptic("success");
    router.back();
  };

  const hint: { icon: IconName; label: string } | null = !intent
    ? null
    : intent.kind === "ask"
      ? { icon: "coach", label: t("Ask the coach") }
      : intent.kind === "start"
        ? { icon: "play", label: active ? t("Resume {name}", { name: active.name }) : workout ? t("Start {name}", { name: workout.name }) : t("No workout by that name") }
        : { icon: "bolt", label: t("Find it and log it") };

  const suggestions = [
    // Recent foods by their plain name (no brand/Arabic suffix, no USDA qualifiers).
    ...(recents.data ?? []).slice(0, 3).map((r) => r.food.name.split(" · ")[0]!.split(",")[0]!.toLowerCase()),
    ...(next ? [t("start {name}", { name: next.name })] : []),
    t("how's my protein today?"),
  ];

  const footer = shownDraft ? (
    <Stack gap={10}>
      {shownDraft.kind === "food" && left != null ? (
        <Row justify="space-between">
          <T variant="mono" color="textSecondary">{t("After logging")}</T>
          <T variant="monoBold">{left >= 0 ? t("{n} kcal left", { n: fmtNum(left) }) : t("{n} kcal over", { n: fmtNum(-left) })}</T>
        </Row>
      ) : null}
      <Button
        title={shownDraft.kind === "food" ? tn(included, "Log 1 item · {kcal} kcal", "Log {n} items · {kcal} kcal", { kcal: fmtNum(Math.round(kcal)) }) : t("Log")}
        onPress={commit}
        disabled={!ready}
      />
    </Stack>
  ) : intent?.kind === "ask" ? (
    <Button title={t("Ask the coach")} icon="coach" onPress={() => ask(intent.question)} />
  ) : intent?.kind === "start" && (workout || active) ? (
    <Button title={active ? t("Resume workout") : t("Start workout")} icon="play" onPress={start} />
  ) : intent?.kind === "log" ? (
    <Button title={t("Understand")} icon="bolt" onPress={() => run()} loading={busy} />
  ) : undefined;

  const inputStyle: TextStyle = { ...th.type.title2, color: th.c.text, minHeight: 64, paddingVertical: 8, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as unknown as TextStyle) : null) };

  return (
    <Screen close footer={footer} right={<IconButton icon="mic" label={t("Speak instead")} onPress={() => router.replace({ pathname: "/food/voice", params: text.trim() ? { text: text.trim() } : {} })} />}>
      <T variant="label" color="data">{t("Log, ask or start anything")}</T>
      <TextInput
        value={text}
        onChangeText={(v) => {
          setText(v);
          setError(null);
        }}
        autoFocus
        placeholder={t("2 eggs and karak · start upper A · how's my protein?")}
        placeholderTextColor={th.c.textTertiary}
        selectionColor={th.c.accent}
        returnKeyType="go"
        multiline
        blurOnSubmit
        onSubmitEditing={() => run()}
        accessibilityLabel={t("Log, ask or start anything")}
        style={inputStyle}
      />
      {hint ? (
        <Row gap={8}>
          <Icon name={hint.icon} size={14} color="accent" />
          <T variant="mono" color="accent">{hint.label}</T>
          {intent?.kind === "log" && !shownDraft ? <T variant="mono" color="textTertiary">{t("· return to continue")}</T> : null}
        </Row>
      ) : null}

      {!text.trim() ? (
        <Row gap={8} wrap>
          {suggestions.map((s) => (
            <Pressable key={s} accessibilityRole="button" onPress={() => use(s)} style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: pressed ? th.c.accent : th.c.border })}>
              <T variant="footnote" color="textSecondary">{s}</T>
            </Pressable>
          ))}
        </Row>
      ) : null}

      {intent?.kind === "start" && !workout && !active && days.length ? (
        <Stack gap={8}>
          <T variant="footnote" color="textSecondary">{t("Your program days:")}</T>
          <Row gap={8} wrap>
            {days.map((d) => (
              <Pressable key={d.id} accessibilityRole="button" onPress={() => setText(t("start {name}", { name: d.name }))} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: th.c.border }}>
                <T variant="footnote">{d.name}</T>
              </Pressable>
            ))}
          </Row>
        </Stack>
      ) : null}

      {error ? <T variant="footnote" color="danger">{error}</T> : null}

      {shownDraft ? (
        <Stack gap={8}>
          {shownDraft.kind === "food"
            ? shownDraft.items.map((it, i) => {
                const c = it.candidates[defaultPick(shownDraft, i, chosen)];
                const nut = c ? candidateNutrients(c) : null;
                const sure = shownDraft.parser !== "ai" && !it.parsed.quantityAssumed && it.candidates.length > 0 && !!it.suggestion;
                return (
                  <View key={i} style={{ backgroundColor: th.c.surface, borderRadius: 18, borderWidth: 1, borderColor: th.c.border, padding: 12, gap: 8, opacity: off[i] ? 0.45 : 1 }}>
                    <Row gap={10} align="center">
                      <Stack gap={3} style={{ flex: 1 }}>
                        <Row gap={6} wrap>
                          <T variant="headline" numberOfLines={2} style={{ flexShrink: 1 }}>{c?.food.name ?? it.parsed.name}</T>
                          <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, backgroundColor: sure ? th.c.dataMuted : th.c.accentMuted }}>
                            <T variant="label" style={{ fontSize: 9, color: sure ? th.c.data : th.c.warning }}>{!it.candidates.length ? t("No match") : sure ? t("Matched") : t("Check")}</T>
                          </View>
                        </Row>
                        <T variant="mono" color="textTertiary" numberOfLines={1}>
                          {c?.portion ? describePortion(c.food, c.portion) : t("choose an amount")}
                          {c ? ` · ${c.food.source === "usda" ? "USDA" : c.food.source === "standard_recipe" ? t("standard recipe") : c.food.brand ?? c.food.source}` : ""}
                        </T>
                      </Stack>
                      <T variant="metric">{nut?.energyKcal != null ? fmtNum(Math.round(nut.energyKcal)) : "–"}</T>
                    </Row>
                    {it.candidates.length > 1 && (open[i] || !sure) ? (
                      <Row gap={6} wrap>
                        {it.candidates.slice(0, 4).map((cand, j) => {
                          const on = defaultPick(shownDraft, i, chosen) === j;
                          return (
                            <Pressable key={cand.food.id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setChosen((s) => ({ ...s, [i]: j }))} style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 9, borderWidth: 1, borderColor: on ? th.c.accent : th.c.border }}>
                              <T variant="caption" color={on ? "accent" : "textSecondary"} numberOfLines={1}>{cand.portion ? cand.food.name.slice(0, 34) : t("{name} (choose amount)", { name: cand.food.name.slice(0, 34) })}</T>
                            </Pressable>
                          );
                        })}
                      </Row>
                    ) : null}
                    <Row gap={8}>
                      <Button title={off[i] ? t("Include") : t("Skip")} kind="ghost" size="sm" onPress={() => setOff((o) => ({ ...o, [i]: !o[i] }))} />
                      {sure && it.candidates.length > 1 && !open[i] ? <Button title={t("Not this?")} kind="ghost" size="sm" onPress={() => setOpen((o) => ({ ...o, [i]: true }))} /> : null}
                      {!c?.portion ? <Button title={t("Search")} kind="secondary" size="sm" icon="search" onPress={() => router.push({ pathname: "/food/search", params: { q: it.parsed.name } })} /> : null}
                    </Row>
                  </View>
                );
              })
            : (
              <View style={{ backgroundColor: th.c.surface, borderRadius: 18, borderWidth: 1, borderColor: th.c.border, padding: 14, gap: 6 }}>
                {shownDraft.kind === "body_weight" ? (
                  <Row justify="space-between"><T variant="headline">{t("Body weight")}</T><T variant="metric">{t("{kg} kg", { kg: shownDraft.weightKg })}</T></Row>
                ) : shownDraft.kind === "water" ? (
                  <Row justify="space-between"><T variant="headline">{t("Water")}</T><T variant="metric">{t("{ml} ml", { ml: shownDraft.ml })}</T></Row>
                ) : shownDraft.kind === "exercise" ? (
                  shownDraft.entries.map((e, i) => <T key={i} variant="headline">{e.matches[0]?.name ?? e.parsed.exerciseName}: {e.parsed.sets} × {e.parsed.reps ?? "?"}{e.parsed.weightKg ? ` @ ${e.parsed.weightKg} kg` : ""}</T>)
                ) : (
                  <T variant="subhead" color="textSecondary">{t("Couldn't understand that. Try “2 eggs and toast”, “weighed 82.4 kg” or “500 ml water”.")}</T>
                )}
              </View>
            )}
          {shownDraft.kind === "food" && needsAmount ? <T variant="footnote" color="warning">{tn(needsAmount, "One item needs a choice: pick the right food (with an amount), skip it, or add it from search.", "{n} items need a choice: pick the right food (with an amount), skip it, or add it from search.")}</T> : null}
          {shownDraft.issues.map((iss) => <T key={iss} variant="footnote" color="warning">{iss}</T>)}
          <T variant="mono" color="textTertiary">{shownDraft.parser === "ai" ? t("Read by AI · nutrition from the food database · nothing is saved until you log") : t("Matched on-device rules · nutrition from the food database · nothing is saved until you log")}</T>
        </Stack>
      ) : null}
    </Screen>
  );
}
