import type { PortionDto } from "@stoke/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { FoodPicker, MEALS } from "../../features/foods/FoodPicker";
import { describePortion, portionForSwap, previewNutrition, rowForFood, rowsFromDraft, rowsFromRecipe, toRecipeBody, withQuantity, type IngredientRow } from "../../features/recipes/editor";
import { api, ApiError } from "../../lib/api";
import { qk } from "../../lib/data";
import { haptic } from "../../lib/haptics";
import { queryClient } from "../../lib/query";
import type { Food, Recipe, RecipeDraft } from "../../lib/types";
import { useTheme } from "../../theme/theme";
import { Badge, Button, Card, Chip, ErrorState, Field, IconButton, Row, SectionHeader, Segmented, Skeleton, Stack, T } from "../../ui/primitives";
import { Screen } from "../../ui/Screen";

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");
const num = (s: string) => Number(s.replace(",", "."));

function IngredientCard({ row, onChange, onRemove }: { row: IngredientRow; onChange: (r: IngredientRow) => void; onRemove: () => void }) {
  const th = useTheme();
  const [picking, setPicking] = useState(false);
  const [qty, setQty] = useState(row.portion ? String(row.portion.quantity) : "");
  useEffect(() => setQty(row.portion ? String(row.portion.quantity) : ""), [row.portion]);
  const swap = (food: Food, suggested: PortionDto | null) => {
    onChange({ ...row, food, portion: portionForSwap(food, row.portion, suggested) });
    setPicking(false);
    haptic("selection");
  };
  return (
    <Card style={!row.food ? { borderColor: th.c.warning } : undefined}>
      <Stack gap={8}>
        <Row justify="space-between" align="flex-start">
          <T variant="body" style={{ flex: 1 }}>{row.rawText}</T>
          <IconButton icon="close" label={`Remove ${row.rawText}`} onPress={onRemove} size={30} />
        </Row>
        {row.food ? (
          <>
            <Row gap={8}>
              <Badge label="matched" tone="accent" />
              <T variant="footnote" color="textSecondary" style={{ flex: 1 }} numberOfLines={2}>{row.food.name}</T>
            </Row>
            <Row gap={8}>
              <View style={{ width: 110 }}>
                <Field
                  value={qty}
                  onChangeText={setQty}
                  onEndEditing={() => num(qty) > 0 && onChange(withQuantity(row, num(qty)))}
                  onBlur={() => num(qty) > 0 && onChange(withQuantity(row, num(qty)))}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Amount of ${row.rawText}`}
                  suffix={row.portion ? (row.portion.kind === "amount" ? row.portion.unit : "×") : row.food.baseUnit}
                  placeholder="amount"
                />
              </View>
              <T variant="footnote" color={row.portion ? "textTertiary" : "warning"} style={{ flex: 1 }}>{row.portion ? describePortion(row) : `Enter the amount in ${row.food.baseUnit}; "${row.rawText}" can't be converted automatically.`}</T>
            </Row>
          </>
        ) : (
          <T variant="footnote" color="warning">{row.candidates.length ? "Not sure about a match. Pick one below or search; it isn't counted until you do." : "Not matched. It will not be counted until you pick a food."}</T>
        )}
        {(row.candidates.length > 1 || (row.candidates.length === 1 && !row.food)) && !picking ? (
          <Row gap={6} wrap>
            {row.candidates.map((c) => <Chip key={c.food.id} label={c.food.name.length > 30 ? `${c.food.name.slice(0, 28)}…` : c.food.name} selected={row.food?.id === c.food.id} onPress={() => swap(c.food, c.portion)} />)}
          </Row>
        ) : null}
        {picking ? (
          <FoodPicker initialQuery={row.rawText.replace(/^[\d\s.,/½¼¾⅓⅔-]+(g|kg|ml|l|cups?|tbsp|tsp|oz|lb)?\s+/i, "")} onPick={(f) => swap(f, null)} onCancel={() => setPicking(false)} />
        ) : (
          <Button title={row.food ? "Change food" : "Find food"} kind="ghost" size="sm" icon="search" onPress={() => setPicking(true)} />
        )}
      </Stack>
    </Card>
  );
}

export default function RecipeEditor() {
  const th = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;
  const existing = useQuery({ queryKey: qk.recipe(id ?? ""), queryFn: () => api<Recipe>(`/v1/recipes/${id}`), enabled: editing });
  const [source, setSource] = useState<"text" | "url">("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [servings, setServings] = useState("4");
  const [yieldG, setYieldG] = useState("");
  const [instructions, setInstructions] = useState("");
  const [meals, setMeals] = useState<string[]>([]);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [rows, setRows] = useState<IngredientRow[] | null>(null);
  const [adding, setAdding] = useState(false);

  // Editing: load the recipe and the foods its ingredients point at.
  useEffect(() => {
    const r = existing.data;
    if (!r || rows) return;
    void (async () => {
      const ids = [...new Set(r.ingredients.flatMap((g) => (g.foodId ? [g.foodId] : [])))];
      const foods = new Map((await Promise.all(ids.map((fid) => api<Food>(`/v1/foods/${fid}`).catch(() => null)))).filter((f): f is Food => !!f).map((f) => [f.id, f]));
      setName(r.name);
      setServings(String(r.servings));
      setYieldG(r.cookedYieldG ? String(Math.round(r.cookedYieldG)) : "");
      setInstructions(r.instructions ?? "");
      setMeals(r.meals ?? []);
      setSourceUrl(r.sourceUrl);
      setRows(rowsFromRecipe(r, foods));
    })();
  }, [existing.data, rows]);

  const draft = useMutation({
    mutationFn: () => api<RecipeDraft>("/v1/recipes/draft", { body: source === "url" ? { url: url.trim() } : { text, ...(name.trim() ? { name: name.trim() } : {}), servings: num(servings) || 1 } }),
    onSuccess: (d) => {
      if (source === "url" || !name.trim()) setName(d.name);
      if (source === "url") setServings(String(d.servings));
      setInstructions(d.instructions.join("\n"));
      setSourceUrl(d.sourceUrl);
      setRows(rowsFromDraft(d));
      haptic("success");
    },
  });

  const s = num(servings);
  const y = yieldG ? num(yieldG) : null;
  const preview = useMemo(() => (rows ? previewNutrition(rows, s, y && y > 0 ? y : null) : null), [rows, s, y]);
  const valid = !!name.trim() && s > 0 && s <= 100 && !!rows?.length && (y === null || y > 0);

  const save = useMutation({
    mutationFn: () => {
      const body = toRecipeBody({ name, servings: s, cookedYieldG: y, instructions, sourceUrl, meals, rows: rows ?? [] });
      return editing ? api<Recipe>(`/v1/recipes/${id}`, { method: "PUT", body }) : api<Recipe>("/v1/recipes", { body });
    },
    onSuccess: (r) => {
      haptic("success");
      queryClient.setQueryData(qk.recipe(r.id), r);
      void queryClient.invalidateQueries({ queryKey: qk.recipes });
      if (editing) router.back();
      else router.replace({ pathname: "/recipes/[id]", params: { id: r.id } });
    },
  });

  if (editing && (existing.isPending || (!rows && !existing.isError))) return <Screen close title="Edit recipe"><Skeleton height={60} /><Skeleton height={160} /></Screen>;
  if (editing && existing.isError) return <Screen close title="Edit recipe"><Card><ErrorState error={existing.error} onRetry={() => void existing.refetch()} /></Card></Screen>;

  return (
    <Screen
      close
      title={editing ? "Edit recipe" : "New recipe"}
      footer={rows ? <Stack gap={6}>{save.error ? <T variant="footnote" color="danger">{errText(save.error)}</T> : null}<Button title="Save recipe" disabled={!valid} loading={save.isPending} onPress={() => save.mutate()} /></Stack> : undefined}
    >
      {!rows ? (
        <>
          <Segmented options={[{ value: "text", label: "Paste ingredients" }, { value: "url", label: "From a link" }]} value={source} onChange={setSource} />
          {source === "text" ? (
            <>
              <Field label="Name" value={name} onChangeText={setName} placeholder="Chicken & rice bowls" />
              <Field label="Servings" value={servings} onChangeText={setServings} keyboardType="decimal-pad" />
              <Field label="Ingredients, one per line" value={text} onChangeText={setText} multiline numberOfLines={8} style={{ minHeight: 160, textAlignVertical: "top" }} placeholder={"500 g chicken breast\n300 g basmati rice\n1 tbsp olive oil\n2 cups broccoli"} />
            </>
          ) : (
            <Field label="Recipe page URL" value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" placeholder="https://…" />
          )}
          {draft.error ? <T variant="footnote" color="danger">{errText(draft.error)}</T> : null}
          <Button title="Match ingredients" icon="search" loading={draft.isPending} disabled={source === "text" ? !text.trim() : !/^https?:\/\/\S+\.\S+/.test(url.trim())} onPress={() => draft.mutate()} />
          <Button title="Start from scratch" kind="ghost" size="sm" onPress={() => setRows([])} />
          <T variant="caption" color="textTertiary">Each line is matched to the food database and you review every match before saving. Pages are read for structured recipe data only.</T>
        </>
      ) : (
        <>
          <Field label="Name" value={name} onChangeText={setName} />
          <Row gap={8}>
            <View style={{ flex: 1 }}><Field label="Servings" value={servings} onChangeText={setServings} keyboardType="decimal-pad" error={s > 0 ? null : "Enter a number"} /></View>
            <View style={{ flex: 1 }}><Field label="Cooked weight" value={yieldG} onChangeText={setYieldG} keyboardType="decimal-pad" suffix="g" placeholder="optional" /></View>
          </Row>
          <Card style={{ backgroundColor: th.c.surfaceRaised }}>
            {preview ? (
              <Stack gap={4}>
                <Row justify="space-between">
                  <T variant="headline">{preview.perServing.energyKcal ?? "–"} kcal per serving</T>
                  {preview.notCounted.length ? <Badge label={`${preview.notCounted.length} not counted`} tone="warning" /> : <Badge label="all counted" tone="accent" />}
                </Row>
                <T variant="footnote" color="textSecondary">Protein {preview.perServing.proteinG ?? "–"} g · Carbs {preview.perServing.carbsG ?? "–"} g · Fat {preview.perServing.fatG ?? "–"} g</T>
              </Stack>
            ) : <T variant="footnote" color="textSecondary">Enter the number of servings to see nutrition.</T>}
          </Card>

          <SectionHeader title={`Ingredients (${rows.length})`} action={adding ? undefined : "Add"} onAction={() => setAdding(true)} />
          {adding ? <Card><FoodPicker label="Add an ingredient" onPick={(f) => { setRows((rs) => [...(rs ?? []), rowForFood(f)]); setAdding(false); }} onCancel={() => setAdding(false)} /></Card> : null}
          {rows.length === 0 && !adding ? <T variant="footnote" color="textSecondary">Add at least one ingredient.</T> : null}
          {rows.map((r) => (
            <IngredientCard key={r.key} row={r} onChange={(nr) => setRows((rs) => rs!.map((x) => (x.key === r.key ? nr : x)))} onRemove={() => setRows((rs) => rs!.filter((x) => x.key !== r.key))} />
          ))}

          <SectionHeader title="Good for" />
          <Row gap={8} wrap>
            {MEALS.map((m) => <Chip key={m.value} label={m.label} selected={meals.includes(m.value)} onPress={() => setMeals((ms) => (ms.includes(m.value) ? ms.filter((x) => x !== m.value) : [...ms, m.value]))} />)}
          </Row>
          <T variant="caption" color="textTertiary">Meal plans only schedule this recipe at the meals you pick. None picked means any meal.</T>

          <SectionHeader title="Method" />
          <Field value={instructions} onChangeText={setInstructions} multiline numberOfLines={6} style={{ minHeight: 120, textAlignVertical: "top" }} placeholder="Optional" />
        </>
      )}
    </Screen>
  );
}
