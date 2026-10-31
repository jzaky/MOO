import { Platform, type TextStyle } from "react-native";

/**
 * Design tokens. Dark is the default appearance; the light palette is
 * defined so components never hard-code colors and light mode can ship
 * without touching screens.
 */

const dark = {
  // "Ember on instrument black": fire marks what you can act on, cyan marks measured data.
  bg: "#08090A",
  surface: "#111315",
  surfaceRaised: "#171A1D",
  surfaceSunken: "#0C0D0E",
  surfacePressed: "#1E2226",
  border: "#262A2F",
  hairline: "rgba(255,255,255,0.07)",
  text: "#F2EFE9",
  textSecondary: "#A0A6AD",
  textTertiary: "#6E747B",
  textInverse: "#1C0C05",
  accent: "#FF6A2B",
  accentMuted: "rgba(255,106,43,0.15)",
  // Gradient stops for the primary button, ring and "+" (gold → fire → rose).
  accentGold: "#FFB347",
  accentRose: "#EF3B55",
  // Measured data (sleep, weigh-ins, logged items, rest timer): text-safe cyan.
  data: "#4EE3FF",
  dataMuted: "rgba(78,227,255,0.12)",
  // Data colors (marks only, never text). Validated for the dark surface with
  // the dataviz palette checker: lightness band, chroma, adjacent CVD separation, contrast.
  energy: "#E0531A",
  protein: "#1FA3BD",
  carbs: "#BC8A1F",
  fat: "#D03E70",
  fiber: "#6E9E2A",
  water: "#4F7FE0",
  gridline: "#1C2024",
  warning: "#FFB347",
  danger: "#FF6B6B",
  dangerMuted: "rgba(255,107,107,0.14)",
  success: "#9DFF6A",
  info: "#4EE3FF",
  track: "#1C2024",
  overlay: "rgba(5,6,7,0.72)",
};

const light: typeof dark = {
  bg: "#F6F5F2",
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
  accent: "#D9480F",
  accentMuted: "rgba(217,72,15,0.12)",
  accentGold: "#E69A1E",
  accentRose: "#D6293F",
  data: "#0A7F99",
  dataMuted: "rgba(10,127,153,0.1)",
  energy: "#D9480F",
  protein: "#0F8BA6",
  carbs: "#A8780F",
  fat: "#C2305F",
  fiber: "#5F8A1E",
  water: "#3F6FD0",
  gridline: "#EDEDEA",
  warning: "#C98A12",
  danger: "#D9534A",
  dangerMuted: "rgba(217,83,74,0.12)",
  success: "#2E9A3E",
  info: "#0A7F99",
  track: "#E7E7E3",
  overlay: "rgba(0,0,0,0.35)",
};

export const palettes = { dark, light };
export type Palette = typeof dark;

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

const family = Platform.select({ ios: "System", android: "sans-serif", default: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" });
/**
 * Big numbers and screen titles use a condensed display face; data labels use a
 * monospace. Both are loaded in the root layout (OFL fonts); until they load,
 * or for scripts they don't cover (Arabic), the platform falls back to the system face.
 */
export const FONT_FILES = {
  display: "BigShoulders-ExtraBold",
  displayBlack: "BigShoulders-Black",
  mono: "JetBrainsMono-Medium",
  monoBold: "JetBrainsMono-Bold",
} as const;
// On the web an unavailable family falls back to the browser default (often a serif), so name the fallbacks.
const withFallback = (name: string, fallback: string) => (Platform.OS === "web" ? `${name}, ${fallback}` : name);
export const fonts = {
  display: withFallback(FONT_FILES.display, "Arial Narrow, system-ui, sans-serif"),
  displayBlack: withFallback(FONT_FILES.displayBlack, "Arial Narrow, system-ui, sans-serif"),
  mono: withFallback(FONT_FILES.mono, "ui-monospace, Menlo, monospace"),
  monoBold: withFallback(FONT_FILES.monoBold, "ui-monospace, Menlo, monospace"),
};

const t = (size: number, lineHeight: number, weight: TextStyle["fontWeight"], extra: TextStyle = {}): TextStyle => ({ fontSize: size, lineHeight, fontWeight: weight, fontFamily: family, ...extra });
// Custom font files carry their own weight: a fontWeight on top would make iOS synthesize a bolder face.
const d = (size: number, lineHeight: number, face: string = fonts.display, extra: TextStyle = {}): TextStyle => ({ fontSize: size, lineHeight, fontFamily: face, ...extra });

/**
 * Type scale (iOS-aligned). Metrics use the display face; `metricS` (aligned
 * columns such as set logging) and `mono` use tabular monospace figures.
 */
export const type = {
  display: d(40, 42, fonts.displayBlack, { textTransform: "uppercase", letterSpacing: 0.3 }),
  title1: t(28, 34, "700"),
  title2: t(22, 28, "700"),
  title3: t(20, 25, "600"),
  headline: t(17, 22, "600"),
  body: t(17, 22, "400"),
  callout: t(16, 21, "400"),
  subhead: t(15, 20, "400"),
  footnote: t(13, 18, "400"),
  caption: t(12, 16, "500"),
  label: d(11, 15, fonts.mono, { letterSpacing: 1.3, textTransform: "uppercase" }),
  mono: d(12, 16, fonts.mono),
  monoBold: d(12, 16, fonts.monoBold),
  metricHero: d(60, 58, fonts.displayBlack),
  metricXL: d(52, 54),
  metricL: d(36, 38),
  metric: d(26, 28),
  metricS: d(15, 20, fonts.monoBold, { fontVariant: ["tabular-nums"] }),
};
export type TypeVariant = keyof typeof type;

export const motion = { fast: 140, normal: 220, slow: 320 } as const;

export const MACRO_COLORS = (p: Palette) => ({ energyKcal: p.energy, proteinG: p.protein, carbsG: p.carbs, fatG: p.fat, fiberG: p.fiber });
