ALTER TABLE "workspaces" ALTER COLUMN "retention_days" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "retention_days" DROP NOT NULL;