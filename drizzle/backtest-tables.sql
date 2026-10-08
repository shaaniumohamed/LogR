-- LogR backtester: the five tables it needs.
--
-- Paste all of this into Neon → SQL Editor (the app's production branch and
-- database) and press Run. It only adds; nothing that exists is changed, and
-- running it twice is harmless. The same statements are part of
-- drizzle/schema.sql.

CREATE TABLE IF NOT EXISTS "bt_strategy" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "setup" text,
  "rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "archived" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bt_strategy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "bt_session" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "strategy_id" text NOT NULL,
  "name" text NOT NULL,
  "symbol" text DEFAULT 'XAUUSD' NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "clock_at" timestamp with time zone NOT NULL,
  "timeframe" text DEFAULT '5m' NOT NULL,
  "chart" jsonb,
  "drawings" jsonb,
  "drawing_times" jsonb,
  "settings" jsonb NOT NULL,
  "state" jsonb,
  "event_seq" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bt_session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "bt_event" (
  "session_id" text NOT NULL,
  "user_id" text NOT NULL,
  "seq" integer NOT NULL,
  "at" timestamp with time zone NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bt_event_session_id_seq_pk" PRIMARY KEY ("session_id", "seq")
);

CREATE TABLE IF NOT EXISTS "bt_trade" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "session_id" text NOT NULL,
  "strategy_id" text NOT NULL,
  "idea_id" text NOT NULL,
  "direction" text NOT NULL,
  "opened_at" timestamp with time zone NOT NULL,
  "closed_at" timestamp with time zone NOT NULL,
  "lots" double precision NOT NULL,
  "avg_entry" double precision NOT NULL,
  "avg_exit" double precision NOT NULL,
  "pnl" double precision NOT NULL,
  "risk" double precision,
  "r" double precision,
  "legs" integer NOT NULL,
  "close_reasons" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bt_trade_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "bt_position" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "session_id" text NOT NULL,
  "trade_id" text NOT NULL,
  "ticket" text NOT NULL,
  "direction" text NOT NULL,
  "lots" double precision NOT NULL,
  "opened_at" timestamp with time zone NOT NULL,
  "closed_at" timestamp with time zone NOT NULL,
  "open_price" double precision NOT NULL,
  "close_price" double precision NOT NULL,
  "stop_loss" double precision,
  "take_profit" double precision,
  "commission" double precision DEFAULT 0 NOT NULL,
  "swap" double precision DEFAULT 0 NOT NULL,
  "profit" double precision NOT NULL,
  "close_reason" text NOT NULL,
  CONSTRAINT "bt_position_pkey" PRIMARY KEY ("id")
);

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('bt_strategy',      'bt_strategy_user_id_user_id_fk',                'FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE'),
      ('bt_session',       'bt_session_user_id_user_id_fk',                 'FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE'),
      ('bt_session',       'bt_session_strategy_id_bt_strategy_id_fk',      'FOREIGN KEY ("strategy_id") REFERENCES "bt_strategy"("id") ON DELETE CASCADE'),
      ('bt_event',         'bt_event_session_id_bt_session_id_fk',          'FOREIGN KEY ("session_id") REFERENCES "bt_session"("id") ON DELETE CASCADE'),
      ('bt_event',         'bt_event_user_id_user_id_fk',                   'FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE'),
      ('bt_trade',         'bt_trade_user_id_user_id_fk',                   'FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE'),
      ('bt_trade',         'bt_trade_session_id_bt_session_id_fk',          'FOREIGN KEY ("session_id") REFERENCES "bt_session"("id") ON DELETE CASCADE'),
      ('bt_trade',         'bt_trade_strategy_id_bt_strategy_id_fk',        'FOREIGN KEY ("strategy_id") REFERENCES "bt_strategy"("id") ON DELETE CASCADE'),
      ('bt_position',      'bt_position_user_id_user_id_fk',                'FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE'),
      ('bt_position',      'bt_position_session_id_bt_session_id_fk',       'FOREIGN KEY ("session_id") REFERENCES "bt_session"("id") ON DELETE CASCADE'),
      ('bt_position',      'bt_position_trade_id_bt_trade_id_fk',           'FOREIGN KEY ("trade_id") REFERENCES "bt_trade"("id") ON DELETE CASCADE')
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

CREATE INDEX IF NOT EXISTS "bt_strategy_user_idx" ON "bt_strategy" ("user_id", "archived");
CREATE INDEX IF NOT EXISTS "bt_session_user_idx" ON "bt_session" ("user_id", "strategy_id");
CREATE UNIQUE INDEX IF NOT EXISTS "bt_trade_idea_idx" ON "bt_trade" ("session_id", "idea_id");
CREATE INDEX IF NOT EXISTS "bt_trade_user_idx" ON "bt_trade" ("user_id", "strategy_id");
CREATE INDEX IF NOT EXISTS "bt_position_trade_idx" ON "bt_position" ("trade_id");
