import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";
import { api } from "../../lib/api";
import { qk } from "../../lib/data";
import type { RecipeSummary } from "../../lib/types";
import { Badge, Button, Card, Divider, EmptyState, ErrorState, ListRow, Skeleton, Stack } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

const n = (v: unknown) => (typeof v === "number" ? Math.round(v) : null);

export default function Recipes() {
  const list = useQuery({ queryKey: qk.recipes, queryFn: async () => (await api<{ items: RecipeSummary[] }>("/v1/recipes")).items });
  return (
    <Screen back title="Recipes" right={<Button title="New" size="sm" icon="add" onPress={() => router.push("/recipes/edit")} />} onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
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
                  subtitle={`${kcal != null ? `${kcal} kcal` : "energy unknown"}${protein != null ? ` · ${protein} g protein` : ""} per serving · makes ${r.servings}`}
                  onPress={() => router.push({ pathname: "/recipes/[id]", params: { id: r.id } })}
                  right={r.missingIngredientCount ? <Badge label={`${r.missingIngredientCount} unmatched`} tone="warning" /> : undefined}
                />
              </View>
            );
          })}
        </Card>
      ) : (
        <Card>
          <EmptyState icon="recipe" title="No recipes yet" body="Paste an ingredient list or a recipe link. Each ingredient is matched to the food database, so nutrition per serving is calculated, not guessed." action="Add a recipe" onAction={() => router.push("/recipes/edit")} />
        </Card>
      )}
    </Screen>
  );
}
