import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { api } from "../../lib/api";
import { qk } from "../../lib/data";
import { t } from "../../i18n";
import type { Food } from "../../lib/types";
import { Badge, Button, Card, Divider, ErrorState, Field, ListRow, Skeleton, Stack, T } from "../../ui/primitives";

// Labels are getters so they follow the current language.
export const MEALS: readonly { readonly value: "breakfast" | "lunch" | "dinner" | "snacks"; readonly label: string }[] = [
  { value: "breakfast", get label() { return t("Breakfast"); } },
  { value: "lunch", get label() { return t("Lunch"); } },
  { value: "dinner", get label() { return t("Dinner"); } },
  { value: "snacks", get label() { return t("Snacks"); } },
];

export function kcalPer100(f: Food): string {
  return typeof f.per100.energyKcal === "number" ? `${Math.round(f.per100.energyKcal)} kcal / 100 ${f.baseUnit}` : t("energy unknown");
}

/** Inline food search: type, pick a result. Used where a full-screen search would lose the user's place. */
export function FoodPicker({ initialQuery = "", onPick, onCancel, label }: { initialQuery?: string; onPick: (food: Food) => void; onCancel?: () => void; label?: string }) {
  const [q, setQ] = useState(initialQuery);
  const [dq, setDq] = useState(initialQuery.trim());
  useEffect(() => {
    const id = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  const search = useQuery({ queryKey: qk.search(dq), queryFn: ({ signal }) => api<{ results: Food[] }>("/v1/foods/search", { query: { q: dq }, signal }), enabled: dq.length >= 2, staleTime: 5 * 60_000 });
  return (
    <Stack gap={8}>
      <Field label={label ?? t("Search foods")} value={q} onChangeText={setQ} autoFocus autoCorrect={false} placeholder={t("e.g. chicken breast")} returnKeyType="search" />
      {dq.length < 2 ? null : search.isPending ? (
        <Skeleton height={44} />
      ) : search.isError ? (
        <ErrorState error={search.error} onRetry={() => void search.refetch()} />
      ) : search.data?.results.length ? (
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {search.data.results.slice(0, 6).map((f, i) => (
            <View key={f.id}>
              {i ? <Divider /> : null}
              <ListRow title={f.name} subtitle={[f.brand, kcalPer100(f)].filter(Boolean).join(" · ")} onPress={() => onPick(f)} right={f.completeness < 1 ? <Badge label={t("partial")} tone="warning" /> : undefined} />
            </View>
          ))}
        </Card>
      ) : (
        <T variant="footnote" color="textSecondary">{t("No matches. Try a simpler name.")}</T>
      )}
      {onCancel ? <Button title={t("Cancel")} kind="ghost" size="sm" onPress={onCancel} /> : null}
    </Stack>
  );
}
