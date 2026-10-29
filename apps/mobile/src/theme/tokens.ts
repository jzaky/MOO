import { Platform, type TextStyle } from "react-native";

/**
 * Design tokens. Dark is the default appearance; the light palette is
 * defined so components never hard-code colors and light mode can ship
 * without touching screens.
 */

const dark = {
  bg: "#0B0C0E",
  surface: "#141519",
  surfaceRaised: "#1B1D22",
  surfaceSunken: "#0F1013",
  surfacePressed: "#22252B",
  border: "#24262C",
  hairline: "rgba(255,255,255,0.06)",
  text: "#F2F3F5",
  textSecondary: "#A1A5AE",
  textTertiary: "#6B7079",
  textInverse: "#0B0C0E",
  accent: "#7CF0B4",
  accentMuted: "rgba(124,240,180,0.14)",
  // Data colors (marks only, never text). Validated for the dark surface with
  // the dataviz palette checker: lightness band, chroma, adjacent CVD separation, contrast.
  energy: "#1FA971",
  protein: "#4F8DF0",
  carbs: "#BC8A1F",
  fat: "#B266D6",
  fiber: "#6E9E2A",
  water: "#2A9BC4",
  gridline: "#202227",
  warning: "#F4C66A",
  danger: "#F28B82",
  dangerMuted: "rgba(242,139,130,0.14)",
  success: "#7CF0B4",
  info: "#8AB4FF",
  track: "#23252B",
  overlay: "rgba(0,0,0,0.6)",
};

const light: typeof dark = {
  bg: "#F6F6F4",
  surface: "#FFFFFF",
  surfaceRaised: "#FFFFFF",
  surfaceSunken: "#EFEFEC",
  surfacePressed: "#ECECE8",
  border: "#E3E3DF",
  hairline: "rgba(0,0,0,0.06)",
  text: "#111214",
  textSecondary: "#5C6068",
  textTertiary: "#8B9098",
  textInverse: "#FFFFFF",
  accent: "#14A06A",
  accentMuted: "rgba(20,160,106,0.12)",
  energy: "#14955F",
  protein: "#3F74E0",
  carbs: "#A8780F",
  fat: "#9B4FC4",
  fiber: "#5F8A1E",
  water: "#1C8DB4",
  gridline: "#EDEDEA",
  warning: "#C98A12",
  danger: "#D9534A",
  dangerMuted: "rgba(217,83,74,0.12)",
  success: "#14A06A",
  info: "#3F74E0",
  track: "#E7E7E3",
  overlay: "rgba(0,0,0,0.35)",
};

export const palettes = { dark, light };
export type Palette = typeof dark;

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

const family = Platform.select({ ios: "System", android: "sans-serif", default: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" });
// Numbers use the same sans as all text (no decorative display face).
const rounded = family;

const t = (size: number, lineHeight: number, weight: TextStyle["fontWeight"], extra: TextStyle = {}): TextStyle => ({ fontSize: size, lineHeight, fontWeight: weight, fontFamily: family, ...extra });

/**
 * Type scale (iOS-aligned). Standalone numbers use proportional figures;
 * `metricS` (used in aligned columns such as set logging) uses tabular figures.
 */
export const type = {
  display: t(34, 41, "700", { letterSpacing: 0.2 }),
  title1: t(28, 34, "700"),
  title2: t(22, 28, "700"),
  title3: t(20, 25, "600"),
  headline: t(17, 22, "600"),
  body: t(17, 22, "400"),
  callout: t(16, 21, "400"),
  subhead: t(15, 20, "400"),
  footnote: t(13, 18, "400"),
  caption: t(12, 16, "500"),
  label: t(13, 16, "600", { letterSpacing: 0.4, textTransform: "uppercase" }),
  metricXL: { ...t(48, 54, "700"), fontFamily: rounded } as TextStyle,
  metricL: { ...t(32, 38, "700"), fontFamily: rounded } as TextStyle,
  metric: { ...t(22, 26, "700"), fontFamily: rounded } as TextStyle,
  metricS: { ...t(15, 20, "600"), fontFamily: rounded, fontVariant: ["tabular-nums"] } as TextStyle,
};
export type TypeVariant = keyof typeof type;

export const motion = { fast: 140, normal: 220, slow: 320 } as const;

export const MACRO_COLORS = (p: Palette) => ({ energyKcal: p.energy, proteinG: p.protein, carbsG: p.carbs, fatG: p.fat, fiberG: p.fiber });
