import { CALORIE_FLOOR } from "@stoke/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, Share, Switch, View } from "react-native";
import { healthAdapter } from "../features/health/adapter";
import { connectHealth, disconnectHealth, getHealthState, syncHealth, type HealthSyncState } from "../features/health/sync";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { qk, useProfile } from "../lib/data";
import { haptic } from "../lib/haptics";
import { queryClient } from "../lib/query";
import type { Profile, Targets } from "../lib/types";
import { useTheme } from "../theme/theme";
import { Badge, Button, Card, Divider, ErrorState, Field, ListRow, Row, SectionHeader, Segmented, Skeleton, Stack, T } from "../ui/primitives";
import { Screen } from "../ui/Screen";

interface NotificationPrefs {
  workoutReminders: boolean;
  mealReminders: boolean;
  hydrationReminders: boolean;
  weeklySummary: boolean;
  personalRecords: boolean;
  checkIns: boolean;
  quietStart: string;
  quietEnd: string;
}

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");

function Toggle({ label, detail, value, onChange, disabled }: { label: string; detail?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const th = useTheme();
  return (
    <Row justify="space-between" style={{ paddingVertical: 8, minHeight: 44 }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <T variant="body">{label}</T>
        {detail ? <T variant="footnote" color="textSecondary">{detail}</T> : null}
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: th.c.accent, false: th.c.track }} thumbColor={th.c.text} />
    </Row>
  );
}

function ProfileSection({ profile }: { profile: Profile }) {
  const [name, setName] = useState(profile.displayName ?? "");
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const save = useMutation({
    mutationFn: (patch: Partial<Profile>) => api<Profile>("/v1/profile", { method: "PUT", body: patch }),
    onSuccess: (p) => queryClient.setQueryData(qk.profile, (old: Profile | undefined) => ({ ...old, ...p })),
  });
  return (
    <Card>
      <Stack gap={12}>
        <Field label="Name" value={name} onChangeText={setName} onEndEditing={() => name.trim() !== (profile.displayName ?? "") && save.mutate({ displayName: name.trim() || null })} autoCapitalize="words" />
        <View style={{ gap: 6 }}>
          <T variant="footnote" color="textSecondary">Units</T>
          <Segmented options={[{ value: "metric", label: "kg · cm" }, { value: "imperial", label: "lb · in" }]} value={profile.unitSystem} onChange={(unitSystem) => save.mutate({ unitSystem })} />
        </View>
        <Row justify="space-between">
          <View style={{ flex: 1 }}>
            <T variant="footnote" color="textSecondary">Time zone</T>
            <T variant="body">{profile.timeZone}</T>
          </View>
          {deviceZone && deviceZone !== profile.timeZone ? <Button title={`Use ${deviceZone}`} kind="secondary" size="sm" onPress={() => save.mutate({ timeZone: deviceZone })} /> : null}
        </Row>
        <T variant="caption" color="textTertiary">Your day boundaries (diary, streaks, weekly reviews) follow this time zone.</T>
        {save.error ? <T variant="footnote" color="danger">{errMsg(save.error)}</T> : null}
      </Stack>
    </Card>
  );
}

function TargetsSection({ profile }: { profile: Profile }) {
  const targets = useQuery({ queryKey: qk.targets, queryFn: () => api<{ current: Targets | null }>("/v1/nutrition/targets") });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ energyKcal: "", proteinG: "", carbsG: "", fatG: "", fiberG: "" });
  const cur = targets.data?.current;
  useEffect(() => {
    if (cur) setForm({ energyKcal: String(cur.energyKcal), proteinG: String(cur.proteinG), carbsG: String(cur.carbsG), fatG: String(cur.fatG), fiberG: cur.fiberG == null ? "" : String(cur.fiberG) });
  }, [cur]);
  const n = (s: string) => Number(s.replace(",", "."));
  const energy = n(form.energyKcal);
  const macroKcal = n(form.proteinG) * 4 + n(form.carbsG) * 4 + n(form.fatG) * 9;
  const floor = profile.sex ? CALORIE_FLOOR[profile.sex] : CALORIE_FLOOR.female;
  const valid = Number.isInteger(energy) && energy >= 800 && energy <= 10000 && [form.proteinG, form.carbsG, form.fatG].every((v) => v !== "" && n(v) >= 0);
  const save = useMutation({
    mutationFn: () => api<Targets>("/v1/nutrition/targets", { body: { energyKcal: energy, proteinG: n(form.proteinG), carbsG: n(form.carbsG), fatG: n(form.fatG), fiberG: form.fiberG ? n(form.fiberG) : null, note: "Edited in settings" } }),
    onSuccess: () => {
      haptic("success");
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: qk.targets });
      void queryClient.invalidateQueries({ queryKey: qk.today });
      void queryClient.invalidateQueries({ queryKey: ["diary"] });
    },
  });
  if (targets.isPending) return <Skeleton height={90} />;
  if (targets.isError) return <ErrorState error={targets.error} onRetry={() => void targets.refetch()} />;
  return (
    <Card>
      {!editing ? (
        <Stack gap={10}>
          {cur ? (
            <>
              <Row justify="space-between">
                <T variant="headline">{cur.energyKcal.toLocaleString()} kcal</T>
                <Badge label={cur.basis === "manual" ? "set by you" : cur.basis === "adapted" ? "adapted from your data" : "estimated"} />
              </Row>
              <T variant="subhead" color="textSecondary">Protein {cur.proteinG} g · Carbs {cur.carbsG} g · Fat {cur.fatG} g{cur.fiberG != null ? ` · Fibre ${cur.fiberG} g` : ""}</T>
            </>
          ) : (
            <T variant="subhead" color="textSecondary">No targets yet.</T>
          )}
          <Button title="Edit targets" kind="secondary" size="md" icon="edit" onPress={() => setEditing(true)} />
        </Stack>
      ) : (
        <Stack gap={10}>
          <Field label="Energy" suffix="kcal" keyboardType="number-pad" value={form.energyKcal} onChangeText={(v) => setForm((f) => ({ ...f, energyKcal: v }))} />
          <Row gap={8}>
            <View style={{ flex: 1 }}><Field label="Protein" suffix="g" keyboardType="decimal-pad" value={form.proteinG} onChangeText={(v) => setForm((f) => ({ ...f, proteinG: v }))} /></View>
            <View style={{ flex: 1 }}><Field label="Carbs" suffix="g" keyboardType="decimal-pad" value={form.carbsG} onChangeText={(v) => setForm((f) => ({ ...f, carbsG: v }))} /></View>
          </Row>
          <Row gap={8}>
            <View style={{ flex: 1 }}><Field label="Fat" suffix="g" keyboardType="decimal-pad" value={form.fatG} onChangeText={(v) => setForm((f) => ({ ...f, fatG: v }))} /></View>
            <View style={{ flex: 1 }}><Field label="Fibre" suffix="g" keyboardType="decimal-pad" value={form.fiberG} onChangeText={(v) => setForm((f) => ({ ...f, fiberG: v }))} placeholder="optional" /></View>
          </Row>
          {valid && Math.abs(macroKcal - energy) > Math.max(100, energy * 0.08) ? (
            <T variant="footnote" color="warning">Your macros add up to about {Math.round(macroKcal)} kcal, which differs from the energy target by {Math.round(Math.abs(macroKcal - energy))} kcal.</T>
          ) : null}
          {valid && energy < floor ? <T variant="footnote" color="warning">This is below {floor} kcal. Intakes this low are best done with a clinician's guidance.</T> : null}
          <T variant="caption" color="textTertiary">Saving creates a new version from today. Past days keep the targets they had.</T>
          {save.error ? <T variant="footnote" color="danger">{errMsg(save.error)}</T> : null}
          <Row gap={8}>
            <Button title="Cancel" kind="secondary" size="md" onPress={() => setEditing(false)} style={{ flex: 1 }} />
            <Button title="Save targets" size="md" disabled={!valid} loading={save.isPending} onPress={() => save.mutate()} style={{ flex: 1.4 }} />
          </Row>
        </Stack>
      )}
    </Card>
  );
}

function HealthSection() {
  const [state, setState] = useState<HealthSyncState>(getHealthState);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"connect" | "sync" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    healthAdapter.isAvailable().then(setAvailable, () => setAvailable(false));
  }, []);
  const run = async (kind: "connect" | "sync") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "connect" && !(await connectHealth())) {
        setError(`${healthAdapter.name} access was not granted. You can change this in system settings.`);
        return;
      }
      setState(await syncHealth());
      haptic("success");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  if (available === null) return <Skeleton height={70} />;
  if (!available || !healthAdapter.provider) {
    return (
      <Card>
        <T variant="subhead" color="textSecondary">{Platform.OS === "web" ? "Apple Health and Health Connect are available in the iOS and Android apps." : `${healthAdapter.provider === "health_connect" ? "Health Connect is not installed or needs an update." : "Health data is not available on this device."}`}</T>
      </Card>
    );
  }
  return (
    <Card>
      <Stack gap={10}>
        <Row justify="space-between">
          <T variant="headline">{healthAdapter.name}</T>
          <Badge label={state.connected ? "connected" : "not connected"} tone={state.connected ? "accent" : "neutral"} />
        </Row>
        <T variant="footnote" color="textSecondary">Reads {healthAdapter.reads.join(", ").toLowerCase()}. Nothing is written back. Body-weight samples appear as weigh-ins.</T>
        {state.lastSyncAt ? <T variant="caption" color="textTertiary">Last synced {new Date(state.lastSyncAt).toLocaleString()}{state.lastResult ? ` · ${state.lastResult.inserted} new of ${state.lastResult.received}` : ""}</T> : null}
        {error ? <T variant="footnote" color="danger">{error}</T> : null}
        {state.connected ? (
          <Row gap={8}>
            <Button title="Sync now" kind="secondary" size="md" icon="sync" loading={busy === "sync"} onPress={() => void run("sync")} style={{ flex: 1 }} />
            <Button title="Disconnect" kind="ghost" size="md" onPress={() => { disconnectHealth(); setState(getHealthState()); }} style={{ flex: 1 }} />
          </Row>
        ) : (
          <Button title={`Connect ${healthAdapter.name}`} size="md" icon="heart" loading={busy === "connect"} onPress={() => void run("connect")} />
        )}
        {healthAdapter.openSystemSettings ? <Button title="Manage permissions" kind="ghost" size="sm" onPress={healthAdapter.openSystemSettings} /> : null}
      </Stack>
    </Card>
  );
}

async function registerPush(): Promise<"granted" | "denied" | "unsupported"> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return "unsupported";
  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return "denied";
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  // Push tokens need an EAS project id; without one, reminders cannot be delivered remotely.
  if (!projectId) return "unsupported";
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  await api("/v1/push-tokens", { body: { token: token.data, platform: Platform.OS } });
  return "granted";
}

function NotificationsSection() {
  const prefs = useQuery({ queryKey: ["notification-preferences"], queryFn: () => api<NotificationPrefs>("/v1/notification-preferences") });
  const [push, setPush] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (p: NotificationPrefs) => api<NotificationPrefs>("/v1/notification-preferences", { method: "PUT", body: p }),
    onMutate: (p) => queryClient.setQueryData(["notification-preferences"], p),
    onError: () => void prefs.refetch(),
  });
  if (prefs.isPending) return <Skeleton height={200} />;
  if (prefs.isError) return <ErrorState error={prefs.error} onRetry={() => void prefs.refetch()} />;
  const p = prefs.data;
  const set = (k: keyof NotificationPrefs) => (v: boolean) => save.mutate({ ...p, [k]: v });
  const validTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  return (
    <Card>
      <Stack gap={2}>
        <Toggle label="Workout reminders" detail="On your planned training days" value={p.workoutReminders} onChange={set("workoutReminders")} />
        <Divider />
        <Toggle label="Meal logging reminders" detail="Only if a usual meal has not been logged" value={p.mealReminders} onChange={set("mealReminders")} />
        <Divider />
        <Toggle label="Hydration" value={p.hydrationReminders} onChange={set("hydrationReminders")} />
        <Divider />
        <Toggle label="Weekly summary" value={p.weeklySummary} onChange={set("weeklySummary")} />
        <Divider />
        <Toggle label="Personal records" value={p.personalRecords} onChange={set("personalRecords")} />
        <Divider />
        <Toggle label="Check-ins" detail="Weekly weigh-in and measurement prompts" value={p.checkIns} onChange={set("checkIns")} />
        <Row gap={8} style={{ paddingTop: 8 }}>
          <View style={{ flex: 1 }}><Field label="Quiet from" defaultValue={p.quietStart} onEndEditing={(e) => validTime(e.nativeEvent.text) && save.mutate({ ...p, quietStart: e.nativeEvent.text })} placeholder="22:00" maxLength={5} /></View>
          <View style={{ flex: 1 }}><Field label="Quiet until" defaultValue={p.quietEnd} onEndEditing={(e) => validTime(e.nativeEvent.text) && save.mutate({ ...p, quietEnd: e.nativeEvent.text })} placeholder="07:00" maxLength={5} /></View>
        </Row>
        <T variant="caption" color="textTertiary" style={{ paddingTop: 4 }}>Nothing is sent during quiet hours. Reminders never repeat for something you have already done.</T>
        <Button
          title="Allow notifications on this device"
          kind="secondary"
          size="md"
          style={{ marginTop: 10 }}
          onPress={() =>
            void registerPush().then(
              (r) => setPush(r === "granted" ? "Notifications are on for this device." : r === "denied" ? "Notifications are off in system settings." : "Push delivery needs a device build with an EAS project configured."),
              (e) => setPush(errMsg(e)),
            )
          }
        />
        {push ? <T variant="footnote" color="textSecondary">{push}</T> : null}
      </Stack>
    </Card>
  );
}

function PrivacySection({ profile }: { profile: Profile }) {
  const save = useMutation({
    mutationFn: (c: Profile["aiConsent"]) => api<Profile["aiConsent"]>("/v1/profile/ai-consent", { method: "PUT", body: c }),
    onMutate: (c) => queryClient.setQueryData(qk.profile, (old: Profile | undefined) => (old ? { ...old, aiConsent: c } : old)),
    onError: () => void queryClient.invalidateQueries({ queryKey: qk.profile }),
  });
  const c = profile.aiConsent;
  return (
    <Card>
      <Stack gap={2}>
        <Toggle label="Photo food recognition" detail="Meal and label photos are sent to the AI provider for analysis" value={c.photoAnalysis} onChange={(v) => save.mutate({ ...c, photoAnalysis: v })} />
        <Divider />
        <Toggle label="Keep meal photos" detail="Off: photos are deleted after you confirm or discard the result" value={c.retainMealPhotos} onChange={(v) => save.mutate({ ...c, retainMealPhotos: v })} />
        <Divider />
        <Toggle label="Coach can use health data" detail="Sleep, resting heart rate and steps in coach answers" value={c.coachUsesHealthData} onChange={(v) => save.mutate({ ...c, coachUsesHealthData: v })} />
        <T variant="caption" color="textTertiary" style={{ paddingTop: 6 }}>The coach reads your logs, goals and workouts to answer. It cannot change anything without your confirmation. Progress photos are never sent to the AI provider.</T>
      </Stack>
    </Card>
  );
}

function DataSection() {
  const { signOut } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const del = useMutation({
    mutationFn: () => api("/v1/me", { method: "DELETE", body: { password, confirm } }),
    onSuccess: () => void signOut(),
  });
  const doExport = async () => {
    setExporting(true);
    setMsg(null);
    try {
      const data = await api<unknown>("/v1/me/export");
      const json = JSON.stringify(data, null, 2);
      const name = `stoke-export-${new Date().toISOString().slice(0, 10)}.json`;
      if (Platform.OS === "web") {
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const file = new File(Paths.document, name);
        if (file.exists) file.delete();
        file.create();
        await file.write(json);
        await Share.share({ url: file.uri, title: name, message: Platform.OS === "android" ? file.uri : undefined });
      }
      setMsg("Export ready.");
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setExporting(false);
    }
  };
  return (
    <Card>
      <Stack gap={10}>
        <Button title="Export my data (JSON)" kind="secondary" size="md" loading={exporting} onPress={() => void doExport()} />
        {msg ? <T variant="footnote" color="textSecondary">{msg}</T> : null}
        <Button title="Sign out" kind="secondary" size="md" onPress={() => void signOut()} />
        {!deleting ? (
          <Pressable accessibilityRole="button" onPress={() => setDeleting(true)} style={{ alignItems: "center", paddingVertical: 12 }}>
            <T variant="headline" color="danger">Delete account…</T>
          </Pressable>
        ) : (
          <Stack gap={8}>
            <T variant="footnote" color="danger">This permanently deletes your account, logs, workouts, measurements and photos. It cannot be undone. Export first if you want a copy.</T>
            <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} autoComplete="current-password" />
            <Field label='Type "DELETE" to confirm' value={confirm} onChangeText={setConfirm} autoCapitalize="characters" />
            {del.error ? <T variant="footnote" color="danger">{errMsg(del.error)}</T> : null}
            <Row gap={8}>
              <Button title="Cancel" kind="secondary" size="md" onPress={() => setDeleting(false)} style={{ flex: 1 }} />
              <Button title="Delete forever" kind="danger" size="md" disabled={!password || confirm !== "DELETE"} loading={del.isPending} onPress={() => del.mutate()} style={{ flex: 1.3 }} />
            </Row>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

export default function Settings() {
  const profile = useProfile();
  const { email } = useAuth();
  return (
    <Screen back title="Settings" subtitle={email ?? undefined}>
      {profile.isPending ? (
        <Skeleton height={240} />
      ) : profile.isError ? (
        <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
      ) : (
        <>
          <SectionHeader title="Profile" />
          <ProfileSection profile={profile.data} />
          <SectionHeader title="Nutrition targets" />
          <TargetsSection profile={profile.data} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            <ListRow icon="coach" title="Ask the coach to review targets" subtitle="Uses your intake and weight trend; changes need your approval" onPress={() => router.push("/coach")} />
          </Card>
          <SectionHeader title="Health data" />
          <HealthSection />
          <SectionHeader title="Notifications" />
          <NotificationsSection />
          <SectionHeader title="Privacy & AI" />
          <PrivacySection profile={profile.data} />
          <SectionHeader title="Your data" />
          <DataSection />
          <T variant="caption" color="textTertiary" align="center">Stoke {Constants.expoConfig?.version ?? ""} · Estimates are not medical advice.</T>
        </>
      )}
    </Screen>
  );
}
