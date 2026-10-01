/**
 * Opens every screen at phone width and reports what is broken.
 *
 * Two failures are worth catching automatically because they are invisible in a
 * desktop browser and obvious on a phone. The first is horizontal overflow: one
 * element wider than the viewport makes the WHOLE page scroll sideways, which
 * pushes the right-hand edge of every card off screen and cannot be recovered
 * from by zooming. The second is a control too small to hit — a text-only link
 * is often sixteen pixels tall, which is fine with a mouse and a coin toss with
 * a thumb.
 *
 * Both colour schemes, because dark mode here is a separate set of tokens
 * rather than an automatic inversion, and four widths, from the narrowest phone
 * still in use to the largest.
 *
 * It needs a local server with seeded data:
 *
 *   node scripts/seed-dev.mjs "postgresql://logr@localhost:55432/logr"
 *   npm run build && npx next start -p 3123
 *   node scripts/ui-audit.mjs                    # or a list of paths
 *
 * A session cookie for the seeded user goes in /var/tmp/logr-token.txt.
 * Screenshots land in /var/tmp/shots for looking at by eye, which is still the
 * only way to catch the things a script cannot describe.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const TOKEN = readFileSync("/var/tmp/logr-token.txt", "utf8").trim();
const BASE = "http://127.0.0.1:3123";
const OUT = "/var/tmp/shots";
mkdirSync(OUT, { recursive: true });

const DEVICES = [
  { name: "se", width: 320, height: 568, dsr: 2 },      // iPhone SE 1st gen / small Android
  { name: "android", width: 360, height: 740, dsr: 3 }, // the commonest Android width
  { name: "iphone", width: 390, height: 844, dsr: 3 },  // iPhone 14/15
  { name: "max", width: 430, height: 932, dsr: 3 },     // iPhone Pro Max
];

const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : [
  "/dashboard", "/calendar", "/trades", "/analytics", "/analytics?view=mind", "/analytics?view=timing",
  "/analytics?view=setups", "/analytics?view=risk", "/playbook", "/review", "/settings", "/import", "/more",
  // A trade, week and day that exist in the deterministic scripts/seed-dev.mjs data.
  "/trades/0666be7bc3e3f835", "/week/2026-09-14", "/day/2026-09-17",
];

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--force-color-profile=srgb"],
});
const findings = [];

for (const d of DEVICES) {
  const ctx = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    colorScheme: process.env.SCHEME === "light" ? "light" : "dark",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  await ctx.addCookies([{
    name: "authjs.session-token", value: TOKEN,
    domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax",
  }]);
  /*
   * A chosen theme is not the same thing as a colour scheme.
   *
   * The scheme above is what the phone reports; a theme is an attribute on the
   * document, stored on the device. Midnight and Paper are reachable through
   * neither of the two schemes, so without this they would be the only screens
   * in the app nothing ever looked at.
   */
  if (process.env.THEME) {
    await ctx.addInitScript(
      (t) => { try { localStorage.setItem("logr.theme", t); } catch {} },
      process.env.THEME,
    );
  }
  const page = await ctx.newPage();

  for (const path of PAGES) {
    const slug = path.replace(/\W+/g, "_").replace(/^_|_$/g, "") || "root";
    await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(400);

    // Horizontal overflow is the defining mobile bug: it makes the whole page
    // scroll sideways and pushes the right edge of every card off screen.
    const overflow = await page.evaluate(() => {
      const docW = document.documentElement.clientWidth;
      const bad = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > docW + 1 || r.left < -1) {
          const style = getComputedStyle(el);
          // An element inside a deliberately scrollable strip is fine.
          let p = el.parentElement, scrollable = false;
          while (p && p !== document.body) {
            const ps = getComputedStyle(p);
            if (ps.overflowX === "auto" || ps.overflowX === "scroll") { scrollable = true; break; }
            p = p.parentElement;
          }
          if (scrollable) continue;
          bad.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className || "").toString().slice(0, 70),
            text: (el.textContent || "").trim().slice(0, 40),
            left: Math.round(r.left), right: Math.round(r.right), docW,
          });
        }
      }
      return {
        pageScrollsSideways: document.documentElement.scrollWidth > docW + 1,
        scrollWidth: document.documentElement.scrollWidth,
        docW,
        offenders: bad.slice(0, 6),
      };
    });

    // Anything genuinely too small to hit with a thumb.
    const tinyTargets = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("a, button, summary, input, select")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // A radio or checkbox hidden behind its own label is not a tap target;
        // the label is, and it gets measured on its own account.
        if (r.width <= 2 || r.height <= 2) continue;
        const cs = getComputedStyle(el);
        if (cs.opacity === "0" || cs.visibility === "hidden") continue;
        if (r.height < 24 || r.width < 24) {
          out.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30),
            w: Math.round(r.width), h: Math.round(r.height),
          });
        }
      }
      return out.slice(0, 8);
    });

    if (overflow.pageScrollsSideways || overflow.offenders.length || tinyTargets.length) {
      findings.push({ device: d.name, width: d.width, path, overflow, tinyTargets });
    }

    await page.screenshot({ path: `${OUT}/${process.env.SCHEME ?? "dark"}-${d.name}-${slug}.png`, fullPage: true });
  }
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/findings.json`, JSON.stringify(findings, null, 2));
console.log(JSON.stringify(findings, null, 2));
console.log(`\n${findings.length} pages with findings`);
