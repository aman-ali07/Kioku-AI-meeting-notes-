ALTER TABLE "meetings" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "title")) STORED;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED;--> statement-breakpoint
CREATE INDEX "meetings_search_idx" ON "meetings" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "meetings_title_trgm_idx" ON "meetings" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "transcript_segments_search_idx" ON "transcript_segments" USING gin ("search_vector");