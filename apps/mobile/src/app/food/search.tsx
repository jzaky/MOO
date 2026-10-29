import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { api } from "../../lib/api";
import { defaultMealForNow, logFood, qk, useFavorites, useRecentFoods } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { todayKey } from "../../lib/ids";
import type { Food, RecentFood } from "../../lib/types";
import { Badge, Card, Chip, Divider, EmptyState, ErrorState, Field, IconButton, ListRow, Row, SectionHeader, Skeleton, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

const MEALS = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snacks", label: "Snacks" },
];

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function foodSubtitle(f: Food): string {
  const kcal = typeof f.per100.energyKcal === "number" ? `${Math.round(f.per100.energyKcal)} kcal / 100 ${f.baseUnit}` : "energy unknown";
  return [f.brand, kcal, f.isPrivate ? "yours" : null].filter(Boolean).join(" · ");
}

export default function FoodSearch() {
  const params = useLocalSearchParams<{ day?: string; meal?: string }>();
  const day = params.day ?? todayKey();
  const [meal, setMeal] = useState(params.meal ?? defaultMealForNow());
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const recent = useRecentFoods();
  const favorites = useFavorites();
  const saved = useQuery({ queryKey: qk.savedMeals, queryFn: async () => (await api<{ items: { id: string; name: string; energyKcal: number; items: unknown[] }[] }>("/v1/saved-meals")).items, staleTime: 5 * 60_000 });
  const search = useQuery({ queryKey: qk.search(dq), queryFn: ({ signal }) => api<{ results: Food[]; notice: string | null }>("/v1/foods/search", { query: { q: dq }, signal }), enabled: dq.length >= 2, staleTime: 5 * 60_000 });

  const open = (f: Food) => router.push({ pathname: "/food/[id]", params: { id: f.id, day, meal } });
  const relog = (r: RecentFood) => {
    if (!r.lastPortion) return open(r.food);
    logFood({ food: r.food, portion: r.lastPortion, day, meal });
    haptic("success");
    router.back();
  };
  const logSaved = async (id: string) => {
    haptic("success");
    router.back();
    await api(`/v1/saved-meals/${id}/log`, { body: { day, meal, loggedAt: new Date().toISOString() } }).catch(() => {});
  };

  return (
    <Screen close title="Add food" right={<><IconButton icon="barcode" label="Scan barcode" onPress={() => router.push({ pathname: "/food/scan", params: { day, meal } })} /><IconButton icon="camera" label="Photo" onPress={() => router.push({ pathname: "/food/camera", params: { day, meal } })} /><IconButton icon="mic" label="Voice" onPress={() => router.push({ pathname: "/food/voice", params: { day } })} /></>}>
      <Field value={q} onChangeText={setQ} placeholder="Search foods, brands…" autoFocus returnKeyType="search" autoCorrect={false} accessibilityLabel="Search foods" />
      <Row gap={8} wrap>
        {MEALS.map((m) => (
          <Chip key={m.value} label={m.label} selected={meal === m.value} onPress={() => setMeal(m.value)} />
        ))}
      </Row>

      {dq.length >= 2 ? (
        <Stack gap={8}>
          {search.data?.notice ? (
            <T variant="footnote" color="warning">
              {search.data.notice}
            </T>
          ) : null}
          {search.isPending ? (
            <Card>
              <Stack>
                <Skeleton />
                <Skeleton width="80%" />
                <Skeleton width="60%" />
              </Stack>
            </Card>
          ) : search.isError ? (
            <Card>
              <ErrorState error={search.error} onRetry={() => void search.refetch()} />
            </Card>
          ) : search.data?.results.length ? (
            <Card padded={false} style={{ paddingHorizontal: 14 }}>
              {search.data.results.map((f, i) => (
                <View key={f.id}>
                  {i ? <Divider /> : null}
                  <ListRow title={f.name} subtitle={foodSubtitle(f)} onPress={() => open(f)} right={f.completeness < 1 ? <Badge label="partial" tone="warning" /> : undefined} />
                </View>
              ))}
            </Card>
          ) : (
            <Card>
              <EmptyState icon="search" title={`No results for "${dq}"`} body="Try a simpler name, scan the barcode, or create the food yourself." action="Create custom food" onAction={() => router.push({ pathname: "/food/custom", params: { name: dq } })} />
            </Card>
          )}
        </Stack>
      ) : (
        <>
          {saved.data?.length ? (
            <>
              <SectionHeader title="Saved meals" />
              <Card padded={false} style={{ paddingHorizontal: 14 }}>
                {saved.data.slice(0, 5).map((m, i) => (
                  <View key={m.id}>
                    {i ? <Divider /> : null}
                    <ListRow title={m.name} subtitle={`${Math.round(m.energyKcal)} kcal · ${m.items.length} items`} right={<IconButton icon="add" label={`Log ${m.name}`} onPress={() => void logSaved(m.id)} bg="surfaceRaised" size={34} />} />
                  </View>
                ))}
              </Card>
            </>
          ) : null}
          <SectionHeader title="Recent" />
          {recent.isPending ? (
            <Card>
              <Skeleton />
            </Card>
          ) : recent.data?.length ? (
            <Card padded={false} style={{ paddingHorizontal: 14 }}>
              {recent.data.slice(0, 15).map((r, i) => (
                <View key={r.food.id}>
                  {i ? <Divider /> : null}
                  <ListRow
                    title={r.food.name}
                    subtitle={r.lastPortion ? `Last: ${r.lastPortion.kind === "serving" ? `${r.lastPortion.quantity} × ${r.food.servings.find((s) => s.id === (r.lastPortion as { servingId: string }).servingId)?.label ?? "serving"}` : `${r.lastPortion.quantity} ${r.lastPortion.unit}`}` : foodSubtitle(r.food)}
                    onPress={() => open(r.food)}
                    right={<IconButton icon="add" label={`Log ${r.food.name} again`} onPress={() => relog(r)} bg="surfaceRaised" size={34} />}
                  />
                </View>
              ))}
            </Card>
          ) : (
            <Card>
              <EmptyState icon="history" title="No recent foods yet" body="Foods you log appear here so you can add them again in one tap." />
            </Card>
          )}
          {favorites.data?.length ? (
            <>
              <SectionHeader title="Favourites" />
              <Card padded={false} style={{ paddingHorizontal: 14 }}>
                {favorites.data.map((f, i) => (
                  <View key={f.id}>
                    {i ? <Divider /> : null}
                    <ListRow title={f.name} subtitle={foodSubtitle(f)} onPress={() => open(f)} />
                  </View>
                ))}
              </Card>
            </>
          ) : null}
          <SectionHeader title="More ways to log" />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            <ListRow icon="recipe" title="From a recipe" onPress={() => router.push("/recipes")} />
            <Divider />
            <ListRow icon="restaurant" title="Restaurant menu" subtitle="Photo or text of a menu" onPress={() => router.push({ pathname: "/food/menu", params: { day, meal } })} />
          </Card>
        </>
      )}
      <T variant="caption" color="textTertiary">
        Food data: USDA FoodData Central (public domain) and Open Food Facts contributors (ODbL). Values can contain errors; you can correct any food for yourself.
      </T>
    </Screen>
  );
}
