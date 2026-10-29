import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { MEALS } from "../../features/foods/FoodPicker";
import { api, ApiError } from "../../lib/api";
import { logRecipe, qk } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { formatDayLabel, todayKey } from "../../lib/ids";
import { queryClient } from "../../lib/query";
import { kv } from "../../lib/storage";
import type { Food, GroceryList, MealPlan, MealPlanItem, Recipe, Targets } from "../../lib/types";
import { ActionSheet } from "../../ui/ActionSheet";
import { Button, Card, Chip, Divider, EmptyState, ErrorState, Icon, ListRow, Row, SectionHeader, Skeleton, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";
import { locale, t, tn } from "../../i18n";

const mealLabel = (v: string) => MEALS.find((m) => m.value === v)?.label ?? v;
const errText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : t("Something went wrong. Try again."));
const groceryKey = (planId: string) => `grocery.forPlan.${planId}`;

/** Log a planned item to its own day and meal. Recipes go through the recipe (server recomputes); saved meals expand server-side. */
async function logPlanned(item: MealPlanItem): Promise<void> {
  const loggedAt = new Date().toISOString();
  if (item.recipeId) {
    const r = await queryClient.fetchQuery({ queryKey: qk.recipe(item.recipeId), queryFn: () => api<Recipe>(`/v1/recipes/${item.recipeId}`) });
    if (!r.foodId || !r.servingId) throw new Error(t("This recipe has no serving size yet. Open and save it once."));
    const food = await queryClient.fetchQuery({ queryKey: qk.food(r.foodId), queryFn: () => api<Food>(`/v1/foods/${r.foodId}`) });
    logRecipe({ recipeId: r.id, food, servingId: r.servingId, servings: item.servings, day: item.day, meal: item.meal });
  } else if (item.savedMealId) {
    await api(`/v1/saved-meals/${item.savedMealId}/log`, { body: { day: item.day, meal: item.meal, loggedAt, scale: item.servings } });
    void queryClient.invalidateQueries({ queryKey: qk.diary(item.day) });
    void queryClient.invalidateQueries({ queryKey: qk.today });
  }
}

export default function MealPlanScreen() {
  const plans = useQuery({ queryKey: qk.mealPlans, queryFn: async () => (await api<{ items: MealPlan[] }>("/v1/meal-plans")).items });
  const targets = useQuery({ queryKey: qk.targets, queryFn: () => api<{ current: Targets | null }>("/v1/nutrition/targets") });
  const [meals, setMeals] = useState<string[]>(["breakfast", "lunch", "dinner"]);
  const [selected, setSelected] = useState<MealPlanItem | null>(null);
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const plan = plans.data?.[0];

  const generate = useMutation({
    mutationFn: () => api<MealPlan>("/v1/meal-plans/generate", { body: { startDay: todayKey(), days: 7, meals } }),
    onSuccess: (p) => {
      haptic("success");
      queryClient.setQueryData<MealPlan[]>(qk.mealPlans, (old) => [p, ...(old ?? [])]);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/v1/meal-plans/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      kv.remove(groceryKey(id));
      queryClient.setQueryData<MealPlan[]>(qk.mealPlans, (old) => (old ?? []).filter((p) => p.id !== id));
    },
  });
  const grocery = useMutation({
    mutationFn: async (planId: string) => {
      const existing = kv.get<string>(groceryKey(planId));
      if (existing) return existing;
      const list = await api<GroceryList>(`/v1/meal-plans/${planId}/grocery-list`, { method: "POST" });
      kv.set(groceryKey(planId), list.id);
      queryClient.setQueryData(qk.grocery(list.id), list);
      return list.id;
    },
    onSuccess: (listId) => router.push({ pathname: "/plan/grocery/[id]", params: { id: listId } }),
  });

  const days = plan ? [...new Set(plan.items.map((i) => i.day))].sort() : [];
  const target = targets.data?.current;

  return (
    <Screen back title={t("Meal plan")} onRefresh={() => void plans.refetch()} refreshing={plans.isRefetching}>
      {plans.isPending ? (
        <Card><Stack><Skeleton height={60} /><Skeleton height={60} /></Stack></Card>
      ) : plans.isError ? (
        <Card><ErrorState error={plans.error} onRetry={() => void plans.refetch()} /></Card>
      ) : !plan ? (
        <Card>
          <Stack gap={12}>
            <EmptyState icon="calendar" title={t("Plan your week")} body={t("A 7-day plan is built from your own recipes and saved meals, sized to your targets, so every number is one you can trust.")} />
            <Row gap={8} wrap style={{ justifyContent: "center" }}>
              {MEALS.map((m) => <Chip key={m.value} label={m.label} selected={meals.includes(m.value)} onPress={() => setMeals((ms) => (ms.includes(m.value) ? ms.filter((x) => x !== m.value) : [...ms, m.value]))} />)}
            </Row>
            {generate.error ? (
              <Stack gap={8}>
                <T variant="footnote" color="danger" align="center">{errText(generate.error)}</T>
                <Button title={t("Add a recipe")} kind="secondary" size="md" onPress={() => router.push("/recipes/edit")} />
              </Stack>
            ) : null}
            <Button title={t("Build my week")} icon="calendar" disabled={!meals.length} loading={generate.isPending} onPress={() => generate.mutate()} />
          </Stack>
        </Card>
      ) : (
        <>
          <Row gap={8}>
            <Button title={t("Grocery list")} icon="cart" size="md" loading={grocery.isPending} onPress={() => grocery.mutate(plan.id)} style={{ flex: 1 }} />
            <Button title={t("Pantry")} kind="secondary" size="md" onPress={() => router.push("/plan/pantry")} style={{ flex: 0.7 }} />
          </Row>
          {grocery.error ? <T variant="footnote" color="danger">{errText(grocery.error)}</T> : null}
          {actionError ? <T variant="footnote" color="danger">{actionError}</T> : null}
          {plan.note ? <T variant="caption" color="textTertiary">{plan.note}</T> : null}
          {days.map((day) => {
            const items = plan.items.filter((i) => i.day === day).sort((a, b) => MEALS.findIndex((m) => m.value === a.meal) - MEALS.findIndex((m) => m.value === b.meal));
            const kcal = items.reduce((a, i) => a + (i.energyKcal ?? 0), 0);
            const protein = items.reduce((a, i) => a + (i.proteinG ?? 0), 0);
            return (
              <View key={day} style={{ gap: 8 }}>
                <SectionHeader title={`${formatDayLabel(day)} · ${t("{kcal} kcal", { kcal: kcal.toLocaleString(locale()) })} · ${t("{g} g protein", { g: protein })}`} />
                <Card padded={false} style={{ paddingHorizontal: 14 }}>
                  {items.map((it, i) => (
                    <View key={it.id}>
                      {i ? <Divider /> : null}
                      <ListRow
                        title={it.name}
                        subtitle={`${mealLabel(it.meal)}${it.servings !== 1 ? ` · ${tn(it.servings, "{n} serving", "{n} servings")}` : ""}${it.energyKcal != null ? ` · ${t("{kcal} kcal", { kcal: it.energyKcal })}` : ""}`}
                        onPress={() => { setActionError(null); setSelected(it); }}
                        right={logged.has(it.id) ? <Icon name="check" color="accent" /> : undefined}
                      />
                    </View>
                  ))}
                </Card>
                {target ? <T variant="caption" color="textTertiary">{t("Target {kcal} kcal · {g} g protein. Snacks or small additions can close the gap.", { kcal: target.energyKcal.toLocaleString(locale()), g: Math.round(target.proteinG) })}</T> : null}
              </View>
            );
          })}
          <Row gap={8} style={{ marginTop: 8 }}>
            <Button title={t("New plan")} kind="secondary" size="md" loading={generate.isPending} onPress={() => generate.mutate()} style={{ flex: 1 }} />
            <Button title={confirmDelete ? t("Tap to confirm") : t("Delete plan")} kind={confirmDelete ? "danger" : "ghost"} size="md" loading={remove.isPending} onPress={() => (confirmDelete ? (setConfirmDelete(false), remove.mutate(plan.id)) : setConfirmDelete(true))} style={{ flex: 1 }} />
          </Row>
          <T variant="caption" color="textTertiary">{t("Plans never log anything on their own. Tap a meal to log it when you eat it.")}</T>
        </>
      )}
      <ActionSheet
        visible={!!selected}
        title={selected?.name}
        onClose={() => setSelected(null)}
        actions={selected ? [
          {
            label: t("Log to {day}'s {meal}", { day: formatDayLabel(selected.day).toLowerCase(), meal: mealLabel(selected.meal).toLowerCase() }),
            icon: "add" as const,
            onPress: () => {
              const it = selected;
              logPlanned(it).then(() => { haptic("success"); setLogged((s) => new Set(s).add(it.id)); }, (e) => setActionError(errText(e)));
            },
          },
          ...(selected.recipeId ? [{ label: t("Open recipe"), icon: "recipe" as const, onPress: () => router.push({ pathname: "/recipes/[id]", params: { id: selected.recipeId! } }) }] : []),
        ] : []}
      />
    </Screen>
  );
}
