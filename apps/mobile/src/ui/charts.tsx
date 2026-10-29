import { useMemo, useState } from "react";
import { t, tn } from "../i18n";
import { View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, G, Line, Path, Rect } from "react-native-svg";
import { useTheme } from "../theme/theme";
import { T } from "./primitives";

/**
 * Charts follow docs/design-system.md: 2px lines, ≥8px end markers with a 2px
 * surface ring, ≤24px bars with 4px rounded data ends, hairline recessive
 * grid, labels in text tokens (never the series color), one y-axis, and a
 * press-and-drag scrub as the touch equivalent of a hover tooltip.
 */

/* ───────── Progress ring (single value vs target) ───────── */

export function ProgressRing({ value, target, color, size = 132, stroke = 10, label, center }: { value: number; target: number; color: string; size?: number; stroke?: number; label: string; center?: React.ReactNode }) {
  const th = useTheme();
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const frac = target > 0 ? value / target : 0;
  const shown = Math.min(frac, 1);
  const over = frac > 1;
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: Math.round(target), now: Math.round(value) }} style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={th.c.track} strokeWidth={stroke} fill="none" />
          {shown > 0 ? <Circle cx={size / 2} cy={size / 2} r={r} stroke={over ? th.c.warning : color} strokeWidth={stroke} fill="none" strokeDasharray={`${circ * shown} ${circ}`} strokeLinecap="round" /> : null}
        </G>
      </Svg>
      <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>{center}</View>
    </View>
  );
}

/* ───────── Macro progress bar ───────── */

export function MacroBar({ label, consumed, target, unit, color, missing = 0 }: { label: string; consumed: number; target: number; unit: string; color: string; missing?: number }) {
  const th = useTheme();
  const frac = target > 0 ? consumed / target : 0;
  const pct = Math.min(1, frac);
  const remaining = Math.round(target - consumed);
  return (
    <View accessible accessibilityLabel={`${t("{label}: {consumed} of {target} {unit}", { label, consumed: Math.round(consumed), target: Math.round(target), unit })}${missing ? `, ${tn(missing, "{n} entry missing data", "{n} entries missing data")}` : ""}`} style={{ gap: 6, flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        <T variant="footnote" color="textSecondary">
          {label}
        </T>
      </View>
      <T variant="metricS">
        {Math.round(consumed)}
        <T variant="footnote" color="textTertiary">
          {" "}
          / {Math.round(target)} {unit}
        </T>
      </T>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: th.c.track, overflow: "hidden" }}>
        <View style={{ width: `${pct * 100}%`, height: 6, borderRadius: 3, backgroundColor: frac > 1.05 ? th.c.warning : color }} />
      </View>
      <T variant="caption" color="textTertiary">
        {remaining >= 0 ? `${remaining} ${unit} left` : `${-remaining} ${unit} over`}
        {missing ? " · partial data" : ""}
      </T>
    </View>
  );
}

/* ───────── Line chart with scrub ───────── */

export interface LinePoint {
  x: number; // e.g. day index or epoch day
  y: number;
}

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  points: LinePoint[];
  /** Render as dots only (e.g. raw scale readings behind a trend line). */
  dotsOnly?: boolean;
  emphasis?: "primary" | "muted";
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

export function LineChart({ series, height = 180, formatY = (v: number) => String(v), formatX = (x: number) => String(x), title }: { series: LineSeries[]; height?: number; formatY?: (v: number) => string; formatX?: (x: number) => string; title: string }) {
  const th = useTheme();
  const [width, setWidth] = useState(0);
  const [scrubX, setScrubX] = useState<number | null>(null);
  const all = series.flatMap((s) => s.points);
  const pad = { l: 8, r: 44, t: 10, b: 22 };
  const geom = useMemo(() => {
    if (!all.length || width === 0) return null;
    const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yPad = Math.max(0.5, (Math.max(...ys) - Math.min(...ys)) * 0.15);
    const ticks = niceTicks(Math.min(...ys) - yPad, Math.max(...ys) + yPad);
    const yMin = Math.min(ticks[0]!, Math.min(...ys)), yMax = Math.max(ticks.at(-1)!, Math.max(...ys));
    const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
    const sx = (x: number) => pad.l + (xMax === xMin ? w / 2 : ((x - xMin) / (xMax - xMin)) * w);
    const sy = (y: number) => pad.t + h - ((y - yMin) / (yMax - yMin || 1)) * h;
    return { sx, sy, ticks, xMin, xMax, w };
  }, [width, height, JSON.stringify(series.map((s) => s.points.length)), all.length]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const handleTouch = (e: GestureResponderEvent) => {
    if (!geom) return;
    const x = e.nativeEvent.locationX;
    const frac = Math.min(1, Math.max(0, (x - pad.l) / geom.w));
    setScrubX(geom.xMin + frac * (geom.xMax - geom.xMin));
  };
  const nearest = (s: LineSeries, x: number) => s.points.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best), s.points[0]!);
  const primary = series.find((s) => s.emphasis !== "muted" && !s.dotsOnly) ?? series[0];
  const scrubbed = scrubX !== null && primary?.points.length ? nearest(primary, scrubX) : null;

  if (!all.length) return null;
  return (
    <View accessible accessibilityLabel={`${title}. ${series.map((s) => t("{label}: latest {value}", { label: s.label, value: formatY(s.points.at(-1)?.y ?? 0) })).join(". ")}`} onLayout={onLayout} style={{ height }} onStartShouldSetResponder={() => true} onResponderGrant={handleTouch} onResponderMove={handleTouch} onResponderRelease={() => setScrubX(null)} onResponderTerminate={() => setScrubX(null)}>
      {geom ? (
        <Svg width={width} height={height}>
          {geom.ticks.map((tk) => (
            <G key={tk}>
              <Line x1={pad.l} x2={width - pad.r} y1={geom.sy(tk)} y2={geom.sy(tk)} stroke={th.c.gridline} strokeWidth={1} />
            </G>
          ))}
          {series.map((s) =>
            s.dotsOnly ? (
              <G key={s.key}>
                {s.points.map((p, i) => (
                  <Circle key={i} cx={geom.sx(p.x)} cy={geom.sy(p.y)} r={2.5} fill={s.color} opacity={0.45} />
                ))}
              </G>
            ) : (
              <Path key={s.key} d={s.points.map((p, i) => `${i ? "L" : "M"}${geom.sx(p.x).toFixed(1)},${geom.sy(p.y).toFixed(1)}`).join(" ")} stroke={s.color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" opacity={s.emphasis === "muted" ? 0.5 : 1} />
            ),
          )}
          {primary && primary.points.length ? (
            <Circle cx={geom.sx(primary.points.at(-1)!.x)} cy={geom.sy(primary.points.at(-1)!.y)} r={5} fill={primary.color} stroke={th.c.surface} strokeWidth={2} />
          ) : null}
          {scrubbed ? (
            <G>
              <Line x1={geom.sx(scrubbed.x)} x2={geom.sx(scrubbed.x)} y1={pad.t} y2={height - pad.b} stroke={th.c.textTertiary} strokeWidth={1} />
              <Circle cx={geom.sx(scrubbed.x)} cy={geom.sy(scrubbed.y)} r={5} fill={primary!.color} stroke={th.c.surface} strokeWidth={2} />
            </G>
          ) : null}
        </Svg>
      ) : null}
      {geom
        ? geom.ticks.map((tk) => (
            <T key={tk} variant="caption" color="textTertiary" style={{ position: "absolute", right: 0, top: geom.sy(tk) - 8, width: pad.r - 6, textAlign: "right" }}>
              {formatY(tk)}
            </T>
          ))
        : null}
      {geom ? (
        <View style={{ position: "absolute", left: pad.l, right: pad.r, bottom: 0, flexDirection: "row", justifyContent: "space-between" }}>
          <T variant="caption" color="textTertiary">
            {formatX(geom.xMin)}
          </T>
          <T variant="caption" color="textTertiary">
            {formatX(geom.xMax)}
          </T>
        </View>
      ) : null}
      {scrubbed && geom ? (
        <View pointerEvents="none" style={{ position: "absolute", top: 0, left: Math.min(Math.max(0, geom.sx(scrubbed.x) - 60), width - 130), width: 120, padding: 8, borderRadius: 10, backgroundColor: th.c.surfaceRaised, borderWidth: 1, borderColor: th.c.border }}>
          <T variant="caption" color="textSecondary">
            {formatX(scrubbed.x)}
          </T>
          {series.map((s) => {
            const p = nearest(s, scrubbed.x);
            return (
              <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
                <T variant="footnote">{formatY(p.y)}</T>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dotted?: boolean }[] }) {
  return (
    <View style={{ flexDirection: "row", gap: 14, flexWrap: "wrap" }}>
      {items.map((i) => (
        <View key={i.label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {i.dotted ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i.color, opacity: 0.6 }} /> : <View style={{ width: 14, height: 2, borderRadius: 1, backgroundColor: i.color }} />}
          <T variant="caption" color="textSecondary">
            {i.label}
          </T>
        </View>
      ))}
    </View>
  );
}

/* ───────── Horizontal bar list (weekly sets per muscle) ───────── */

export function BarList({ items, color, max, unit = "" }: { items: { label: string; value: number }[]; color: string; max?: number; unit?: string }) {
  const th = useTheme();
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <View style={{ gap: 10 }}>
      {items.map((i) => (
        <View key={i.label} accessible accessibilityLabel={`${i.label}: ${i.value}${unit}`} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <T variant="footnote" color="textSecondary" style={{ width: 92 }} numberOfLines={1}>
            {i.label}
          </T>
          <View style={{ flex: 1, height: 14, justifyContent: "center" }}>
            <Svg width="100%" height={14}>
              <Rect x={0} y={0} width={`${Math.max(2, (i.value / m) * 100)}%`} height={14} rx={4} fill={color} />
            </Svg>
          </View>
          <T variant="metricS" style={{ width: 36, textAlign: "right" }}>
            {Math.round(i.value * 10) / 10}
          </T>
        </View>
      ))}
    </View>
  );
}

/* ───────── Stat tile ───────── */

export function StatTile({ label, value, unit, delta, deltaGood, hint }: { label: string; value: string; unit?: string; delta?: string | null; deltaGood?: boolean | null; hint?: string }) {
  const th = useTheme();
  return (
    <View accessible accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ""}${delta ? `, ${delta}` : ""}`} style={{ flex: 1, backgroundColor: th.c.surface, borderRadius: th.radius.lg, borderWidth: 1, borderColor: th.c.hairline, padding: 14, gap: 4 }}>
      <T variant="footnote" color="textSecondary">
        {label}
      </T>
      <T variant="metric">
        {value}
        {unit ? (
          <T variant="footnote" color="textTertiary">
            {" "}
            {unit}
          </T>
        ) : null}
      </T>
      {delta ? (
        <T variant="caption" color={deltaGood == null ? "textTertiary" : deltaGood ? "success" : "warning"}>
          {delta}
        </T>
      ) : hint ? (
        <T variant="caption" color="textTertiary">
          {hint}
        </T>
      ) : null}
    </View>
  );
}
