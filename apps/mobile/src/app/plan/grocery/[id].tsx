import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { api } from "../../../lib/api";
import { qk } from "../../../lib/data";
import { haptic } from "../../../lib/haptics";
import { queryClient } from "../../../lib/query";
import type { GroceryItem, GroceryList } from "../../../lib/types";
import { useTheme } from "../../../theme/theme";
import { ActionSheet } from "../../../ui/ActionSheet";
import { Button, Card, Divider, EmptyState, ErrorState, Icon, Row, SectionHeader, Skeleton, Stack, T } from "../../../ui/primitives";
import { Screen } from "../../../ui/Screen";

function fmtQty(i: GroceryItem): string {
  if (i.unit === "g" && i.quantity >= 1000) return `${Math.round(i.quantity / 100) / 10} kg`;
  if (i.unit === "ml" && i.quantity >= 1000) return `${Math.round(i.quantity / 100) / 10} l`;
  return `${Math.round(i.quantity)} ${i.unit}`;
}

export default function GroceryListScreen() {
  const th = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const list = useQuery({ queryKey: qk.grocery(id), queryFn: () => api<GroceryList>(`/v1/grocery-lists/${id}`) });
  const [menu, setMenu] = useState<GroceryItem | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const setChecked = (itemId: string, checked: boolean) =>
    queryClient.setQueryData<GroceryList>(qk.grocery(id), (old) => (old ? { ...old, items: old.items.map((i) => (i.id === itemId ? { ...i, checked } : i)) } : old));
  const toggle = useMutation({
    mutationFn: (v: { item: GroceryItem; checked: boolean }) => api(`/v1/grocery-items/${v.item.id}`, { method: "PATCH", body: { checked: v.checked } }),
    onMutate: (v) => {
      setChecked(v.item.id, v.checked);
      haptic("selection");
    },
    onError: (_, v) => {
      setChecked(v.item.id, !v.checked);
      setMessage("Couldn't save that change. Check your connection.");
    },
  });
  const toPantry = useMutation({
    mutationFn: (i: GroceryItem) => api("/v1/pantry", { method: "PUT", body: { key: i.key, name: i.name, quantity: i.quantity, unit: i.unit } }),
    onSuccess: (_, i) => {
      toggle.mutate({ item: i, checked: true });
      void queryClient.invalidateQueries({ queryKey: qk.pantry });
      setMessage(`${i.name} added to your pantry. Future lists will subtract it.`);
    },
  });

  const items = list.data?.items ?? [];
  const done = items.filter((i) => i.checked).length;
  const categories = [...new Set(items.map((i) => i.category))];

  return (
    <Screen back title="Grocery list" subtitle={list.data ? `${done} of ${items.length} in the basket` : undefined} right={<Button title="Pantry" kind="secondary" size="sm" onPress={() => router.push("/plan/pantry")} />} onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
      {list.isPending ? (
        <Card><Stack><Skeleton /><Skeleton /><Skeleton width="60%" /></Stack></Card>
      ) : list.isError ? (
        <Card><ErrorState error={list.error} onRetry={() => void list.refetch()} /></Card>
      ) : !items.length ? (
        <Card><EmptyState icon="cart" title="Nothing to buy" body="Everything this plan needs is already in your pantry, or its recipes have no matched ingredients." /></Card>
      ) : (
        <>
          {message ? <T variant="footnote" color="textSecondary">{message}</T> : null}
          {categories.map((c) => (
            <View key={c} style={{ gap: 8 }}>
              <SectionHeader title={c} />
              <Card padded={false} style={{ paddingHorizontal: 14 }}>
                {items.filter((i) => i.category === c).map((i, n) => (
                  <View key={i.id}>
                    {n ? <Divider /> : null}
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: i.checked }}
                      accessibilityLabel={`${i.name}, ${fmtQty(i)}`}
                      accessibilityHint="Hold for more options"
                      onPress={() => toggle.mutate({ item: i, checked: !i.checked })}
                      onLongPress={() => setMenu(i)}
                      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, minHeight: 48 }}
                    >
                      <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: i.checked ? th.c.accent : th.c.textTertiary, backgroundColor: i.checked ? th.c.accent : "transparent", alignItems: "center", justifyContent: "center" }}>
                        {i.checked ? <Icon name="check" size={16} color="textInverse" /> : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <T variant="body" color={i.checked ? "textTertiary" : "text"} style={{ textDecorationLine: i.checked ? "line-through" : "none" }}>{i.name}</T>
                        {/* Recipes that list a cooked ingredient give its cooked weight; buy less of it dry. */}
                        {/\bcooked\b/i.test(i.name) ? <T variant="caption" color="textTertiary">cooked weight; buy less dry</T> : null}
                      </View>
                      <T variant="subhead" color="textSecondary">{fmtQty(i)}</T>
                    </Pressable>
                  </View>
                ))}
              </Card>
            </View>
          ))}
          <T variant="caption" color="textTertiary">Amounts are totals across the plan's recipes, minus what's in your pantry. Hold an item if you already have it.</T>
        </>
      )}
      <ActionSheet visible={!!menu} title={menu?.name} onClose={() => setMenu(null)} actions={menu ? [{ label: "I have this at home (add to pantry)", icon: "check" as const, onPress: () => toPantry.mutate(menu) }] : []} />
    </Screen>
  );
}
