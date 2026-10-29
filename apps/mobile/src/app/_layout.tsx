import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, AppState, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { syncHealth } from "../features/health/sync";
import { onWatchAction } from "../features/native/watch";
import { applyWatchAction, syncNativeSurfaces } from "../features/workout/store";
import { applyDirection, useLanguage } from "../i18n";
import { AuthProvider, useAuth } from "../lib/auth";
import { useProfile } from "../lib/data";
import { flush, startOutboxLoop } from "../lib/outbox";
import { queryClient, restoreCache, startCachePersistence, wireOnlineManager } from "../lib/query";
import { ThemeProvider, useTheme } from "../theme/theme";
import { onlineManager } from "@tanstack/react-query";

SplashScreen.preventAutoHideAsync().catch(() => {});
restoreCache();
wireOnlineManager();
applyDirection();

function Gate() {
  const th = useTheme();
  const lang = useLanguage();
  const { status } = useAuth();
  const signedIn = status === "signedIn";
  const profile = useProfile(signedIn);
  const onboarded = !!profile.data?.onboardingCompletedAt;
  const resolving = status === "loading" || (signedIn && !profile.data && profile.isPending && !profile.isError);

  useEffect(() => {
    if (!resolving) SplashScreen.hideAsync().catch(() => {});
  }, [resolving]);

  useEffect(() => {
    if (!signedIn) return;
    const stopOutbox = startOutboxLoop();
    const stopPersist = startCachePersistence();
    const unsub = onlineManager.subscribe((online) => {
      if (online) void flush();
    });
    // Health samples are pulled when the app opens or returns to the foreground (no-op until connected).
    const pullHealth = () => void syncHealth().catch(() => {});
    pullHealth();
    const appState = AppState.addEventListener("change", (s) => s === "active" && pullHealth());
    // Apple Watch: apply "complete set" taps, and push the current workout (and rest Live Activity) once.
    const watch = onWatchAction(applyWatchAction);
    syncNativeSurfaces();
    return () => {
      stopOutbox();
      stopPersist();
      unsub();
      appState.remove();
      watch.remove();
    };
  }, [signedIn]);

  if (resolving) {
    return (
      <View style={{ flex: 1, backgroundColor: th.c.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={th.c.textSecondary} />
      </View>
    );
  }

  const sheet = { presentation: "formSheet" as const, sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true, contentStyle: { backgroundColor: th.c.bg } };
  const modal = { presentation: "modal" as const, contentStyle: { backgroundColor: th.c.bg } };
  return (
    // Keyed on language so every screen re-renders its text when it changes.
    <Stack key={lang} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: th.c.bg }, animation: "default" }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="welcome" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !onboarded}>
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && onboarded}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="food/search" options={modal} />
        <Stack.Screen name="food/[id]" options={sheet} />
        <Stack.Screen name="food/scan" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="food/camera" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="food/review" options={modal} />
        <Stack.Screen name="food/voice" options={sheet} />
        <Stack.Screen name="food/custom" options={modal} />
        <Stack.Screen name="food/quick-add" options={sheet} />
        <Stack.Screen name="workout/active" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
        <Stack.Screen name="workout/summary/[id]" options={modal} />
        <Stack.Screen name="workout/exercise-picker" options={modal} />
        <Stack.Screen name="workout/form-check" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="weigh-in" options={sheet} />
        <Stack.Screen name="settings" />
        <Stack.Screen name="import" options={modal} />
        <Stack.Screen name="food/menu" options={modal} />
        <Stack.Screen name="recipes/index" />
        <Stack.Screen name="recipes/[id]" />
        <Stack.Screen name="recipes/edit" options={modal} />
        <Stack.Screen name="plan/index" />
        <Stack.Screen name="plan/grocery/[id]" />
        <Stack.Screen name="plan/pantry" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider scheme="dark">
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <StatusBar style="light" />
              <Gate />
            </AuthProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
