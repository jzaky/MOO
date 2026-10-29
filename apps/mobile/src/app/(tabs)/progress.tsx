import { displayBodyWeight, kgToLb, round } from "@moo/core";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { api } from "../../lib/api";
import { qk, useProfile, useWeight } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { todayKey } from "../../lib/ids";
import { appendImage, compressForUpload } from "../../lib/images";
import { queryClient } from "../../lib/query";
import { useTheme } from "../../theme/theme";
import { Legend, LineChart, StatTile } from "../../ui/charts";
import { Badge, Button, Card, Chip, EmptyState, Row, Segmented, SectionHeader, Skeleton, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

interface Photo {
  id: string;
  day: string;
  view: "front" | "side" | "back" | "custom";
  url: string;
}
const toX = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
const fmtX = (x: number) => new Date(x * 86_400_000).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const pretty = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default function Progress() {
  const th = useTheme();
  const profile = useProfile();
  const units = profile.data?.unitSystem ?? "metric";
  const weight = useWeight();
  const [range, setRange] = useState<"30" | "90" | "365">("90");
  const [view, setView] = useState<Photo["view"]>("front");
  const [compare, setCompare] = useState<string[]>([]);
  const measurements = useQuery({ queryKey: qk.measurements, queryFn: () => api<{ items: { kind: string; first?: { day: string; value: number }; latest?: { day: string; value: number }; change: number | null }[] }>("/v1/progress/measurements-summary", { query: { days: 180 } }) });
  const photos = useQuery({ queryKey: qk.photos, queryFn: async () => (await api<{ items: Photo[] }>("/v1/progress-photos")).items, staleTime: 4 * 60_000 });
  const recovery = useQuery({ queryKey: qk.recovery, queryFn: () => api<{ readiness: string; insights: { id: string; message: string }[]; sleep: { last7AvgMin: number | null; baselineAvgMin: number | null }; restingHr: { last7Avg: number | null }; steps: { day: string; steps: number }[]; explanation: string }>("/v1/recovery/summary") });
  const analytics = useQuery({ queryKey: qk.analytics, queryFn: () => api<{ strengthTrends: { exerciseId: string; name: string; points: { day: string; e1rmKg: number }[] }[] }>("/v1/training/analytics", { query: { weeks: 12 } }) });

  const w = weight.data;
  const conv = (kg: number) => (units === "imperial" ? round(kgToLb(kg), 1) : round(kg, 1));
  const unit = units === "imperial" ? "lb" : "kg";
  const cutoff = toX(todayKey()) - Number(range);
  const pts = (w?.trend ?? []).filter((p) => toX(p.day) >= cutoff);

  const uploadPhoto = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (r.canceled || !r.assets[0]) return;
    const form = new FormData();
    form.append("day", todayKey());
    form.append("view", view);
    await appendImage(form, "photo", await compressForUpload(r.assets[0].uri, 2048));
    await api("/v1/progress-photos", { method: "POST", form });
    haptic("success");
    void queryClient.invalidateQueries({ queryKey: qk.photos });
  };
  const viewPhotos = (photos.data ?? []).filter((p) => p.view === view);
  const compared = compare.map((id) => photos.data?.find((p) => p.id === id)).filter(Boolean) as Photo[];

  return (
    <Screen tabBar title="Progress" right={<Button title="Log weight" size="sm" icon="scale" onPress={() => router.push("/weigh-in")} />} onRefresh={() => { void weight.refetch(); void measurements.refetch(); void photos.refetch(); }} refreshing={weight.isRefetching}>
      {weight.isPending ? <Skeleton height={220} /> : w ? (
        <>
          <Row gap={8} align="stretch">
            <StatTile label="7-day average" value={w.sevenDayAverageKg ? String(conv(w.sevenDayAverageKg)) : "–"} unit={unit} />
            <StatTile label="Trend" value={w.rate.kgPerWeek == null ? "–" : `${w.rate.kgPerWeek >= 0 ? "+" : "−"}${conv(Math.abs(w.rate.kgPerWeek))}`} unit={w.rate.kgPerWeek == null ? undefined : `${unit}/wk`} hint={w.rate.sufficiency === "good" ? "≥ 3 weeks of data" : w.rate.sufficiency === "limited" ? "early estimate" : "needs more weigh-ins"} />
          </Row>
          <Card>
            <Stack gap={10}>
              <Row justify="space-between">
                <T variant="headline">Body weight</T>
                <View style={{ width: 170 }}><Segmented options={[{ value: "30", label: "1M" }, { value: "90", label: "3M" }, { value: "365", label: "1Y" }]} value={range} onChange={setRange} /></View>
              </Row>
              {pts.length >= 2 ? (
                <>
                  <LineChart
                    title="Body weight"
                    series={[
                      { key: "scale", label: "Scale readings", color: th.c.textTertiary, dotsOnly: true, points: pts.map((p) => ({ x: toX(p.day), y: conv(p.scaleKg) })) },
                      { key: "trend", label: "Trend", color: th.c.energy, points: pts.map((p) => ({ x: toX(p.day), y: conv(p.trendKg) })) },
                    ]}
                    formatY={(v) => String(round(v, 1))}
                    formatX={fmtX}
                    height={200}
                  />
                  <Legend items={[{ label: "Trend (smoothed)", color: th.c.energy }, { label: "Daily readings", color: th.c.textTertiary, dotted: true }]} />
                </>
              ) : (
                <EmptyState icon="scale" title="Not enough weigh-ins yet" body="Weigh in a few mornings a week; the trend appears after a couple of readings." />
              )}
              <T variant="footnote" color="textSecondary">{w.interpretation}</T>
              {w.progress && w.goal?.targetWeightKg ? (
                <View style={{ gap: 6 }}>
                  <Row justify="space-between"><T variant="footnote" color="textSecondary">Goal {conv(w.goal.targetWeightKg)} {unit}</T><T variant="footnote" color="textSecondary">{Math.round(w.progress.fraction * 100)}%{w.progress.weeksRemaining ? ` · ~${Math.round(w.progress.weeksRemaining)} weeks at this rate` : ""}</T></Row>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: th.c.track }}><View style={{ height: 6, borderRadius: 3, width: `${w.progress.fraction * 100}%`, backgroundColor: th.c.energy }} /></View>
                </View>
              ) : null}
            </Stack>
          </Card>
        </>
      ) : null}

      <SectionHeader title="Measurements" action="Add" onAction={() => router.push({ pathname: "/weigh-in", params: { measurements: "1" } })} />
      <Card>
        {measurements.data?.items.length ? (
          <Stack gap={8}>
            {measurements.data.items.map((m) => (
              <Row key={m.kind} justify="space-between">
                <T variant="subhead">{pretty(m.kind.replace("custom:", ""))}</T>
                <T variant="subhead" color="textSecondary">
                  {m.latest ? `${units === "imperial" ? round(m.latest.value / 2.54, 1) : m.latest.value} ${units === "imperial" ? "in" : "cm"}` : "–"}
                  {m.change != null ? ` (${m.change >= 0 ? "+" : "−"}${units === "imperial" ? round(Math.abs(m.change) / 2.54, 1) : round(Math.abs(m.change), 1)} since ${m.first ? fmtDay(m.first.day) : "first"})` : ""}
                </T>
              </Row>
            ))}
          </Stack>
        ) : (
          <EmptyState icon="edit" title="No measurements yet" body="Waist every couple of weeks is a useful companion to the scale." />
        )}
      </Card>

      <SectionHeader title="Photos" action="Add" onAction={() => void uploadPhoto()} />
      <Row gap={8}>{(["front", "side", "back"] as const).map((v) => <Chip key={v} label={pretty(v)} selected={view === v} onPress={() => { setView(v); setCompare([]); }} />)}</Row>
      {compared.length === 2 ? (
        <Card padded={false}>
          <Row gap={2}>
            {compared.map((p) => (
              <View key={p.id} style={{ flex: 1 }}>
                <Image source={{ uri: p.url }} style={{ width: "100%", aspectRatio: 0.75 }} contentFit="cover" accessibilityLabel={`${p.view} photo from ${p.day}`} />
                <T variant="caption" color="textSecondary" align="center" style={{ paddingVertical: 6 }}>{fmtDay(p.day)}</T>
              </View>
            ))}
          </Row>
        </Card>
      ) : null}
      {viewPhotos.length ? (
        <>
          <Row gap={6} wrap>
            {viewPhotos.map((p) => {
              const sel = compare.includes(p.id);
              return (
                <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`Photo ${p.day}${sel ? ", selected for comparison" : ""}`} onPress={() => setCompare((c) => (sel ? c.filter((x) => x !== p.id) : [...c, p.id].slice(-2)))} style={{ borderRadius: 10, overflow: "hidden", borderWidth: 2, borderColor: sel ? th.c.accent : "transparent" }}>
                  <Image source={{ uri: p.url }} style={{ width: 76, height: 100 }} contentFit="cover" />
                </Pressable>
              );
            })}
          </Row>
          <T variant="caption" color="textTertiary">Tap two photos to compare side by side. Photos are private and shown through short-lived links.</T>
        </>
      ) : (
        <Card><EmptyState icon="camera" title={`No ${view} photos yet`} body="Same lighting and distance each time makes comparisons more useful." /></Card>
      )}

      {analytics.data?.strengthTrends.length ? (
        <>
          <SectionHeader title="Strength" />
          {analytics.data.strengthTrends.slice(0, 3).map((t) => (
            <Card key={t.exerciseId}>
              <Row justify="space-between"><T variant="headline">{t.name}</T><Badge label="est. 1RM" /></Row>
              <LineChart title={`${t.name} estimated 1RM`} series={[{ key: t.exerciseId, label: t.name, color: th.c.protein, points: t.points.map((p) => ({ x: toX(p.day), y: round(units === "imperial" ? kgToLb(p.e1rmKg) : p.e1rmKg, 1) })) }]} formatY={(v) => String(Math.round(v))} formatX={fmtX} height={130} />
            </Card>
          ))}
        </>
      ) : null}

      <SectionHeader title="Recovery" />
      <Card>
        {recovery.data ? (
          <Stack gap={8}>
            <Row gap={8} wrap>
              <Badge label={`Sleep ${recovery.data.sleep.last7AvgMin ? `${round(recovery.data.sleep.last7AvgMin / 60, 1)} h` : "no data"}`} />
              <Badge label={`Resting HR ${recovery.data.restingHr.last7Avg ? Math.round(recovery.data.restingHr.last7Avg) : "–"}`} />
              <Badge label={`Steps ${recovery.data.steps.at(-1)?.steps.toLocaleString() ?? "–"}`} />
            </Row>
            {recovery.data.insights.map((i) => <T key={i.id} variant="footnote" color="textSecondary">{i.message}</T>)}
            <T variant="caption" color="textTertiary">{recovery.data.explanation}</T>
            <Button title="Connect Apple Health / Health Connect" kind="ghost" size="sm" onPress={() => router.push("/settings")} />
          </Stack>
        ) : <Skeleton height={60} />}
      </Card>
      {profile.data ? <T variant="caption" color="textTertiary">Latest weigh-in {w?.latest ? `${displayBodyWeight(w.latest.kg, units).value} ${unit} on ${w.latest.day}` : "none"}.</T> : null}
    </Screen>
  );
}
