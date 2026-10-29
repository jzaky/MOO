import { CameraView, useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, ApiError } from "../../lib/api";
import { haptic } from "../../lib/haptics";
import { appendImage, compressForUpload } from "../../lib/images";
import { kv } from "../../lib/storage";
import { t } from "../../i18n";
import { useTheme } from "../../theme/theme";
import { Button, Chip, IconButton, Row, Stack, T } from "../../ui/primitives";

function stages() {
  return [t("Uploading photo"), t("Identifying foods"), t("Estimating portions"), t("Matching nutrition data")];
}
const STAGE_COUNT = 4;

export default function MealCamera() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ day?: string; meal?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [shots, setShots] = useState<string[]>([]);
  const [mode, setMode] = useState<"standard" | "before_after">("standard");
  const [stage, setStage] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const take = async () => {
    const pic = await cam.current?.takePictureAsync({ quality: 0.8, skipProcessing: false });
    if (pic?.uri) {
      haptic("light");
      setShots((s) => [...s, pic.uri].slice(0, mode === "before_after" ? 2 : 4));
    }
  };
  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 4, quality: 0.8 });
    if (!r.canceled) setShots((s) => [...s, ...r.assets.map((a) => a.uri)].slice(0, 4));
  };

  const analyze = async () => {
    setError(null);
    setStage(0);
    const timer = setInterval(() => setStage((s) => (s === null ? s : Math.min(STAGE_COUNT - 1, s + 1))), 2500);
    try {
      const form = new FormData();
      form.append("mode", mode);
      for (const [i, uri] of shots.entries()) await appendImage(form, `image${i}`, await compressForUpload(uri));
      const res = await api<{ recognitionId: string }>("/v1/ai/meal-photo", { method: "POST", form });
      kv.set("recognition.current", { ...res, day: params.day ?? null, meal: params.meal ?? null });
      haptic("success");
      router.replace("/food/review");
    } catch (e) {
      setError(e instanceof ApiError ? (e.code === "consent_required" ? t("Photo analysis is turned off. Enable it in Settings → Privacy.") : e.message) : t("Analysis failed. You can still log the meal manually."));
      haptic("warning");
    } finally {
      clearInterval(timer);
      setStage(null);
    }
  };

  if (!permission) return <View style={{ flex: 1, backgroundColor: th.c.bg }} />;
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {permission.granted ? <CameraView ref={cam} style={{ flex: 1 }} facing="back" /> : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}>
          <T variant="headline" align="center">{t("Camera access is needed to photograph meals")}</T>
          <Button title={t("Allow camera")} onPress={() => void requestPermission()} />
          <Button title={t("Choose from library")} kind="secondary" onPress={() => void pick()} />
        </View>
      )}
      <Row justify="space-between" style={{ position: "absolute", top: insets.top + 8, start: 12, end: 12 }}>
        <IconButton icon="close" label={t("Close")} onPress={() => router.back()} bg="surfaceRaised" />
        <Row gap={6}>
          <Chip label={t("Meal")} selected={mode === "standard"} onPress={() => setMode("standard")} />
          <Chip label={t("Before / after")} selected={mode === "before_after"} onPress={() => { setMode("before_after"); setShots((s) => s.slice(0, 2)); }} />
        </Row>
      </Row>
      <View style={{ position: "absolute", start: 0, end: 0, bottom: 0, paddingBottom: insets.bottom + 16, paddingTop: 14, paddingHorizontal: 16, backgroundColor: "rgba(11,12,14,0.92)", gap: 12 }}>
        {stage !== null ? (
          <Stack gap={8} style={{ alignItems: "center", paddingVertical: 8 }}>
            <ActivityIndicator color={th.c.accent} />
            <T variant="subhead">{stages()[stage]}…</T>
            <T variant="caption" color="textTertiary">{t("Results are an estimate you can edit.")}</T>
          </Stack>
        ) : (
          <>
            <T variant="footnote" color="textSecondary" align="center">
              {mode === "before_after" ? (shots.length === 0 ? t("1. Photograph the full plate") : shots.length === 1 ? t("2. Photograph what's left") : t("Ready to analyse")) : t("Include the whole plate. Extra angles help with portions.")}
            </T>
            <Row gap={8}>
              {shots.map((u, i) => (
                <Pressable key={u} accessibilityLabel={t("Remove photo {n}", { n: i + 1 })} onPress={() => setShots((s) => s.filter((x) => x !== u))}>
                  <Image source={{ uri: u }} style={{ width: 52, height: 52, borderRadius: 10 }} />
                </Pressable>
              ))}
            </Row>
            <Row justify="space-between">
              <IconButton icon="photos" label={t("Choose from library")} onPress={() => void pick()} bg="surfaceRaised" size={48} />
              <Pressable accessibilityRole="button" accessibilityLabel={t("Take photo")} disabled={!permission.granted} onPress={() => void take()} style={({ pressed }) => ({ width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: "#fff", alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}>
                <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: "#fff" }} />
              </Pressable>
              <IconButton icon="check" label={t("Analyse photos")} color={shots.length ? "accent" : "textTertiary"} onPress={() => shots.length && void analyze()} bg="surfaceRaised" size={48} />
            </Row>
            {error ? (
              <Stack gap={8}>
                <T variant="footnote" color="danger" align="center">{error}</T>
                <Button title={t("Log manually instead")} kind="secondary" size="md" onPress={() => router.replace({ pathname: "/food/search", params: { day: params.day ?? "", meal: params.meal ?? "" } })} />
              </Stack>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}
