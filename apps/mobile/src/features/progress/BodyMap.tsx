import { View } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";
import { t } from "../../i18n";
import { useTheme } from "../../theme/theme";
import { T } from "../../ui/primitives";
import { heatLevel } from "./muscles";

type Shape = { kind: "rect"; x: number; y: number; w: number; h: number; r?: number } | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number } | { kind: "path"; d: string };

// Stylised front and back figures on a 100 × 200 grid; each region is one catalogue muscle.
const mirror = (s: Shape): Shape => (s.kind === "rect" ? { ...s, x: 100 - s.x - s.w } : s.kind === "ellipse" ? { ...s, cx: 100 - s.cx } : { kind: "path", d: s.d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) => `${100 - Number(x)},${y}`) });
const pair = (s: Shape): Shape[] => [s, mirror(s)];

const FRONT: Record<string, Shape[]> = {
  front_delts: pair({ kind: "ellipse", cx: 31, cy: 40, rx: 6, ry: 7 }),
  side_delts: pair({ kind: "ellipse", cx: 24.5, cy: 45, rx: 3.5, ry: 6.5 }),
  chest: pair({ kind: "path", d: "M36,35 Q49,31 49,37 L49,53 Q41,57 35,51 Z" }),
  biceps: pair({ kind: "rect", x: 19, y: 52, w: 9, h: 21, r: 4.5 }),
  forearms: pair({ kind: "rect", x: 16, y: 76, w: 9, h: 24, r: 4.5 }),
  abs: [{ kind: "rect", x: 41, y: 58, w: 18, h: 30, r: 5 }],
  obliques: pair({ kind: "rect", x: 34, y: 60, w: 6, h: 25, r: 3 }),
  quads: pair({ kind: "rect", x: 35, y: 98, w: 12.5, h: 44, r: 6 }),
  adductors: [{ kind: "rect", x: 47.8, y: 100, w: 4.4, h: 28, r: 2.2 }],
  calves: pair({ kind: "rect", x: 37, y: 148, w: 9.5, h: 34, r: 4.5 }),
};
const BACK: Record<string, Shape[]> = {
  traps: [{ kind: "path", d: "M38,31 L50,26 L62,31 L57,41 L43,41 Z" }],
  rear_delts: pair({ kind: "ellipse", cx: 30, cy: 42, rx: 6, ry: 7 }),
  upper_back: [{ kind: "rect", x: 41, y: 42, w: 18, h: 12, r: 3 }],
  lats: pair({ kind: "path", d: "M34,47 L40,50 L40,76 L36,72 Q33,60 34,47 Z" }),
  triceps: pair({ kind: "rect", x: 19, y: 52, w: 9, h: 21, r: 4.5 }),
  lower_back: [{ kind: "rect", x: 42, y: 70, w: 16, h: 18, r: 4 }],
  glutes: pair({ kind: "ellipse", cx: 43, cy: 99, rx: 8, ry: 9 }),
  hamstrings: pair({ kind: "rect", x: 35, y: 110, w: 12.5, h: 34, r: 6 }),
  calves: pair({ kind: "rect", x: 37, y: 148, w: 9.5, h: 32, r: 4.5 }),
};

function Figure({ regions, ratios, label }: { regions: Record<string, Shape[]>; ratios: Record<string, number | null>; label: string }) {
  const th = useTheme();
  const fill = (m: string) => {
    const lvl = heatLevel(ratios[m] ?? null);
    if (lvl == null) return { fill: th.c.surfaceRaised, opacity: 1 };
    if (lvl === 0) return { fill: th.c.track, opacity: 1 };
    return { fill: th.c.accent, opacity: [0, 0.3, 0.55, 0.8, 1][lvl]! };
  };
  return (
    <View style={{ alignItems: "center", gap: 4 }}>
      <Svg width={110} height={220} viewBox="0 0 100 200">
        <Circle cx={50} cy={14} r={10} fill={th.c.surfaceRaised} />
        <Rect x={45} y={23} width={10} height={8} rx={3} fill={th.c.surfaceRaised} />
        {/* Untrained silhouette under the regions, so gaps read as body, not holes. */}
        <Path d="M30,33 Q50,27 70,33 L82,52 L86,100 L78,100 L72,62 L66,94 L66,182 L54,182 L52,120 L48,120 L46,182 L34,182 L34,94 L28,62 L22,100 L14,100 L18,52 Z" fill={th.c.surfaceSunken} />
        {Object.entries(regions).map(([m, shapes]) => {
          const f = fill(m);
          return (
            <G key={m} opacity={f.opacity}>
              {shapes.map((s, i) =>
                s.kind === "rect" ? <Rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r ?? 0} fill={f.fill} /> : s.kind === "ellipse" ? <Ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill={f.fill} /> : <Path key={i} d={s.d} fill={f.fill} />,
              )}
            </G>
          );
        })}
      </Svg>
      <T variant="label" color="textTertiary" style={{ fontSize: 9 }}>{label}</T>
    </View>
  );
}

/** Front and back figures shaded by this week's sets against the plan (brighter = closer to plan). Decorative: the list beside it carries the numbers. */
export function BodyMap({ ratios }: { ratios: Record<string, number | null> }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", justifyContent: "center", gap: 4, direction: "ltr" }}>
      <Figure regions={FRONT} ratios={ratios} label={t("Front")} />
      <Figure regions={BACK} ratios={ratios} label={t("Back view")} />
    </View>
  );
}
