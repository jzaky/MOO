import { NUTRIENT_KEYS, isKnown, type NutrientValues } from "./nutrients";

/**
 * UAE and wider Gulf / Levant dishes as standard recipes. Each dish is a list
 * of USDA FoodData Central ingredients (public domain) in grams for one
 * typical serving; nutrition is computed from those records, never typed in.
 * Recipes vary by cook and restaurant, so every dish is labelled an estimate
 * and shows its ingredients. Where USDA lacks the exact ingredient the
 * closest one is used and named in `substitutions`.
 */

export interface StandardDishIngredient {
  /** USDA FoodData Central id (SR Legacy). */
  fdcId: string;
  grams: number;
  label: string;
}

export interface StandardDish {
  slug: string;
  name: string;
  nameAr: string;
  serving: string;
  ingredients: readonly StandardDishIngredient[];
  /** Weight of the finished serving when cooking removes water (frying, baking). Omitted when ingredients are already cooked. */
  cookedG?: number;
  substitutions?: readonly string[];
}

const I = (fdcId: string, grams: number, label: string): StandardDishIngredient => ({ fdcId, grams, label });

// USDA SR Legacy ids used below.
const F = {
  chickenThigh: "172388", // Chicken, thigh, meat only, cooked, roasted
  chickenBreast: "171477", // Chicken, breast, meat only, cooked, roasted
  lambShoulder: "172497", // Lamb, shoulder, whole, lean and fat, cooked, braised
  riceParboiled: "169708", // Rice, white, long-grain, parboiled, cooked
  pita: "174915", // Bread, pita, white, enriched
  falafel: "172455", // Falafel, home-prepared
  oliveOil: "171413",
  canolaOil: "172336",
  ghee: "173412", // Butter oil, anhydrous
  butter: "173430", // Butter, without salt
  garlic: "169230",
  pickles: "168558",
  tomato: "170457",
  tomatoCanned: "170051", // canned, packed in tomato juice
  onionRaw: "170000",
  onionCooked: "170001",
  lettuce: "169247", // romaine
  cucumber: "168409",
  radish: "169276",
  parsley: "170416",
  bulgur: "170287", // cooked
  lemon: "167747", // juice
  eggplant: "169229", // cooked, boiled, without salt
  tahini: "170189",
  yogurt: "171284", // plain, whole milk
  greekYogurt: "171304", // Greek, plain, whole milk
  fava: "173753", // cooked, boiled, without salt
  egg: "171287", // whole, raw
  eggFried: "173423",
  greenPepper: "170427",
  thyme: "170938", // dried
  sesame: "170150",
  mozzarella: "170845", // whole milk
  evaporatedMilk: "172194",
  sugar: "169655",
  flour: "168894", // all-purpose, enriched
  honey: "169640",
  pasta: "169737", // cooked, enriched, without added salt
  lentils: "172421", // cooked, boiled, without salt
  carrot: "170393",
  grouper: "171963", // cooked, dry heat
  coffee: "171890", // brewed, tap water
  water: "173647", // tap, drinking
  cardamom: "170919",
  cumin: "170923",
  phyllo: "172791",
  fries: "170118", // frozen, oven-heated
} as const;

export const STANDARD_DISHES: readonly StandardDish[] = [
  {
    slug: "chicken-shawarma-wrap",
    name: "Chicken shawarma wrap",
    nameAr: "شاورما دجاج",
    serving: "1 wrap",
    ingredients: [I(F.chickenThigh, 100, "Chicken thigh, roasted"), I(F.pita, 60, "Flatbread"), I(F.canolaOil, 12, "Garlic sauce (oil)"), I(F.garlic, 5, "Garlic sauce (garlic)"), I(F.pickles, 20, "Pickles"), I(F.tomato, 15, "Tomato"), I(F.fries, 25, "Fries")],
    substitutions: ["Markook/Arabic bread as USDA white pita", "Toum (garlic sauce) as oil + garlic"],
  },
  {
    slug: "falafel-wrap",
    name: "Falafel wrap",
    nameAr: "ساندويش فلافل",
    serving: "1 wrap",
    ingredients: [I(F.falafel, 70, "Falafel, 4 pieces"), I(F.pita, 60, "Flatbread"), I(F.tahini, 15, "Tahini"), I(F.lemon, 5, "Lemon juice"), I(F.water, 10, "Water (tarator)"), I(F.tomato, 20, "Tomato"), I(F.pickles, 15, "Pickles"), I(F.lettuce, 15, "Lettuce"), I(F.parsley, 5, "Parsley")],
  },
  {
    slug: "manakish-zaatar",
    name: "Manakish za'atar",
    nameAr: "مناقيش زعتر",
    serving: "1 piece",
    ingredients: [I(F.pita, 90, "Flatbread base"), I(F.oliveOil, 15, "Olive oil"), I(F.thyme, 5, "Za'atar (thyme)"), I(F.sesame, 4, "Sesame seeds")],
    substitutions: ["Manakish dough as USDA white pita", "Za'atar blend as dried thyme + sesame (sumac not in USDA)"],
  },
  {
    slug: "manakish-cheese",
    name: "Manakish cheese",
    nameAr: "مناقيش جبنة",
    serving: "1 piece",
    ingredients: [I(F.pita, 90, "Flatbread base"), I(F.mozzarella, 50, "White cheese"), I(F.oliveOil, 5, "Olive oil")],
    substitutions: ["Manakish dough as USDA white pita", "Akkawi cheese as whole-milk mozzarella"],
  },
  {
    slug: "chicken-machboos",
    name: "Chicken machboos",
    nameAr: "مجبوس دجاج",
    serving: "1 plate",
    ingredients: [I(F.riceParboiled, 250, "Rice, cooked"), I(F.chickenThigh, 150, "Chicken, cooked, no bone"), I(F.onionCooked, 40, "Onion"), I(F.tomato, 30, "Tomato"), I(F.ghee, 10, "Ghee"), I(F.canolaOil, 5, "Oil")],
  },
  {
    slug: "lamb-mandi",
    name: "Lamb mandi",
    nameAr: "مندي لحم",
    serving: "1 plate",
    ingredients: [I(F.riceParboiled, 250, "Rice, cooked"), I(F.lambShoulder, 150, "Lamb shoulder, cooked, no bone"), I(F.onionCooked, 20, "Onion"), I(F.canolaOil, 8, "Oil")],
  },
  {
    slug: "chicken-biryani",
    name: "Chicken biryani",
    nameAr: "برياني دجاج",
    serving: "1 plate",
    ingredients: [I(F.riceParboiled, 220, "Rice, cooked"), I(F.chickenThigh, 120, "Chicken, cooked, no bone"), I(F.yogurt, 30, "Yogurt"), I(F.onionCooked, 30, "Fried onion"), I(F.canolaOil, 12, "Oil"), I(F.ghee, 5, "Ghee"), I(F.tomato, 30, "Tomato")],
  },
  {
    slug: "karak-chai",
    name: "Karak chai",
    nameAr: "شاي كرك",
    serving: "1 cup",
    ingredients: [I(F.water, 150, "Brewed tea"), I(F.evaporatedMilk, 50, "Evaporated milk"), I(F.sugar, 12, "Sugar"), I(F.cardamom, 0.5, "Cardamom")],
    substitutions: ["Brewed black tea counted as water (about 2 kcal per cup)"],
  },
  {
    slug: "luqaimat",
    name: "Luqaimat",
    nameAr: "لقيمات",
    serving: "5 pieces",
    ingredients: [I(F.flour, 40, "Flour"), I(F.water, 30, "Water"), I(F.canolaOil, 12, "Frying oil absorbed"), I(F.honey, 15, "Date syrup")],
    cookedG: 80,
    substitutions: ["Date syrup (dibs) as honey", "Oil absorbed in frying is an estimate"],
  },
  {
    slug: "harees",
    name: "Harees",
    nameAr: "هريس",
    serving: "1 bowl",
    ingredients: [I(F.bulgur, 200, "Wheat, cooked"), I(F.chickenBreast, 60, "Chicken, cooked"), I(F.ghee, 10, "Ghee")],
    substitutions: ["Whole wheat (jareesh) as cooked bulgur"],
  },
  {
    slug: "balaleet",
    name: "Balaleet",
    nameAr: "بلاليط",
    serving: "1 plate",
    ingredients: [I(F.pasta, 150, "Vermicelli, cooked"), I(F.sugar, 15, "Sugar"), I(F.butter, 10, "Butter"), I(F.eggFried, 50, "Omelette"), I(F.cardamom, 0.5, "Cardamom")],
    substitutions: ["Wheat vermicelli as USDA cooked pasta"],
  },
  {
    slug: "fattoush",
    name: "Fattoush",
    nameAr: "فتوش",
    serving: "1 bowl",
    ingredients: [I(F.lettuce, 80, "Lettuce"), I(F.tomato, 60, "Tomato"), I(F.cucumber, 50, "Cucumber"), I(F.radish, 15, "Radish"), I(F.parsley, 10, "Parsley"), I(F.onionRaw, 10, "Onion"), I(F.pita, 20, "Toasted bread"), I(F.oliveOil, 15, "Olive oil"), I(F.lemon, 10, "Lemon juice")],
  },
  {
    slug: "tabbouleh",
    name: "Tabbouleh",
    nameAr: "تبولة",
    serving: "1 bowl",
    ingredients: [I(F.parsley, 60, "Parsley"), I(F.bulgur, 30, "Bulgur, cooked"), I(F.tomato, 50, "Tomato"), I(F.onionRaw, 10, "Onion"), I(F.oliveOil, 15, "Olive oil"), I(F.lemon, 15, "Lemon juice")],
  },
  {
    slug: "mutabbal",
    name: "Mutabbal",
    nameAr: "متبل",
    serving: "1 small plate",
    ingredients: [I(F.eggplant, 70, "Eggplant, cooked"), I(F.tahini, 12, "Tahini"), I(F.yogurt, 10, "Yogurt"), I(F.lemon, 5, "Lemon juice"), I(F.garlic, 2, "Garlic"), I(F.oliveOil, 5, "Olive oil")],
  },
  {
    slug: "shish-tawook",
    name: "Shish tawook",
    nameAr: "شيش طاووق",
    serving: "2 skewers",
    ingredients: [I(F.chickenBreast, 150, "Chicken breast, grilled"), I(F.yogurt, 15, "Yogurt marinade"), I(F.oliveOil, 8, "Olive oil"), I(F.lemon, 5, "Lemon juice"), I(F.garlic, 3, "Garlic")],
  },
  {
    slug: "foul-medames",
    name: "Foul medames",
    nameAr: "فول مدمس",
    serving: "1 bowl",
    ingredients: [I(F.fava, 200, "Fava beans, cooked"), I(F.oliveOil, 15, "Olive oil"), I(F.lemon, 10, "Lemon juice"), I(F.garlic, 3, "Garlic"), I(F.cumin, 1, "Cumin"), I(F.tomato, 20, "Tomato")],
  },
  {
    slug: "shakshuka",
    name: "Shakshuka",
    nameAr: "شكشوكة",
    serving: "1 pan (2 eggs)",
    ingredients: [I(F.egg, 100, "Eggs"), I(F.tomatoCanned, 150, "Tomatoes"), I(F.onionCooked, 40, "Onion"), I(F.greenPepper, 40, "Green pepper"), I(F.oliveOil, 15, "Olive oil")],
  },
  {
    slug: "labneh",
    name: "Labneh with olive oil",
    nameAr: "لبنة بزيت الزيتون",
    serving: "1 small plate",
    ingredients: [I(F.greekYogurt, 100, "Labneh"), I(F.oliveOil, 10, "Olive oil")],
    substitutions: ["Labneh as USDA whole-milk Greek yogurt (labneh is often strained further and richer)"],
  },
  {
    slug: "shorbat-adas",
    name: "Lentil soup",
    nameAr: "شوربة عدس",
    serving: "1 bowl",
    ingredients: [I(F.lentils, 150, "Lentils, cooked"), I(F.water, 100, "Water"), I(F.onionCooked, 30, "Onion"), I(F.carrot, 30, "Carrot"), I(F.canolaOil, 8, "Oil"), I(F.lemon, 5, "Lemon juice"), I(F.cumin, 1, "Cumin")],
  },
  {
    slug: "grilled-hammour",
    name: "Grilled hammour",
    nameAr: "هامور مشوي",
    serving: "1 fillet",
    ingredients: [I(F.grouper, 170, "Hammour (grouper), grilled"), I(F.oliveOil, 8, "Olive oil"), I(F.lemon, 5, "Lemon juice")],
  },
  {
    slug: "kunafa",
    name: "Kunafa",
    nameAr: "كنافة",
    serving: "1 piece",
    ingredients: [I(F.phyllo, 35, "Pastry"), I(F.mozzarella, 40, "Cheese"), I(F.butter, 15, "Butter"), I(F.sugar, 20, "Sugar syrup (sugar)"), I(F.water, 15, "Sugar syrup (water)")],
    substitutions: ["Kataifi as USDA phyllo dough", "Nabulsi/akkawi cheese as whole-milk mozzarella"],
  },
  {
    slug: "chebab",
    name: "Chebab (Emirati pancakes)",
    nameAr: "جباب",
    serving: "2 pancakes",
    ingredients: [I(F.flour, 40, "Flour"), I(F.egg, 15, "Egg"), I(F.evaporatedMilk, 10, "Milk"), I(F.sugar, 8, "Sugar"), I(F.water, 30, "Water"), I(F.butter, 5, "Butter"), I(F.cardamom, 0.3, "Cardamom")],
    cookedG: 90,
  },
  {
    slug: "gahwa",
    name: "Arabic coffee (gahwa)",
    nameAr: "قهوة عربية",
    serving: "1 finjan",
    ingredients: [I(F.coffee, 30, "Coffee, brewed"), I(F.cardamom, 0.3, "Cardamom")],
  },
];

export interface ComposedDish {
  per100: NutrientValues;
  servingG: number;
  rawG: number;
  /** fdcIds that were not available; the dish can't be composed without them. */
  missing: string[];
}

/**
 * Nutrition per 100 g of the finished dish from its ingredients' per-100 g
 * USDA values. A nutrient is reported only when every ingredient has a value
 * for it; otherwise it stays unknown rather than undercounted.
 */
export function composeDish(dish: StandardDish, per100ByFdcId: ReadonlyMap<string, NutrientValues>): ComposedDish {
  const missing = [...new Set(dish.ingredients.filter((i) => !per100ByFdcId.has(i.fdcId)).map((i) => i.fdcId))];
  const rawG = dish.ingredients.reduce((a, i) => a + i.grams, 0);
  const servingG = dish.cookedG ?? rawG;
  if (missing.length) return { per100: {}, servingG, rawG, missing };
  const per100: NutrientValues = {};
  for (const key of NUTRIENT_KEYS) {
    let total = 0;
    let complete = true;
    for (const ing of dish.ingredients) {
      const v = per100ByFdcId.get(ing.fdcId)![key];
      if (!isKnown(v)) {
        complete = false;
        break;
      }
      total += (v * ing.grams) / 100;
    }
    if (complete) per100[key] = Math.round(((total * 100) / servingG) * 100) / 100;
  }
  return { per100, servingG, rawG, missing };
}
