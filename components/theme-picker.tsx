"use client";

import { useEffect, useState } from "react";
import { THEMES, THEME_PAGE_COLOUR, THEME_STORAGE_KEY, type ThemeKey } from "@/lib/themes";

/**
 * Applied the moment it is tapped, not on a save button.
 *
 * Picking a theme is the one setting where the preview IS the confirmation —
 * you cannot tell whether you want it from the name, only from the page
 * changing around you.
 */
function apply(key: ThemeKey) {
  const root = document.documentElement;
  if (key === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", key);

  // Keep the phone's status bar with the page. Without this the bar stays the
  // colour of whichever theme the document loaded in, and the seam is obvious.
  const colour = key === "system" ? null : THEME_PAGE_COLOUR[key];
  const meta = document.querySelector('meta[name="theme-color"]:not([media])')
    ?? document.head.appendChild(Object.assign(document.createElement("meta"), { name: "theme-color" }));
  if (colour) meta.setAttribute("content", colour);

  try { localStorage.setItem(THEME_STORAGE_KEY, key); } catch { /* private mode */ }
}

export function ThemePicker() {
  // Starts as null rather than "system" so the server and the first client
  // render agree: the server cannot know what this device stored, and
  // rendering a guess would make React replace the markup it just sent.
  const [picked, setPicked] = useState<ThemeKey | null>(null);
  useEffect(() => {
    try { setPicked(((localStorage.getItem(THEME_STORAGE_KEY) as ThemeKey) ?? "system")); }
    catch { setPicked("system"); }
  }, []);

  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {THEMES.map((t) => {
        const on = picked === t.key;
        return (
          <button
            key={t.key}
            type="button"
            aria-pressed={on}
            onClick={() => { apply(t.key); setPicked(t.key); }}
            className="rounded-xl p-3 text-left"
            style={{
              background: on ? "var(--s3)" : "var(--s1)",
              border: `1px solid ${on ? "var(--ink3)" : "var(--line)"}`,
            }}
          >
            <span className="flex items-center gap-2">
              <Swatch theme={t.key} />
              <span className="text-[13px] font-semibold">{t.label}</span>
            </span>
            <span className="mt-1 block text-[11.5px] leading-tight" style={{ color: "var(--ink3)" }}>
              {t.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** What it looks like, rather than what it is called. */
function Swatch({ theme }: { theme: ThemeKey }) {
  const faces: Record<ThemeKey, [string, string]> = {
    system: ["#f3f3f1", "#0a0b0d"],
    light: ["#f3f3f1", "#ffffff"],
    dark: ["#0a0b0d", "#191c23"],
    midnight: ["#000000", "#101014"],
    paper: ["#f3ede1", "#fffdf9"],
  };
  const [a, b] = faces[theme];
  return (
    <span aria-hidden className="inline-block h-4 w-4 shrink-0 overflow-hidden rounded-full"
          style={{ background: `linear-gradient(135deg, ${a} 0 50%, ${b} 50% 100%)`, border: "1px solid var(--line)" }} />
  );
}
