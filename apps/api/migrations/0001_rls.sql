-- Row-Level Security. The runtime API connects as a member of stoke_runtime
-- (NOT the table owner), so these policies apply to every query it makes.
-- The owner role is used only for migrations and explicitly-named system
-- tasks (auth lookups, shared catalogue imports).
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO stoke_runtime;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_user_id() TO stoke_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE profiles TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY profiles_isolation ON profiles USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE goals TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY goals_isolation ON goals USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE nutrition_targets TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE nutrition_targets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY nutrition_targets_isolation ON nutrition_targets USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE food_favorites TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE food_favorites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY food_favorites_isolation ON food_favorites USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE food_logs TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE food_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY food_logs_isolation ON food_logs USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE water_logs TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE water_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY water_logs_isolation ON water_logs USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE saved_meals TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE saved_meals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY saved_meals_isolation ON saved_meals USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE recipes TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recipes_isolation ON recipes USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE recipe_ingredients TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE recipe_ingredients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recipe_ingredients_isolation ON recipe_ingredients USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE food_recognitions TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE food_recognitions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY food_recognitions_isolation ON food_recognitions USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE workout_programs TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE workout_programs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workout_programs_isolation ON workout_programs USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE workout_templates TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE workout_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workout_templates_isolation ON workout_templates USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE template_exercises TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE template_exercises ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY template_exercises_isolation ON template_exercises USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE workout_sessions TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workout_sessions_isolation ON workout_sessions USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session_exercises TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE session_exercises ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY session_exercises_isolation ON session_exercises USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE set_logs TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE set_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY set_logs_isolation ON set_logs USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE personal_records TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE personal_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY personal_records_isolation ON personal_records USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE body_measurements TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE body_measurements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY body_measurements_isolation ON body_measurements USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE progress_photos TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE progress_photos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY progress_photos_isolation ON progress_photos USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE health_observations TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE health_observations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY health_observations_isolation ON health_observations USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE daily_checkins TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE daily_checkins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY daily_checkins_isolation ON daily_checkins USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE coach_conversations TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE coach_conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY coach_conversations_isolation ON coach_conversations USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE coach_messages TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE coach_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY coach_messages_isolation ON coach_messages USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE coach_recommendations TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE coach_recommendations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY coach_recommendations_isolation ON coach_recommendations USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE coach_actions TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE coach_actions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY coach_actions_isolation ON coach_actions USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE meal_plans TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY meal_plans_isolation ON meal_plans USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE meal_plan_items TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE meal_plan_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY meal_plan_items_isolation ON meal_plan_items USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE grocery_lists TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE grocery_lists ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY grocery_lists_isolation ON grocery_lists USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE grocery_items TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE grocery_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY grocery_items_isolation ON grocery_items USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pantry_items TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE pantry_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pantry_items_isolation ON pantry_items USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE notification_preferences TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_preferences_isolation ON notification_preferences USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE push_tokens TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY push_tokens_isolation ON push_tokens USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE subscriptions TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY subscriptions_isolation ON subscriptions USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE usage_events TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY usage_events_isolation ON usage_events USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE foods TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE foods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY foods_read ON foods FOR SELECT USING (owner_user_id IS NULL OR owner_user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY foods_write ON foods FOR INSERT WITH CHECK (owner_user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY foods_update ON foods FOR UPDATE USING (owner_user_id = app_user_id()) WITH CHECK (owner_user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY foods_delete ON foods FOR DELETE USING (owner_user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE food_servings TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE food_servings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY food_servings_read ON food_servings FOR SELECT USING (owner_user_id IS NULL OR owner_user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY food_servings_write ON food_servings FOR INSERT WITH CHECK (owner_user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY food_servings_update ON food_servings FOR UPDATE USING (owner_user_id = app_user_id()) WITH CHECK (owner_user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY food_servings_delete ON food_servings FOR DELETE USING (owner_user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE exercises TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY exercises_read ON exercises FOR SELECT USING (owner_user_id IS NULL OR owner_user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY exercises_write ON exercises FOR INSERT WITH CHECK (owner_user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY exercises_update ON exercises FOR UPDATE USING (owner_user_id = app_user_id()) WITH CHECK (owner_user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY exercises_delete ON exercises FOR DELETE USING (owner_user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE audit_events TO stoke_runtime;
--> statement-breakpoint
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_events_own ON audit_events USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT ON TABLE feature_flags TO stoke_runtime;
--> statement-breakpoint
-- users and refresh_tokens are deliberately NOT granted to the runtime role.
SELECT 1;
