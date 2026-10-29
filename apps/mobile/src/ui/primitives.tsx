import { SymbolView } from "expo-symbols";
import { useState, type ReactNode, type Ref } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text as RNText,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputInstance,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { haptic } from "../lib/haptics";
import { useTheme } from "../theme/theme";
import type { Palette, TypeVariant } from "../theme/tokens";

/* ───────── Text ───────── */

export interface TProps extends TextProps {
  variant?: TypeVariant;
  color?: keyof Palette | (string & {});
  align?: TextStyle["textAlign"];
  weight?: TextStyle["fontWeight"];
}

export function T({ variant = "body", color = "text", align, weight, style, maxFontSizeMultiplier, ...rest }: TProps) {
  const th = useTheme();
  const c = (th.c as Record<string, string>)[color] ?? color;
  const isMetric = variant.startsWith("metric") || variant === "display";
  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (isMetric ? 1.3 : 1.8)}
      style={[th.type[variant], { color: c }, align ? { textAlign: align } : null, weight ? { fontWeight: weight } : null, style]}
      {...rest}
    />
  );
}

/* ───────── Icons ───────── */

/** App icon vocabulary → SF Symbol (iOS) and Material Symbol (Android/web). */
export const ICONS = {
  today: ["sun.max.fill", "home"],
  nutrition: ["fork.knife", "restaurant"],
  train: ["dumbbell.fill", "fitness_center"],
  progress: ["chart.line.uptrend.xyaxis", "monitoring"],
  coach: ["sparkles", "auto_awesome"],
  add: ["plus", "add"],
  camera: ["camera.fill", "photo_camera"],
  barcode: ["barcode.viewfinder", "barcode_scanner"],
  mic: ["mic.fill", "mic"],
  search: ["magnifyingglass", "search"],
  close: ["xmark", "close"],
  check: ["checkmark", "check"],
  timer: ["timer", "timer"],
  play: ["play.fill", "play_arrow"],
  pause: ["pause.fill", "pause"],
  settings: ["gearshape.fill", "settings"],
  water: ["drop.fill", "water_drop"],
  sleep: ["bed.double.fill", "bedtime"],
  heart: ["heart.fill", "favorite"],
  up: ["arrow.up.right", "trending_up"],
  send: ["arrow.up", "arrow_upward"],
  down: ["arrow.down.right", "trending_down"],
  scale: ["scalemass.fill", "scale"],
  chevron: ["chevron.right", "chevron_right"],
  back: ["chevron.left", "arrow_back"],
  flame: ["flame.fill", "local_fire_department"],
  bolt: ["bolt.fill", "bolt"],
  edit: ["pencil", "edit"],
  trash: ["trash", "delete"],
  history: ["clock.arrow.circlepath", "history"],
  recipe: ["book.fill", "menu_book"],
  cart: ["cart.fill", "shopping_cart"],
  restaurant: ["fork.knife.circle", "restaurant_menu"],
  info: ["info.circle", "info"],
  lock: ["lock.fill", "lock"],
  offline: ["icloud.slash", "cloud_off"],
  keyboard: ["keyboard", "keyboard"],
  more: ["ellipsis", "more_horiz"],
  minus: ["minus", "remove"],
  sync: ["arrow.triangle.2.circlepath", "sync"],
  photos: ["photo.on.rectangle", "photo_library"],
  calendar: ["calendar", "calendar_today"],
  star: ["star.fill", "star"],
  trophy: ["trophy.fill", "emoji_events"],
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, color = "text", style }: { name: IconName; size?: number; color?: keyof Palette | (string & {}); style?: StyleProp<ViewStyle> }) {
  const th = useTheme();
  const tint = (th.c as Record<string, string>)[color] ?? color;
  const [ios, md] = ICONS[name];
  return <SymbolView name={{ ios: ios as never, android: md as never, web: md as never }} size={size} tintColor={tint} style={[{ width: size, height: size }, style]} fallback={<View style={{ width: size, height: size }} />} />;
}

/* ───────── Layout ───────── */

export function Card({ children, style, padded = true, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean; onPress?: () => void; accessibilityLabel?: string }) {
  const th = useTheme();
  const base: ViewStyle = { backgroundColor: th.c.surface, borderRadius: th.radius.lg, borderWidth: 1, borderColor: th.c.hairline, padding: padded ? th.space.lg : 0, overflow: "hidden" };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [base, pressed && { backgroundColor: th.c.surfacePressed }, style]}>
      {children}
    </Pressable>
  );
}

export function Row({ children, gap = 8, align = "center", justify, style, wrap }: { children: ReactNode; gap?: number; align?: ViewStyle["alignItems"]; justify?: ViewStyle["justifyContent"]; style?: StyleProp<ViewStyle>; wrap?: boolean }) {
  return <View style={[{ flexDirection: "row", alignItems: align, gap, justifyContent: justify, flexWrap: wrap ? "wrap" : "nowrap" }, style]}>{children}</View>;
}

export function Stack({ children, gap = 12, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

export function Divider() {
  const th = useTheme();
  return <View style={{ height: 1, backgroundColor: th.c.hairline }} />;
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <Row justify="space-between" style={{ marginTop: 8, marginBottom: 2 }}>
      <T variant="label" color="textTertiary" accessibilityRole="header">
        {title}
      </T>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button">
          <T variant="footnote" color="accent" weight="600">
            {action}
          </T>
        </Pressable>
      ) : null}
    </Row>
  );
}

/* ───────── Buttons ───────── */

type ButtonKind = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends Omit<PressableProps, "style" | "children"> {
  title: string;
  kind?: ButtonKind;
  icon?: IconName;
  loading?: boolean;
  size?: "lg" | "md" | "sm";
  style?: StyleProp<ViewStyle>;
  hapticOnPress?: boolean;
}

export function Button({ title, kind = "primary", icon, loading, size = "lg", style, disabled, onPress, hapticOnPress, ...rest }: ButtonProps) {
  const th = useTheme();
  const bg = { primary: th.c.accent, secondary: th.c.surfaceRaised, ghost: "transparent", danger: th.c.dangerMuted }[kind];
  const fg = { primary: th.c.textInverse, secondary: th.c.text, ghost: th.c.accent, danger: th.c.danger }[kind];
  const h = { lg: 52, md: 44, sm: 34 }[size];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      disabled={disabled || loading}
      onPress={(e) => {
        if (hapticOnPress) haptic("light");
        onPress?.(e);
      }}
      style={({ pressed }) => [
        { height: h, minWidth: h, borderRadius: size === "sm" ? th.radius.md : th.radius.lg, backgroundColor: bg, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingHorizontal: size === "sm" ? 12 : 18, opacity: disabled ? 0.45 : pressed ? 0.85 : 1, borderWidth: kind === "secondary" ? 1 : 0, borderColor: th.c.border },
        style,
      ]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={size === "sm" ? 15 : 18} color={fg} /> : null}
      {!loading || size !== "sm" ? (
        <T variant={size === "sm" ? "footnote" : "headline"} weight="600" style={{ color: fg }} numberOfLines={1}>
          {title}
        </T>
      ) : null}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, color = "text", bg, size = 40 }: { icon: IconName; onPress: () => void; label: string; color?: keyof Palette; bg?: keyof Palette; size?: number }) {
  const th = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: bg ? th.c[bg] : pressed ? th.c.surfacePressed : "transparent" })}
    >
      <Icon name={icon} size={size * 0.48} color={color} />
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  const th = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={() => {
        haptic("selection");
        onPress?.();
      }}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, height: 36, borderRadius: th.radius.pill, borderWidth: 1, borderColor: selected ? th.c.accent : th.c.border, backgroundColor: selected ? th.c.accentMuted : pressed ? th.c.surfacePressed : th.c.surface })}
    >
      {icon ? <Icon name={icon} size={14} color={selected ? "accent" : "textSecondary"} /> : null}
      <T variant="subhead" color={selected ? "accent" : "text"} weight={selected ? "600" : "500"}>
        {label}
      </T>
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const th = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", backgroundColor: th.c.surfaceSunken, borderRadius: th.radius.md, padding: 3, borderWidth: 1, borderColor: th.c.hairline }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              haptic("selection");
              onChange(o.value);
            }}
            style={{ flex: 1, height: 34, borderRadius: th.radius.sm + 1, alignItems: "center", justifyContent: "center", backgroundColor: active ? th.c.surfaceRaised : "transparent" }}
          >
            <T variant="footnote" weight={active ? "700" : "500"} color={active ? "text" : "textSecondary"}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ───────── Inputs ───────── */

// The browser's own focus outline would draw inside the container's focus ring (web only; not in RN's style types).
const WEB_NO_OUTLINE = (Platform.OS === "web" ? { outlineStyle: "none" } : null) as TextStyle | null;

export function Field({ label, suffix, error, style, ref, onFocus, onBlur, ...rest }: TextInputProps & { label?: string; suffix?: string; error?: string | null; ref?: Ref<TextInputInstance> }) {
  const th = useTheme();
  // The container draws the focus ring (the browser outline on web is suppressed).
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <T variant="footnote" color="textSecondary">
          {label}
        </T>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: th.c.surfaceSunken, borderRadius: th.radius.md, borderWidth: 1, borderColor: error ? th.c.danger : focused ? th.c.accent : th.c.border, paddingHorizontal: 14, minHeight: 50 }}>
        <TextInput
          ref={ref}
          placeholderTextColor={th.c.textTertiary}
          selectionColor={th.c.accent}
          accessibilityLabel={label}
          style={[th.type.body, { flex: 1, minWidth: 0, color: th.c.text, paddingVertical: 12, outlineWidth: 0 }, WEB_NO_OUTLINE, style]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {suffix ? (
          <T variant="subhead" color="textTertiary">
            {suffix}
          </T>
        ) : null}
      </View>
      {error ? (
        <T variant="footnote" color="danger">
          {error}
        </T>
      ) : null}
    </View>
  );
}

export function Stepper({ value, onChange, step = 1, min = 0, max = 9999, format = (v: number) => String(v), label }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; format?: (v: number) => string; label: string }) {
  const th = useTheme();
  const set = (v: number) => {
    const clamped = Math.min(max, Math.max(min, Math.round(v * 1000) / 1000));
    if (clamped !== value) haptic("selection");
    onChange(clamped);
  };
  return (
    <View accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: format(value) }} accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={(e) => set(value + (e.nativeEvent.actionName === "increment" ? step : -step))} style={{ flexDirection: "row", alignItems: "center", backgroundColor: th.c.surfaceSunken, borderRadius: th.radius.md, borderWidth: 1, borderColor: th.c.border }}>
      <IconButton icon="minus" label={`Decrease ${label}`} onPress={() => set(value - step)} />
      <T variant="metricS" style={{ flex: 1, textAlign: "center" }}>
        {format(value)}
      </T>
      <IconButton icon="add" label={`Increase ${label}`} onPress={() => set(value + step)} />
    </View>
  );
}

/* ───────── States ───────── */

export function EmptyState({ icon = "info", title, body, action, onAction }: { icon?: IconName; title: string; body?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 28, paddingHorizontal: 16, gap: 8 }}>
      <Icon name={icon} size={30} color="textTertiary" />
      <T variant="headline" align="center">
        {title}
      </T>
      {body ? (
        <T variant="subhead" color="textSecondary" align="center">
          {body}
        </T>
      ) : null}
      {action && onAction ? <Button title={action} kind="secondary" size="md" onPress={onAction} style={{ marginTop: 8 }} /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : "Something went wrong.";
  return <EmptyState icon="info" title="Couldn't load this" body={msg} action={onRetry ? "Try again" : undefined} onAction={onRetry} />;
}

export function Skeleton({ height = 16, width = "100%", radius: r = 8, style }: { height?: number; width?: ViewStyle["width"]; radius?: number; style?: StyleProp<ViewStyle> }) {
  const th = useTheme();
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ height, width, borderRadius: r, backgroundColor: th.c.surfaceRaised, opacity: 0.7 }, style]} />;
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "accent" | "warning" | "danger" | "info" }) {
  const th = useTheme();
  const fg = { neutral: th.c.textSecondary, accent: th.c.accent, warning: th.c.warning, danger: th.c.danger, info: th.c.info }[tone];
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: th.radius.pill, backgroundColor: th.c.surfaceRaised, borderWidth: 1, borderColor: th.c.hairline, alignSelf: "flex-start" }}>
      <T variant="caption" style={{ color: fg }}>
        {label}
      </T>
    </View>
  );
}

export function ListRow({ title, subtitle, right, onPress, icon, iconColor = "textSecondary", accessibilityHint }: { title: string; subtitle?: string | null; right?: ReactNode; onPress?: () => void; icon?: IconName; iconColor?: keyof Palette; accessibilityHint?: string }) {
  const th = useTheme();
  const content = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, minHeight: 52 }}>
      {icon ? (
        <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: th.c.surfaceRaised, alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} size={17} color={iconColor} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="callout" weight="500" numberOfLines={2}>
          {title}
        </T>
        {subtitle ? (
          <T variant="footnote" color="textSecondary" numberOfLines={2}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {right}
      {onPress && !right ? <Icon name="chevron" size={14} color="textTertiary" /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" accessibilityHint={accessibilityHint} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {content}
    </Pressable>
  );
}
