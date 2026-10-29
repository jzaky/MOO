import { useMutation } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { MEALS } from "../../features/foods/FoodPicker";
import { api, ApiError } from "../../lib/api";
import { defaultMealForNow, quickAdd } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { todayKey } from "../../lib/ids";
import { appendImage, compressForUpload } from "../../lib/images";
import type { MenuDish, MenuResult } from "../../lib/types";
import { fmtNum, t, tn } from "../../i18n";
import { Badge, Button, Card, Chip, Field, Row, SectionHeader, Segmented, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

const errText = (e: unknown) =>
  e instanceof ApiError ? (e.code === "consent_required" ? t("Photo analysis is off. Turn it on in Settings → Privacy & AI, or paste the menu text.") : e.message) : t("Couldn't read the menu. Try again or paste the text.");

function energyText(d: MenuDish): string {
  if (d.basis === "estimate" && d.energyRangeKcal) return `${d.energyRangeKcal.low}–${d.energyRangeKcal.high} kcal`;
  return d.energyKcal != null ? `${d.energyKcal} kcal` : t("energy unknown");
}

function DishCard({ d, best, onLog, logged }: { d: MenuDish; best: boolean; onLog: () => void; logged: boolean }) {
  const macros = [d.proteinG != null ? t("P {g} g", { g: d.proteinG }) : null, d.carbsG != null ? t("C {g} g", { g: d.carbsG }) : null, d.fatG != null ? t("F {g} g", { g: d.fatG }) : null].filter(Boolean).join(" · ");
  return (
    <Card>
      <Stack gap={6}>
        <Row justify="space-between" align="flex-start">
          <T variant="headline" style={{ flex: 1 }}>{d.name}</T>
          <Badge label={d.basis === "printed" ? t("on menu") : t("estimate")} tone={d.basis === "printed" ? "accent" : "info"} />
        </Row>
        {d.description ? <T variant="footnote" color="textSecondary" numberOfLines={2}>{d.description}</T> : null}
        <Row justify="space-between">
          <View style={{ flex: 1 }}>
            <T variant="subhead">{energyText(d)}</T>
            {macros ? <T variant="caption" color="textSecondary">{d.basis === "estimate" ? t("{macros} (typical portion)", { macros }) : macros}</T> : null}
          </View>
          {logged ? <T variant="footnote" color="accent">{t("Logged")}</T> : <Button title={t("Log")} size="sm" icon="add" disabled={d.energyKcal == null} onPress={onLog} />}
        </Row>
        {best ? <T variant="caption" color="accent">{t("Fits what's left of your day well")}</T> : null}
        {d.unmatchedComponents.length ? <T variant="caption" color="textTertiary">{t("Not in the food database: {items}. Not counted.", { items: d.unmatchedComponents.join(", ") })}</T> : null}
      </Stack>
    </Card>
  );
}

export default function MenuScreen() {
  const params = useLocalSearchParams<{ day?: string; meal?: string }>();
  const day = params.day || todayKey();
  const [meal, setMeal] = useState(params.meal || defaultMealForNow());
  const [mode, setMode] = useState<"photo" | "text">("photo");
  const [photos, setPhotos] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [logged, setLogged] = useState<Set<number>>(new Set());

  const addPhoto = async (camera: boolean) => {
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return;
    }
    const r = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 3, quality: 0.85 });
    if (!r.canceled) setPhotos((p) => [...p, ...r.assets.map((a) => a.uri)].slice(0, 3));
  };

  const analyze = useMutation({
    mutationFn: async () => {
      if (mode === "text") return api<MenuResult>("/v1/ai/menu", { body: { text } });
      const form = new FormData();
      for (const [i, uri] of photos.entries()) await appendImage(form, `image${i}`, await compressForUpload(uri, 2000));
      return api<MenuResult>("/v1/ai/menu", { method: "POST", form });
    },
    onSuccess: () => {
      haptic("success");
      setLogged(new Set());
    },
  });

  const log = (d: MenuDish, i: number) => {
    if (d.energyKcal == null) return;
    const where = analyze.data?.restaurant ? ` (${analyze.data.restaurant})` : "";
    quickAdd({ day, meal, description: `${d.name}${where}`.slice(0, 200), energyKcal: d.energyKcal, proteinG: d.proteinG, carbsG: d.carbsG, fatG: d.fatG, ...(d.basis === "estimate" ? { provenance: "ai_estimate" as const } : {}) });
    haptic("success");
    setLogged((s) => new Set(s).add(i));
  };

  const res = analyze.data;
  const ready = mode === "text" ? text.trim().length >= 3 : photos.length > 0;

  return (
    <Screen close title={t("Restaurant menu")} subtitle={res?.restaurant ?? t("Find dishes that fit your day")}>
      {!res ? (
        <>
          <Segmented options={[{ value: "photo", label: t("Photo of menu") }, { value: "text", label: t("Paste text") }]} value={mode} onChange={setMode} />
          {mode === "photo" ? (
            <Stack gap={10}>
              <Row gap={8}>
                {photos.map((u, i) => (
                  <Pressable key={u} accessibilityLabel={t("Remove page {n}", { n: i + 1 })} onPress={() => setPhotos((p) => p.filter((x) => x !== u))}>
                    <Image source={{ uri: u }} style={{ width: 72, height: 96, borderRadius: 10 }} contentFit="cover" />
                  </Pressable>
                ))}
              </Row>
              <Row gap={8}>
                {Platform.OS !== "web" ? <Button title={t("Take photo")} icon="camera" kind="secondary" size="md" onPress={() => void addPhoto(true)} style={{ flex: 1 }} /> : null}
                <Button title={t("Choose photos")} icon="photos" kind="secondary" size="md" onPress={() => void addPhoto(false)} style={{ flex: 1 }} />
              </Row>
              <T variant="caption" color="textTertiary">{t("Up to 3 pages. Photos are sent to the AI provider only with photo analysis turned on in settings, and are not stored.")}</T>
            </Stack>
          ) : (
            <Field label={t("Menu text")} value={text} onChangeText={setText} multiline numberOfLines={8} style={{ minHeight: 160, textAlignVertical: "top" }} placeholder={t("Chicken shawarma plate – garlic sauce, fries, salad\nGrilled halloumi wrap\nLentil soup")} />
          )}
          {analyze.error ? <T variant="footnote" color="danger">{errText(analyze.error)}</T> : null}
          <Button title={t("Read menu")} icon="search" disabled={!ready} loading={analyze.isPending} onPress={() => analyze.mutate()} />
        </>
      ) : (
        <>
          {res.remaining ? <T variant="subhead" color="textSecondary">{t("Left today: {kcal} kcal · {protein} g protein", { kcal: fmtNum(Math.max(0, Math.round(res.remaining.energyKcal))), protein: Math.max(0, Math.round(res.remaining.proteinG)) })}</T> : null}
          <Row gap={8} wrap>{MEALS.map((m) => <Chip key={m.value} label={m.label} selected={meal === m.value} onPress={() => setMeal(m.value)} />)}</Row>
          <SectionHeader title={tn(res.dishes.length, "{n} dish", "{n} dishes")} action={t("Start over")} onAction={() => analyze.reset()} />
          {res.dishes.map((d, i) => <DishCard key={`${d.name}-${i}`} d={d} best={i < 2 && (d.fit ?? -1) > 0} logged={logged.has(i)} onLog={() => log(d, i)} />)}
          <T variant="caption" color="textTertiary">{res.disclaimer} {t("Estimates are logged as estimates.")}</T>
          <Button title={t("Done")} kind="secondary" onPress={() => router.back()} />
        </>
      )}
    </Screen>
  );
}
