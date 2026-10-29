import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";
import { api } from "../../lib/api";
import { qk } from "../../lib/data";
import type { RecipeSummary } from "../../lib/types";
import { Badge, Button, Card, Divider, EmptyState, ErrorState, ListRow, Skeleton, Stack } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";
import { t } from "../../i18n";

const n = (v: unknown) => (typeof v === "number" ? Math.round(v) : null);

export default function Recipes() {
  const list = useQuery({ queryKey: qk.recipes, queryFn: async () => (await api<{ items: RecipeSummary[] }>("/v1/recipes")).items });
  return (
    <Screen back title={t("Recipes")} right={<Button title={t("New")} size="sm" icon="add" onPress={() => router.push("/recipes/edit")} />} onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
      {list.isPending ? (
        <Card><Stack><Skeleton /><Skeleton width="70%" /><Skeleton width="80%" /></Stack></Card>
      ) : list.isError ? (
        <Card><ErrorState error={list.error} onRetry={() => void list.refetch()} /></Card>
      ) : list.data.length ? (
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {list.data.map((r, i) => {
            const kcal = n(r.perServing.energyKcal);
            const protein = n(r.perServing.proteinG);
            return (
              <View key={r.id}>
                {i ? <Divider /> : null}
                <ListRow
                  icon="recipe"
                  title={r.name}
                  subtitle={`${kcal != null ? t("{kcal} kcal", { kcal }) : t("energy unknown")}${protein != null ? ` · ${t("{g} g protein", { g: protein })}` : ""} ${t("per serving")} · ${t("makes {n}", { n: r.servings })}`}
                  onPress={() => router.push({ pathname: "/recipes/[id]", params: { id: r.id } })}
                  right={r.missingIngredientCount ? <Badge label={t("{count} unmatched", { count: r.missingIngredientCount })} tone="warning" /> : undefined}
                />
              </View>
            );
          })}
        </Card>
      ) : (
        <Card>
          <EmptyState icon="recipe" title={t("No recipes yet")} body={t("Paste an ingredient list or a recipe link. Each ingredient is matched to the food database, so nutrition per serving is calculated, not guessed.")} action={t("Add a recipe")} onAction={() => router.push("/recipes/edit")} />
        </Card>
      )}
    </Screen>
  );
}
