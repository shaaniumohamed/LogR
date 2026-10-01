/**
 * The themes a person can pick, and the one rule about how they are applied.
 *
 * The choice lives in this device's own storage rather than in the database.
 * It could live in either — but reading it from the database would mean the
 * page cannot be drawn until the server has looked the reader up, on every
 * route including the sign-in page, and a theme is not worth a round trip to
 * another continent. The cost is that it does not follow you between a phone
 * and a laptop, which is how nearly every app behaves and nobody minds.
 */

export const THEMES = [
  { key: "system", label: "Match my phone", hint: "Light by day, dark at night" },
  { key: "light", label: "Light", hint: "Always light" },
  { key: "dark", label: "Dark", hint: "Always dark" },
  { key: "midnight", label: "Midnight", hint: "True black, easier at night" },
  { key: "paper", label: "Paper", hint: "Warm and soft, easier in sunlight" },
] as const;

export type ThemeKey = (typeof THEMES)[number]["key"];

export const THEME_STORAGE_KEY = "logr.theme";

/** The colour a phone paints its status bar, so the app and the chrome meet without a seam. */
export const THEME_PAGE_COLOUR: Record<string, string> = {
  light: "#f3f3f1",
  dark: "#0a0b0d",
  midnight: "#000000",
  paper: "#f3ede1",
};

/**
 * Applied before the page paints, inlined in the document head.
 *
 * Anything that runs after React has started is too late: the page would draw
 * in the default theme and then snap to the chosen one, which is the flash
 * every themed site used to have. Written as a string because it has to be a
 * plain script tag, and defensively because a browser in private mode throws
 * on the storage read rather than returning nothing.
 */
export const THEME_BOOT_SCRIPT = `
try {
  var t = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
  if (t && t !== "system") {
    document.documentElement.setAttribute("data-theme", t);
    var c = ${JSON.stringify(THEME_PAGE_COLOUR)}[t];
    if (c) {
      var m = document.querySelector('meta[name="theme-color"]');
      if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.appendChild(m); }
      m.setAttribute("content", c);
      m.removeAttribute("media");
    }
  }
} catch (e) {}
`.trim();
