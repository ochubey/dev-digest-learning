ALTER TABLE "conventions" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "rejected" boolean DEFAULT false NOT NULL;