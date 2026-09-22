-- LogR: the whole schema, in one file you can paste into a SQL console.
--
-- Why this exists: `npm run db:push` needs a checkout and a terminal. This file
-- does the same job from a browser — Neon's SQL Editor, psql, anything — which
-- matters when the only device to hand is a phone.
--
-- It is safe to run on an empty database, on a database an older version of
-- LogR created, and safe to run twice. Every statement either creates something
-- missing or skips it. Nothing here drops, renames, or rewrites a table, so no
-- trade you have already imported can be lost by running it.
--
-- tests/schema-sql.test.ts fails if lib/db/schema.ts grows a table, column, or
-- index that this file does not have, so it cannot quietly fall behind.

-- ---------------------------------------------------------------- tables ---

CREATE TABLE IF NOT EXISTS "user" (
  "id" text NOT NULL,
  "name" text,
  "email" text,
  "emailVerified" timestamp,
  "image" text,
  "time_zone" text DEFAULT 'UTC' NOT NULL,
  "base_currency" varchar(3) DEFAULT 'USD' NOT NULL,
  "active_account_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "account" (
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
  CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY ("provider", "providerAccountId")
);

CREATE TABLE IF NOT EXISTS "session" (
  "sessionToken" text NOT NULL,
  "userId" text NOT NULL,
  "expires" timestamp NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sessionToken")
);

CREATE TABLE IF NOT EXISTS "verificationToken" (
  "identifier" text NOT NULL,
  "token" text NOT NULL,
  "expires" timestamp NOT NULL,
  CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY ("identifier", "token")
);

CREATE TABLE IF NOT EXISTS "trading_account" (
  "id" text NOT NULL,
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
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "trading_account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "import_batch" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "account_id" text NOT NULL,
  "filename" text,
  "parser_version" text DEFAULT 'exness-csv-1' NOT NULL,
  "rows_parsed" integer DEFAULT 0 NOT NULL,
  "rows_inserted" integer DEFAULT 0 NOT NULL,
  "rows_duplicate" integer DEFAULT 0 NOT NULL,
  "reported_net" double precision,
  "meta" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "position" (
  "id" text NOT NULL,
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
  "import_batch_id" text,
  CONSTRAINT "position_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "zone_trade" (
  "id" text NOT NULL,
  "account_id" text NOT NULL,
  "user_id" text NOT NULL,
  "identity_hash" text NOT NULL,
  "symbol" text NOT NULL,
  "direction" text NOT NULL,
  "opened_at" timestamp with time zone NOT NULL,
  "closed_at" timestamp with time zone NOT NULL,
  "hold_minutes" real NOT NULL,
  "leg_count" integer NOT NULL,
  "exit_count" integer DEFAULT 1 NOT NULL,
  "lots" real NOT NULL,
  "avg_entry" double precision NOT NULL,
  "avg_exit" double precision NOT NULL,
  "zone_low" double precision NOT NULL,
  "zone_high" double precision NOT NULL,
  "net_pnl" double precision NOT NULL,
  "had_stop" boolean DEFAULT false NOT NULL,
  "close_reasons" text[] DEFAULT '{}' NOT NULL,
  CONSTRAINT "zone_trade_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "trade_annotation" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "account_id" text NOT NULL,
  "identity_hash" text NOT NULL,
  "setup" text,
  "timeframe" text,
  "invalidation" double precision,
  "invalidation_source" text,
  "confluences" text[] DEFAULT '{}' NOT NULL,
  "mistakes" text[] DEFAULT '{}' NOT NULL,
  "rules_broken" text[] DEFAULT '{}' NOT NULL,
  "emotion" text,
  "note" text,
  "drawings" jsonb,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "trade_annotation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "trade_screenshot" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "account_id" text NOT NULL,
  "identity_hash" text NOT NULL,
  "storage_key" text NOT NULL,
  "content_type" text NOT NULL,
  "bytes" integer NOT NULL,
  "width" integer,
  "height" integer,
  "caption" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "trade_screenshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "weekly_note" (
  "account_id" text NOT NULL,
  "user_id" text NOT NULL,
  "week_start" text NOT NULL,
  "went_well" text,
  "to_fix" text,
  "focus" text,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "weekly_note_account_id_week_start_pk" PRIMARY KEY ("account_id", "week_start")
);

CREATE TABLE IF NOT EXISTS "trading_rule" (
  "id" text NOT NULL,
  "account_id" text NOT NULL,
  "user_id" text NOT NULL,
  "text" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "trading_rule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "invite" (
  "email" text NOT NULL,
  "invited_by" text,
  "note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "invite_pkey" PRIMARY KEY ("email")
);

CREATE TABLE IF NOT EXISTS "price_bar" (
  "symbol" text NOT NULL,
  "t" timestamp with time zone NOT NULL,
  "open" double precision NOT NULL,
  "high" double precision NOT NULL,
  "low" double precision NOT NULL,
  "close" double precision NOT NULL,
  "source" text DEFAULT 'csv' NOT NULL,
  CONSTRAINT "price_bar_symbol_t_pk" PRIMARY KEY ("symbol", "t")
);

CREATE TABLE IF NOT EXISTS "price_bar_htf" (
  "symbol" text NOT NULL,
  "tf" text NOT NULL,
  "t" timestamp with time zone NOT NULL,
  "open" double precision NOT NULL,
  "high" double precision NOT NULL,
  "low" double precision NOT NULL,
  "close" double precision NOT NULL,
  "source" text DEFAULT 'twelvedata' NOT NULL,
  CONSTRAINT "price_bar_htf_symbol_tf_t_pk" PRIMARY KEY ("symbol", "tf", "t")
);

CREATE TABLE IF NOT EXISTS "economic_event" (
  "at" timestamp with time zone NOT NULL,
  "currency" text NOT NULL,
  "title" text NOT NULL,
  "impact" text DEFAULT 'high' NOT NULL,
  "source" text DEFAULT 'csv' NOT NULL,
  CONSTRAINT "economic_event_at_currency_title_pk" PRIMARY KEY ("at", "currency", "title")
);

-- --------------------------------------------------------------- columns ---
-- For databases created by an older version of LogR: add what is missing.
-- Every column here is either nullable or has a default, so adding it to a
-- table that already holds rows is safe.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "time_zone" text DEFAULT 'UTC' NOT NULL;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "base_currency" varchar(3) DEFAULT 'USD' NOT NULL;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "active_account_id" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;

ALTER TABLE "trading_account" ADD COLUMN IF NOT EXISTS "broker" text DEFAULT 'Exness' NOT NULL;
ALTER TABLE "trading_account" ADD COLUMN IF NOT EXISTS "platform" text DEFAULT 'mt5' NOT NULL;
ALTER TABLE "trading_account" ADD COLUMN IF NOT EXISTS "login" text;
ALTER TABLE "trading_account" ADD COLUMN IF NOT EXISTS "currency" varchar(3) DEFAULT 'USD' NOT NULL;
ALTER TABLE "trading_account" ADD COLUMN IF NOT EXISTS "account_kind" text DEFAULT 'live' NOT NULL;
ALTER TABLE "trading_account" ADD COLUMN IF NOT EXISTS "is_cent" boolean DEFAULT false NOT NULL;
ALTER TABLE "trading_account" ADD COLUMN IF NOT EXISTS "capital_mode" text DEFAULT 'compounding' NOT NULL;
ALTER TABLE "trading_account" ADD COLUMN IF NOT EXISTS "declared_float" double precision;
ALTER TABLE "trading_account" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;

ALTER TABLE "import_batch" ADD COLUMN IF NOT EXISTS "filename" text;
ALTER TABLE "import_batch" ADD COLUMN IF NOT EXISTS "parser_version" text DEFAULT 'exness-csv-1' NOT NULL;
ALTER TABLE "import_batch" ADD COLUMN IF NOT EXISTS "rows_parsed" integer DEFAULT 0 NOT NULL;
ALTER TABLE "import_batch" ADD COLUMN IF NOT EXISTS "rows_inserted" integer DEFAULT 0 NOT NULL;
ALTER TABLE "import_batch" ADD COLUMN IF NOT EXISTS "rows_duplicate" integer DEFAULT 0 NOT NULL;
ALTER TABLE "import_batch" ADD COLUMN IF NOT EXISTS "reported_net" double precision;
ALTER TABLE "import_batch" ADD COLUMN IF NOT EXISTS "meta" jsonb;
ALTER TABLE "import_batch" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;

ALTER TABLE "position" ADD COLUMN IF NOT EXISTS "stop_loss" double precision;
ALTER TABLE "position" ADD COLUMN IF NOT EXISTS "take_profit" double precision;
ALTER TABLE "position" ADD COLUMN IF NOT EXISTS "commission" double precision DEFAULT 0 NOT NULL;
ALTER TABLE "position" ADD COLUMN IF NOT EXISTS "swap" double precision DEFAULT 0 NOT NULL;
ALTER TABLE "position" ADD COLUMN IF NOT EXISTS "close_reason" text DEFAULT 'unknown' NOT NULL;
ALTER TABLE "position" ADD COLUMN IF NOT EXISTS "import_batch_id" text;

ALTER TABLE "zone_trade" ADD COLUMN IF NOT EXISTS "exit_count" integer DEFAULT 1 NOT NULL;
ALTER TABLE "zone_trade" ADD COLUMN IF NOT EXISTS "had_stop" boolean DEFAULT false NOT NULL;
ALTER TABLE "zone_trade" ADD COLUMN IF NOT EXISTS "close_reasons" text[] DEFAULT '{}' NOT NULL;

ALTER TABLE "trade_annotation" ADD COLUMN IF NOT EXISTS "setup" text;
ALTER TABLE "trade_annotation" ADD COLUMN IF NOT EXISTS "timeframe" text;
ALTER TABLE "trade_annotation" ADD COLUMN IF NOT EXISTS "invalidation" double precision;
ALTER TABLE "trade_annotation" ADD COLUMN IF NOT EXISTS "invalidation_source" text;
ALTER TABLE "trade_annotation" ADD COLUMN IF NOT EXISTS "confluences" text[] DEFAULT '{}' NOT NULL;
ALTER TABLE "trade_annotation" ADD COLUMN IF NOT EXISTS "mistakes" text[] DEFAULT '{}' NOT NULL;
ALTER TABLE "trade_annotation" ADD COLUMN IF NOT EXISTS "rules_broken" text[] DEFAULT '{}' NOT NULL;
ALTER TABLE "trade_annotation" ADD COLUMN IF NOT EXISTS "emotion" text;
ALTER TABLE "trade_annotation" ADD COLUMN IF NOT EXISTS "note" text;
ALTER TABLE "trade_annotation" ADD COLUMN IF NOT EXISTS "drawings" jsonb;
ALTER TABLE "trade_annotation" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;

ALTER TABLE "trade_screenshot" ADD COLUMN IF NOT EXISTS "width" integer;
ALTER TABLE "trade_screenshot" ADD COLUMN IF NOT EXISTS "height" integer;
ALTER TABLE "trade_screenshot" ADD COLUMN IF NOT EXISTS "caption" text;
ALTER TABLE "trade_screenshot" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;

ALTER TABLE "weekly_note" ADD COLUMN IF NOT EXISTS "went_well" text;
ALTER TABLE "weekly_note" ADD COLUMN IF NOT EXISTS "to_fix" text;
ALTER TABLE "weekly_note" ADD COLUMN IF NOT EXISTS "focus" text;
ALTER TABLE "weekly_note" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;

ALTER TABLE "trading_rule" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;
ALTER TABLE "trading_rule" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;
ALTER TABLE "trading_rule" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;

ALTER TABLE "invite" ADD COLUMN IF NOT EXISTS "invited_by" text;
ALTER TABLE "invite" ADD COLUMN IF NOT EXISTS "note" text;
ALTER TABLE "invite" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;

ALTER TABLE "price_bar" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'csv' NOT NULL;
ALTER TABLE "price_bar_htf" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'twelvedata' NOT NULL;

ALTER TABLE "economic_event" ADD COLUMN IF NOT EXISTS "impact" text DEFAULT 'high' NOT NULL;
ALTER TABLE "economic_event" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'csv' NOT NULL;

-- ----------------------------------------------------------- constraints ---
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so each one is wrapped in a
-- check against the catalogue. Re-running simply finds them already there.

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('user',             'user_email_unique',                             'UNIQUE ("email")'),
      ('account',          'account_userId_user_id_fk',                     'FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE'),
      ('session',          'session_userId_user_id_fk',                     'FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE'),
      ('trading_account',  'trading_account_user_id_user_id_fk',            'FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE'),
      ('import_batch',     'import_batch_user_id_user_id_fk',               'FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE'),
      ('import_batch',     'import_batch_account_id_trading_account_id_fk', 'FOREIGN KEY ("account_id") REFERENCES "trading_account"("id") ON DELETE CASCADE'),
      ('position',         'position_user_id_user_id_fk',                   'FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE'),
      ('position',         'position_account_id_trading_account_id_fk',     'FOREIGN KEY ("account_id") REFERENCES "trading_account"("id") ON DELETE CASCADE'),
      ('zone_trade',       'zone_trade_user_id_user_id_fk',                 'FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE'),
      ('zone_trade',       'zone_trade_account_id_trading_account_id_fk',   'FOREIGN KEY ("account_id") REFERENCES "trading_account"("id") ON DELETE CASCADE'),
      ('trade_annotation', 'trade_annotation_user_id_user_id_fk',           'FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE'),
      ('trade_annotation', 'trade_annotation_account_id_trading_account_id_fk', 'FOREIGN KEY ("account_id") REFERENCES "trading_account"("id") ON DELETE CASCADE'),
      ('trade_screenshot', 'trade_screenshot_user_id_user_id_fk',           'FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE'),
      ('trade_screenshot', 'trade_screenshot_account_id_trading_account_id_fk', 'FOREIGN KEY ("account_id") REFERENCES "trading_account"("id") ON DELETE CASCADE'),
      ('weekly_note',      'weekly_note_user_id_user_id_fk',                'FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE'),
      ('weekly_note',      'weekly_note_account_id_trading_account_id_fk',  'FOREIGN KEY ("account_id") REFERENCES "trading_account"("id") ON DELETE CASCADE'),
      ('trading_rule',     'trading_rule_user_id_user_id_fk',               'FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE'),
      ('trading_rule',     'trading_rule_account_id_trading_account_id_fk', 'FOREIGN KEY ("account_id") REFERENCES "trading_account"("id") ON DELETE CASCADE'),
      ('invite',           'invite_invited_by_user_id_fk',                  'FOREIGN KEY ("invited_by") REFERENCES "user"("id") ON DELETE SET NULL')
    ) AS t(tbl, name, definition)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = c.name AND conrelid = format('public.%I', c.tbl)::regclass
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', c.tbl, c.name, c.definition);
    END IF;
  END LOOP;
END $$;

-- --------------------------------------------------------------- indexes ---

CREATE UNIQUE INDEX IF NOT EXISTS "position_account_ticket_closed_idx" ON "position" ("account_id", "ticket", "closed_at");
CREATE INDEX IF NOT EXISTS "position_account_opened_idx" ON "position" ("account_id", "opened_at");
CREATE UNIQUE INDEX IF NOT EXISTS "zone_trade_identity_idx" ON "zone_trade" ("account_id", "identity_hash");
CREATE INDEX IF NOT EXISTS "zone_trade_account_closed_idx" ON "zone_trade" ("account_id", "closed_at");
CREATE UNIQUE INDEX IF NOT EXISTS "annotation_identity_idx" ON "trade_annotation" ("account_id", "identity_hash");
CREATE INDEX IF NOT EXISTS "screenshot_trade_idx" ON "trade_screenshot" ("account_id", "identity_hash");
CREATE INDEX IF NOT EXISTS "trading_account_user_idx" ON "trading_account" ("user_id");
CREATE INDEX IF NOT EXISTS "rule_account_idx" ON "trading_rule" ("account_id", "active");
CREATE INDEX IF NOT EXISTS "economic_event_at_idx" ON "economic_event" ("at");
