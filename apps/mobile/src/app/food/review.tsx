import { estimateMeal, isKnown, type NutrientValues } from "@moo/core";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { api, ApiError } from "../../lib/api";
import { defaultMealForNow, qk } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { todayKey, uuid } from "../../lib/ids";
import { queryClient } from "../../lib/query";
import { kv } from "../../lib/storage";
import { useTheme } from "../../theme/theme";
import { Badge, Button, Card, Chip, EmptyState, Row, SectionHeader, Stack, Stepper, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

interface Candidate {
  id: string;
  name: string;
  brand: string | null;
  source: string;
  per100: NutrientValues;
  completeness: number;
}
interface Component {
  id: string;
  label: string;
  cookingMethod: string | null;
  alternatives: string[];
  hiddenIngredientRisk: string | null;
  portionBasis: string;
  identityConfidence: number;
  portionConfidence: number;
  tier: "high" | "medium" | "low";
  needsUserInput: boolean;
  grams: { estimate: number; low: number; high: number };
  candidates: Candidate[];
}
interface Recognition {
  recognitionId: string;
  isFood: boolean;
  components: Component[];
  clarifyingQuestions: string[];
  disclaimer: string;
  consumedFactor: number;
  day: string | null;
  meal: string | null;
}

const TIER_LABEL = { high: "Likely", medium: "Check this", low: "Unsure" } as const;

export default function Review() {
  const th = useTheme();
  const rec = kv.get<Recognition>("recognition.current");
  const [choice, setChoice] = useState<Record<string, { foodId: string | null; grams: number; include: boolean }>>(() =>
    Object.fromEntries((rec?.components ?? []).map((c) => [c.id, { foodId: c.candidates[0]?.id ?? null, grams: c.grams.estimate, include: !c.needsUserInput && !!c.candidates[0] }])),
  );
  const [meal, setMeal] = useState(rec?.meal || defaultMealForNow());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estimate = useMemo(() => {
    if (!rec) return null;
    return estimateMeal(
      rec.components.filter((c) => choice[c.id]?.include).map((c) => {
        const ch = choice[c.id]!;
        const cand = c.candidates.find((x) => x.id === ch.foodId);
        const scale = ch.grams / Math.max(1, c.grams.estimate);
        return { id: c.id, label: c.label, identityConfidence: 1, portionConfidence: 1, grams: { estimate: ch.grams, low: c.grams.low * scale, high: c.grams.high * scale }, matchedPer100: cand?.per100 ?? null };
      }),
    );
  }, [rec, choice]);

  if (!rec) return <Screen close title="Review"><EmptyState title="Nothing to review" body="Take a meal photo to start." /></Screen>;
  if (!rec.isFood) return <Screen close title="Review"><EmptyState icon="camera" title="No food found in the photo" body="Try again with the whole plate in view, or log it manually." action="Log manually" onAction={() => router.replace("/food/search")} /></Screen>;

  const included = rec.components.filter((c) => choice[c.id]?.include && choice[c.id]?.foodId);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const day = rec.day || todayKey();
      await api(`/v1/ai/meal-photo/${rec.recognitionId}/confirm`, {
        body: { day, meal, loggedAt: new Date().toISOString(), items: included.map((c) => ({ id: uuid(), componentId: c.id, foodId: choice[c.id]!.foodId, portion: { kind: "amount", quantity: Math.round(choice[c.id]!.grams), unit: "g" } })), keepImages: false },
      });
      kv.remove("recognition.current");
      haptic("success");
      void queryClient.invalidateQueries({ queryKey: qk.diary(day) });
      void queryClient.invalidateQueries({ queryKey: qk.today });
      router.dismissAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save. Check your connection.");
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    kv.remove("recognition.current");
    await api(`/v1/ai/meal-photo/${rec.recognitionId}/discard`, { method: "POST" }).catch(() => {});
    router.back();
  };

  const range = estimate?.energyRangeKcal;
  return (
    <Screen close title="Check your meal" subtitle="Estimated from your photo — adjust anything that looks off." footer={<Row gap={10}><Button title="Discard" kind="secondary" onPress={() => void discard()} style={{ flex: 1 }} /><Button title={`Log ${included.length} item${included.length === 1 ? "" : "s"}`} onPress={() => void confirm()} loading={busy} disabled={!included.length} style={{ flex: 2 }} /></Row>}>
      <Card>
        <Row justify="space-between" align="flex-end">
          <View>
            <T variant="footnote" color="textSecondary">Estimated energy</T>
            <T variant="metricL">{range ? `${range.low}–${range.high}` : "—"}</T>
            <T variant="caption" color="textTertiary">kcal · best estimate {isKnown(estimate?.totals.energyKcal) ? Math.round(estimate!.totals.energyKcal as number) : "—"}</T>
          </View>
          <Stack gap={2} style={{ alignItems: "flex-end" }}>
            <T variant="footnote" color="textSecondary">Protein</T>
            <T variant="headline">{isKnown(estimate?.totals.proteinG) ? `${Math.round(estimate!.totals.proteinG as number)} g` : "—"}</T>
          </Stack>
        </Row>
        {rec.consumedFactor < 1 ? <T variant="caption" color="textTertiary" style={{ marginTop: 8 }}>Adjusted for about {Math.round((1 - rec.consumedFactor) * 100)}% left on the plate.</T> : null}
      </Card>

      {rec.clarifyingQuestions.length ? (
        <Card>
          <Stack gap={6}>
            <T variant="label" color="textTertiary">Worth checking</T>
            {rec.clarifyingQuestions.map((q) => <T key={q} variant="subhead">• {q}</T>)}
          </Stack>
        </Card>
      ) : null}

      <SectionHeader title="Items" />
      {rec.components.map((c) => {
        const ch = choice[c.id]!;
        return (
          <Card key={c.id}>
            <Stack gap={10}>
              <Row justify="space-between" align="flex-start">
                <View style={{ flex: 1, gap: 4 }}>
                  <Row gap={8}>
                    <T variant="headline" style={{ flexShrink: 1 }}>{c.label}</T>
                    <Badge label={TIER_LABEL[c.tier]} tone={c.tier === "high" ? "accent" : c.tier === "medium" ? "info" : "warning"} />
                  </Row>
                  <T variant="caption" color="textTertiary">{c.portionBasis}</T>
                </View>
                <Switch value={ch.include} onValueChange={(v) => setChoice((s) => ({ ...s, [c.id]: { ...ch, include: v } }))} trackColor={{ true: th.c.accent, false: th.c.track }} accessibilityLabel={`Include ${c.label}`} />
              </Row>
              {c.candidates.length ? (
                <Row gap={6} wrap>
                  {c.candidates.map((cand) => <Chip key={cand.id} label={cand.name.length > 34 ? cand.name.slice(0, 32) + "…" : cand.name} selected={ch.foodId === cand.id} onPress={() => setChoice((s) => ({ ...s, [c.id]: { ...ch, foodId: cand.id, include: true } }))} />)}
                </Row>
              ) : (
                <Pressable onPress={() => router.push({ pathname: "/food/search", params: { day: rec.day ?? "", meal } })}>
                  <T variant="footnote" color="warning">No database match. Tap to search and add it yourself.</T>
                </Pressable>
              )}
              {c.alternatives.length && c.tier !== "high" ? <T variant="caption" color="textTertiary">Could also be: {c.alternatives.join(", ")}</T> : null}
              <Stepper value={ch.grams} onChange={(g) => setChoice((s) => ({ ...s, [c.id]: { ...ch, grams: g } }))} step={10} min={5} max={2000} label={`${c.label} amount`} format={(g) => `${Math.round(g)} g`} />
              <T variant="caption" color="textTertiary">Plausible range {c.grams.low}–{c.grams.high} g{c.hiddenIngredientRisk ? ` · ${c.hiddenIngredientRisk}` : ""}</T>
            </Stack>
          </Card>
        );
      })}

      <SectionHeader title="Meal" />
      <Row gap={8} wrap>
        {["breakfast", "lunch", "dinner", "snacks"].map((m) => <Chip key={m} label={m[0]!.toUpperCase() + m.slice(1)} selected={meal === m} onPress={() => setMeal(m)} />)}
      </Row>
      {error ? <T variant="footnote" color="danger">{error}</T> : null}
      <T variant="caption" color="textTertiary">{rec.disclaimer} Saved entries are marked as photo estimates. Photos are deleted after you log or discard.</T>
    </Screen>
  );
}
