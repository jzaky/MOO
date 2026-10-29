import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Database schema. Conventions:
 *  - Every user-owned row has `user_id`; Row-Level Security (see the
 *    0001_rls migration) restricts the runtime role to rows where
 *    user_id = current_setting('app.user_id').
 *  - Rows written from devices use CLIENT-generated UUIDs so retries are
 *    idempotent, plus `client_updated_at` (LWW conflict resolution) and a
 *    server `version`.
 *  - Body weight/loads in kg, lengths in cm, food in g/ml, energy in kcal.
 *    Original user-entered units are kept where they matter.
 *  - Nutrient values are JSON objects whose missing keys / nulls mean UNKNOWN.
 *  - `deleted_at` soft-deletes user content so deletions can sync.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();
const day = (name = "day") => date(name, { mode: "string" });
const syncCols = () => ({
  clientUpdatedAt: ts("client_updated_at").notNull(),
  version: integer("version").notNull().default(1),
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
const userRef = () => uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" });

/* ───────────── Identity ───────────── */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  status: text("status").notNull().default("active"), // active | deletion_requested
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)]);

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  tokenHash: text("token_hash").notNull(),
  familyId: uuid("family_id").notNull(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  replacedBy: uuid("replaced_by"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("refresh_tokens_hash_uq").on(t.tokenHash), index("refresh_tokens_family_idx").on(t.familyId)]);

export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  birthDate: day("birth_date"),
  sex: text("sex"),
  heightCm: doublePrecision("height_cm"),
  unitSystem: text("unit_system").notNull().default("metric"),
  timeZone: text("time_zone").notNull().default("UTC"),
  country: text("country"),
  activityLevel: text("activity_level"),
  dietary: jsonb("dietary").notNull().default({}),
  training: jsonb("training").notNull().default({}),
  lifestyle: jsonb("lifestyle").notNull().default({}),
  aiConsent: jsonb("ai_consent").notNull().default({ coachUsesHealthData: false, photoAnalysis: false, retainMealPhotos: false }),
  onboardingCompletedAt: ts("onboarding_completed_at"),
  updatedAt: updatedAt(),
});

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  kind: text("kind").notNull(),
  priority: integer("priority").notNull(),
  targetWeightKg: doublePrecision("target_weight_kg"),
  weeklyRatePct: doublePrecision("weekly_rate_pct"),
  targetDate: day("target_date"),
  notes: text("notes"),
  status: text("status").notNull().default("active"), // active | achieved | archived
  createdAt: createdAt(),
  endedAt: ts("ended_at"),
}, (t) => [index("goals_user_idx").on(t.userId, t.status)]);

/** Versioned targets: a change inserts a new row; history is never rewritten. */
export const nutritionTargets = pgTable("nutrition_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  effectiveFrom: day("effective_from").notNull(),
  energyKcal: integer("energy_kcal").notNull(),
  proteinG: doublePrecision("protein_g").notNull(),
  carbsG: doublePrecision("carbs_g").notNull(),
  fatG: doublePrecision("fat_g").notNull(),
  fiberG: doublePrecision("fiber_g"),
  waterMl: integer("water_ml"),
  basis: text("basis").notNull(), // estimated | adapted | manual
  estimatedTdeeKcal: integer("estimated_tdee_kcal"),
  recommendationId: uuid("recommendation_id"),
  note: text("note"),
  createdAt: createdAt(),
}, (t) => [index("nutrition_targets_user_idx").on(t.userId, t.effectiveFrom)]);

/* ───────────── Foods ───────────── */

/**
 * Foods. owner_user_id NULL = shared catalogue (imported from a source);
 * otherwise private to the owner. User corrections never modify shared rows:
 * they create a private copy with derived_from_food_id set.
 */
export const foods = pgTable("foods", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
  source: text("source").notNull(), // off | usda | user | label | ai_label
  sourceRef: text("source_ref"),
  sourceLicense: text("source_license"),
  derivedFromFoodId: uuid("derived_from_food_id"),
  name: text("name").notNull(),
  brand: text("brand"),
  barcode: text("barcode"),
  baseUnit: text("base_unit").notNull(), // g | ml
  densityGPerMl: doublePrecision("density_g_per_ml"),
  per100: jsonb("per100").notNull(),
  completeness: doublePrecision("completeness").notNull(),
  quality: jsonb("quality").notNull().default({}),
  imageUrl: text("image_url"),
  countries: text("countries").array(),
  sourcePayload: jsonb("source_payload"),
  lastVerifiedAt: ts("last_verified_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("foods_source_ref_uq").on(t.source, t.sourceRef).where(sql`${t.ownerUserId} is null and ${t.sourceRef} is not null`),
  index("foods_barcode_idx").on(t.barcode),
  index("foods_owner_idx").on(t.ownerUserId),
  index("foods_search_trgm_idx").using("gin", sql`lower(${t.name} || ' ' || coalesce(${t.brand}, '')) gin_trgm_ops`),
]);

export const foodServings = pgTable("food_servings", {
  id: uuid("id").primaryKey().defaultRandom(),
  foodId: uuid("food_id").notNull().references(() => foods.id, { onDelete: "cascade" }),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  baseAmount: doublePrecision("base_amount").notNull(),
  source: text("source").notNull().default("database"),
  isDefault: boolean("is_default").notNull().default(false),
  position: integer("position").notNull().default(0),
}, (t) => [index("food_servings_food_idx").on(t.foodId)]);

export const foodFavorites = pgTable("food_favorites", {
  userId: userRef(),
  foodId: uuid("food_id").notNull().references(() => foods.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.foodId] })]);

/** Diary entries. `nutrients` is a SNAPSHOT so later food edits never change history. */
export const foodLogs = pgTable("food_logs", {
  id: uuid("id").primaryKey(),
  userId: userRef(),
  day: day().notNull(),
  loggedAt: ts("logged_at").notNull(),
  meal: text("meal").notNull(),
  foodId: uuid("food_id").references(() => foods.id, { onDelete: "set null" }),
  recipeId: uuid("recipe_id"),
  savedMealId: uuid("saved_meal_id"),
  recognitionId: uuid("recognition_id"),
  description: text("description").notNull(),
  portion: jsonb("portion"),
  baseAmount: doublePrecision("base_amount"),
  baseUnit: text("base_unit"),
  nutrients: jsonb("nutrients").notNull(),
  provenance: text("provenance").notNull(),
  note: text("note"),
  ...syncCols(),
}, (t) => [index("food_logs_user_day_idx").on(t.userId, t.day), index("food_logs_user_food_idx").on(t.userId, t.foodId)]);

export const waterLogs = pgTable("water_logs", {
  id: uuid("id").primaryKey(),
  userId: userRef(),
  day: day().notNull(),
  loggedAt: ts("logged_at").notNull(),
  ml: integer("ml").notNull(),
  ...syncCols(),
}, (t) => [index("water_logs_user_day_idx").on(t.userId, t.day)]);

/** Per-day logging status; "complete" days feed the adaptive engine. */
export const diaryDays = pgTable("diary_days", {
  userId: userRef(),
  day: day().notNull(),
  status: text("status").notNull(), // complete | incomplete
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.day] })]);

export const savedMeals = pgTable("saved_meals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  name: text("name").notNull(),
  defaultMeal: text("default_meal"),
  items: jsonb("items").notNull(),
  useCount: integer("use_count").notNull().default(0),
  lastUsedAt: ts("last_used_at"),
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("saved_meals_user_idx").on(t.userId)]);

export const recipes = pgTable("recipes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  name: text("name").notNull(),
  servings: doublePrecision("servings").notNull(),
  cookedYieldG: doublePrecision("cooked_yield_g"),
  instructions: text("instructions"),
  sourceUrl: text("source_url"),
  /** Private food row materialized from this recipe so it can be searched and logged like any food. */
  foodId: uuid("food_id").references(() => foods.id, { onDelete: "set null" }),
  nutritionTotal: jsonb("nutrition_total").notNull(),
  nutritionPerServing: jsonb("nutrition_per_serving").notNull(),
  missingIngredientCount: integer("missing_ingredient_count").notNull().default(0),
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("recipes_user_idx").on(t.userId)]);

export const recipeIngredients = pgTable("recipe_ingredients", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipeId: uuid("recipe_id").notNull().references(() => recipes.id, { onDelete: "cascade" }),
  userId: userRef(),
  position: integer("position").notNull(),
  foodId: uuid("food_id").references(() => foods.id, { onDelete: "set null" }),
  rawText: text("raw_text").notNull(),
  portion: jsonb("portion"),
  baseAmount: doublePrecision("base_amount"),
}, (t) => [index("recipe_ingredients_recipe_idx").on(t.recipeId)]);

/** AI food-photo / label analyses. Images are deleted after confirmation unless the user keeps them. */
export const foodRecognitions = pgTable("food_recognitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  kind: text("kind").notNull(), // meal_photo | nutrition_label | menu
  status: text("status").notNull(), // analyzed | confirmed | discarded | failed
  imageKeys: text("image_keys").array().notNull().default(sql`'{}'::text[]`),
  model: text("model"),
  result: jsonb("result"),
  error: text("error"),
  createdAt: createdAt(),
  confirmedAt: ts("confirmed_at"),
}, (t) => [index("food_recognitions_user_idx").on(t.userId, t.createdAt)]);

/* ───────────── Training ───────────── */

export const exercises = pgTable("exercises", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
  primaryMuscles: text("primary_muscles").array().notNull(),
  secondaryMuscles: text("secondary_muscles").array().notNull().default(sql`'{}'::text[]`),
  equipment: text("equipment").notNull(),
  category: text("category").notNull(), // strength | cardio | mobility
  movementPattern: text("movement_pattern").notNull(),
  mechanics: text("mechanics").notNull(), // compound | isolation
  difficulty: text("difficulty").notNull(),
  loadProfile: text("load_profile").notNull(),
  unilateral: boolean("unilateral").notNull().default(false),
  instructions: text("instructions").array().notNull().default(sql`'{}'::text[]`),
  cautions: text("cautions"),
  alternatives: text("alternatives").array().notNull().default(sql`'{}'::text[]`),
  media: jsonb("media").notNull().default([]),
  license: text("license").notNull().default("proprietary-original"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("exercises_global_slug_uq").on(t.slug).where(sql`${t.ownerUserId} is null`),
  index("exercises_owner_idx").on(t.ownerUserId),
]);

export const workoutPrograms = pgTable("workout_programs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  name: text("name").notNull(),
  split: text("split").notNull(),
  status: text("status").notNull().default("active"), // active | archived
  version: integer("version").notNull().default(1),
  parentProgramId: uuid("parent_program_id"),
  createdBy: text("created_by").notNull().default("user"), // user | ai | template
  changeReason: text("change_reason"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("workout_programs_user_idx").on(t.userId)]);

export const workoutTemplates = pgTable("workout_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  programId: uuid("program_id").references(() => workoutPrograms.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  weekday: integer("weekday"),
  position: integer("position").notNull().default(0),
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
}, (t) => [index("workout_templates_user_idx").on(t.userId)]);

export const templateExercises = pgTable("template_exercises", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  templateId: uuid("template_id").notNull().references(() => workoutTemplates.id, { onDelete: "cascade" }),
  exerciseId: uuid("exercise_id").notNull().references(() => exercises.id),
  position: integer("position").notNull(),
  supersetGroup: integer("superset_group"),
  prescription: jsonb("prescription").notNull(),
  notes: text("notes"),
}, (t) => [index("template_exercises_template_idx").on(t.templateId)]);

export const workoutSessions = pgTable("workout_sessions", {
  id: uuid("id").primaryKey(),
  userId: userRef(),
  templateId: uuid("template_id").references(() => workoutTemplates.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  day: day().notNull(),
  startedAt: ts("started_at").notNull(),
  endedAt: ts("ended_at"),
  pausedSec: integer("paused_sec").notNull().default(0),
  status: text("status").notNull(),
  notes: text("notes"),
  summary: jsonb("summary"),
  ...syncCols(),
}, (t) => [index("workout_sessions_user_day_idx").on(t.userId, t.day)]);

export const sessionExercises = pgTable("session_exercises", {
  id: uuid("id").primaryKey(),
  userId: userRef(),
  sessionId: uuid("session_id").notNull().references(() => workoutSessions.id, { onDelete: "cascade" }),
  exerciseId: uuid("exercise_id").notNull().references(() => exercises.id),
  position: integer("position").notNull(),
  supersetGroup: integer("superset_group"),
  prescription: jsonb("prescription"),
  notes: text("notes"),
}, (t) => [index("session_exercises_session_idx").on(t.sessionId), index("session_exercises_user_ex_idx").on(t.userId, t.exerciseId)]);

export const setLogs = pgTable("set_logs", {
  id: uuid("id").primaryKey(),
  userId: userRef(),
  sessionExerciseId: uuid("session_exercise_id").notNull().references(() => sessionExercises.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  kind: text("kind").notNull(),
  weightKg: doublePrecision("weight_kg").notNull(),
  reps: integer("reps").notNull(),
  rir: doublePrecision("rir"),
  rpe: doublePrecision("rpe"),
  assistedReps: integer("assisted_reps"),
  completed: boolean("completed").notNull(),
  completedAt: ts("completed_at"),
  targetWeightKg: doublePrecision("target_weight_kg"),
  targetReps: integer("target_reps"),
  originalUnit: text("original_unit").notNull().default("kg"),
  notes: text("notes"),
}, (t) => [index("set_logs_session_exercise_idx").on(t.sessionExerciseId)]);

export const personalRecords = pgTable("personal_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  exerciseId: uuid("exercise_id").notNull().references(() => exercises.id),
  sessionId: uuid("session_id").notNull().references(() => workoutSessions.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  value: doublePrecision("value").notNull(),
  weightKg: doublePrecision("weight_kg").notNull(),
  reps: integer("reps").notNull(),
  previous: doublePrecision("previous"),
  day: day().notNull(),
  createdAt: createdAt(),
}, (t) => [index("personal_records_user_ex_idx").on(t.userId, t.exerciseId)]);

/* ───────────── Progress ───────────── */

export const bodyMeasurements = pgTable("body_measurements", {
  id: uuid("id").primaryKey(),
  userId: userRef(),
  day: day().notNull(),
  measuredAt: ts("measured_at").notNull(),
  kind: text("kind").notNull(),
  value: doublePrecision("value").notNull(),
  originalValue: doublePrecision("original_value"),
  originalUnit: text("original_unit"),
  source: text("source").notNull().default("manual"),
  sourceRecordId: text("source_record_id"),
  note: text("note"),
  ...syncCols(),
}, (t) => [
  index("body_measurements_user_kind_day_idx").on(t.userId, t.kind, t.day),
  uniqueIndex("body_measurements_source_uq").on(t.userId, t.source, t.sourceRecordId).where(sql`${t.sourceRecordId} is not null`),
]);

export const progressPhotos = pgTable("progress_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  day: day().notNull(),
  view: text("view").notNull(), // front | side | back | custom
  storageKey: text("storage_key").notNull(),
  width: integer("width"),
  height: integer("height"),
  bytes: integer("bytes"),
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
}, (t) => [index("progress_photos_user_day_idx").on(t.userId, t.day)]);

/* ───────────── Health & recovery ───────────── */

export const healthObservations = pgTable("health_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  provider: text("provider").notNull(),
  sourceRecordId: text("source_record_id").notNull(),
  type: text("type").notNull(),
  day: day().notNull(),
  startAt: ts("start_at").notNull(),
  endAt: ts("end_at").notNull(),
  value: doublePrecision("value").notNull(),
  sourceName: text("source_name"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("health_observations_dedupe_uq").on(t.userId, t.provider, t.sourceRecordId),
  index("health_observations_user_type_day_idx").on(t.userId, t.type, t.day),
]);

export const dailyCheckins = pgTable("daily_checkins", {
  userId: userRef(),
  day: day().notNull(),
  fatigue: integer("fatigue"),
  soreness: integer("soreness"),
  stress: integer("stress"),
  motivation: integer("motivation"),
  notes: text("notes"),
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.day] })]);

/* ───────────── Coach ───────────── */

export const coachConversations = pgTable("coach_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  title: text("title"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("coach_conversations_user_idx").on(t.userId, t.updatedAt)]);

export const coachMessages = pgTable("coach_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  conversationId: uuid("conversation_id").notNull().references(() => coachConversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user | assistant
  /** Display text. */
  text: text("text").notNull(),
  /** Full provider content (tool calls/results) needed to continue the conversation. */
  providerContent: jsonb("provider_content"),
  toolCalls: jsonb("tool_calls"),
  model: text("model"),
  createdAt: createdAt(),
}, (t) => [index("coach_messages_conversation_idx").on(t.conversationId, t.createdAt)]);

export const coachRecommendations = pgTable("coach_recommendations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  conversationId: uuid("conversation_id"),
  kind: text("kind").notNull(), // nutrition_targets | workout_program | meal_plan | exercise_substitution | goal_update
  status: text("status").notNull().default("proposed"), // proposed | accepted | rejected | superseded
  title: text("title").notNull(),
  rationale: text("rationale").notNull(),
  payload: jsonb("payload").notNull(),
  evidence: jsonb("evidence").notNull().default({}),
  source: text("source").notNull(), // engine | coach
  createdAt: createdAt(),
  decidedAt: ts("decided_at"),
  decisionNote: text("decision_note"),
}, (t) => [index("coach_recommendations_user_idx").on(t.userId, t.status)]);

/** History of changes applied after the user accepted a recommendation. */
export const coachActions = pgTable("coach_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  recommendationId: uuid("recommendation_id").notNull().references(() => coachRecommendations.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: createdAt(),
});

/* ───────────── Meal planning ───────────── */

export const mealPlans = pgTable("meal_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  startDay: day("start_day").notNull(),
  days: integer("days").notNull(),
  status: text("status").notNull().default("active"),
  createdBy: text("created_by").notNull().default("user"),
  createdAt: createdAt(),
});

export const mealPlanItems = pgTable("meal_plan_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  planId: uuid("plan_id").notNull().references(() => mealPlans.id, { onDelete: "cascade" }),
  day: day().notNull(),
  meal: text("meal").notNull(),
  recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
  savedMealId: uuid("saved_meal_id").references(() => savedMeals.id, { onDelete: "set null" }),
  servings: doublePrecision("servings").notNull().default(1),
  notes: text("notes"),
});

export const groceryLists = pgTable("grocery_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  mealPlanId: uuid("meal_plan_id").references(() => mealPlans.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const groceryItems = pgTable("grocery_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  listId: uuid("list_id").notNull().references(() => groceryLists.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  unit: text("unit").notNull(),
  category: text("category").notNull(),
  checked: boolean("checked").notNull().default(false),
  position: integer("position").notNull().default(0),
});

export const pantryItems = pgTable("pantry_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  unit: text("unit").notNull(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("pantry_items_user_key_unit_uq").on(t.userId, t.key, t.unit)]);

/* ───────────── Platform ───────────── */

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  settings: jsonb("settings").notNull(),
  updatedAt: updatedAt(),
});

export const pushTokens = pgTable("push_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  token: text("token").notNull(),
  platform: text("platform").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("push_tokens_token_uq").on(t.token)]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  event: text("event").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("audit_events_user_idx").on(t.userId, t.createdAt)]);

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("active"),
  provider: text("provider"),
  providerRef: text("provider_ref"),
  currentPeriodEnd: ts("current_period_end"),
  createdAt: createdAt(),
});

/** AI and API usage metering for cost tracking and future plan limits. */
export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userRef(),
  feature: text("feature").notNull(),
  provider: text("provider"),
  model: text("model"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costMicroUsd: integer("cost_micro_usd"),
  createdAt: createdAt(),
}, (t) => [index("usage_events_user_feature_idx").on(t.userId, t.feature, t.createdAt)]);

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  rules: jsonb("rules").notNull().default({}),
  updatedAt: updatedAt(),
});
