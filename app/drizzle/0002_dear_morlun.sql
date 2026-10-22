DROP INDEX "jobs_status_created_idx";--> statement-breakpoint
DROP INDEX "meetings_ws_created_idx";--> statement-breakpoint
CREATE INDEX "jobs_status_created_idx" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "meetings_ws_created_idx" ON "meetings" USING btree ("workspace_id","created_at");