import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, View } from "react-native";
import { MEALS } from "../../features/foods/FoodPicker";
import { api, ApiError } from "../../lib/api";
import { defaultMealForNow, logRecipe, qk, useFood } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { todayKey } from "../../lib/ids";
import { queryClient } from "../../lib/query";
import type { Recipe } from "../../lib/types";
import { useTheme } from "../../theme/theme";
import { StatTile } from "../../ui/charts";
import { Button, Card, Chip, Divider, ErrorState, Icon, Row, SectionHeader, Skeleton, Stack, Stepper, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";
import { t, tn } from "../../i18n";

const fmt = (v: unknown, unit: string) => (typeof v === "number" ? `${Math.round(v)}` : "–") + (typeof v === "number" ? unit : "");

export default function RecipeDetail() {
  const th = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const recipe = useQuery({ queryKey: qk.recipe(id), queryFn: () => api<Recipe>(`/v1/recipes/${id}`) });
  const r = recipe.data;
  const food = useFood(r?.foodId ?? "");
  const [meal, setMeal] = useState<string>(defaultMealForNow());
  const [servings, setServings] = useState(1);
  const [logged, setLogged] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useMutation({
    mutationFn: () => api(`/v1/recipes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.recipes });
      router.back();
    },
  });

  if (recipe.isPending) return <Screen back title={t("Recipe")}><Skeleton height={120} /><Skeleton height={200} /></Screen>;
  if (recipe.isError || !r) return <Screen back title={t("Recipe")}><Card><ErrorState error={recipe.error} onRetry={() => void recipe.refetch()} /></Card></Screen>;

  const log = () => {
    if (!food.data || !r.servingId) return;
    logRecipe({ recipeId: r.id, food: food.data, servingId: r.servingId, servings, day: todayKey(), meal });
    haptic("success");
    setLogged(true);
  };
  const ps = r.perServing;

  return (
    <Screen back title={r.name} subtitle={`${tn(r.servings, "Makes {n} serving", "Makes {n} servings")}${r.cookedYieldG ? ` · ${t("{g} g cooked", { g: Math.round(r.cookedYieldG) })}` : ""}`} right={<Button title={t("Edit")} kind="secondary" size="sm" icon="edit" onPress={() => router.push({ pathname: "/recipes/edit", params: { id: r.id } })} />}>
      <Row gap={8} align="stretch">
        <StatTile label={t("Energy")} value={fmt(ps.energyKcal, "")} unit="kcal" />
        <StatTile label={t("Protein")} value={fmt(ps.proteinG, "")} unit="g" />
      </Row>
      <Row gap={8} align="stretch">
        <StatTile label={t("Carbs")} value={fmt(ps.carbsG, "")} unit="g" />
        <StatTile label={t("Fat")} value={fmt(ps.fatG, "")} unit="g" />
      </Row>
      <T variant="caption" color="textTertiary">{t("Per serving, calculated from matched ingredients.")}</T>
      {r.missingIngredientCount ? (
        <Card style={{ borderColor: th.c.warning }}>
          <Row gap={8} align="flex-start">
            <Icon name="info" color="warning" size={18} />
            <T variant="footnote" style={{ flex: 1 }}>{tn(r.missingIngredientCount, "{n} ingredient is not matched to a food, so it is not counted. Edit the recipe to match it.", "{n} ingredients are not matched to a food, so they are not counted. Edit the recipe to match them.")}</T>
          </Row>
        </Card>
      ) : null}

      <SectionHeader title={t("Log it")} />
      <Card>
        <Stack gap={12}>
          <Row gap={8} wrap>{MEALS.map((m) => <Chip key={m.value} label={m.label} selected={meal === m.value} onPress={() => setMeal(m.value)} />)}</Row>
          <Stepper label={t("Servings")} value={servings} onChange={setServings} step={0.5} min={0.5} max={20} format={(v) => `${v}`} />
          {logged ? (
            <Row justify="space-between">
              <T variant="subhead" color="accent">{t("Logged to {meal}", { meal: MEALS.find((m) => m.value === meal)?.label.toLowerCase() ?? "" })}</T>
              <Button title={t("Done")} kind="secondary" size="sm" onPress={() => router.back()} />
            </Row>
          ) : (
            <Button title={tn(servings, "Log {n} serving today", "Log {n} servings today")} icon="add" disabled={!food.data || !r.servingId} loading={food.isPending && !!r.foodId} onPress={log} />
          )}
        </Stack>
      </Card>

      <SectionHeader title={t("Ingredients")} />
      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {r.ingredients.map((g, i) => (
          <View key={g.id}>
            {i ? <Divider /> : null}
            <Row gap={10} style={{ paddingVertical: 12 }}>
              <Icon name={g.foodId ? "check" : "info"} size={16} color={g.foodId ? "accent" : "warning"} />
              <T variant="body" style={{ flex: 1 }}>{g.rawText}</T>
              {g.baseAmount != null ? <T variant="footnote" color="textSecondary">{Math.round(g.baseAmount)} g</T> : null}
            </Row>
          </View>
        ))}
      </Card>

      {r.instructions ? (
        <>
          <SectionHeader title={t("Method")} />
          <Card><T variant="body">{r.instructions}</T></Card>
        </>
      ) : null}
      {r.sourceUrl ? <Button title={t("Open original recipe")} kind="ghost" size="sm" onPress={() => void Linking.openURL(r.sourceUrl!)} /> : null}
      {/* Two-step delete: the first tap arms it. Logged entries keep their values either way. */}
      <Button title={confirmDelete ? t("Tap again to delete (past logs are kept)") : t("Delete recipe")} kind={confirmDelete ? "danger" : "ghost"} size="sm" loading={remove.isPending} onPress={() => (confirmDelete ? remove.mutate() : setConfirmDelete(true))} />
      {remove.error ? <T variant="footnote" color="danger">{remove.error instanceof ApiError ? remove.error.message : t("Could not delete")}</T> : null}
    </Screen>
  );
}
