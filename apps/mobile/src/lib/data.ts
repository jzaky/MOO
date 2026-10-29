import type { PortionDto } from "@moo/contracts";
import { nutrientsForPortion, type PortionInput } from "@moo/core";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { nowIso, uuid } from "./ids";
import { enqueue, setAppliedHandler } from "./outbox";
import { queryClient } from "./query";
import type { Diary, Food, FoodLog, Profile, RecentFood, TodayOverview, WeightOverview } from "./types";

/* ───────── Query keys ───────── */

export const qk = {
  profile: ["profile"] as const,
  today: ["today"] as const,
  diary: (day: string) => ["diary", day] as const,
  recent: ["foods", "recent"] as const,
  favorites: ["foods", "favorites"] as const,
  food: (id: string) => ["food", id] as const,
  search: (q: string) => ["foods", "search", q] as const,
  savedMeals: ["saved-meals"] as const,
  recipes: ["recipes"] as const,
  targets: ["targets"] as const,
  programs: ["programs"] as const,
  workouts: ["workouts"] as const,
  exercise: (id: string) => ["exercise", id] as const,
  exerciseHistory: (id: string) => ["exercise", id, "history"] as const,
  exercises: (q: string) => ["exercises", q] as const,
  weight: ["progress", "weight"] as const,
  measurements: ["progress", "measurements"] as const,
  photos: ["progress", "photos"] as const,
  analytics: ["training", "analytics"] as const,
  recovery: ["recovery"] as const,
  recommendations: ["recommendations"] as const,
  conversations: ["coach", "conversations"] as const,
  messages: (id: string) => ["coach", "messages", id] as const,
  weekly: ["coach", "weekly"] as const,
  suggestions: ["nutrition", "suggestions"] as const,
};

/* ───────── Reads ───────── */

export const useProfile = (enabled = true) => useQuery({ queryKey: qk.profile, queryFn: () => api<Profile>("/v1/profile"), enabled });
export const useToday = () => useQuery({ queryKey: qk.today, queryFn: () => api<TodayOverview>("/v1/today") });
export const useDiary = (day: string) => useQuery({ queryKey: qk.diary(day), queryFn: () => api<Diary>(`/v1/diary/${day}`) });
export const useRecentFoods = () => useQuery({ queryKey: qk.recent, queryFn: async () => (await api<{ items: RecentFood[] }>("/v1/foods/recent")).items, staleTime: 5 * 60_000 });
export const useFavorites = () => useQuery({ queryKey: qk.favorites, queryFn: async () => (await api<{ items: Food[] }>("/v1/foods/favorites")).items, staleTime: 5 * 60_000 });
export const useFood = (id: string) => useQuery({ queryKey: qk.food(id), queryFn: () => api<Food>(`/v1/foods/${id}`), staleTime: 60 * 60_000 });
export const useWeight = () => useQuery({ queryKey: qk.weight, queryFn: () => api<WeightOverview>("/v1/progress/weight") });

/* ───────── Writes (offline-first) ───────── */

const MEAL_ORDER = ["breakfast", "lunch", "dinner", "snacks"];

export function defaultMealForNow(d = new Date()): string {
  const h = d.getHours();
  if (h < 11) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 17) return "snacks";
  if (h < 22) return "dinner";
  return "snacks";
}

function patchDiary(day: string, fn: (d: Diary) => Diary) {
  queryClient.setQueryData<Diary>(qk.diary(day), (old) => fn(old ?? { day, entries: [], targets: null, water: { totalMl: 0, targetMl: null, entries: [] }, status: null }));
}

function describePortion(food: Food, p: PortionDto): string {
  if (p.kind === "serving") return `${p.quantity} × ${food.servings.find((s) => s.id === p.servingId)?.label ?? "serving"}`;
  return `${Math.round(p.quantity * 10) / 10} ${p.unit}`;
}

/**
 * Log a database food. Nutrients are computed on-device with the same
 * @moo/core code the server uses, so the optimistic entry matches the server's
 * snapshot; the server recomputes authoritatively on sync.
 */
export function logFood(args: { food: Food; portion: PortionDto; day: string; meal: string; provenance?: "ai_estimate"; recognitionId?: string; id?: string }): string {
  const id = args.id ?? uuid();
  const at = nowIso();
  const { baseAmount, nutrients } = nutrientsForPortion({ baseUnit: args.food.baseUnit, per100: args.food.per100, servings: args.food.servings.map((s) => ({ id: s.id, label: s.label, baseAmount: s.baseAmount })), densityGPerMl: args.food.densityGPerMl }, args.portion as PortionInput);
  const entry: FoodLog = { id, day: args.day, loggedAt: at, meal: args.meal, foodId: args.food.id, recipeId: null, description: args.food.brand ? `${args.food.name} (${args.food.brand})` : args.food.name, portion: args.portion, baseAmount, baseUnit: args.food.baseUnit, nutrients, provenance: args.provenance ?? "database", note: describePortion(args.food, args.portion), clientUpdatedAt: at, pending: true };
  patchDiary(args.day, (d) => ({ ...d, entries: [...d.entries.filter((e) => e.id !== id), entry] }));
  // Remember the portion for one-tap re-logging.
  queryClient.setQueryData<RecentFood[]>(qk.recent, (old) => [{ food: args.food, lastPortion: args.portion, lastMeal: args.meal, uses: (old?.find((r) => r.food.id === args.food.id)?.uses ?? 0) + 1 }, ...(old ?? []).filter((r) => r.food.id !== args.food.id)].slice(0, 30));
  enqueue({ method: "PUT", path: `/v1/food-logs/${id}`, body: { day: args.day, loggedAt: at, clientUpdatedAt: at, meal: args.meal, foodId: args.food.id, portion: args.portion, ...(args.provenance ? { provenance: args.provenance } : {}), ...(args.recognitionId ? { recognitionId: args.recognitionId } : {}) } });
  return id;
}

export function quickAdd(args: { day: string; meal: string; description: string; energyKcal: number; proteinG?: number | null; carbsG?: number | null; fatG?: number | null }): string {
  const id = uuid();
  const at = nowIso();
  const nutrients = { energyKcal: args.energyKcal, ...(args.proteinG != null ? { proteinG: args.proteinG } : {}), ...(args.carbsG != null ? { carbsG: args.carbsG } : {}), ...(args.fatG != null ? { fatG: args.fatG } : {}) };
  patchDiary(args.day, (d) => ({ ...d, entries: [...d.entries, { id, day: args.day, loggedAt: at, meal: args.meal, foodId: null, recipeId: null, description: args.description, portion: null, baseAmount: null, baseUnit: null, nutrients, provenance: "user", note: null, clientUpdatedAt: at, pending: true }] }));
  enqueue({ method: "PUT", path: `/v1/food-logs/${id}`, body: { day: args.day, loggedAt: at, clientUpdatedAt: at, meal: args.meal, description: args.description, nutrients } });
  return id;
}

export function deleteFoodLog(entry: FoodLog): void {
  patchDiary(entry.day, (d) => ({ ...d, entries: d.entries.filter((e) => e.id !== entry.id) }));
  enqueue({ method: "DELETE", path: `/v1/food-logs/${entry.id}`, query: { clientUpdatedAt: nowIso() } });
}

export function moveFoodLog(entry: FoodLog, meal: string): void {
  if (!entry.foodId || !entry.portion) return;
  const at = nowIso();
  patchDiary(entry.day, (d) => ({ ...d, entries: d.entries.map((e) => (e.id === entry.id ? { ...e, meal, clientUpdatedAt: at, pending: true } : e)) }));
  enqueue({ method: "PUT", path: `/v1/food-logs/${entry.id}`, body: { day: entry.day, loggedAt: entry.loggedAt, clientUpdatedAt: at, meal, foodId: entry.foodId, portion: entry.portion } });
}

export function logWater(day: string, ml: number): void {
  const id = uuid();
  const at = nowIso();
  patchDiary(day, (d) => ({ ...d, water: { ...d.water, totalMl: d.water.totalMl + ml, entries: [...d.water.entries, { id, ml, loggedAt: at }] } }));
  enqueue({ method: "PUT", path: `/v1/water-logs/${id}`, body: { day, loggedAt: at, ml, clientUpdatedAt: at } });
}

export function logWeight(day: string, kg: number, original?: { value: number; unit: "kg" | "lb" }): void {
  const id = uuid();
  const at = nowIso();
  queryClient.setQueryData<WeightOverview>(qk.weight, (old) => (old ? { ...old, latest: { day, kg } } : old));
  enqueue({ method: "PUT", path: `/v1/measurements/${id}`, body: { day, measuredAt: at, kind: "weight", value: Math.round(kg * 100) / 100, ...(original ? { originalValue: original.value, originalUnit: original.unit } : {}), clientUpdatedAt: at } });
}

export function logMeasurement(day: string, kind: string, cm: number, original?: { value: number; unit: "cm" | "in" }): void {
  const id = uuid();
  const at = nowIso();
  enqueue({ method: "PUT", path: `/v1/measurements/${id}`, body: { day, measuredAt: at, kind, value: Math.round(cm * 10) / 10, ...(original ? { originalValue: original.value, originalUnit: original.unit } : {}), clientUpdatedAt: at } });
}

/** When an outbox op lands, refresh the affected server views (authoritative values replace optimistic ones). */
setAppliedHandler((op) => {
  if (op.path.startsWith("/v1/food-logs") || op.path.startsWith("/v1/water-logs")) {
    const day = (op.body as { day?: string } | undefined)?.day;
    if (day) void queryClient.invalidateQueries({ queryKey: qk.diary(day) });
    void queryClient.invalidateQueries({ queryKey: qk.today });
  } else if (op.path.startsWith("/v1/measurements")) {
    void queryClient.invalidateQueries({ queryKey: qk.weight });
    void queryClient.invalidateQueries({ queryKey: qk.measurements });
    void queryClient.invalidateQueries({ queryKey: qk.today });
  } else if (op.path.startsWith("/v1/workouts")) {
    void queryClient.invalidateQueries({ queryKey: qk.workouts });
    void queryClient.invalidateQueries({ queryKey: qk.today });
    void queryClient.invalidateQueries({ queryKey: qk.analytics });
  }
});

export { MEAL_ORDER };
