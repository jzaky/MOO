import type { NutrientValues, ProgressionRecommendation, LoggedSet } from "@stoke/core";
import type { PortionDto, PrescriptionDto, ProfileDto } from "@stoke/contracts";

/** Response shapes of the API endpoints the app consumes. */

export interface Serving {
  id: string;
  label: string;
  baseAmount: number;
  source: string;
  isDefault: boolean;
  isPrivate: boolean;
}

export interface Food {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  source: string;
  sourceLicense: string | null;
  isPrivate: boolean;
  derivedFromFoodId: string | null;
  baseUnit: "g" | "ml";
  densityGPerMl: number | null;
  per100: NutrientValues;
  servings: Serving[];
  completeness: number;
  quality: { flags: string[]; energyConsistent?: boolean; servingConfidence?: string };
  imageUrl: string | null;
  lastVerifiedAt: string | null;
}

export interface FoodLog {
  id: string;
  day: string;
  loggedAt: string;
  meal: string;
  foodId: string | null;
  recipeId: string | null;
  description: string;
  portion: PortionDto | null;
  baseAmount: number | null;
  baseUnit: string | null;
  nutrients: NutrientValues;
  provenance: string;
  note: string | null;
  clientUpdatedAt: string;
  pending?: boolean;
}

export interface Targets {
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number | null;
  waterMl: number | null;
  basis: "estimated" | "adapted" | "manual";
}

export interface Diary {
  day: string;
  entries: FoodLog[];
  targets: Targets | null;
  water: { totalMl: number; targetMl: number | null; entries: { id: string; ml: number; loggedAt: string }[] };
  status: "complete" | "incomplete" | null;
}

export interface RecentFood {
  food: Food;
  lastPortion: PortionDto | null;
  lastMeal: string;
  uses: number;
}

export interface Profile extends Omit<ProfileDto, "dietary" | "training" | "lifestyle"> {
  dietary: ProfileDto["dietary"];
  training: ProfileDto["training"];
  lifestyle: ProfileDto["lifestyle"];
  aiConsent: { coachUsesHealthData: boolean; photoAnalysis: boolean; retainMealPhotos: boolean };
}

export interface Exercise {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string;
  category: string;
  movementPattern: string;
  mechanics: string;
  difficulty: string;
  loadProfile: string;
  unilateral: boolean;
  instructions: string[];
  cautions: string | null;
  alternatives: string[];
  isCustom: boolean;
  alternativeExercises?: Exercise[];
}

export interface ProgramDay {
  id: string;
  name: string;
  weekday: number | null;
  position: number;
  exercises: { id: string; exerciseId: string; exercise: Exercise; position: number; supersetGroup: number | null; prescription: PrescriptionDto; notes: string | null }[];
}

export interface Program {
  id: string;
  name: string;
  split: string;
  status: string;
  version: number;
  createdBy: string;
  notes: string | null;
  days: ProgramDay[];
  blockWeeks: number | null;
  blockStart: string | null;
  deloadWeekStart: string | null;
  block: { week: number; of: number; deload: boolean } | null;
  deloadThisWeek: boolean;
}

export interface StartWorkout {
  template: { id: string; name: string };
  day: string;
  readiness: "good" | "normal" | "poor";
  recoveryInsights: { id: string; message: string; severity: string }[];
  shortened: boolean;
  block: { week: number; of: number; deload: boolean } | null;
  deload: boolean;
  items: {
    templateExerciseId: string;
    exercise: Exercise;
    supersetGroup: number | null;
    prescription: PrescriptionDto;
    role: "main" | "secondary" | "accessory";
    previous: { day: string; sets: LoggedSet[] } | null;
    recommendation: ProgressionRecommendation;
  }[];
}

export interface WorkoutSummary {
  durationSec: number;
  exercises: number;
  workSets: number;
  totalReps: number;
  volumeKg: number;
  personalRecords: { exerciseId: string; exerciseName: string; kind: string; value: number; weightKg: number; reps: number; previous: number | null }[];
  nextTargets: (ProgressionRecommendation & { exerciseId: string; exerciseName: string })[];
  comparison: { exerciseId: string; exerciseName: string; e1rmKg: number | null; previousE1rmKg: number | null; previousDay: string | null }[];
  readiness: string;
  note: string;
}

export interface TodayOverview {
  day: string;
  profile: { displayName: string | null; unitSystem: "metric" | "imperial" };
  nutrition: { totals: { energyKcal: number; proteinG: number; carbsG: number; fatG: number }; targets: Targets | null; water: Diary["water"]; entryCount: number };
  workout: { program: { id: string; name: string }; scheduledToday: { id: string; name: string } | null; nextInRotation: { id: string; name: string } | null; lastSession: { id: string; name: string; day: string } | null } | null;
  recovery: { readiness: "good" | "normal" | "poor"; insights: { id: string; message: string; severity: string }[] };
  weight: { latest: { day: string; kg: number } | null; sevenDayAverageKg: number | null; rate: { kgPerWeek: number | null; sufficiency: "insufficient" | "limited" | "good" } };
  insights: { id: string; text: string; kind: "observed" | "calculated" | "suggestion" }[];
  pendingRecommendations: { id: string; kind: string; title: string }[];
}

export interface WeightOverview {
  latest: { day: string; kg: number } | null;
  sevenDayAverageKg: number | null;
  trend: { day: string; scaleKg: number; trendKg: number }[];
  rate: { kgPerWeek: number | null; pctPerWeek: number | null; sufficiency: "insufficient" | "limited" | "good"; latestTrendKg: number | null; readings: number };
  goal: { kind: string; targetWeightKg: number | null } | null;
  progress: { fraction: number; weeksRemaining: number | null } | null;
  interpretation: string;
}

export interface Recommendation {
  id: string;
  kind: string;
  status: string;
  title: string;
  rationale: string;
  payload: Record<string, unknown>;
  evidence: Record<string, unknown>;
  source: string;
  createdAt: string;
  actions: { action: string; before: unknown; after: unknown; createdAt: string }[];
}

export interface RecipeSummary {
  id: string;
  name: string;
  servings: number;
  foodId: string | null;
  perServing: NutrientValues;
  missingIngredientCount: number;
}

export interface Recipe extends RecipeSummary {
  meals: string[];
  cookedYieldG: number | null;
  instructions: string | null;
  sourceUrl: string | null;
  servingId: string | null;
  total: NutrientValues;
  ingredients: { id: string; foodId: string | null; rawText: string; portion: PortionDto | null; baseAmount: number | null }[];
}

export interface RecipeDraft {
  name: string;
  servings: number;
  sourceUrl: string | null;
  instructions: string[];
  ingredients: {
    rawText: string;
    parsed: { quantity: number; name: string; quantityAssumed: boolean } | null;
    candidates: { food: Food; portion: PortionDto | null }[];
    /** Best-ranked food; portion is null when the amount needs the user's input. */
    suggestion: { foodId: string; portion: PortionDto | null } | null;
  }[];
  note: string;
}

export interface MealPlanItem {
  id: string;
  day: string;
  meal: string;
  recipeId: string | null;
  savedMealId: string | null;
  servings: number;
  name: string;
  energyKcal: number | null;
  proteinG: number | null;
}

export interface MealPlan {
  id: string;
  startDay: string;
  days: number;
  status: string;
  items: MealPlanItem[];
  note?: string;
}

export interface GroceryItem {
  id: string;
  key: string;
  name: string;
  quantity: number;
  unit: string;
  category: string;
  checked: boolean;
}

export interface GroceryList {
  id: string;
  name: string;
  items: GroceryItem[];
}

export interface PantryItem {
  id: string;
  key: string;
  name: string;
  quantity: number;
  unit: string;
}

export interface MenuDish {
  name: string;
  description: string | null;
  basis: "printed" | "estimate";
  energyKcal: number | null;
  energyRangeKcal: { low: number; high: number } | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  unmatchedComponents: string[];
  fit: number | null;
}

export interface MenuResult {
  restaurant: string | null;
  remaining: { energyKcal: number; proteinG: number } | null;
  dishes: MenuDish[];
  disclaimer: string;
}
