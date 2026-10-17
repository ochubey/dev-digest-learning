DROP INDEX "ci_installations_repo_uq";--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "workflow_file" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ci_installations_repo_agent_uq" ON "ci_installations" USING btree ("repo","agent_id");