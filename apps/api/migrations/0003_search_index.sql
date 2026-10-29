DROP INDEX "foods_name_trgm_idx";--> statement-breakpoint
CREATE INDEX "foods_search_trgm_idx" ON "foods" USING gin (lower("name" || ' ' || coalesce("brand", '')) gin_trgm_ops);