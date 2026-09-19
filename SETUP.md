# Running and deploying LogR

Everything here is on a **free tier**. No card required at any step.

| Piece | Service | Free allowance |
|---|---|---|
| Hosting | **Vercel Hobby** | Free for non-commercial projects |
| Database | **Neon** Postgres | 0.5 GB storage, scale-to-zero, auto-resumes |
| Auth | **Auth.js + Google OAuth** | Free, self-hosted, **no monthly-active-user cap** |

Why Auth.js rather than a hosted auth service: the hosted free tiers are generous
but metered, and this needs no password storage or email infrastructure — Google
carries the identity and we store nothing sensitive.

---

## 1. Database (5 min)

1. Sign up at **neon.tech** → **Create project** (pick the region nearest you —
   Singapore for Malaysia).
2. Copy the **pooled** connection string. It has `-pooler` in the host, which is
   what serverless needs.
3. `cp .env.example .env.local` and paste it into `DATABASE_URL`.

## 2. Google OAuth (5 min)

1. **console.cloud.google.com** → create a project.
2. **APIs & Services → OAuth consent screen** → External → fill in the app name and
   your email. Add yourself under **Test users** while it is unpublished.
3. **Credentials → Create credentials → OAuth client ID → Web application.**
4. Authorised redirect URIs — add both:
   ```
   http://localhost:3000/api/auth/callback/google
   https://YOUR-APP.vercel.app/api/auth/callback/google
   ```
5. Put the client ID and secret into `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.

## 3. Auth secret

```bash
npx auth secret          # writes AUTH_SECRET for you
# or: openssl rand -base64 32
```

## 4. Create the tables

```bash
npm run db:push          # pushes the schema straight to Neon
```

Run this again after any `git pull` that changes `lib/db/schema.ts`. It is
non-destructive for additive changes and prints what it is about to do. The
checked-in files in `drizzle/` are the same changes as SQL, if you would rather
apply them by hand.

## 5. Run it

```bash
npm install
npm run dev              # http://localhost:3000
```

## 6. Deploy to Vercel

```bash
npm i -g vercel && vercel        # first run links the project
```
…or push to GitHub and import the repo at **vercel.com/new**.

Then in **Project → Settings → Environment Variables** add, for Production:

```
DATABASE_URL      <your Neon pooled string>
AUTH_SECRET       <the generated secret>
AUTH_GOOGLE_ID    <from Google>
AUTH_GOOGLE_SECRET
AUTH_URL          https://YOUR-APP.vercel.app
ALLOWED_EMAILS    you@example.com,friend@example.com   (optional)
```

`ALLOWED_EMAILS` is the private-beta gate: leave it empty and anyone with a Google
account can sign in; set it and only those addresses can.

Redeploy after adding the variables, and add the production callback URL to Google
if you have not already.

---

## Importing your history

Exness Personal Area → **Trading → History of orders → Download CSV**.

The export is capped at 1,000 rows, so pull it in date chunks. Re-importing an
overlapping range is harmless — rows are unique on `(account, ticket, closedAt)`,
so a repeat insert is a no-op rather than a duplicate.

That key is deliberate. A ticket identifies a *position*, and a position closed in
parts emits one row per partial exit, all carrying the same ticket. Keying on the
ticket alone silently drops real exits.

The CSV is parsed **in your browser**; only normalised rows are sent to the server.
That keeps a multi-month export well clear of serverless request limits, and you
see the reconciliation screen before anything is saved.

**Do not import the Trading Analytics PDF** — it is a summary of totals with no
per-trade rows. The importer detects it and says so rather than failing obscurely.

## Importing price history

**Import → Price history.** Optional, and it needs no extra configuration or
service — price bars live in the same Neon database.

Any CSV works as long as each row carries a timestamp followed by open, high, low
and close; the separator, the column order and whether there is a header are all
worked out from the file. Free sources:

| Source | Format | Time zone |
|---|---|---|
| HistData.com | `YYYYMMDD HHMMSS;O;H;L;C;V`, one zip a month | **US Eastern** — pick it in the dropdown |
| Dukascopy historical feed | CSV with a header | UTC |
| MT5 desktop / TradingView chart export | CSV with a header | the platform's own |

Before anything is saved the file is checked against your own fills: a fill
happened at a price the market was really trading, so it must sit inside the high
and low of the minute it happened in. The screen reports what share of your fills
pass, and if the file is simply in the wrong zone it works out the shift and
offers to apply it. A file that spans a daylight-saving change is recognised as
such, because no single shift can fix one.

Bars are stored at one minute only; five-minute, fifteen-minute and hourly views
are rolled up in the browser. Roughly 40 MB a year for gold.

Price history is **shared between accounts**, not per user — a gold candle is the
same candle for everybody, and there is nothing private in it.

## Commands

```bash
npm run dev         npm run build       npm start
npm run typecheck   npm test            npm run db:push    npm run db:studio
```

## Cost ceiling

Nothing in this stack bills by default. Neon's free project suspends when idle and
resumes on the next query in well under a second; Vercel Hobby has no spend unless
you opt in. The only thing to watch is Neon's 0.5 GB — roughly a decade of trading
at 100 orders a day for the trade data itself. One-minute candles add about 40 MB
a year per instrument, which still leaves the better part of a decade.
