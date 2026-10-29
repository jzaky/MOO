CREATE TABLE "diary_days" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diary_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "food_id" uuid;--> statement-breakpoint
ALTER TABLE "diary_days" ADD CONSTRAINT "diary_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE diary_days TO moo_runtime;
--> statement-breakpoint
ALTER TABLE diary_days ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY diary_days_isolation ON diary_days USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
