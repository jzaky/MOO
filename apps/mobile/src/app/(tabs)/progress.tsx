import { displayBodyWeight, kgToLb, navyBodyFat, round, startOfIsoWeek } from "@stoke/core";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { BodyMap } from "../../features/progress/BodyMap";
import { goalForecast } from "../../features/progress/forecast";
import { muscleLabel } from "../../features/workout/components";
import { muscleRows, plannedSetsPerMuscle } from "../../features/progress/muscles";
import { api } from "../../lib/api";
import type { Program } from "../../lib/types";
import { qk, useProfile, useWeight } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { todayKey } from "../../lib/ids";
import { appendImage, compressForUpload } from "../../lib/images";
import { queryClient } from "../../lib/query";
import { useTheme } from "../../theme/theme";
import { Legend, LineChart } from "../../ui/charts";
import { Badge, Button, Card, Chip, EmptyState, Row, Segmented, SectionHeader, Skeleton, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";
import { fmtDay, locale, t, tn } from "../../i18n";

interface Photo {
  id: string;
  day: string;
  view: "front" | "side" | "back" | "custom";
  url: string;
}
const toX = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
const fmtX = (x: number) => new Date(x * 86_400_000).toLocaleDateString(locale(), { month: "short", day: "numeric", timeZone: "UTC" });
const pretty = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function measurementLabel(kind: string): string {
  switch (kind) {
    case "weight": return t("Weight");
    case "body_fat_pct": return t("Body fat");
    case "waist": return t("Waist");
    case "chest": return t("Chest");
    case "hips": return t("Hips");
    case "neck": return t("Neck");
    case "left_arm": return t("Left arm");
    case "right_arm": return t("Right arm");
    case "left_thigh": return t("Left thigh");
    case "right_thigh": return t("Right thigh");
    case "calf": return t("Calf");
    default: return pretty(kind.replace("custom:", ""));
  }
}

function viewLabel(v: Photo["view"]): string {
  switch (v) {
    case "front": return t("Front");
    case "side": return t("Side");
    case "back": return t("Back view");
    default: return t("Other");
  }
}

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
  const analytics = useQuery({ queryKey: [...qk.analytics, 12], queryFn: () => api<{ weeks: { week: string; setsPerMuscle: Record<string, number> }[]; strengthTrends: { exerciseId: string; name: string; points: { day: string; e1rmKg: number }[] }[] }>("/v1/training/analytics", { query: { weeks: 12 } }) });
  const programs = useQuery({ queryKey: qk.programs, queryFn: async () => (await api<{ items: Program[] }>("/v1/programs")).items });

  const w = weight.data;
  // Body-fat estimate from the latest circumferences (US Navy method), computed on device.
  const latest = (kind: string) => measurements.data?.items.find((m) => m.kind === kind)?.latest?.value ?? null;
  const p = profile.data;
  const bf = p?.sex && p.heightCm && latest("waist") && latest("neck") ? navyBodyFat({ sex: p.sex, heightCm: p.heightCm, waistCm: latest("waist")!, neckCm: latest("neck")!, hipCm: latest("hips") }) : null;
  const bfMissing = !p?.sex || !p?.heightCm ? t("height and sex in your profile") : [!latest("waist") && t("waist"), !latest("neck") && t("neck"), p.sex === "female" && !latest("hips") && t("hips")].filter(Boolean).join(t(", "));
  const conv = (kg: number) => (units === "imperial" ? round(kgToLb(kg), 1) : round(kg, 1));
  const unit = units === "imperial" ? "lb" : "kg";
  const cutoff = toX(todayKey()) - Number(range);
  const pts = (w?.trend ?? []).filter((p) => toX(p.day) >= cutoff);
  const goalKg = w?.goal?.targetWeightKg ?? null;
  const forecast = w ? goalForecast({ trendKg: w.rate.latestTrendKg, goalKg, kgPerWeek: w.rate.kgPerWeek, sufficiency: w.rate.sufficiency, today: todayKey() }) : null;
  const lastPt = pts.at(-1);
  // Draw the projection at most ~4 months ahead so the history stays readable.
  const projEnd = forecast && lastPt ? Math.min(toX(forecast.day), toX(lastPt.day) + 120) : null;
  const projection = forecast && lastPt && projEnd != null && w?.rate.kgPerWeek != null ? [{ x: toX(lastPt.day), y: conv(lastPt.trendKg) }, { x: projEnd, y: conv(lastPt.trendKg + (w.rate.kgPerWeek / 7) * (projEnd - toX(lastPt.day))) }] : null;
  const towardGoal = goalKg != null && w?.rate.kgPerWeek != null && w.rate.latestTrendKg != null && Math.sign(goalKg - w.rate.latestTrendKg) === Math.sign(w.rate.kgPerWeek);

  // This week's sets per muscle against the active program's plan (same counting rule as the server).
  const thisWeek = startOfIsoWeek(todayKey());
  const doneSets = analytics.data?.weeks.find((wk) => wk.week === thisWeek)?.setsPerMuscle ?? {};
  const activeProgram = (programs.data ?? []).find((p) => p.status === "active") ?? programs.data?.[0];
  const planned = activeProgram ? plannedSetsPerMuscle(activeProgram.days) : {};
  const rows = muscleRows(doneSets, planned);
  const ratios = Object.fromEntries(rows.map((r) => [r.muscle, r.ratio]));

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
    <Screen tabBar title={t("Progress")} right={<Button title={t("Log weight")} size="sm" icon="scale" onPress={() => router.push("/weigh-in")} />} onRefresh={() => { void weight.refetch(); void measurements.refetch(); void photos.refetch(); }} refreshing={weight.isRefetching}>
      {weight.isPending ? <Skeleton height={220} /> : w ? (
        <>
          <Stack gap={2}>
            <Row justify="space-between">
              <T variant="label" color="textTertiary">{t("Trend weight")}</T>
              {goalKg != null ? <T variant="label" color="data">{t("Goal {value} {unit}", { value: conv(goalKg), unit })}</T> : null}
            </Row>
            <Row gap={10} align="flex-end">
              <T variant="metricHero">{w.rate.latestTrendKg != null ? String(conv(w.rate.latestTrendKg)) : w.sevenDayAverageKg ? String(conv(w.sevenDayAverageKg)) : "–"}</T>
              <T variant="metric" color="textTertiary" style={{ marginBottom: 6 }}>{unit}</T>
              <View style={{ flex: 1 }} />
              <Stack gap={0} style={{ alignItems: "flex-end", marginBottom: 6 }}>
                <T variant="monoBold" color={w.rate.kgPerWeek == null ? "textTertiary" : towardGoal ? "success" : "textSecondary"}>
                  {w.rate.kgPerWeek == null ? t("needs more weigh-ins") : t("{change} {unit}/wk", { change: `${w.rate.kgPerWeek >= 0 ? "+" : "−"}${conv(Math.abs(w.rate.kgPerWeek))}`, unit })}
                </T>
                <T variant="mono" color="textTertiary">{w.rate.sufficiency === "good" ? t("≥ 3 weeks of data") : w.rate.sufficiency === "limited" ? t("early estimate") : t("7-day average")}</T>
              </Stack>
            </Row>
          </Stack>
          <Card>
            <Stack gap={10}>
              <Row justify="space-between">
                <T variant="headline">{t("Body weight")}</T>
                <View style={{ width: 170 }}><Segmented options={[{ value: "30", label: t("1M") }, { value: "90", label: t("3M") }, { value: "365", label: t("1Y") }]} value={range} onChange={setRange} /></View>
              </Row>
              {pts.length >= 2 ? (
                <>
                  <LineChart
                    title={t("Body weight")}
                    series={[
                      { key: "scale", label: t("Scale readings"), color: th.c.textTertiary, dotsOnly: true, points: pts.map((p) => ({ x: toX(p.day), y: conv(p.scaleKg) })) },
                      { key: "trend", label: t("Trend"), color: th.c.energy, points: pts.map((p) => ({ x: toX(p.day), y: conv(p.trendKg) })) },
                      ...(projection ? [{ key: "forecast", label: t("At this pace"), color: th.c.accent, projection: true, points: projection }] : []),
                    ]}
                    formatY={(v) => String(round(v, 1))}
                    formatX={fmtX}
                    height={210}
                    reference={goalKg != null ? { y: conv(goalKg), label: t("Goal {value}", { value: conv(goalKg) }), color: th.c.data } : undefined}
                  />
                  <Legend items={[{ label: t("Trend (smoothed)"), color: th.c.energy }, { label: t("Daily readings"), color: th.c.textTertiary, dotted: true }, ...(projection ? [{ label: t("At this pace"), color: th.c.accent }] : [])]} />
                  {forecast && goalKg != null ? (
                    <T variant="mono" color="textSecondary">
                      {t("At this pace, {goal} {unit} around {date} (between {early} and {late} if the pace changes by a quarter). Drag across the chart to read any day.", { goal: conv(goalKg), unit, date: fmtDay(forecast.day, { day: "numeric", month: "short", year: "numeric" }), early: fmtDay(forecast.earliest), late: fmtDay(forecast.latest) })}
                    </T>
                  ) : (
                    <T variant="mono" color="textTertiary">{t("Drag across the chart to read any day.")}</T>
                  )}
                </>
              ) : (
                <EmptyState icon="scale" title={t("Not enough weigh-ins yet")} body={t("Weigh in a few mornings a week; the trend appears after a couple of readings.")} />
              )}
              <T variant="footnote" color="textSecondary">{w.interpretation}</T>
              {w.progress && w.goal?.targetWeightKg ? (
                <View style={{ gap: 6 }}>
                  <Row justify="space-between"><T variant="footnote" color="textSecondary">{t("Goal {value} {unit}", { value: conv(w.goal.targetWeightKg), unit })}</T><T variant="footnote" color="textSecondary">{Math.round(w.progress.fraction * 100)}%{w.progress.weeksRemaining ? ` · ${tn(Math.round(w.progress.weeksRemaining), "~{n} week at this rate", "~{n} weeks at this rate")}` : ""}</T></Row>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: th.c.track }}><View style={{ height: 6, borderRadius: 3, width: `${w.progress.fraction * 100}%`, backgroundColor: th.c.energy }} /></View>
                </View>
              ) : null}
            </Stack>
          </Card>
        </>
      ) : null}

      {rows.length ? (
        <>
          <SectionHeader title={t("Sets per muscle this week")} action={t("Train")} onAction={() => router.push("/train")} />
          <Card>
            <BodyMap ratios={ratios} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 6, marginTop: 8 }}>
              {rows.slice(0, 12).map((r) => (
                <Row key={r.muscle} justify="space-between" gap={6} style={{ width: "46%", flexGrow: 1 }}>
                  <T variant="caption" weight="700" numberOfLines={1} style={{ flexShrink: 1 }}>{muscleLabel(r.muscle)}</T>
                  <T variant="mono" color={r.ratio == null ? "textTertiary" : r.ratio >= 1 ? "accent" : "textSecondary"}>
                    {r.planned ? `${r.done}/${r.planned}` : `${r.done}`}
                  </T>
                </Row>
              ))}
            </View>
            <T variant="caption" color="textTertiary" style={{ marginTop: 8 }}>{t("Completed sets this week against your program (secondary muscles count as half a set). Brighter means closer to plan.")}</T>
          </Card>
        </>
      ) : null}

      <SectionHeader title={t("Measurements")} action={t("Add")} onAction={() => router.push({ pathname: "/weigh-in", params: { measurements: "1" } })} />
      <Card>
        {measurements.data?.items.length ? (
          <Stack gap={8}>
            {measurements.data.items.map((m) => (
              <Row key={m.kind} justify="space-between">
                <T variant="subhead">{measurementLabel(m.kind)}</T>
                <T variant="subhead" color="textSecondary">
                  {m.latest ? `${units === "imperial" ? round(m.latest.value / 2.54, 1) : m.latest.value} ${units === "imperial" ? "in" : "cm"}` : "–"}
                  {m.change != null ? ` (${t("{change} since {date}", { change: `${m.change >= 0 ? "+" : "−"}${units === "imperial" ? round(Math.abs(m.change) / 2.54, 1) : round(Math.abs(m.change), 1)}`, date: m.first ? fmtDay(m.first.day) : t("first") })})` : ""}
                </T>
              </Row>
            ))}
          </Stack>
        ) : (
          <EmptyState icon="edit" title={t("No measurements yet")} body={t("Waist every couple of weeks is a useful companion to the scale.")} />
        )}
      </Card>

      <Card>
        {bf ? (
          <Stack gap={4}>
            <Row justify="space-between">
              <T variant="headline">{t("Body fat ≈ {pct}%", { pct: bf.percent })}</T>
              <Badge label={t("estimate")} tone="info" />
            </Row>
            <T variant="footnote" color="textSecondary">{p?.sex === "female" ? t("US Navy method from your latest waist, neck, hips and height. Typically within ±{err} points of lab methods; use it to see a trend, not as an exact number.", { err: bf.typicalErrorPct }) : t("US Navy method from your latest waist, neck and height. Typically within ±{err} points of lab methods; use it to see a trend, not as an exact number.", { err: bf.typicalErrorPct })}</T>
          </Stack>
        ) : (
          <T variant="footnote" color="textSecondary">{t("Add {missing} to see a body-fat estimate (US Navy method).", { missing: bfMissing || t("measurements") })}</T>
        )}
      </Card>

      <SectionHeader title={t("Photos")} action={t("Add")} onAction={() => void uploadPhoto()} />
      <Row gap={8}>{(["front", "side", "back"] as const).map((v) => <Chip key={v} label={viewLabel(v)} selected={view === v} onPress={() => { setView(v); setCompare([]); }} />)}</Row>
      {compared.length === 2 ? (
        <Card padded={false}>
          <Row gap={2}>
            {compared.map((p) => (
              <View key={p.id} style={{ flex: 1 }}>
                <Image source={{ uri: p.url }} style={{ width: "100%", aspectRatio: 0.75 }} contentFit="cover" accessibilityLabel={t("{view} photo from {date}", { view: viewLabel(p.view), date: fmtDay(p.day) })} />
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
                <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={sel ? t("Photo {date}, selected for comparison", { date: fmtDay(p.day) }) : t("Photo {date}", { date: fmtDay(p.day) })} onPress={() => setCompare((c) => (sel ? c.filter((x) => x !== p.id) : [...c, p.id].slice(-2)))} style={{ borderRadius: 10, overflow: "hidden", borderWidth: 2, borderColor: sel ? th.c.accent : "transparent" }}>
                  <Image source={{ uri: p.url }} style={{ width: 76, height: 100 }} contentFit="cover" />
                </Pressable>
              );
            })}
          </Row>
          <T variant="caption" color="textTertiary">{t("Tap two photos to compare side by side. Photos are private and shown through short-lived links.")}</T>
        </>
      ) : (
        <Card><EmptyState icon="camera" title={t("No {view} photos yet", { view: viewLabel(view) })} body={t("Same lighting and distance each time makes comparisons more useful.")} /></Card>
      )}

      {analytics.data?.strengthTrends.length ? (
        <>
          <SectionHeader title={t("Strength")} />
          {analytics.data.strengthTrends.slice(0, 3).map((tr) => (
            <Card key={tr.exerciseId}>
              <Row justify="space-between"><T variant="headline">{tr.name}</T><Badge label={t("est. 1RM")} /></Row>
              <LineChart title={t("{name} estimated 1RM", { name: tr.name })} series={[{ key: tr.exerciseId, label: tr.name, color: th.c.protein, points: tr.points.map((p) => ({ x: toX(p.day), y: round(units === "imperial" ? kgToLb(p.e1rmKg) : p.e1rmKg, 1) })) }]} formatY={(v) => String(Math.round(v))} formatX={fmtX} height={130} />
            </Card>
          ))}
        </>
      ) : null}

      <SectionHeader title={t("Recovery")} />
      <Card>
        {recovery.data ? (
          <Stack gap={8}>
            <Row gap={8} wrap>
              <Badge label={t("Sleep {value}", { value: recovery.data.sleep.last7AvgMin ? t("{h} h", { h: round(recovery.data.sleep.last7AvgMin / 60, 1) }) : t("no data") })} />
              <Badge label={t("Resting HR {value}", { value: recovery.data.restingHr.last7Avg ? Math.round(recovery.data.restingHr.last7Avg) : "–" })} />
              <Badge label={t("Steps {value}", { value: recovery.data.steps.at(-1)?.steps.toLocaleString(locale()) ?? "–" })} />
            </Row>
            {recovery.data.insights.map((i) => <T key={i.id} variant="footnote" color="textSecondary">{i.message}</T>)}
            <T variant="caption" color="textTertiary">{recovery.data.explanation}</T>
            <Button title={t("Connect Apple Health / Health Connect")} kind="ghost" size="sm" onPress={() => router.push("/settings")} />
          </Stack>
        ) : <Skeleton height={60} />}
      </Card>
      {profile.data ? <T variant="caption" color="textTertiary">{w?.latest ? t("Latest weigh-in {value} {unit} on {date}.", { value: displayBodyWeight(w.latest.kg, units).value, unit, date: fmtDay(w.latest.day) }) : t("No weigh-ins yet.")}</T> : null}
    </Screen>
  );
}
