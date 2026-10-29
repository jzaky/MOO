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

const PROMPTS = ["What should I eat tonight?", "Am I eating enough protein?", "Build me a 45-minute workout", "How consistent have I been?", "Why has my weight stopped dropping?", "What should I change next week?"];

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
}

function payloadSummary(r: Recommendation): string | null {
  const p = r.payload as Record<string, number | string | undefined>;
  if (r.kind === "nutrition_targets") return `${p.energyKcal} kcal · ${p.proteinG} g protein · ${p.carbsG} g carbs · ${p.fatG} g fat`;
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
          <Badge label={r.source === "engine" ? "From your data" : "Coach"} tone="info" />
        </Row>
        {payloadSummary(r) ? <T variant="subhead">{payloadSummary(r)}</T> : null}
        <T variant="footnote" color="textSecondary">{r.rationale}</T>
        {ev.confidence ? <T variant="caption" color="textTertiary">Confidence {ev.confidence} · {ev.completeDays} complete days{ev.observedKgPerWeek != null ? ` · trend ${ev.observedKgPerWeek.toFixed(2)} kg/wk` : ""}</T> : null}
        {r.status === "proposed" ? (
          <Row gap={8}>
            <Button title="Not now" kind="secondary" size="md" onPress={() => decide.mutate("reject")} style={{ flex: 1 }} disabled={decide.isPending} />
            <Button title="Apply" size="md" onPress={() => decide.mutate("accept")} loading={decide.isPending} style={{ flex: 1 }} />
          </Row>
        ) : (
          <Badge label={r.status} tone={r.status === "accepted" ? "accent" : "neutral"} />
        )}
        {decide.error ? <T variant="footnote" color="danger">{decide.error instanceof ApiError ? decide.error.message : "Failed"}</T> : null}
      </Stack>
    </Card>
  );
}

export default function Coach() {
  const th = useTheme();
  const [tab, setTab] = useState<"chat" | "suggestions" | "week">("chat");
  const [conversationId, setConversationId] = useState<string | null>(() => kv.get<string>("coach.conversation"));
  const [text, setText] = useState("");
  const recs = useQuery({ queryKey: qk.recommendations, queryFn: async () => (await api<{ items: Recommendation[] }>("/v1/coach/recommendations")).items });
  const weekly = useQuery({ queryKey: qk.weekly, queryFn: () => api<{ week: { start: string; end: string }; nutrition: { daysLogged: number; completeDays: number; averages: { energyKcal: number | null; proteinG: number | null }; targets: { energyKcal: number; proteinG: number } | null; proteinTargetHitDays: number | null }; training: { sessionsCompleted: number; sessionsPlannedPerWeek: number | null; personalRecords: number }; weight: { kgPerWeek: number | null; sufficiency: string }; adaptive: { status: string; reasons: string[] } }>("/v1/coach/weekly-review"), enabled: tab === "week" });
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
    <Screen tabBar title="Coach" right={tab === "chat" && conversationId ? <IconButton icon="add" label="New conversation" onPress={() => { kv.remove("coach.conversation"); setConversationId(null); }} /> : undefined}>
      <Segmented options={[{ value: "chat", label: "Ask" }, { value: "suggestions", label: `Suggestions${pending.length ? ` (${pending.length})` : ""}` }, { value: "week", label: "This week" }]} value={tab} onChange={setTab} />

      {tab === "chat" ? (
        <>
          {!messages.data?.length ? (
            <Stack gap={10}>
              <T variant="subhead" color="textSecondary">Answers use your logged food, workouts, weight trend and goals. Changes are suggested for you to approve, never applied silently.</T>
              <Row gap={8} wrap>{PROMPTS.map((p) => <Chip key={p} label={p} onPress={() => submit(p)} />)}</Row>
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
          {send.isPending ? <Row gap={8}><ActivityIndicator color={th.c.textSecondary} /><T variant="footnote" color="textSecondary">Looking at your data…</T></Row> : null}
          {send.error ? <T variant="footnote" color="danger">{send.error instanceof ApiError ? send.error.message : "The coach is unavailable right now."}</T> : null}
          {pending.length ? <Button title={`${pending.length} suggestion${pending.length > 1 ? "s" : ""} to review`} kind="secondary" size="md" icon="coach" onPress={() => setTab("suggestions")} /> : null}
          <Row gap={8} align="flex-end">
            <View style={{ flex: 1 }}><Field value={text} onChangeText={setText} placeholder="Ask about food, training or progress" multiline onSubmitEditing={() => submit()} accessibilityLabel="Message the coach" /></View>
            <IconButton icon="send" label="Send" onPress={() => submit()} bg="accent" color="textInverse" size={48} />
          </Row>
          <T variant="caption" color="textTertiary">Not medical advice. For pain, injury, or medical conditions, talk to a qualified professional.</T>
        </>
      ) : null}

      {tab === "suggestions" ? (
        <>
          <Button title="Check my calorie target" kind="secondary" icon="progress" onPress={() => adaptive.mutate()} loading={adaptive.isPending} />
          {adaptive.data && !adaptive.data.recommendation ? (
            <Card><Stack gap={4}><T variant="headline">{adaptive.data.result.status === "on_track" ? "On track" : adaptive.data.result.status === "adherence_gap" ? "Target not the issue" : "Not enough data yet"}</T>{adaptive.data.result.reasons.map((r) => <T key={r} variant="footnote" color="textSecondary">{r}</T>)}</Stack></Card>
          ) : null}
          {pending.length ? pending.map((r) => <RecommendationCard key={r.id} r={r} />) : <Card><EmptyState icon="check" title="Nothing to review" body="Suggestions from the coach and the adaptive engine will appear here for your approval." /></Card>}
          {(recs.data ?? []).filter((r) => r.status !== "proposed").length ? (
            <>
              <SectionHeader title="History" />
              {(recs.data ?? []).filter((r) => r.status !== "proposed").slice(0, 10).map((r) => (
                <Row key={r.id} gap={10}>
                  <Icon name={r.status === "accepted" ? "check" : "close"} size={14} color={r.status === "accepted" ? "accent" : "textTertiary"} />
                  <T variant="footnote" color="textSecondary" style={{ flex: 1 }}>{r.title} · {r.status}{r.actions[0] ? ` · applied ${r.actions[0].createdAt.slice(0, 10)}` : ""}</T>
                </Row>
              ))}
            </>
          ) : null}
        </>
      ) : null}

      {tab === "week" ? (
        weekly.data ? (
          <Stack gap={12}>
            <T variant="footnote" color="textSecondary">{weekly.data.week.start} – {weekly.data.week.end}</T>
            <Card>
              <Stack gap={6}>
                <T variant="label" color="textTertiary">Nutrition · logged</T>
                <T variant="subhead">{weekly.data.nutrition.daysLogged} days logged, {weekly.data.nutrition.completeDays} complete.</T>
                {weekly.data.nutrition.averages.energyKcal != null ? <T variant="subhead">Averaged {weekly.data.nutrition.averages.energyKcal} kcal{weekly.data.nutrition.targets ? ` (target ${weekly.data.nutrition.targets.energyKcal})` : ""} and {weekly.data.nutrition.averages.proteinG} g protein.</T> : null}
                {weekly.data.nutrition.proteinTargetHitDays != null ? <T variant="footnote" color="textSecondary">Protein target reached on {weekly.data.nutrition.proteinTargetHitDays} of {weekly.data.nutrition.completeDays} complete days.</T> : null}
              </Stack>
            </Card>
            <Card>
              <Stack gap={6}>
                <T variant="label" color="textTertiary">Training · logged</T>
                <T variant="subhead">{weekly.data.training.sessionsCompleted} session{weekly.data.training.sessionsCompleted === 1 ? "" : "s"}{weekly.data.training.sessionsPlannedPerWeek ? ` of ${weekly.data.training.sessionsPlannedPerWeek} planned` : ""} · {weekly.data.training.personalRecords} PR{weekly.data.training.personalRecords === 1 ? "" : "s"}</T>
              </Stack>
            </Card>
            <Card>
              <Stack gap={6}>
                <T variant="label" color="textTertiary">Body · calculated</T>
                <T variant="subhead">{weekly.data.weight.kgPerWeek == null ? "Not enough weigh-ins for a trend." : `Trend ${weekly.data.weight.kgPerWeek >= 0 ? "+" : ""}${weekly.data.weight.kgPerWeek.toFixed(2)} kg/week (${weekly.data.weight.sufficiency} data).`}</T>
              </Stack>
            </Card>
            <Card>
              <Stack gap={6}>
                <T variant="label" color="textTertiary">Targets · estimate</T>
                {weekly.data.adaptive.reasons.map((r) => <T key={r} variant="footnote" color="textSecondary">{r}</T>)}
              </Stack>
            </Card>
          </Stack>
        ) : weekly.isPending ? <ActivityIndicator /> : <EmptyState title="Weekly review unavailable" />
      ) : null}
    </Screen>
  );
}
