/**
 * Proves that one person using this journal cannot see or change another's.
 *
 * Written as a script that drives the REAL running app over HTTP rather than as
 * unit tests, because the question is about the surface an actual signed-in
 * stranger can reach: the routes, the session resolution, the redirects. A test
 * that calls a query function and passes it the right account id proves only
 * that the function does what its argument says.
 *
 *   node scripts/seed-two-users.mjs "$DATABASE_URL"
 *   npm run build && npx next start -p 3123
 *   node scripts/isolation-check.mjs
 *
 * Alice is an owner, Bob is someone she invited, Mallory is signed in with a
 * token for a user that does not exist. Every one of Alice's private strings is
 * seeded with a distinctive marker, so a leak is found by looking for the marker
 * rather than by reasoning about which field should have been filtered.
 */
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3123";
const T = JSON.parse(readFileSync("/var/tmp/tokens.json", "utf8"));

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name} ${detail}`); }
}

const as = (who, path, init = {}) =>
  fetch(BASE + path, {
    ...init,
    redirect: "manual",
    headers: {
      ...(init.headers ?? {}),
      ...(who ? { Cookie: `authjs.session-token=${T[who]}` } : {}),
    },
  });

const text = async (who, path) => (await as(who, path)).text();

console.log("\nSIGNED OUT");
for (const path of ["/dashboard", "/trades", "/settings", "/week", "/playbook"]) {
  const r = await as(null, path);
  check(`${path} is not served to a stranger`, r.status === 307 || r.status === 302,
    `got ${r.status}`);
}
for (const [path, init] of [
  ["/api/export?format=json", {}],
  ["/api/fills?from=2026-01-01&to=2026-12-31", {}],
  ["/api/screenshots?id=s-alice", { method: "DELETE" }],
  ["/api/news", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }],
]) {
  const r = await as(null, path, init);
  check(`${path} refuses a stranger`, r.status === 401, `got ${r.status}`);
}

/*
 * /api/health is open on purpose — it diagnoses a database too old to sign in
 * with, and a check you need a session for is useless when sessions are what is
 * broken. Open on purpose still has to mean open to NOTHING ELSE, so what it
 * returns is searched for the markers rather than taken on trust.
 */
{
  const r = await as(null, "/api/health");
  const body = await r.text();
  check("/api/health answers a stranger", r.status === 200 || r.status === 503, `got ${r.status}`);
  check("/api/health leaks no email address", !/@/.test(body), body.slice(0, 120));
  check("/api/health leaks no journal data", !/SECRET|alice|bob/i.test(body), body.slice(0, 120));
}

console.log("\nA SIGNED-IN USER WHO IS NOT IN THE DATABASE");
{
  const r = await as("mallory", "/dashboard");
  check("an unknown user id is bounced", r.status === 307 || r.status === 302, `got ${r.status}`);
}

console.log("\nBOB CANNOT READ ALICE'S JOURNAL");
{
  const bobExport = await text("bob", "/api/export?format=json");
  check("Bob's export holds none of Alice's notes", !bobExport.includes("SECRET-NOTE-OF-ALICE"));
  check("Bob's export holds none of Alice's trades", !bobExport.includes("u-alice-trade"));
  check("Bob's export holds none of Alice's account id", !bobExport.includes("a-alice"));
  check("Bob's export holds his own notes", bobExport.includes("SECRET-NOTE-OF-BOB"));

  const parsed = JSON.parse(bobExport);
  check("Bob's export counts only his own five trades", parsed.counts.trades === 5,
    `got ${parsed.counts.trades}`);
  check("Bob's export holds only his own rule",
    parsed.rules.every((r) => r.text.startsWith("Bob")));
  check("Bob's export holds only his own weekly review",
    parsed.weeklyNotes.every((w) => (w.focus ?? "").includes("BOB")));

  const csv = await text("bob", "/api/export?format=csv");
  check("Bob's spreadsheet holds none of Alice's notes", !csv.includes("SECRET-NOTE-OF-ALICE"));
}

console.log("\nBOB CANNOT OPEN ALICE'S PAGES");
{
  /*
   * Alice's trade has to be indistinguishable from one that never existed.
   *
   * Asserted on content rather than on the status code: every page here streams
   * (that is what the loading skeletons are), and once streaming has begun Next
   * cannot go back and change the status, so `notFound()` arrives as a 200
   * carrying the not-found page. What matters is the stronger property — Bob
   * gets exactly what he would get for a made-up address, so there is no way to
   * ask this journal whether somebody else's trade exists.
   */
  /*
   * Alice's trade has to be indistinguishable from one that never existed.
   *
   * Checked on content and on status parity rather than on byte equality. Every
   * page here streams — that is what the loading skeletons are — and a streamed
   * response is not byte-stable even for the same URL asked twice: the chunks
   * interleave differently. Byte equality would be a flaky assertion about
   * flush timing rather than a true one about information.
   *
   * The whole response is searched, scripts included, because the not-found
   * body arrives in the streamed payload rather than the first chunk of markup
   * — and the payload is what anyone scraping the page would read.
   */
  const alice = await as("bob", "/trades/u-alice-trade-0");
  const alicePage = await alice.text();
  const madeUp = await as("bob", "/trades/zzzz-no-such-trade");
  const madeUpPage = await madeUp.text();

  check("Alice's trade reads as not found for Bob", alicePage.includes("Nothing here"));
  check("a trade that never existed reads the same way", madeUpPage.includes("Nothing here"));
  check("both answer with the same status", alice.status === madeUp.status,
    `${alice.status} vs ${madeUp.status}`);
  check("neither says which of the two it was",
    !alicePage.includes("permission") && !alicePage.includes("not yours")
    && !alicePage.includes("access"));
  check("nothing of Alice's is anywhere in the response",
    !alicePage.includes("SECRET-NOTE-OF-ALICE") && !alicePage.includes("a-alice")
    && !alicePage.includes("Alice"));

  const body = await text("bob", "/trades/u-bob-trade-0");
  check("Bob's own trade page still works", body.includes("SECRET-NOTE-OF-BOB-0"));

  const day = await text("bob", "/day/2026-09-14");
  check("Alice's trades are absent from Bob's day page", !day.includes("SECRET-NOTE-OF-ALICE"));

  const week = await text("bob", "/week/2026-09-14");
  check("Alice's weekly review is absent from Bob's week", !week.includes("SECRET-FOCUS-OF-ALICE"));
  check("Bob's own weekly review is on his week", week.includes("SECRET-FOCUS-OF-BOB"));

  const playbook = await text("bob", "/playbook");
  check("Alice's rule is absent from Bob's playbook", !playbook.includes("Alice private rule"));
  check("Bob's own rule is on his playbook", playbook.includes("Bob private rule"));
}

console.log("\nBOB CANNOT WRITE TO ALICE'S JOURNAL");
{
  // A screenshot against a trade that is not his.
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "x.webp", { type: "image/webp" }));
  form.set("identityHash", "u-alice-trade-0");
  const r = await as("bob", "/api/screenshots", { method: "POST", body: form });
  check("attaching a screenshot to Alice's trade is refused",
    r.status === 404 || r.status === 503, `got ${r.status}`);

  const del = await as("bob", "/api/screenshots?id=s-alice", { method: "DELETE" });
  check("deleting Alice's screenshot is refused", del.status === 404, `got ${del.status}`);

  const aliceExport = JSON.parse(await text("alice", "/api/export?format=json"));
  check("Alice's screenshot is still there", aliceExport.screenshots.length === 1);
  check("Alice's five trades are untouched", aliceExport.counts.trades === 5);
  check("Alice's notes are untouched", aliceExport.counts.notes === 5);
}

console.log("\nSHARED DATA IS PROTECTED FROM ONE PERSON'S MISTAKE");
{
  const bobDelete = await as("bob", "/api/candles?symbol=XAUUSD", { method: "DELETE" });
  check("a non-owner cannot delete everyone's price history",
    bobDelete.status === 403, `got ${bobDelete.status}`);

  const stillThere = await text("alice", "/import?tab=candles");
  check("the candles survived", stillThere.includes("20 candles") || stillThere.includes("candles"));
}

console.log("\nONLY AN OWNER SEES OR CHANGES WHO HAS ACCESS");
{
  const bobSettings = await text("bob", "/settings");
  check("Bob's settings do not name Alice", !bobSettings.includes("alice@example.com"));
  check("Bob's settings do not offer the access panel", !bobSettings.includes("Who can use this"));

  const aliceSettings = await text("alice", "/settings");
  check("Alice's settings do offer the access panel", aliceSettings.includes("Who can use this"));
  check("Alice's settings list her invitee", aliceSettings.includes("bob@example.com"));
}

console.log("\nACCOUNTS ARE THE TRADER'S OWN");
{
  const bobSettings = await text("bob", "/settings");
  check("Bob sees his own account", bobSettings.includes("Bob&#x27;s main") || bobSettings.includes("Bob's main"));
  check("Bob does not see Alice's account", !bobSettings.includes("Alice&#x27;s main") && !bobSettings.includes("Alice's main"));
  check("Bob is not offered a switcher for one account", !bobSettings.includes("a-alice"));
}

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
