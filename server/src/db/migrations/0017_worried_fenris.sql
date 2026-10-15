ALTER TABLE "ci_installations" ADD COLUMN "repo_id" uuid;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "github_repo_id" bigint;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "workflow_version" integer;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "agent_version" integer;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "ci_fail_on" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "post_as" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "triggers" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "files" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "pr_url" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "agent_name" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "agent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "github_run_id" bigint;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "repo" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "pr_title" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "commit_sha" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "verdict" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "critical" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "warning" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "suggestion" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "agent_version" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "runner_version" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "workflow_version" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD CONSTRAINT "ci_installations_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD CONSTRAINT "ci_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD CONSTRAINT "ci_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD CONSTRAINT "ci_runs_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ci_installations_repo_uq" ON "ci_installations" USING btree ("repo");--> statement-breakpoint
CREATE UNIQUE INDEX "ci_runs_github_run_uq" ON "ci_runs" USING btree ("github_run_id");--> statement-breakpoint
CREATE INDEX "ci_runs_ws_ran_idx" ON "ci_runs" USING btree ("workspace_id","ran_at");