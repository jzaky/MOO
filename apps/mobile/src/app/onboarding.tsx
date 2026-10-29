import type { OnboardingPlanRequest } from "@stoke/contracts";
import { lbToKg, round, toCm } from "@stoke/core";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { api, ApiError } from "../lib/api";
import { qk } from "../lib/data";
import { deviceTimeZone } from "../lib/ids";
import { queryClient } from "../lib/query";
import { kv } from "../lib/storage";
import { useTheme } from "../theme/theme";
import { Button, Card, Chip, Field, Icon, Row, Segmented, Stack, T } from "../ui/primitives";
import { Screen } from "../ui/Screen";

type Goal = "lose_fat" | "build_muscle" | "maintain" | "recomposition" | "strength" | "general_fitness" | "endurance";
const GOALS: { value: Goal; label: string; body: string }[] = [
  { value: "lose_fat", label: "Lose body fat", body: "A moderate deficit with high protein" },
  { value: "build_muscle", label: "Build muscle", body: "A small surplus and progressive training" },
  { value: "recomposition", label: "Recomposition", body: "Lose fat and gain muscle slowly" },
  { value: "strength", label: "Get stronger", body: "Focus on main lifts" },
  { value: "maintain", label: "Maintain weight", body: "Hold steady, improve habits" },
  { value: "general_fitness", label: "General fitness", body: "Feel better, move more" },
  { value: "endurance", label: "Improve endurance", body: "Conditioning alongside strength" },
];
const ACTIVITY = [
  { value: "sedentary", label: "Mostly sitting", body: "Desk work, little walking" },
  { value: "light", label: "Lightly active", body: "Some walking most days" },
  { value: "moderate", label: "Moderately active", body: "On your feet often or regular exercise" },
  { value: "very", label: "Very active", body: "Physical job or hard training most days" },
  { value: "extra", label: "Extremely active", body: "Physical job plus hard training" },
] as const;
const EQUIPMENT = ["barbell", "dumbbell", "kettlebell", "machine", "cable", "bodyweight", "band", "pullup_bar", "cardio_machine"] as const;
const DAYS = ["M", "T", "W", "T", "F", "S", "S"];

interface Draft {
  step: number;
  goals: Goal[];
  units: "metric" | "imperial";
  sex: "male" | "female" | null;
  birthYear: string;
  birthMonth: string;
  birthDay: string;
  height: string;
  heightIn: string;
  weight: string;
  bodyFat: string;
  activity: (typeof ACTIVITY)[number]["value"] | null;
  sleepStart: string;
  sleepEnd: string;
  experience: "new" | "beginner" | "intermediate" | "advanced";
  gymAccess: "commercial_gym" | "home_gym" | "minimal" | "none";
  equipment: string[];
  days: number[];
  sessionMinutes: number;
  limitations: string;
  diet: "omnivore" | "vegetarian" | "vegan" | "pescatarian" | "halal" | "kosher" | "keto" | "other";
  allergies: string;
  dislikes: string;
  mealsPerDay: number;
  photoAnalysis: boolean;
  coachUsesHealthData: boolean;
}

const INITIAL: Draft = { step: 0, goals: [], units: "metric", sex: null, birthYear: "", birthMonth: "", birthDay: "", height: "", heightIn: "", weight: "", bodyFat: "", activity: null, sleepStart: "23:00", sleepEnd: "07:00", experience: "beginner", gymAccess: "commercial_gym", equipment: [], days: [1, 3, 5], sessionMinutes: 60, limitations: "", diet: "omnivore", allergies: "", dislikes: "", mealsPerDay: 3, photoAnalysis: true, coachUsesHealthData: false };
const STEPS = ["Goals", "Body", "Lifestyle", "Training", "Nutrition", "Privacy", "Your plan"];

interface Plan {
  targets: { energyKcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number; waterMl: number; estimatedTdeeKcal: number; bmrKcal: number; notes: string[]; weeklyRatePct: number };
  training: { split: string; daysPerWeek: number; dayNames: string[]; weekdays: number[]; rationale: string; sessionMinutes: number };
  activity: { dailyStepsTarget: number; note: string };
  measurementSchedule: Record<string, string>;
  disclaimer: string;
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 30);

function toRequest(d: Draft): OnboardingPlanRequest | null {
  const pad = (s: string) => s.padStart(2, "0");
  const birthDate = `${d.birthYear}-${pad(d.birthMonth)}-${pad(d.birthDay)}`;
  const weightKg = d.units === "metric" ? Number(d.weight) : lbToKg(Number(d.weight));
  const heightCm = d.units === "metric" ? Number(d.height) : toCm(Number(d.height || 0) * 12 + Number(d.heightIn || 0), "in");
  if (!d.sex || !d.activity || !d.goals.length || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !(weightKg > 0) || !(heightCm > 0)) return null;
  return {
    sex: d.sex,
    birthDate,
    heightCm: round(heightCm, 1),
    weightKg: round(weightKg, 1),
    bodyFatPct: d.bodyFat ? Number(d.bodyFat) : null,
    activityLevel: d.activity,
    goals: d.goals.map((g, i) => ({ kind: g, priority: i + 1 })),
    training: { experience: d.experience, gymAccess: d.gymAccess, equipment: d.equipment as never, preferredDays: d.days, sessionMinutes: d.sessionMinutes, limitations: d.limitations || null, currentRoutine: null, likedExercises: [], dislikedExercises: [] },
  };
}

function Option({ title, body, selected, onPress, badge }: { title: string; body?: string; selected: boolean; onPress: () => void; badge?: string }) {
  const th = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: th.radius.lg, borderWidth: 1, borderColor: selected ? th.c.accent : th.c.hairline, backgroundColor: selected ? th.c.accentMuted : pressed ? th.c.surfacePressed : th.c.surface })}>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="headline">{title}</T>
        {body ? (
          <T variant="footnote" color="textSecondary">
            {body}
          </T>
        ) : null}
      </View>
      {badge ? (
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: th.c.accent, alignItems: "center", justifyContent: "center" }}>
          <T variant="caption" color="textInverse" weight="700">
            {badge}
          </T>
        </View>
      ) : selected ? (
        <Icon name="check" size={18} color="accent" />
      ) : null}
    </Pressable>
  );
}

export default function Onboarding() {
  const th = useTheme();
  const [d, setD] = useState<Draft>(() => ({ ...INITIAL, ...(kv.get<Draft>("onboarding.draft") ?? {}) }));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [edits, setEdits] = useState<{ energyKcal?: string; proteinG?: string; carbsG?: string; fatG?: string }>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => kv.set("onboarding.draft", d), [d]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const planMutation = useMutation({
    mutationFn: (req: OnboardingPlanRequest) => api<Plan>("/v1/onboarding/plan", { body: req }),
    onSuccess: (p) => {
      setPlan(p);
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not build the plan."),
  });

  const complete = useMutation({
    mutationFn: async () => {
      const req = toRequest(d)!;
      const overrides = Object.fromEntries(Object.entries(edits).filter(([, v]) => v && Number(v) > 0).map(([k, v]) => [k, Number(v)]));
      await api("/v1/profile/ai-consent", { method: "PUT", body: { photoAnalysis: d.photoAnalysis, coachUsesHealthData: d.coachUsesHealthData, retainMealPhotos: false } });
      return api("/v1/onboarding/complete", {
        body: {
          ...req,
          timeZone: deviceTimeZone(),
          unitSystem: d.units,
          dietary: { pattern: d.diet, allergies: list(d.allergies), dislikedFoods: list(d.dislikes), mealsPerDay: d.mealsPerDay, restrictions: [], preferredFoods: [] },
          lifestyle: { sleepStart: d.sleepStart || null, sleepEnd: d.sleepEnd || null },
          ...(Object.keys(overrides).length ? { targetOverrides: overrides } : {}),
        },
      });
    },
    onSuccess: async () => {
      kv.remove("onboarding.draft");
      await queryClient.invalidateQueries({ queryKey: qk.profile });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save. Check your connection and try again."),
  });

  const canContinue = [
    d.goals.length > 0,
    !!d.sex && !!d.birthYear && !!d.birthMonth && !!d.birthDay && Number(d.weight) > 0 && Number(d.height) > 0,
    !!d.activity,
    d.days.length > 0,
    true,
    true,
    !!plan,
  ][d.step];

  const next = () => {
    if (d.step === 5) {
      const req = toRequest(d);
      if (!req) return setError("Some details are missing.");
      planMutation.mutate(req);
    }
    set("step", Math.min(6, d.step + 1));
  };

  const units = d.units;
  return (
    <Screen
      title={STEPS[d.step]}
      subtitle={`Step ${d.step + 1} of ${STEPS.length}`}
      back={false}
      right={d.step > 0 ? <Button title="Back" kind="ghost" size="sm" onPress={() => set("step", d.step - 1)} /> : undefined}
      footer={
        d.step < 6 ? (
          <Button title="Continue" onPress={next} disabled={!canContinue} />
        ) : (
          <Button title="Start" onPress={() => complete.mutate()} loading={complete.isPending} disabled={!plan} />
        )
      }
    >
      <View style={{ height: 4, borderRadius: 2, backgroundColor: th.c.track }}>
        <View style={{ height: 4, borderRadius: 2, width: `${((d.step + 1) / STEPS.length) * 100}%`, backgroundColor: th.c.accent }} />
      </View>

      {d.step === 0 ? (
        <Stack gap={10}>
          <T variant="subhead" color="textSecondary">
            Pick one or more. Tap in order of importance; the first is your main goal.
          </T>
          {GOALS.map((g) => {
            const idx = d.goals.indexOf(g.value);
            return <Option key={g.value} title={g.label} body={g.body} selected={idx >= 0} badge={idx >= 0 ? String(idx + 1) : undefined} onPress={() => set("goals", idx >= 0 ? d.goals.filter((x) => x !== g.value) : [...d.goals, g.value].slice(0, 3))} />;
          })}
        </Stack>
      ) : null}

      {d.step === 1 ? (
        <Stack gap={14}>
          <Segmented options={[{ value: "metric", label: "Metric (kg, cm)" }, { value: "imperial", label: "Imperial (lb, ft)" }]} value={units} onChange={(v) => set("units", v)} />
          <T variant="footnote" color="textSecondary">
            Used for the energy estimate (Mifflin-St Jeor). You can change anything later.
          </T>
          <Row gap={8}>
            <Chip label="Male" selected={d.sex === "male"} onPress={() => set("sex", "male")} />
            <Chip label="Female" selected={d.sex === "female"} onPress={() => set("sex", "female")} />
          </Row>
          <Row gap={8} align="flex-end">
            <View style={{ flex: 1.4 }}>
              <Field label="Birth year" value={d.birthYear} onChangeText={(v) => set("birthYear", v.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" placeholder="1990" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Month" value={d.birthMonth} onChangeText={(v) => set("birthMonth", v.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" placeholder="5" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Day" value={d.birthDay} onChangeText={(v) => set("birthDay", v.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" placeholder="14" />
            </View>
          </Row>
          {units === "metric" ? (
            <Field label="Height" value={d.height} onChangeText={(v) => set("height", v)} keyboardType="decimal-pad" suffix="cm" placeholder="178" />
          ) : (
            <Row gap={8}>
              <View style={{ flex: 1 }}>
                <Field label="Height" value={d.height} onChangeText={(v) => set("height", v)} keyboardType="number-pad" suffix="ft" placeholder="5" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label=" " value={d.heightIn} onChangeText={(v) => set("heightIn", v)} keyboardType="decimal-pad" suffix="in" placeholder="10" />
              </View>
            </Row>
          )}
          <Field label="Current weight" value={d.weight} onChangeText={(v) => set("weight", v)} keyboardType="decimal-pad" suffix={units === "metric" ? "kg" : "lb"} placeholder={units === "metric" ? "82.5" : "182"} />
          <Field label="Body fat (optional)" value={d.bodyFat} onChangeText={(v) => set("bodyFat", v)} keyboardType="decimal-pad" suffix="%" placeholder="Only if measured" />
        </Stack>
      ) : null}

      {d.step === 2 ? (
        <Stack gap={10}>
          {ACTIVITY.map((a) => (
            <Option key={a.value} title={a.label} body={a.body} selected={d.activity === a.value} onPress={() => set("activity", a.value)} />
          ))}
          <Row gap={8}>
            <View style={{ flex: 1 }}>
              <Field label="Usual bedtime" value={d.sleepStart} onChangeText={(v) => set("sleepStart", v)} placeholder="23:00" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Usual wake time" value={d.sleepEnd} onChangeText={(v) => set("sleepEnd", v)} placeholder="07:00" />
            </View>
          </Row>
        </Stack>
      ) : null}

      {d.step === 3 ? (
        <Stack gap={16}>
          <Stack gap={8}>
            <T variant="headline">Experience</T>
            <Segmented options={[{ value: "new", label: "New" }, { value: "beginner", label: "< 1 yr" }, { value: "intermediate", label: "1–3 yrs" }, { value: "advanced", label: "3+ yrs" }]} value={d.experience} onChange={(v) => set("experience", v)} />
          </Stack>
          <Stack gap={8}>
            <T variant="headline">Where do you train?</T>
            <Row gap={8} wrap>
              {([["commercial_gym", "Full gym"], ["home_gym", "Home gym"], ["minimal", "Minimal kit"], ["none", "No equipment"]] as const).map(([v, l]) => (
                <Chip key={v} label={l} selected={d.gymAccess === v} onPress={() => set("gymAccess", v)} />
              ))}
            </Row>
          </Stack>
          {d.gymAccess !== "commercial_gym" ? (
            <Stack gap={8}>
              <T variant="headline">Equipment you have</T>
              <Row gap={8} wrap>
                {EQUIPMENT.map((e) => (
                  <Chip key={e} label={e.replace(/_/g, " ")} selected={d.equipment.includes(e)} onPress={() => set("equipment", d.equipment.includes(e) ? d.equipment.filter((x) => x !== e) : [...d.equipment, e])} />
                ))}
              </Row>
            </Stack>
          ) : null}
          <Stack gap={8}>
            <T variant="headline">Training days</T>
            <Row gap={6}>
              {DAYS.map((label, i) => {
                const wd = i + 1;
                const on = d.days.includes(wd);
                return (
                  <Pressable key={wd} accessibilityRole="button" accessibilityLabel={["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i]} accessibilityState={{ selected: on }} onPress={() => set("days", on ? d.days.filter((x) => x !== wd) : [...d.days, wd].sort())} style={{ flex: 1, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: on ? th.c.accent : th.c.surface, borderWidth: 1, borderColor: on ? th.c.accent : th.c.hairline }}>
                    <T variant="headline" color={on ? "textInverse" : "textSecondary"}>
                      {label}
                    </T>
                  </Pressable>
                );
              })}
            </Row>
          </Stack>
          <Stack gap={8}>
            <T variant="headline">Session length</T>
            <Segmented options={[{ value: "30", label: "30 min" }, { value: "45", label: "45" }, { value: "60", label: "60" }, { value: "75", label: "75" }, { value: "90", label: "90" }]} value={String(d.sessionMinutes) as "30"} onChange={(v) => set("sessionMinutes", Number(v))} />
          </Stack>
          <Field label="Movement limitations (optional)" value={d.limitations} onChangeText={(v) => set("limitations", v)} placeholder="e.g. avoid overhead pressing" multiline />
        </Stack>
      ) : null}

      {d.step === 4 ? (
        <Stack gap={14}>
          <Row gap={8} wrap>
            {(["omnivore", "halal", "vegetarian", "vegan", "pescatarian", "keto", "kosher", "other"] as const).map((p) => (
              <Chip key={p} label={p[0]!.toUpperCase() + p.slice(1)} selected={d.diet === p} onPress={() => set("diet", p)} />
            ))}
          </Row>
          <Field label="Allergies (comma separated)" value={d.allergies} onChangeText={(v) => set("allergies", v)} placeholder="e.g. peanuts, shellfish" />
          <Field label="Foods you dislike" value={d.dislikes} onChangeText={(v) => set("dislikes", v)} placeholder="e.g. mushrooms" />
          <Stack gap={8}>
            <T variant="headline">Meals per day</T>
            <Segmented options={[{ value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }, { value: "5", label: "5+" }]} value={String(Math.min(5, d.mealsPerDay)) as "3"} onChange={(v) => set("mealsPerDay", Number(v))} />
          </Stack>
        </Stack>
      ) : null}

      {d.step === 5 ? (
        <Stack gap={12}>
          <Card>
            <Row justify="space-between" align="flex-start">
              <View style={{ flex: 1, gap: 4, paddingRight: 12 }}>
                <T variant="headline">Photo analysis</T>
                <T variant="footnote" color="textSecondary">
                  Meal and label photos are sent to the AI provider to draft an entry you review. Photos are deleted after you confirm unless you choose to keep them.
                </T>
              </View>
              <Switch value={d.photoAnalysis} onValueChange={(v) => set("photoAnalysis", v)} trackColor={{ true: th.c.accent, false: th.c.track }} accessibilityLabel="Allow photo analysis" />
            </Row>
          </Card>
          <Card>
            <Row justify="space-between" align="flex-start">
              <View style={{ flex: 1, gap: 4, paddingRight: 12 }}>
                <T variant="headline">Coach can use health data</T>
                <T variant="footnote" color="textSecondary">
                  Lets the coach read sleep, resting heart rate and check-ins when answering. Off by default.
                </T>
              </View>
              <Switch value={d.coachUsesHealthData} onValueChange={(v) => set("coachUsesHealthData", v)} trackColor={{ true: th.c.accent, false: th.c.track }} accessibilityLabel="Allow coach to use health data" />
            </Row>
          </Card>
          <T variant="footnote" color="textTertiary">
            Apple Health / Health Connect and notifications are set up later in Settings, one permission at a time.
          </T>
        </Stack>
      ) : null}

      {d.step === 6 ? (
        <Stack gap={12}>
          {planMutation.isPending ? <T color="textSecondary">Building your plan…</T> : null}
          {plan ? (
            <>
              <Card>
                <Stack gap={10}>
                  <Row justify="space-between">
                    <T variant="label" color="textTertiary">
                      Daily targets
                    </T>
                    <T variant="caption" color="textTertiary">
                      Estimated
                    </T>
                  </Row>
                  <Row gap={8}>
                    {([["energyKcal", "Energy", "kcal"], ["proteinG", "Protein", "g"], ["carbsG", "Carbs", "g"], ["fatG", "Fat", "g"]] as const).map(([k, l, u]) => (
                      <View key={k} style={{ flex: 1 }}>
                        <Field label={l} value={edits[k] ?? String(plan.targets[k])} onChangeText={(v) => setEdits((e) => ({ ...e, [k]: v.replace(/[^\d]/g, "") }))} keyboardType="number-pad" suffix={u} />
                      </View>
                    ))}
                  </Row>
                  <T variant="footnote" color="textSecondary">
                    Estimated maintenance ≈ {plan.targets.estimatedTdeeKcal} kcal. Targets adapt to your logged intake and weight trend after a few weeks, and only with your approval.
                  </T>
                  {plan.targets.notes.map((n) => (
                    <T key={n} variant="footnote" color="warning">
                      {n}
                    </T>
                  ))}
                </Stack>
              </Card>
              <Card>
                <Stack gap={6}>
                  <T variant="label" color="textTertiary">
                    Training
                  </T>
                  <T variant="headline">{plan.training.dayNames.join(" · ")}</T>
                  <T variant="footnote" color="textSecondary">
                    {plan.training.rationale}
                  </T>
                </Stack>
              </Card>
              <Card>
                <Stack gap={6}>
                  <T variant="label" color="textTertiary">
                    Measuring progress
                  </T>
                  <T variant="footnote" color="textSecondary">
                    {plan.measurementSchedule.weighIns}
                  </T>
                  <T variant="footnote" color="textSecondary">
                    About {plan.activity.dailyStepsTarget.toLocaleString()} steps a day. {plan.activity.note}
                  </T>
                </Stack>
              </Card>
              <T variant="caption" color="textTertiary">
                {plan.disclaimer}
              </T>
            </>
          ) : null}
        </Stack>
      ) : null}

      {error ? (
        <T variant="footnote" color="danger">
          {error}
        </T>
      ) : null}
    </Screen>
  );
}
