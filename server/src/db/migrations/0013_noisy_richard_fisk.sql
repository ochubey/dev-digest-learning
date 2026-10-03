ALTER TABLE "pr_intent" ALTER COLUMN "intent" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "scope_reason" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "confidence" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "missing_context" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "basis" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "derived_from_head_sha" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "cache_key_hash" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "tokens" integer;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "cost_usd" double precision;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "derived_by" text DEFAULT 'auto';--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;