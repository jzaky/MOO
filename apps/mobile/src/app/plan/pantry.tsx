import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { FoodPicker } from "../../features/foods/FoodPicker";
import { api, ApiError } from "../../lib/api";
import { qk } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { queryClient } from "../../lib/query";
import type { Food, PantryItem } from "../../lib/types";
import { Button, Card, Divider, EmptyState, ErrorState, Field, IconButton, ListRow, Row, Skeleton, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

export default function Pantry() {
  const pantry = useQuery({ queryKey: qk.pantry, queryFn: async () => (await api<{ items: PantryItem[] }>("/v1/pantry")).items });
  const [adding, setAdding] = useState(false);
  const [food, setFood] = useState<Food | null>(null);
  const [qty, setQty] = useState("");
  const q = Number(qty.replace(",", "."));

  const save = useMutation({
    // Keyed by food id so grocery lists (which are keyed the same way) subtract it.
    mutationFn: () => api<PantryItem>("/v1/pantry", { method: "PUT", body: { key: food!.id, name: food!.name, quantity: q, unit: food!.baseUnit } }),
    onSuccess: () => {
      haptic("success");
      setFood(null);
      setQty("");
      setAdding(false);
      void queryClient.invalidateQueries({ queryKey: qk.pantry });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/v1/pantry/${id}`, { method: "DELETE" }),
    onMutate: (id) => queryClient.setQueryData<PantryItem[]>(qk.pantry, (old) => (old ?? []).filter((p) => p.id !== id)),
    onError: () => void pantry.refetch(),
  });

  return (
    <Screen back title="Pantry" subtitle="What you already have at home" right={!adding ? <Button title="Add" size="sm" icon="add" onPress={() => setAdding(true)} /> : undefined}>
      {adding ? (
        <Card>
          {!food ? (
            <FoodPicker label="Which food?" onPick={setFood} onCancel={() => setAdding(false)} />
          ) : (
            <Stack gap={10}>
              <T variant="headline">{food.name}</T>
              <Field label="How much do you have?" value={qty} onChangeText={setQty} keyboardType="decimal-pad" suffix={food.baseUnit} autoFocus />
              {save.error ? <T variant="footnote" color="danger">{save.error instanceof ApiError ? save.error.message : "Could not save"}</T> : null}
              <Row gap={8}>
                <Button title="Back" kind="secondary" size="md" onPress={() => setFood(null)} style={{ flex: 1 }} />
                <Button title="Save" size="md" disabled={!(q >= 0) || qty === ""} loading={save.isPending} onPress={() => save.mutate()} style={{ flex: 1.4 }} />
              </Row>
            </Stack>
          )}
        </Card>
      ) : null}
      {pantry.isPending ? (
        <Card><Skeleton /></Card>
      ) : pantry.isError ? (
        <Card><ErrorState error={pantry.error} onRetry={() => void pantry.refetch()} /></Card>
      ) : pantry.data.length ? (
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {pantry.data.map((p, i) => (
            <View key={p.id}>
              {i ? <Divider /> : null}
              <ListRow title={p.name} subtitle={`${Math.round(p.quantity)} ${p.unit}`} right={<IconButton icon="trash" label={`Remove ${p.name}`} onPress={() => remove.mutate(p.id)} size={34} />} />
            </View>
          ))}
        </Card>
      ) : !adding ? (
        <Card><EmptyState icon="cart" title="Pantry is empty" body="Add staples you keep at home. Grocery lists subtract them automatically." action="Add an item" onAction={() => setAdding(true)} /></Card>
      ) : null}
    </Screen>
  );
}
