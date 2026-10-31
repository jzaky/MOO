import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { api } from "../../lib/api";
import { defaultMealForNow, logFood, qk, useFavorites, useProfile, useRecentFoods } from "../../lib/data";
import { dietRowBadge } from "../../features/food/diet";
import { haptic } from "../../lib/haptics";
import { todayKey } from "../../lib/ids";
import type { Food, RecentFood } from "../../lib/types";
import { t, tn } from "../../i18n";
import { Badge, Card, Chip, Divider, EmptyState, ErrorState, Field, IconButton, ListRow, Row, SectionHeader, Skeleton, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

function meals() {
  return [
    { value: "breakfast", label: t("Breakfast") },
    { value: "lunch", label: t("Lunch") },
    { value: "dinner", label: t("Dinner") },
    { value: "snacks", label: t("Snacks") },
  ];
}

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function foodSubtitle(f: Food): string {
  const kcal = typeof f.per100.energyKcal === "number" ? `${Math.round(f.per100.energyKcal)} kcal / 100 ${f.baseUnit}` : t("energy unknown");
  return [f.brand, kcal, f.isPrivate ? t("yours") : null].filter(Boolean).join(" · ");
}

export default function FoodSearch() {
  const params = useLocalSearchParams<{ day?: string; meal?: string; q?: string }>();
  const day = params.day ?? todayKey();
  const [meal, setMeal] = useState(params.meal ?? defaultMealForNow());
  const [q, setQ] = useState(params.q ?? "");
  const dq = useDebounced(q.trim());
  const recent = useRecentFoods();
  const favorites = useFavorites();
  const saved = useQuery({ queryKey: qk.savedMeals, queryFn: async () => (await api<{ items: { id: string; name: string; energyKcal: number; items: unknown[] }[] }>("/v1/saved-meals")).items, staleTime: 5 * 60_000 });
  const profile = useProfile();
  const avoidsPorkAlcohol = profile.data?.dietary.pattern === "halal";
  // Saved catalogue first (instant), online databases in parallel below it, so typing never waits on the network.
  const search = useQuery({ queryKey: qk.search(dq), queryFn: ({ signal }) => api<{ results: Food[]; notice: string | null }>("/v1/foods/search", { query: { q: dq, remote: 0 }, signal }), enabled: dq.length >= 2, staleTime: 5 * 60_000 });
  const online = useQuery({ queryKey: ["food-search-online", dq], queryFn: ({ signal }) => api<{ results: Food[]; notice: string | null }>("/v1/foods/search/online", { query: { q: dq }, signal }), enabled: dq.length >= 3, staleTime: 10 * 60_000, retry: false });
  const localIds = new Set(search.data?.results.map((f) => f.id));
  // The same product often exists under several barcodes; show it once.
  const sameProduct = (f: Food) => `${f.name.trim().toLowerCase()}|${(f.brand ?? "").toLowerCase()}|${Math.round(f.per100.energyKcal ?? -1)}`;
  const onlineOnly = (online.data?.results ?? []).filter((f, i, all) => !localIds.has(f.id) && all.findIndex((g) => sameProduct(g) === sameProduct(f)) === i);
  const nothingAnywhere = !search.data?.results.length && !onlineOnly.length && !online.isFetching;

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
    <Screen close title={t("Add food")} right={<><IconButton icon="barcode" label={t("Scan barcode")} onPress={() => router.push({ pathname: "/food/scan", params: { day, meal } })} /><IconButton icon="camera" label={t("Photo")} onPress={() => router.push({ pathname: "/food/camera", params: { day, meal } })} /><IconButton icon="mic" label={t("Voice")} onPress={() => router.push({ pathname: "/food/voice", params: { day } })} /></>}>
      <Field value={q} onChangeText={setQ} placeholder={t("Search foods, brands…")} autoFocus returnKeyType="search" autoCorrect={false} accessibilityLabel={t("Search foods")} />
      <Row gap={8} wrap>
        {meals().map((m) => (
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
          ) : !nothingAnywhere ? (
            <>
              {search.data?.results.length ? (
                <Card padded={false} style={{ paddingHorizontal: 14 }}>
                  {search.data.results.map((f, i) => (
                    <View key={f.id}>
                      {i ? <Divider /> : null}
                      <ListRow title={f.name} subtitle={foodSubtitle(f)} onPress={() => open(f)} right={dietRowBadge(f, avoidsPorkAlcohol)} />
                    </View>
                  ))}
                </Card>
              ) : null}
              {dq.length >= 3 ? (
                <>
                  <SectionHeader title={online.isFetching && !onlineOnly.length ? t("Searching brands and products online…") : t("Brands and products")} />
                  {onlineOnly.length ? (
                    <Card padded={false} style={{ paddingHorizontal: 14 }}>
                      {onlineOnly.map((f, i) => (
                        <View key={f.id}>
                          {i ? <Divider /> : null}
                          <ListRow title={f.name} subtitle={foodSubtitle(f)} onPress={() => open(f)} right={dietRowBadge(f, avoidsPorkAlcohol)} />
                        </View>
                      ))}
                    </Card>
                  ) : online.isFetching ? (
                    <Card>
                      <Stack>
                        <Skeleton />
                        <Skeleton width="70%" />
                      </Stack>
                    </Card>
                  ) : online.data?.notice || online.isError ? (
                    <T variant="footnote" color="textTertiary">{t("Online product search isn't reachable right now. Barcode scanning still works.")}</T>
                  ) : (
                    <T variant="footnote" color="textTertiary">{t("No packaged products matched.")}</T>
                  )}
                </>
              ) : null}
            </>
          ) : (
            <Card>
              <EmptyState icon="search" title={t("No results for “{query}”", { query: dq })} body={t("Try a simpler name, scan the barcode, or create the food yourself.")} action={t("Create custom food")} onAction={() => router.push({ pathname: "/food/custom", params: { name: dq } })} />
            </Card>
          )}
        </Stack>
      ) : (
        <>
          {saved.data?.length ? (
            <>
              <SectionHeader title={t("Saved meals")} />
              <Card padded={false} style={{ paddingHorizontal: 14 }}>
                {saved.data.slice(0, 5).map((m, i) => (
                  <View key={m.id}>
                    {i ? <Divider /> : null}
                    <ListRow title={m.name} subtitle={`${Math.round(m.energyKcal)} kcal · ${tn(m.items.length, "{n} item", "{n} items")}`} right={<IconButton icon="add" label={t("Log {name}", { name: m.name })} onPress={() => void logSaved(m.id)} bg="surfaceRaised" size={34} />} />
                  </View>
                ))}
              </Card>
            </>
          ) : null}
          <SectionHeader title={t("Recent")} />
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
                    subtitle={r.lastPortion ? t("Last: {portion}", { portion: r.lastPortion.kind === "serving" ? `${r.lastPortion.quantity} × ${r.food.servings.find((s) => s.id === (r.lastPortion as { servingId: string }).servingId)?.label ?? t("serving")}` : `${r.lastPortion.quantity} ${r.lastPortion.unit}` }) : foodSubtitle(r.food)}
                    onPress={() => open(r.food)}
                    right={<IconButton icon="add" label={t("Log {name} again", { name: r.food.name })} onPress={() => relog(r)} bg="surfaceRaised" size={34} />}
                  />
                </View>
              ))}
            </Card>
          ) : (
            <Card>
              <EmptyState icon="history" title={t("No recent foods yet")} body={t("Foods you log appear here so you can add them again in one tap.")} />
            </Card>
          )}
          {favorites.data?.length ? (
            <>
              <SectionHeader title={t("Favourites")} />
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
          <SectionHeader title={t("More ways to log")} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            <ListRow icon="recipe" title={t("From a recipe")} onPress={() => router.push("/recipes")} />
            <Divider />
            <ListRow icon="restaurant" title={t("Restaurant menu")} subtitle={t("Photo or text of a menu")} onPress={() => router.push({ pathname: "/food/menu", params: { day, meal } })} />
          </Card>
        </>
      )}
      <T variant="caption" color="textTertiary">
        {t("Food data: USDA FoodData Central (public domain) and Open Food Facts contributors (ODbL). Values can contain errors; you can correct any food for yourself.")}
      </T>
    </Screen>
  );
}
