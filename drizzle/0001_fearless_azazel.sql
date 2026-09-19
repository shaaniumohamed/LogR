CREATE TABLE "price_bar" (
	"symbol" text NOT NULL,
	"t" timestamp with time zone NOT NULL,
	"open" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"close" double precision NOT NULL,
	"source" text DEFAULT 'csv' NOT NULL,
	CONSTRAINT "price_bar_symbol_t_pk" PRIMARY KEY("symbol","t")
);
--> statement-breakpoint
DROP INDEX "position_account_ticket_idx";--> statement-breakpoint
ALTER TABLE "trade_annotation" ADD COLUMN "drawings" jsonb;--> statement-breakpoint
ALTER TABLE "zone_trade" ADD COLUMN "exit_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "position_account_ticket_closed_idx" ON "position" USING btree ("account_id","ticket","closed_at");