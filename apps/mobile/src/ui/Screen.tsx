import { router } from "expo-router";
import { t } from "../i18n";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/theme";
import { IconButton, Row, T } from "./primitives";
import { SyncBanner } from "./SyncBanner";

/**
 * Standard screen: safe areas, large title, optional back/close, pull to
 * refresh, keyboard avoidance. Content is capped in width so web and iPad stay
 * readable.
 */
export function Screen({
  title,
  subtitle,
  back,
  close,
  right,
  children,
  scroll = true,
  onRefresh,
  refreshing = false,
  footer,
  contentStyle,
  tabBar = false,
}: {
  title?: string;
  subtitle?: string;
  back?: boolean;
  close?: boolean;
  right?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  tabBar?: boolean;
}) {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const header = (
    <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, backgroundColor: th.c.bg }}>
      {back || close || right ? (
        <Row justify="space-between" style={{ minHeight: 40 }}>
          {back ? <IconButton icon="back" label={t("Back")} onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} /> : close ? <IconButton icon="close" label={t("Close")} onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} /> : <View />}
          <Row gap={4}>{right}</Row>
        </Row>
      ) : null}
      {title ? (
        <View style={{ paddingTop: back || close || right ? 2 : 8, paddingBottom: 10 }}>
          <T variant="display" accessibilityRole="header" numberOfLines={2}>
            {title}
          </T>
          {subtitle ? (
            <T variant="subhead" color="textSecondary" style={{ marginTop: 2 }}>
              {subtitle}
            </T>
          ) : null}
        </View>
      ) : null}
    </View>
  );
  const bottomPad = (tabBar ? 96 : 24) + insets.bottom + (footer ? 80 : 0);
  const inner = <View style={[{ paddingHorizontal: 16, gap: 14, width: "100%", maxWidth: 720, alignSelf: "center" }, contentStyle]}>{children}</View>;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: th.c.bg }}>
      {header}
      <SyncBanner />
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: bottomPad, paddingTop: 4 }}
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={th.c.textSecondary} /> : undefined}
        >
          {inner}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingBottom: footer ? 80 + insets.bottom : 0 }}>{inner}</View>
      )}
      {footer ? <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 12, backgroundColor: th.c.bg, borderTopWidth: 1, borderTopColor: th.c.hairline }}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}
