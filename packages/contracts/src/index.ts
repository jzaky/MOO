import { z } from "zod";

/* ───────────── Shared primitives ───────────── */

export const DayKey = z.iso.date();
export const Instant = z.iso.datetime({ offset: true });
export const Id = z.uuid();
export const UnitSystem = z.enum(["metric", "imperial"]);

export const NutrientValuesSchema = z
  .object({
    energyKcal: z.number().nonnegative().nullable(),
    proteinG: z.number().nonnegative().nullable(),
    carbsG: z.number().nonnegative().nullable(),
    fatG: z.number().nonnegative().nullable(),
    fiberG: z.number().nonnegative().nullable(),
    sugarG: z.number().nonnegative().nullable(),
    addedSugarG: z.number().nonnegative().nullable(),
    saturatedFatG: z.number().nonnegative().nullable(),
    transFatG: z.number().nonnegative().nullable(),
    monounsaturatedFatG: z.number().nonnegative().nullable(),
    polyunsaturatedFatG: z.number().nonnegative().nullable(),
    cholesterolMg: z.number().nonnegative().nullable(),
    sodiumMg: z.number().nonnegative().nullable(),
    potassiumMg: z.number().nonnegative().nullable(),
    calciumMg: z.number().nonnegative().nullable(),
    ironMg: z.number().nonnegative().nullable(),
    magnesiumMg: z.number().nonnegative().nullable(),
    zincMg: z.number().nonnegative().nullable(),
    vitaminAUg: z.number().nonnegative().nullable(),
    vitaminCMg: z.number().nonnegative().nullable(),
    vitaminDUg: z.number().nonnegative().nullable(),
    vitaminB12Ug: z.number().nonnegative().nullable(),
    folateUg: z.number().nonnegative().nullable(),
    alcoholG: z.number().nonnegative().nullable(),
    caffeineMg: z.number().nonnegative().nullable(),
  })
  .partial()
  .strict();
export type NutrientValuesDto = z.infer<typeof NutrientValuesSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/* ───────────── Auth ───────────── */

export const Password = z.string().min(10, "Use at least 10 characters").max(256);
export const RegisterRequest = z.object({ email: z.email().max(254), password: Password });
export const LoginRequest = z.object({ email: z.email().max(254), password: z.string().min(1).max(256) });
export const RefreshRequest = z.object({ refreshToken: z.string().min(20).max(512) });
export const AuthTokens = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: Instant,
  refreshToken: z.string(),
  refreshTokenExpiresAt: Instant,
  user: z.object({ id: Id, email: z.string() }),
});
export type AuthTokens = z.infer<typeof AuthTokens>;

/* ───────────── Profile & onboarding ───────────── */

export const Sex = z.enum(["male", "female"]);
export const ActivityLevel = z.enum(["sedentary", "light", "moderate", "very", "extra"]);
export const GoalKind = z.enum(["lose_fat", "build_muscle", "maintain", "recomposition", "strength", "general_fitness", "endurance"]);
export const ExperienceLevel = z.enum(["new", "beginner", "intermediate", "advanced"]);
export const Equipment = z.enum([
  "barbell",
  "dumbbell",
  "kettlebell",
  "machine",
  "cable",
  "bodyweight",
  "band",
  "smith_machine",
  "pullup_bar",
  "bench",
  "cardio_machine",
]);

export const DietaryPreferences = z.object({
  pattern: z.enum(["omnivore", "vegetarian", "vegan", "pescatarian", "halal", "kosher", "keto", "other"]).default("omnivore"),
  restrictions: z.array(z.string().max(60)).max(30).default([]),
  allergies: z.array(z.string().max(60)).max(30).default([]),
  preferredFoods: z.array(z.string().max(80)).max(50).default([]),
  dislikedFoods: z.array(z.string().max(80)).max(50).default([]),
  mealsPerDay: z.number().int().min(1).max(8).default(3),
  cookingTimeMinutes: z.number().int().min(0).max(240).nullable().default(null),
  eatsOutPerWeek: z.number().int().min(0).max(21).nullable().default(null),
});

export const TrainingPreferences = z.object({
  experience: ExperienceLevel.default("beginner"),
  equipment: z.array(Equipment).max(20).default([]),
  gymAccess: z.enum(["commercial_gym", "home_gym", "minimal", "none"]).default("commercial_gym"),
  preferredDays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  sessionMinutes: z.number().int().min(10).max(240).default(60),
  currentRoutine: z.string().max(1000).nullable().default(null),
  likedExercises: z.array(z.string().max(80)).max(50).default([]),
  dislikedExercises: z.array(z.string().max(80)).max(50).default([]),
  limitations: z.string().max(1000).nullable().default(null),
});

export const Lifestyle = z.object({
  sleepStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
  sleepEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
  workSchedule: z.enum(["day", "night", "shift", "flexible", "other"]).nullable().default(null),
  recoveryPreferences: z.string().max(500).nullable().default(null),
});

export const ProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).nullable(),
  birthDate: DayKey.nullable(),
  sex: Sex.nullable(),
  heightCm: z.number().min(100).max(250).nullable(),
  unitSystem: UnitSystem,
  timeZone: z.string().min(1).max(64),
  country: z.string().length(2).toUpperCase().nullable(),
  activityLevel: ActivityLevel.nullable(),
  dietary: DietaryPreferences,
  training: TrainingPreferences,
  lifestyle: Lifestyle,
  onboardingCompletedAt: Instant.nullable(),
});
export type ProfileDto = z.infer<typeof ProfileSchema>;
export const ProfileUpdate = ProfileSchema.omit({ onboardingCompletedAt: true }).partial();
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

export const GoalInput = z.object({
  kind: GoalKind,
  priority: z.number().int().min(1).max(10),
  targetWeightKg: z.number().min(30).max(350).nullable().optional(),
  weeklyRatePct: z.number().min(-0.02).max(0.02).nullable().optional(),
  targetDate: DayKey.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});
export const SetGoalsRequest = z.object({ goals: z.array(GoalInput).min(1).max(5) });

export const OnboardingPlanRequest = z.object({
  sex: Sex,
  birthDate: DayKey,
  heightCm: z.number().min(100).max(250),
  weightKg: z.number().min(30).max(350),
  bodyFatPct: z.number().min(3).max(70).nullable().optional(),
  activityLevel: ActivityLevel,
  goals: z.array(GoalInput).min(1).max(5),
  training: TrainingPreferences.partial().optional(),
});
export type OnboardingPlanRequest = z.infer<typeof OnboardingPlanRequest>;

export const NutritionTargetsSchema = z.object({
  energyKcal: z.number().int().min(800).max(10000),
  proteinG: z.number().min(0).max(600),
  carbsG: z.number().min(0).max(1500),
  fatG: z.number().min(0).max(500),
  fiberG: z.number().min(0).max(150).nullable(),
  waterMl: z.number().int().min(0).max(10000).nullable().optional(),
});
export const ManualTargetsRequest = NutritionTargetsSchema.extend({ effectiveFrom: DayKey.optional(), note: z.string().max(300).optional() });

/* ───────────── Nutrition ───────────── */

export const MealSlot = z.string().trim().min(1).max(40);
export const MassOrVolumeUnit = z.enum(["mg", "g", "kg", "oz", "lb", "ml", "l", "tsp", "tbsp", "cup", "fl_oz"]);
export const PortionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("serving"), servingId: Id, quantity: z.number().positive().max(10000) }),
  z.object({ kind: z.literal("amount"), quantity: z.number().positive().max(100000), unit: MassOrVolumeUnit }),
]);
export type PortionDto = z.infer<typeof PortionSchema>;

export const Provenance = z.enum(["database", "label", "user", "ai_estimate", "recipe", "saved_meal", "import"]);

/** Idempotent upsert of a diary entry. The client generates the id. */
export const FoodLogUpsert = z
  .object({
    day: DayKey,
    loggedAt: Instant,
    meal: MealSlot,
    clientUpdatedAt: Instant,
    foodId: Id.nullable().optional(),
    recipeId: Id.nullable().optional(),
    portion: PortionSchema.nullable().optional(),
    /** Required when no foodId/recipeId: quick-add with explicit numbers. */
    description: z.string().trim().min(1).max(200).optional(),
    nutrients: NutrientValuesSchema.optional(),
    provenance: Provenance.optional(),
    recognitionId: Id.nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((v) => (v.foodId || v.recipeId ? !!v.portion : !!v.description && !!v.nutrients), {
    message: "Provide foodId/recipeId with a portion, or a description with nutrients for a quick add",
  });
export type FoodLogUpsert = z.infer<typeof FoodLogUpsert>;

export const WaterLogUpsert = z.object({ day: DayKey, loggedAt: Instant, ml: z.number().int().positive().max(5000), clientUpdatedAt: Instant });

export const CustomFoodCreate = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(120).nullable().optional(),
  barcode: z.string().regex(/^\d{8,14}$/).nullable().optional(),
  baseUnit: z.enum(["g", "ml"]),
  densityGPerMl: z.number().positive().max(5).nullable().optional(),
  per100: NutrientValuesSchema,
  servings: z.array(z.object({ label: z.string().trim().min(1).max(60), baseAmount: z.number().positive().max(10000) })).max(20).default([]),
  source: z.enum(["user", "label"]).default("user"),
});
export type CustomFoodCreate = z.infer<typeof CustomFoodCreate>;

export const SavedMealCreate = z.object({
  name: z.string().trim().min(1).max(120),
  defaultMeal: MealSlot.nullable().optional(),
  items: z.array(z.object({ foodId: Id, portion: PortionSchema })).min(1).max(40),
});

export const SavedMealLogRequest = z.object({ day: DayKey, meal: MealSlot, loggedAt: Instant, scale: z.number().positive().max(10).default(1), idPrefix: Id.optional() });

export const RecipeCreate = z.object({
  name: z.string().trim().min(1).max(200),
  servings: z.number().positive().max(100),
  cookedYieldG: z.number().positive().max(50000).nullable().optional(),
  instructions: z.string().max(20000).nullable().optional(),
  sourceUrl: z.url().max(2000).nullable().optional(),
  /** Meals this recipe suits; omitted or empty = any meal. */
  meals: z.array(z.enum(["breakfast", "lunch", "dinner", "snacks"])).max(4).optional(),
  ingredients: z
    .array(z.object({ foodId: Id.nullable(), rawText: z.string().max(300), portion: PortionSchema.nullable() }))
    .min(1)
    .max(100),
});
export type RecipeCreate = z.infer<typeof RecipeCreate>;

export const ParseLogRequest = z.object({ text: z.string().trim().min(1).max(1000), day: DayKey.optional() });

export const RecognitionConfirmRequest = z.object({
  day: DayKey,
  meal: MealSlot,
  loggedAt: Instant,
  items: z
    .array(
      z.object({
        id: Id,
        componentId: z.string().max(40).nullable(),
        foodId: Id,
        portion: PortionSchema,
      }),
    )
    .min(1)
    .max(30),
  keepImages: z.boolean().default(false),
});

/* ───────────── Training ───────────── */

export const SetKind = z.enum(["warmup", "working", "drop", "failure", "backoff"]);
export const PrescriptionSchema = z.object({
  scheme: z.enum(["double_progression", "linear", "rpe_target"]),
  sets: z.number().int().min(1).max(15),
  repRange: z.object({ min: z.number().int().min(1).max(100), max: z.number().int().min(1).max(100) }),
  targetRir: z.number().min(0).max(6).nullable().optional(),
  restSec: z.number().int().min(0).max(900).default(120),
  allowShortfall: z.number().int().min(0).max(10).optional(),
  linearIncrementKg: z.number().positive().max(20).optional(),
  loadProfile: z.enum(["barbell", "dumbbell", "machine", "cable", "bodyweight"]).optional(),
});
export type PrescriptionDto = z.infer<typeof PrescriptionSchema>;

export const TemplateExerciseInput = z.object({
  exerciseId: Id,
  supersetGroup: z.number().int().min(1).max(20).nullable().optional(),
  prescription: PrescriptionSchema,
  notes: z.string().max(500).nullable().optional(),
});

export const ProgramCreate = z.object({
  name: z.string().trim().min(1).max(120),
  /** Training blocks: weeks per block, the last one a deload. null = off; omitted = keep the previous version's setting. */
  blockWeeks: z.number().int().min(3).max(8).nullable().optional(),
  split: z.enum(["push_pull_legs", "upper_lower", "full_body", "bro_split", "strength", "hybrid", "custom"]),
  notes: z.string().max(2000).nullable().optional(),
  days: z
    .array(z.object({ name: z.string().trim().min(1).max(80), weekday: z.number().int().min(1).max(7).nullable().optional(), exercises: z.array(TemplateExerciseInput).min(1).max(20) }))
    .min(1)
    .max(14),
});
export type ProgramCreate = z.infer<typeof ProgramCreate>;

export const WorkoutUpsert = z.object({
  templateId: Id.nullable().optional(),
  name: z.string().trim().min(1).max(120),
  day: DayKey,
  startedAt: Instant,
  endedAt: Instant.nullable().optional(),
  pausedSec: z.number().int().min(0).max(86400).default(0),
  status: z.enum(["active", "completed", "discarded"]),
  notes: z.string().max(2000).nullable().optional(),
  clientUpdatedAt: Instant,
  exercises: z
    .array(
      z.object({
        id: Id,
        exerciseId: Id,
        position: z.number().int().min(0).max(100),
        supersetGroup: z.number().int().min(1).max(20).nullable().optional(),
        prescription: PrescriptionSchema.nullable().optional(),
        notes: z.string().max(1000).nullable().optional(),
        sets: z
          .array(
            z.object({
              id: Id,
              position: z.number().int().min(0).max(100),
              kind: SetKind,
              weightKg: z.number().min(-200).max(1000),
              reps: z.number().int().min(0).max(1000),
              rir: z.number().min(0).max(10).nullable().optional(),
              rpe: z.number().min(1).max(10).nullable().optional(),
              assistedReps: z.number().int().min(0).max(100).nullable().optional(),
              completed: z.boolean(),
              completedAt: Instant.nullable().optional(),
              targetWeightKg: z.number().min(-200).max(1000).nullable().optional(),
              targetReps: z.number().int().min(0).max(1000).nullable().optional(),
              originalUnit: z.enum(["kg", "lb"]).default("kg"),
              notes: z.string().max(500).nullable().optional(),
            }),
          )
          .max(50),
      }),
    )
    .max(40),
});
export type WorkoutUpsert = z.infer<typeof WorkoutUpsert>;

/* ───────────── Progress ───────────── */

export const MeasurementKind = z.string().regex(/^(weight|body_fat_pct|waist|chest|hips|neck|left_arm|right_arm|left_thigh|right_thigh|calf|custom:[a-z0-9_]{1,40})$/);
export const MeasurementUpsert = z.object({
  day: DayKey,
  measuredAt: Instant,
  kind: MeasurementKind,
  value: z.number().positive().max(1000),
  originalValue: z.number().positive().max(2000).optional(),
  originalUnit: z.enum(["kg", "lb", "cm", "in", "pct"]).optional(),
  clientUpdatedAt: Instant,
  note: z.string().max(300).nullable().optional(),
});

/* ───────────── Health ───────────── */

export const HealthObservationType = z.enum(["steps", "active_energy_kcal", "resting_hr", "hrv_sdnn_ms", "sleep_minutes", "walking_distance_m", "body_mass_kg", "workout_minutes"]);
export const HealthIngestRequest = z.object({
  provider: z.enum(["healthkit", "health_connect"]),
  observations: z
    .array(
      z.object({
        sourceRecordId: z.string().min(1).max(200),
        type: HealthObservationType,
        startAt: Instant,
        endAt: Instant,
        value: z.number().min(0).max(1e7),
        sourceName: z.string().max(120).optional(),
      }),
    )
    .max(2000),
});

export const CheckinUpsert = z.object({
  fatigue: z.number().int().min(1).max(5).nullable().optional(),
  soreness: z.number().int().min(1).max(5).nullable().optional(),
  stress: z.number().int().min(1).max(5).nullable().optional(),
  motivation: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

/* ───────────── Coach ───────────── */

export const CoachMessageRequest = z.object({ text: z.string().trim().min(1).max(4000) });
export const RecommendationDecision = z.object({ decision: z.enum(["accept", "reject"]), note: z.string().max(500).optional() });

export const NotificationPreferences = z.object({
  workoutReminders: z.boolean().default(true),
  mealReminders: z.boolean().default(false),
  hydrationReminders: z.boolean().default(false),
  weeklySummary: z.boolean().default(true),
  personalRecords: z.boolean().default(true),
  checkIns: z.boolean().default(true),
  quietStart: z.string().regex(/^\d{2}:\d{2}$/).default("22:00"),
  quietEnd: z.string().regex(/^\d{2}:\d{2}$/).default("07:00"),
});

export const AiDataConsent = z.object({ coachUsesHealthData: z.boolean(), photoAnalysis: z.boolean(), retainMealPhotos: z.boolean() });
