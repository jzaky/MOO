import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, ApiError } from "../../lib/api";
import { haptic } from "../../lib/haptics";
import type { Food } from "../../lib/types";
import { t } from "../../i18n";
import { useTheme } from "../../theme/theme";
import { Button, Field, IconButton, Row, Stack, T } from "../../ui/primitives";

/**
 * Barcode scanner (expo-camera CameraView). The first detection locks the
 * scanner; the server validates the check digit and normalizes UPC-A/EAN-13
 * before lookup (iOS reports UPC-A as a 13-digit EAN).
 */
export default function Scan() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ day?: string; meal?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [status, setStatus] = useState<"scanning" | "looking" | "not_found" | "error">("scanning");
  const [code, setCode] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const locked = useRef(false);

  const lookup = async (raw: string) => {
    if (locked.current) return;
    locked.current = true;
    setCode(raw);
    setStatus("looking");
    haptic("light");
    try {
      const res = await api<{ food: Food; origin: string }>(`/v1/foods/barcode/${encodeURIComponent(raw)}`);
      haptic("success");
      router.replace({ pathname: "/food/[id]", params: { id: res.food.id, day: params.day ?? "", meal: params.meal ?? "" } });
    } catch (e) {
      if (e instanceof ApiError && e.code === "barcode_not_found") {
        setStatus("not_found");
        setCode((e.details as { barcode?: string } | undefined)?.barcode ?? raw);
      } else {
        setStatus("error");
        setMessage(e instanceof ApiError ? e.message : t("Lookup failed."));
      }
      haptic("warning");
    }
  };

  const reset = () => {
    locked.current = false;
    setStatus("scanning");
    setMessage(null);
  };

  if (!permission) return <View style={{ flex: 1, backgroundColor: th.c.bg }} />;
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: th.c.bg, padding: 24, paddingTop: insets.top + 24, justifyContent: "center", gap: 16 }}>
        <T variant="title2">{t("Camera access")}</T>
        <T color="textSecondary">{t("The camera is used only while this screen is open, to read product barcodes.")}</T>
        <Button title={permission.canAskAgain ? t("Allow camera") : t("Open Settings to allow")} onPress={() => void requestPermission()} />
        <Field label={t("Or type the barcode")} value={manual} onChangeText={(v) => setManual(v.replace(/\D/g, ""))} keyboardType="number-pad" returnKeyType="search" onSubmitEditing={() => manual && void lookup(manual)} />
        <Button title={t("Cancel")} kind="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] }}
        onBarcodeScanned={status === "scanning" ? (r: BarcodeScanningResult) => void lookup(r.data) : undefined}
      />
      <View pointerEvents="none" style={{ position: "absolute", top: "35%", start: "12%", end: "12%", height: 150, borderRadius: 18, borderWidth: 2, borderColor: "rgba(255,255,255,0.85)" }} />
      <Row justify="space-between" style={{ position: "absolute", top: insets.top + 8, start: 12, end: 12 }}>
        <IconButton icon="close" label={t("Close scanner")} onPress={() => router.back()} bg="surfaceRaised" />
        <IconButton icon="bolt" label={torch ? t("Turn off light") : t("Turn on light")} color={torch ? "warning" : "text"} onPress={() => setTorch((on) => !on)} bg="surfaceRaised" />
      </Row>
      <View style={{ position: "absolute", start: 16, end: 16, bottom: insets.bottom + 20 }}>
        <View style={{ backgroundColor: th.c.surface, borderRadius: 18, padding: 16, gap: 10 }}>
          {status === "scanning" ? (
            <T variant="subhead" color="textSecondary" align="center">
              {t("Point at the barcode on the package")}
            </T>
          ) : status === "looking" ? (
            <Row gap={10} justify="center">
              <ActivityIndicator color={th.c.textSecondary} />
              <T variant="subhead">{t("Looking up {code}…", { code: code ?? "" })}</T>
            </Row>
          ) : status === "not_found" ? (
            <Stack gap={10}>
              <T variant="headline">{t("Product not found")}</T>
              <T variant="footnote" color="textSecondary">
                {t("{code} isn't in the food databases yet. Photograph the nutrition label and we'll read it for you to check, or enter it yourself. It's saved privately to your account.", { code: code ?? "" })}
              </T>
              <Button title={t("Scan nutrition label")} icon="camera" onPress={() => router.replace({ pathname: "/food/custom", params: { barcode: code ?? "", label: "1" } })} />
              <Button title={t("Enter manually")} kind="secondary" onPress={() => router.replace({ pathname: "/food/custom", params: { barcode: code ?? "" } })} />
              <Button title={t("Scan again")} kind="ghost" onPress={reset} />
            </Stack>
          ) : (
            <Stack gap={10}>
              <T variant="footnote" color="danger">
                {message}
              </T>
              <Button title={t("Try again")} onPress={reset} />
            </Stack>
          )}
        </View>
      </View>
    </View>
  );
}
