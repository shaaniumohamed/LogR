/**
 * Fills a LOCAL database with synthetic trading history.
 *
 * Exists so the interface can be looked at. Every screen here is driven by real
 * data — a calendar with no days, a histogram with no tail and a playbook with
 * no setups all render as empty states, which are the one part of the app that
 * is easy to check and the least useful to check. Nothing here is real: prices
 * come from a random walk, and no part of it goes anywhere near a real account.
 *
 *   node scripts/seed-dev.mjs "postgresql://logr@localhost:55432/logr"
 */
import pg from "pg";

const url = process.argv[2] ?? process.env.DATABASE_URL;
if (!url || /neon\.tech/.test(url)) {
  console.error("Refusing to run without a local connection string.");
  process.exit(1);
}

/* Deterministic, so two runs produce the same journal and a screenshot taken
   yesterday can be compared with one taken today. */
let seed = 20260922;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const gauss = () => {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

function identityHash(legs) {
  const key = legs.map((l) => `${l.ticket}@${l.closedAt.toISOString()}`).sort().join("|");
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

const DAY = 86_400_000;
const MIN = 60_000;
const TODAY = Date.UTC(2026, 8, 22);          // the session's "today"
const TRADING_DAYS = 150;

/* ------------------------------------------------- the market, invented */

const days = [];
let price = 3180;
for (let i = TRADING_DAYS; i >= 1; i--) {
  const t = TODAY - i * DAY;
  const d = new Date(t).getUTCDay();
  if (d === 0 || d === 6) continue;           // gold is shut
  price *= 1 + gauss() * 0.008 + 0.0011;      // a drifting, noisy market
  days.push({ t, close: round(price) });
}

/** One-minute bars, but only for the days a chart will actually be opened on. */
const M1_DAYS = 6;
const bars = [];
for (const day of days.slice(-M1_DAYS)) {
  let p = day.close * (1 - 0.004);
  for (let m = 0; m < 1440; m++) {
    // The market is shut between 21:00 and 22:00 UTC, as gold roughly is.
    if (m >= 1260 && m < 1320) continue;
    p *= 1 + gauss() * 0.00035;
    const o = p, c = p * (1 + gauss() * 0.00018);
    const hi = Math.max(o, c) * (1 + Math.abs(gauss()) * 0.00012);
    const lo = Math.min(o, c) * (1 - Math.abs(gauss()) * 0.00012);
    bars.push({ t: day.t + m * MIN, o: round(o), h: round(hi), l: round(lo), c: round(c) });
    p = c;
  }
}
const barAt = new Map(bars.map((b) => [b.t, b]));

/* Higher timeframes, built from the daily walk so they agree with the fills. */
function htfSeries(key, stepMs) {
  const out = [];
  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i];
    const steps = Math.max(1, Math.round(DAY / stepMs));
    for (let s = 0; s < steps; s++) {
      const t = day.t + s * stepMs;
      if (t > TODAY) continue;
      const base = day.close * (1 + (s / steps - 0.5) * 0.004);
      const o = base * (1 + gauss() * 0.0006);
      const c = base * (1 + gauss() * 0.0006);
      out.push({
        tf: key, t,
        o: round(o), c: round(c),
        h: round(Math.max(o, c) * (1 + Math.abs(gauss()) * 0.0012)),
        l: round(Math.min(o, c) * (1 - Math.abs(gauss()) * 0.0012)),
      });
    }
  }
  return out;
}
const htf = [
  ...htfSeries("1h", 3600_000),
  ...htfSeries("4h", 4 * 3600_000),
  ...htfSeries("1day", DAY),
  ...htfSeries("1week", 7 * DAY).filter((b) => new Date(b.t).getUTCDay() === 1),
];

/* --------------------------------------------------------- the trading */

const SETUPS = ["MSNR fresh level", "MSNR flipped level", "Sweep + reversal", "SMC order block", "No setup — impulse"];
const FEELINGS = ["patient", "confident", "focused", "rushed", "fomo", "revenge", "bored", "hesitant", "tilted"];
const MISTAKES = ["chased", "oversized", "no_plan", "held_past", "early_exit", "unfresh", "overtraded"];
const CONFLUENCES = ["fresh_level", "flipped_level", "htf_bias", "liquidity_sweep", "order_block", "fvg", "ote", "smt", "london_kz", "ny_kz", "bos", "choch"];
const NOTES = [
  "Level had been respected twice on the four hour. Waited for the sweep, entered on the reclaim.",
  "Entered before the sweep completed. Should have waited for the body close.",
  "Got impatient after the previous loss and took a setup I would normally skip.",
  "Textbook. Zone held, took partials into the old high, left a runner.",
  "Held past my invalidation hoping it would come back. It did not.",
  "Small size because the read was not clean. Right call — it chopped.",
];

const positions = [];
const zones = [];
const annotations = [];
let ticket = 4100000;

for (const [di, day] of days.entries()) {
  const tradesToday = 8 + Math.floor(rnd() * 14);
  // Every so often a bad session, which is what gives the histogram its tail.
  const badDay = rnd() < 0.18;
  let lastLossAt = null;

  for (let n = 0; n < tradesToday; n++) {
    const hour = 6 + Math.floor(rnd() * 16);
    const minute = Math.floor(rnd() * 60);
    const openedAt = new Date(day.t + hour * 3600_000 + minute * MIN);
    if (openedAt.getTime() > TODAY + 20 * 3600_000) continue;

    const direction = rnd() < 0.53 ? "long" : "short";
    const legCount = rnd() < 0.7 ? 1 + Math.floor(rnd() * 5) : 1;
    const holdMin = Math.max(1, Math.round(Math.abs(gauss()) * 9 + 2));

    // Tilt, on purpose: a quick re-entry after a loss, and a bigger one.
    const revenge = lastLossAt !== null && openedAt.getTime() - lastLossAt < 4 * MIN;
    const baseLots = round((0.02 + rnd() * 0.06) * (revenge ? 2.6 : 1), 2);

    const nearBar = barAt.get(Math.floor(openedAt.getTime() / MIN) * MIN);
    const entry = nearBar ? nearBar.c : round(day.close * (1 + gauss() * 0.0015));

    const winning = rnd() < (badDay ? 0.38 : 0.56);
    const size = Math.abs(gauss());
    const movePts = winning
      ? size * 1.5 + 0.3
      : -(size * (badDay ? 3.6 : 1.9) + 0.3) * (rnd() < 0.03 ? 6 : 1); // the rare disaster

    const legs = [];
    for (let l = 0; l < legCount; l++) {
      const legOpen = new Date(openedAt.getTime() + l * MIN);
      const legClose = new Date(legOpen.getTime() + holdMin * MIN);
      const openPrice = round(entry * (1 + (direction === "long" ? -1 : 1) * l * 0.00012));
      const closePrice = round(openPrice + (direction === "long" ? movePts : -movePts));
      const lots = round(baseLots / legCount, 2) || 0.01;
      legs.push({
        ticket: String(ticket++),
        openedAt: legOpen, closedAt: legClose,
        direction, symbol: "XAUUSD", lots,
        openPrice, closePrice,
        stopLoss: rnd() < 0.12 ? round(openPrice * (direction === "long" ? 0.997 : 1.003)) : null,
        takeProfit: null,
        commission: 0, swap: 0,
        profit: round(movePts * lots * 100),
        closeReason: rnd() < 0.08 ? pick(["tp", "sl"]) : "user",
      });
    }
    positions.push(...legs);

    const netPnl = round(legs.reduce((s, l) => s + l.profit, 0));
    if (netPnl < 0) lastLossAt = legs[legs.length - 1].closedAt.getTime();

    const lots = round(legs.reduce((s, l) => s + l.lots, 0));
    const entries = legs.map((l) => l.openPrice);
    const closedAt = new Date(Math.max(...legs.map((l) => l.closedAt.getTime())));
    const hash = identityHash(legs);

    zones.push({
      identityHash: hash, symbol: "XAUUSD", direction,
      openedAt: legs[0].openedAt, closedAt,
      holdMinutes: round((closedAt - legs[0].openedAt) / MIN),
      legCount, exitCount: legs.length, lots,
      avgEntry: round(legs.reduce((s, l) => s + l.openPrice * l.lots, 0) / lots),
      avgExit: round(legs.reduce((s, l) => s + l.closePrice * l.lots, 0) / lots),
      zoneLow: round(Math.min(...entries)), zoneHigh: round(Math.max(...entries)),
      netPnl, hadStop: legs.some((l) => l.stopLoss !== null),
      closeReasons: [...new Set(legs.map((l) => l.closeReason))],
    });

    // Roughly a third annotated, weighted towards the big results — which is
    // what the review queue nudges a trader to do.
    if (rnd() < (Math.abs(netPnl) > 25 ? 0.75 : 0.22)) {
      const mid = round((Math.min(...entries) + Math.max(...entries)) / 2);
      annotations.push({
        identityHash: hash,
        setup: pick(SETUPS),
        timeframe: pick(["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1"]),
        invalidation: round(mid * (direction === "long" ? 0.9985 : 1.0015)),
        confluences: [...new Set([pick(CONFLUENCES), pick(CONFLUENCES), pick(CONFLUENCES)])],
        mistakes: netPnl < 0 && rnd() < 0.6 ? [pick(MISTAKES)] : [],
        emotion: pick(FEELINGS),
        note: rnd() < 0.5 ? pick(NOTES) : null,
        drawings: rnd() < 0.45 ? [{
          id: `d${hash}`,
          kind: "zone",
          low: round(mid * 0.9994), high: round(mid * 1.0006),
          label: pick(["Demand zone", "Supply zone", "Flip level", "August high"]),
        }] : null,
      });
    }
  }

  // Once a month, something left open over the weekend.
  if (di % 22 === 7) {
    const openedAt = new Date(day.t + 20 * 3600_000);
    const closedAt = new Date(openedAt.getTime() + 3 * DAY);
    const openPrice = round(day.close);
    const closePrice = round(openPrice * 0.9955);
    const leg = {
      ticket: String(ticket++), openedAt, closedAt, direction: "long", symbol: "XAUUSD",
      lots: 0.08, openPrice, closePrice, stopLoss: null, takeProfit: null,
      commission: 0, swap: round(-1.2), profit: round((closePrice - openPrice) * 0.08 * 100),
      closeReason: "user",
    };
    positions.push(leg);
    zones.push({
      identityHash: identityHash([leg]), symbol: "XAUUSD", direction: "long",
      openedAt, closedAt, holdMinutes: round((closedAt - openedAt) / MIN),
      legCount: 1, exitCount: 1, lots: 0.08,
      avgEntry: openPrice, avgExit: closePrice, zoneLow: openPrice, zoneHigh: openPrice,
      netPnl: round(leg.profit + leg.swap), hadStop: false, closeReasons: ["user"],
    });
  }
}

/* ------------------------------------------------------------- loading */

const client = new pg.Client({ connectionString: url });
await client.connect();

const USER = "dev-user-0001";
const ACCOUNT = "dev-account-0001";

await client.query("begin");
await client.query(`truncate "trade_annotation","zone_trade","position","price_bar","price_bar_htf","invite","trading_account","user" cascade`);
await client.query(
  `insert into "user" (id, name, email, "emailVerified", time_zone, base_currency)
   values ($1,$2,$3,now(),$4,'USD')`,
  [USER, "Dev Trader", "dev@example.com", "Asia/Kuala_Lumpur"],
);
await client.query(
  `insert into trading_account (id, user_id, nickname, broker, platform, currency, account_kind)
   values ($1,$2,'Main','Exness','mt5','USD','live')`,
  [ACCOUNT, USER],
);
await client.query(
  `insert into invite (email, invited_by, note) values
     ('friend.one@example.com',$1,'Danish — gold, same levels'),
     ('friend.two@example.com',$1,null)`,
  [USER],
);

async function copyIn(table, columns, rows, toValues) {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = [];
    const placeholders = slice.map((r, j) => {
      const v = toValues(r);
      values.push(...v);
      return `(${v.map((_, k) => `$${j * v.length + k + 1}`).join(",")})`;
    });
    await client.query(
      `insert into ${table} (${columns.join(",")}) values ${placeholders.join(",")} on conflict do nothing`,
      values,
    );
  }
}

await copyIn("position",
  ["id","account_id","user_id","ticket","opened_at","closed_at","direction","symbol","lots",
   "open_price","close_price","stop_loss","take_profit","commission","swap","profit","close_reason"],
  positions,
  (p) => [`p${p.ticket}`, ACCOUNT, USER, p.ticket, p.openedAt, p.closedAt, p.direction, p.symbol,
          p.lots, p.openPrice, p.closePrice, p.stopLoss, p.takeProfit, p.commission, p.swap, p.profit, p.closeReason]);

await copyIn("zone_trade",
  ["id","account_id","user_id","identity_hash","symbol","direction","opened_at","closed_at",
   "hold_minutes","leg_count","exit_count","lots","avg_entry","avg_exit","zone_low","zone_high",
   "net_pnl","had_stop","close_reasons"],
  zones,
  (z) => [`z${z.identityHash}`, ACCOUNT, USER, z.identityHash, z.symbol, z.direction, z.openedAt, z.closedAt,
          z.holdMinutes, z.legCount, z.exitCount, z.lots, z.avgEntry, z.avgExit, z.zoneLow, z.zoneHigh,
          z.netPnl, z.hadStop, z.closeReasons]);

await copyIn("trade_annotation",
  ["id","user_id","account_id","identity_hash","setup","timeframe","invalidation",
   "invalidation_source","confluences","mistakes","emotion","note","drawings"],
  annotations,
  (a) => [`a${a.identityHash}`, USER, ACCOUNT, a.identityHash, a.setup, a.timeframe, a.invalidation,
          "user", a.confluences, a.mistakes, a.emotion, a.note,
          a.drawings ? JSON.stringify(a.drawings) : null]);

await copyIn("price_bar", ["symbol","t","open","high","low","close","source"], bars,
  (b) => ["XAUUSD", new Date(b.t), b.o, b.h, b.l, b.c, "dev-seed"]);

await copyIn("price_bar_htf", ["symbol","tf","t","open","high","low","close","source"], htf,
  (b) => ["XAUUSD", b.tf, new Date(b.t), b.o, b.h, b.l, b.c, "dev-seed"]);

await client.query("commit");

const [{ rows: [counts] }] = [await client.query(`
  select (select count(*) from "position") positions,
         (select count(*) from zone_trade) zones,
         (select count(*) from trade_annotation) notes,
         (select count(*) from price_bar) bars,
         (select count(*) from price_bar_htf) htf`)];
console.log(counts);

const { rows: [recent] } = await client.query(
  `select identity_hash, closed_at, net_pnl from zone_trade order by closed_at desc limit 1`);
console.log("newest trade:", recent);
await client.end();
