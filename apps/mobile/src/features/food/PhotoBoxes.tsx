import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { t } from "../../i18n";
import { useTheme } from "../../theme/theme";
import { T } from "../../ui/primitives";

export interface PhotoBox {
  id: string;
  label: string;
  tier: "high" | "medium" | "low";
  grams: { low: number; high: number };
  region: { x: number; y: number; w: number; h: number } | null;
  included: boolean;
}

/**
 * The meal photo with a box on each recognised item: cyan when likely, amber when it needs a
 * check, red when unsure; excluded items fade. Boxes are approximate (the model's estimate of
 * where each item is) and only for orientation. Tapping one selects that item's card.
 */
export function PhotoBoxes({ uri, boxes, selected, onSelect }: { uri: string; boxes: PhotoBox[]; selected: string | null; onSelect: (id: string) => void }) {
  const th = useTheme();
  const [ratio, setRatio] = useState(4 / 3);
  const tone = (b: PhotoBox) => (b.tier === "high" ? th.c.data : b.tier === "medium" ? th.c.warning : th.c.danger);
  const shown = boxes.filter((b) => b.region);
  return (
    <View style={{ borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: th.c.border, backgroundColor: "#000" }}>
      <View style={{ width: "100%", aspectRatio: ratio }}>
        <Image source={{ uri }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" onLoad={(e) => e.source.width && e.source.height && setRatio(e.source.width / e.source.height)} accessibilityLabel={t("Your meal photo")} />
        {shown.map((b) => {
          const r = b.region!;
          const c = tone(b);
          const on = selected === b.id;
          // Labels sit above the box, or inside it when the box touches the top edge.
          const labelInside = r.y < 0.08;
          return (
            <Pressable
              key={b.id}
              accessibilityRole="button"
              accessibilityLabel={t("{item}, about {low}–{high} g", { item: b.label, low: b.grams.low, high: b.grams.high })}
              onPress={() => onSelect(b.id)}
              style={{ position: "absolute", left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, borderWidth: on ? 3 : 2, borderColor: c, borderRadius: 12, opacity: b.included ? 1 : 0.4, backgroundColor: on ? "rgba(255,255,255,0.08)" : "transparent" }}
            >
              <View style={{ position: "absolute", left: -2, ...(labelInside ? { top: 2 } : { top: -24 }), maxWidth: 220, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7, backgroundColor: c }}>
                <T variant="monoBold" numberOfLines={1} style={{ fontSize: 10, color: "#06141A" }}>
                  {`${b.label.toUpperCase()} · ${b.grams.low}–${b.grams.high} g`}
                </T>
              </View>
            </Pressable>
          );
        })}
      </View>
      {shown.length < boxes.length ? (
        <T variant="caption" color="textTertiary" style={{ padding: 8 }}>
          {t("Items without a box (like sauces or oil) are listed below.")}
        </T>
      ) : null}
    </View>
  );
}
