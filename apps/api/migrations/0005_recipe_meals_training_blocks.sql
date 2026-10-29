ALTER TABLE "recipes" ADD COLUMN "meals" text[];--> statement-breakpoint
ALTER TABLE "workout_programs" ADD COLUMN "block_weeks" integer;--> statement-breakpoint
ALTER TABLE "workout_programs" ADD COLUMN "block_start" date;--> statement-breakpoint
ALTER TABLE "workout_programs" ADD COLUMN "deload_week_start" date;