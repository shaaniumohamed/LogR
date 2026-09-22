/**
 * Two traders, one deployment — the fixture the isolation check runs against.
 *
 * Alice is an owner (named in OWNER_EMAILS) and Bob is someone she invited.
 * Both have trades, notes, rules, weekly reviews and a screenshot record, so
 * every table that holds something private has something in it belonging to
 * each of them. Nothing here is real.
 */
import pg from "pg";

const url = process.argv[2] ?? process.env.DATABASE_URL;
if (!url || /neon\.tech/.test(url)) {
  console.error("Refusing to run without a local connection string.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("begin");
await client.query(`truncate "trade_annotation","trade_screenshot","trading_rule","weekly_note",
                            "zone_trade","position","import_batch","invite","trading_account","user",
                            "price_bar","price_bar_htf","economic_event" cascade`);

const people = [
  { id: "u-alice", email: "alice@example.com", name: "Alice", acct: "a-alice", tz: "Asia/Kuala_Lumpur" },
  { id: "u-bob", email: "bob@example.com", name: "Bob", acct: "a-bob", tz: "Europe/London" },
];

for (const p of people) {
  await client.query(
    `insert into "user" (id,name,email,"emailVerified",time_zone,base_currency,active_account_id)
     values ($1,$2,$3,now(),$4,'USD',$5)`,
    [p.id, p.name, p.email, p.tz, p.acct],
  );
  await client.query(
    `insert into trading_account (id,user_id,nickname,broker,platform,currency,account_kind)
     values ($1,$2,$3,'Exness','mt5','USD','live')`,
    [p.acct, p.id, `${p.name}'s main`],
  );

  // A handful of trades each, with prices far enough apart that a leak is
  // obvious at a glance rather than something to squint at.
  const base = p.id === "u-alice" ? 3300 : 1900;
  for (let i = 0; i < 5; i++) {
    const hash = `${p.id}-trade-${i}`;
    const opened = new Date(Date.UTC(2026, 8, 14 + i, 9, 0));
    const closed = new Date(opened.getTime() + 10 * 60_000);
    await client.query(
      `insert into "position" (id,account_id,user_id,ticket,opened_at,closed_at,direction,symbol,lots,
                               open_price,close_price,commission,swap,profit,close_reason)
       values ($1,$2,$3,$4,$5,$6,'long','XAUUSD',0.1,$7,$8,0,0,$9,'user')`,
      [`p-${hash}`, p.acct, p.id, `t-${hash}`, opened, closed, base + i, base + i + 1, (i - 2) * 10],
    );
    await client.query(
      `insert into zone_trade (id,account_id,user_id,identity_hash,symbol,direction,opened_at,closed_at,
                               hold_minutes,leg_count,exit_count,lots,avg_entry,avg_exit,zone_low,zone_high,
                               net_pnl,had_stop,close_reasons)
       values ($1,$2,$3,$4,'XAUUSD','long',$5,$6,10,1,1,0.1,$7,$8,$7,$7,$9,false,'{user}')`,
      [`z-${hash}`, p.acct, p.id, hash, opened, closed, base + i, base + i + 1, (i - 2) * 10],
    );
    await client.query(
      `insert into trade_annotation (id,user_id,account_id,identity_hash,setup,emotion,note,confluences,mistakes,rules_broken)
       values ($1,$2,$3,$4,$5,'patient',$6,'{fresh_level}','{}','{}')`,
      [`an-${hash}`, p.id, p.acct, hash, `${p.name} setup`, `SECRET-NOTE-OF-${p.name.toUpperCase()}-${i}`],
    );
  }

  await client.query(
    `insert into trading_rule (id,account_id,user_id,text,active,sort_order)
     values ($1,$2,$3,$4,true,0)`,
    [`r-${p.id}`, p.acct, p.id, `${p.name} private rule`],
  );
  await client.query(
    `insert into weekly_note (account_id,user_id,week_start,went_well,to_fix,focus)
     values ($1,$2,'2026-09-14',$3,$4,$5)`,
    [p.acct, p.id, `${p.name} went well`, `${p.name} to fix`, `SECRET-FOCUS-OF-${p.name.toUpperCase()}`],
  );
  await client.query(
    `insert into trade_screenshot (id,user_id,account_id,identity_hash,storage_key,content_type,bytes,caption)
     values ($1,$2,$3,$4,$5,'image/webp',1234,$6)`,
    [`s-${p.id}`, p.id, p.acct, `${p.id}-trade-0`, `shots/${p.acct}/x.webp`, `${p.name} screenshot`],
  );
}

// Bob is here because Alice invited him; Alice is an owner via the environment.
await client.query(
  `insert into invite (email, invited_by, note) values ('bob@example.com','u-alice','friend')`,
);

// Shared market data, so the destructive-endpoint check has something to protect.
for (let i = 0; i < 20; i++) {
  await client.query(
    `insert into price_bar (symbol,t,open,high,low,close,source)
     values ('XAUUSD',$1,3300,3301,3299,3300,'seed')`,
    [new Date(Date.UTC(2026, 8, 14, 9, i))],
  );
}

await client.query("commit");
const { rows } = await client.query(`
  select (select count(*) from "user") users,
         (select count(*) from zone_trade) trades,
         (select count(*) from trade_annotation) notes,
         (select count(*) from price_bar) bars`);
console.log(rows[0]);
await client.end();
