import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { api, ApiError } from "../../lib/api";
import { qk } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { queryClient } from "../../lib/query";
import { kv } from "../../lib/storage";
import type { Recommendation } from "../../lib/types";
import { useTheme } from "../../theme/theme";
import { Badge, Button, Card, Chip, EmptyState, Field, Icon, IconButton, Row, SectionHeader, Segmented, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";
import { fmtDay, locale, t, tn } from "../../i18n";

const prompts = () => [t("What should I eat tonight?"), t("Am I eating enough protein?"), t("Build me a 45-minute workout"), t("How consistent have I been?"), t("Why has my weight stopped dropping?"), t("What should I change next week?")];

function statusLabel(status: string): string {
  if (status === "accepted") return t("Applied");
  if (status === "rejected") return t("Declined");
  if (status === "proposed") return t("Waiting for you");
  if (status === "expired") return t("Expired");
  return status;
}

function sufficiencyLabel(s: string): string {
  if (s === "good") return t("good");
  if (s === "limited") return t("limited");
  if (s === "insufficient") return t("insufficient");
  return s;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
}

function payloadSummary(r: Recommendation): string | null {
  const p = r.payload as Record<string, number | string | undefined>;
  if (r.kind === "nutrition_targets") return t("{kcal} kcal · {protein} g protein · {carbs} g carbs · {fat} g fat", { kcal: String(p.energyKcal), protein: String(p.proteinG), carbs: String(p.carbsG), fat: String(p.fatG) });
  return null;
}

function RecommendationCard({ r }: { r: Recommendation }) {
  const decide = useMutation({
    mutationFn: (decision: "accept" | "reject") => api(`/v1/coach/recommendations/${r.id}/decision`, { body: { decision } }),
    onSuccess: (_d, decision) => {
      haptic(decision === "accept" ? "success" : "light");
      for (const k of [qk.recommendations, qk.today, qk.programs, ["targets"]]) void queryClient.invalidateQueries({ queryKey: k });
    },
  });
  const ev = r.evidence as { confidence?: string; completeDays?: number; observedKgPerWeek?: number | null };
  return (
    <Card>
      <Stack gap={8}>
        <Row justify="space-between" align="flex-start">
          <T variant="headline" style={{ flex: 1 }}>{r.title}</T>
          <Badge label={r.source === "engine" ? t("From your data") : t("Coach")} tone="info" />
        </Row>
        {payloadSummary(r) ? <T variant="subhead">{payloadSummary(r)}</T> : null}
        <T variant="footnote" color="textSecondary">{r.rationale}</T>
        {ev.confidence ? <T variant="caption" color="textTertiary">{t("Confidence {level}", { level: ev.confidence === "high" ? t("high") : ev.confidence === "medium" ? t("medium") : ev.confidence === "low" ? t("low") : ev.confidence })} · {tn(ev.completeDays ?? 0, "{n} complete day", "{n} complete days")}{ev.observedKgPerWeek != null ? ` · ${t("trend {value} kg/wk", { value: ev.observedKgPerWeek.toFixed(2) })}` : ""}</T> : null}
        {r.status === "proposed" ? (
          <Row gap={8}>
            <Button title={t("Not now")} kind="secondary" size="md" onPress={() => decide.mutate("reject")} style={{ flex: 1 }} disabled={decide.isPending} />
            <Button title={t("Apply")} size="md" onPress={() => decide.mutate("accept")} loading={decide.isPending} style={{ flex: 1 }} />
          </Row>
        ) : (
          <Badge label={statusLabel(r.status)} tone={r.status === "accepted" ? "accent" : "neutral"} />
        )}
        {decide.error ? <T variant="footnote" color="danger">{decide.error instanceof ApiError ? decide.error.message : t("Something went wrong. Try again.")}</T> : null}
      </Stack>
    </Card>
  );
}

const fmtNum0 = (n: number | null) => (n == null ? "–" : Math.round(n).toLocaleString(locale()));
const fmtRange = (a: string, b: string) => (a.slice(0, 7) === b.slice(0, 7) ? `${fmtDay(a)} – ${fmtDay(b, { day: "numeric" })}` : `${fmtDay(a)} – ${fmtDay(b)}`);

export default function Coach() {
  const th = useTheme();
  const [tab, setTab] = useState<"chat" | "suggestions" | "week">("chat");
  const [conversationId, setConversationId] = useState<string | null>(() => kv.get<string>("coach.conversation"));
  const [text, setText] = useState("");
  const recs = useQuery({ queryKey: qk.recommendations, queryFn: async () => (await api<{ items: Recommendation[] }>("/v1/coach/recommendations")).items });
  const weekly = useQuery({ queryKey: qk.weekly, queryFn: () => api<{ week: { start: string; end: string }; nutrition: { daysLogged: number; completeDays: number; averages: { energyKcal: number | null; proteinG: number | null }; targets: { energyKcal: number; proteinG: number } | null; proteinTargetHitDays: number | null }; training: { sessionsCompleted: number; sessionsPlannedPerWeek: number | null; personalRecords: number; prExercises: string[] }; weight: { kgPerWeek: number | null; sufficiency: string }; adaptive: { status: string; reasons: string[] } }>("/v1/coach/weekly-review"), enabled: tab === "week" });
  const messages = useQuery({ queryKey: qk.messages(conversationId ?? "none"), queryFn: async () => (await api<{ items: Message[] }>(`/v1/coach/conversations/${conversationId}/messages`)).items, enabled: !!conversationId });
  useEffect(() => {
    if (messages.isError && messages.error instanceof ApiError && messages.error.status === 404) {
      kv.remove("coach.conversation");
      setConversationId(null);
    }
  }, [messages.isError, messages.error]);

  const send = useMutation({
    mutationFn: async (msg: string) => {
      let id = conversationId;
      if (!id) {
        id = (await api<{ id: string }>("/v1/coach/conversations", { method: "POST" })).id;
        kv.set("coach.conversation", id);
        setConversationId(id);
      }
      queryClient.setQueryData<Message[]>(qk.messages(id), (old) => [...(old ?? []), { id: `local-${Date.now()}`, role: "user", text: msg }]);
      const res = await api<{ reply: string; recommendations: Recommendation[] }>(`/v1/coach/conversations/${id}/messages`, { body: { text: msg } });
      return { id, res };
    },
    onSuccess: ({ id, res }) => {
      queryClient.setQueryData<Message[]>(qk.messages(id), (old) => [...(old ?? []), { id: `local-a-${Date.now()}`, role: "assistant", text: res.reply }]);
      if (res.recommendations.length) void queryClient.invalidateQueries({ queryKey: qk.recommendations });
    },
  });
  const adaptive = useMutation({ mutationFn: () => api<{ result: { status: string; reasons: string[] }; recommendation: unknown }>("/v1/nutrition/adaptive-check", { method: "POST" }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.recommendations }) });

  const pending = (recs.data ?? []).filter((r) => r.status === "proposed");
  const submit = (msg = text) => {
    if (!msg.trim() || send.isPending) return;
    setText("");
    send.mutate(msg.trim());
  };

  return (
    <Screen tabBar title={t("Coach")} right={tab === "chat" && conversationId ? <IconButton icon="add" label={t("New conversation")} onPress={() => { kv.remove("coach.conversation"); setConversationId(null); }} /> : undefined}>
      <Segmented options={[{ value: "chat", label: t("Ask") }, { value: "suggestions", label: pending.length ? t("Suggestions ({n})", { n: pending.length }) : t("Suggestions") }, { value: "week", label: t("This week") }]} value={tab} onChange={setTab} />

      {tab === "chat" ? (
        <>
          {!messages.data?.length ? (
            <Stack gap={10}>
              <T variant="subhead" color="textSecondary">{t("Answers use your logged food, workouts, weight trend and goals. Changes are suggested for you to approve, never applied silently.")}</T>
              <Row gap={8} wrap>{prompts().map((p) => <Chip key={p} label={p} onPress={() => submit(p)} />)}</Row>
            </Stack>
          ) : (
            <Stack gap={10}>
              {messages.data.map((m) => (
                <View key={m.id} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", backgroundColor: m.role === "user" ? th.c.accentMuted : th.c.surface, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: th.c.hairline }}>
                  <T variant="body" selectable>{m.text}</T>
                </View>
              ))}
            </Stack>
          )}
          {send.isPending ? <Row gap={8}><ActivityIndicator color={th.c.textSecondary} /><T variant="footnote" color="textSecondary">{t("Looking at your data…")}</T></Row> : null}
          {send.error ? <T variant="footnote" color="danger">{send.error instanceof ApiError ? send.error.message : t("The coach is unavailable right now.")}</T> : null}
          {pending.length ? <Button title={tn(pending.length, "{n} suggestion to review", "{n} suggestions to review")} kind="secondary" size="md" icon="coach" onPress={() => setTab("suggestions")} /> : null}
          <Row gap={8} align="flex-end">
            <View style={{ flex: 1 }}><Field value={text} onChangeText={setText} placeholder={t("Ask about food, training or progress")} multiline onSubmitEditing={() => submit()} accessibilityLabel={t("Message the coach")} /></View>
            <IconButton icon="send" label={t("Send")} onPress={() => submit()} bg="accent" color="textInverse" size={48} />
          </Row>
          <T variant="caption" color="textTertiary">{t("Not medical advice. For pain, injury, or medical conditions, talk to a qualified professional.")}</T>
        </>
      ) : null}

      {tab === "suggestions" ? (
        <>
          <Button title={t("Check my calorie target")} kind="secondary" icon="progress" onPress={() => adaptive.mutate()} loading={adaptive.isPending} />
          {adaptive.data && !adaptive.data.recommendation ? (
            <Card><Stack gap={4}><T variant="headline">{adaptive.data.result.status === "on_track" ? t("On track") : adaptive.data.result.status === "adherence_gap" ? t("Target not the issue") : t("Not enough data yet")}</T>{adaptive.data.result.reasons.map((r) => <T key={r} variant="footnote" color="textSecondary">{r}</T>)}</Stack></Card>
          ) : null}
          {pending.length ? pending.map((r) => <RecommendationCard key={r.id} r={r} />) : <Card><EmptyState icon="check" title={t("Nothing to review")} body={t("Suggestions from the coach and the adaptive engine will appear here for your approval.")} /></Card>}
          {(recs.data ?? []).filter((r) => r.status !== "proposed").length ? (
            <>
              <SectionHeader title={t("History")} />
              {(recs.data ?? []).filter((r) => r.status !== "proposed").slice(0, 10).map((r) => (
                <Row key={r.id} gap={10}>
                  <Icon name={r.status === "accepted" ? "check" : "close"} size={14} color={r.status === "accepted" ? "accent" : "textTertiary"} />
                  <T variant="footnote" color="textSecondary" style={{ flex: 1 }}>{r.title} · {statusLabel(r.status)}{r.actions[0] ? ` · ${t("applied {date}", { date: fmtDay(r.actions[0].createdAt.slice(0, 10)) })}` : ""}</T>
                </Row>
              ))}
            </>
          ) : null}
        </>
      ) : null}

      {tab === "week" ? (
        weekly.data ? (
          <Stack gap={12}>
            <T variant="footnote" color="textSecondary">{fmtRange(weekly.data.week.start, weekly.data.week.end)}</T>
            <Card>
              <Stack gap={6}>
                <T variant="label" color="textTertiary">{t("Nutrition · logged")}</T>
                <T variant="subhead">{t("{logged} days logged, {complete} complete.", { logged: weekly.data.nutrition.daysLogged, complete: weekly.data.nutrition.completeDays })}</T>
                {weekly.data.nutrition.averages.energyKcal != null ? <T variant="subhead">{weekly.data.nutrition.targets ? t("Averaged {kcal} kcal (target {target}) and {protein} g protein.", { kcal: fmtNum0(weekly.data.nutrition.averages.energyKcal), target: fmtNum0(weekly.data.nutrition.targets.energyKcal), protein: String(weekly.data.nutrition.averages.proteinG) }) : t("Averaged {kcal} kcal and {protein} g protein.", { kcal: fmtNum0(weekly.data.nutrition.averages.energyKcal), protein: String(weekly.data.nutrition.averages.proteinG) })}</T> : null}
                {weekly.data.nutrition.proteinTargetHitDays != null && weekly.data.nutrition.completeDays > 0 ? <T variant="footnote" color="textSecondary">{t("Protein target reached on {hit} of {complete} complete days.", { hit: weekly.data.nutrition.proteinTargetHitDays, complete: weekly.data.nutrition.completeDays })}</T> : null}
              </Stack>
            </Card>
            <Card>
              <Stack gap={6}>
                <T variant="label" color="textTertiary">{t("Training · logged")}</T>
                <T variant="subhead">{weekly.data.training.sessionsPlannedPerWeek ? t("{done} of {planned} planned sessions", { done: weekly.data.training.sessionsCompleted, planned: weekly.data.training.sessionsPlannedPerWeek }) : tn(weekly.data.training.sessionsCompleted, "{n} session", "{n} sessions")}</T>
                {weekly.data.training.prExercises.length ? <T variant="footnote" color="accent">{weekly.data.training.prExercises.length > 4 ? t("New records on {list} and {more} more.", { list: weekly.data.training.prExercises.slice(0, 4).join(t(", ")), more: weekly.data.training.prExercises.length - 4 }) : t("New records on {list}.", { list: weekly.data.training.prExercises.join(t(", ")) })}</T> : null}
              </Stack>
            </Card>
            <Card>
              <Stack gap={6}>
                <T variant="label" color="textTertiary">{t("Body · calculated")}</T>
                <T variant="subhead">{weekly.data.weight.kgPerWeek == null ? t("Not enough weigh-ins for a trend.") : t("Trend {value} kg/week ({quality} data).", { value: `${weekly.data.weight.kgPerWeek >= 0 ? "+" : ""}${weekly.data.weight.kgPerWeek.toFixed(2)}`, quality: sufficiencyLabel(weekly.data.weight.sufficiency) })}</T>
              </Stack>
            </Card>
            <Card>
              <Stack gap={6}>
                <T variant="label" color="textTertiary">{t("Targets · estimate")}</T>
                {weekly.data.adaptive.reasons.map((r) => <T key={r} variant="footnote" color="textSecondary">{r}</T>)}
              </Stack>
            </Card>
          </Stack>
        ) : weekly.isPending ? <ActivityIndicator /> : <EmptyState title={t("Weekly review unavailable")} />
      ) : null}
    </Screen>
  );
}
