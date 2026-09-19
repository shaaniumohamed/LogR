CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"filename" text,
	"parser_version" text DEFAULT 'exness-csv-1' NOT NULL,
	"rows_parsed" integer DEFAULT 0 NOT NULL,
	"rows_inserted" integer DEFAULT 0 NOT NULL,
	"rows_duplicate" integer DEFAULT 0 NOT NULL,
	"reported_net" double precision,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"ticket" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"direction" text NOT NULL,
	"symbol" text NOT NULL,
	"lots" real NOT NULL,
	"open_price" double precision NOT NULL,
	"close_price" double precision NOT NULL,
	"stop_loss" double precision,
	"take_profit" double precision,
	"commission" double precision DEFAULT 0 NOT NULL,
	"swap" double precision DEFAULT 0 NOT NULL,
	"profit" double precision NOT NULL,
	"close_reason" text DEFAULT 'unknown' NOT NULL,
	"import_batch_id" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_annotation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"identity_hash" text NOT NULL,
	"setup" text,
	"timeframe" text,
	"invalidation" double precision,
	"invalidation_source" text,
	"confluences" text[] DEFAULT '{}' NOT NULL,
	"mistakes" text[] DEFAULT '{}' NOT NULL,
	"emotion" text,
	"note" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"nickname" text NOT NULL,
	"broker" text DEFAULT 'Exness' NOT NULL,
	"platform" text DEFAULT 'mt5' NOT NULL,
	"login" text,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"account_kind" text DEFAULT 'live' NOT NULL,
	"is_cent" boolean DEFAULT false NOT NULL,
	"capital_mode" text DEFAULT 'compounding' NOT NULL,
	"declared_float" double precision,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp,
	"image" text,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"base_currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "zone_trade" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"identity_hash" text NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"hold_minutes" real NOT NULL,
	"leg_count" integer NOT NULL,
	"lots" real NOT NULL,
	"avg_entry" double precision NOT NULL,
	"avg_exit" double precision NOT NULL,
	"zone_low" double precision NOT NULL,
	"zone_high" double precision NOT NULL,
	"net_pnl" double precision NOT NULL,
	"had_stop" boolean DEFAULT false NOT NULL,
	"close_reasons" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_account_id_trading_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_account_id_trading_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_annotation" ADD CONSTRAINT "trade_annotation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_annotation" ADD CONSTRAINT "trade_annotation_account_id_trading_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_account" ADD CONSTRAINT "trading_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_trade" ADD CONSTRAINT "zone_trade_account_id_trading_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_trade" ADD CONSTRAINT "zone_trade_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "position_account_ticket_idx" ON "position" USING btree ("account_id","ticket");--> statement-breakpoint
CREATE INDEX "position_account_opened_idx" ON "position" USING btree ("account_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "annotation_identity_idx" ON "trade_annotation" USING btree ("account_id","identity_hash");--> statement-breakpoint
CREATE INDEX "trading_account_user_idx" ON "trading_account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zone_trade_identity_idx" ON "zone_trade" USING btree ("account_id","identity_hash");--> statement-breakpoint
CREATE INDEX "zone_trade_account_closed_idx" ON "zone_trade" USING btree ("account_id","closed_at");