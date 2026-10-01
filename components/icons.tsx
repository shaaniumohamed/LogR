/**
 * One small icon set, drawn on a 24-unit grid with a single stroke weight.
 *
 * Inline rather than an icon library: there are about twenty of them, they are
 * a few hundred bytes together, and a library would ship thousands to use
 * these. Drawn as plain geometry so every one shares the same visual weight —
 * which is most of what makes a set of icons look like it belongs together.
 */
const PATHS = {
  home: "M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6.5H9V21H4.5a1 1 0 0 1-1-1z",
  trades: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  review: "M9 3.5h6v3H9zM15.5 5H18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5M8.5 13.5l2.5 2.5 4.5-4.5",
  insights: "M3.5 20.5h17M7 17v-5M12 17V7M17 17v-8",
  more: "M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z",
  calendar: "M4 6.5h16V20H4zM4 10.5h16M8.5 3.5v4M15.5 3.5v4",
  week: "M4 6.5h16V20H4zM4 10.5h16M8.5 3.5v4M15.5 3.5v4M8 15h8",
  playbook: "M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7.5h6",
  upload: "M12 15.5V4M7.5 8.5 12 4l4.5 4.5M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15",
  candles: "M7.5 3.5v17M16.5 3.5v17M5.5 8h4v7h-4zM14.5 10h4v5h-4z",
  news: "M13 3 5 13.5h6L10 21l8-10.5h-6z",
  settings: "M4 6.5h9M17 6.5h3M15 4.5v4M4 12h3M11 12h9M9 10v4M4 17.5h11M19 17.5h1M17 15.5v4",
  signout: "M14.5 4.5h3a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-3M10 16l-4-4 4-4M6 12h9.5",
  chevron: "M9.5 6l6 6-6 6",
  back: "M14.5 6l-6 6 6 6",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5a6 6 0 0 1 3 5.5",
  download: "M12 4v11.5M7.5 11 12 15.5l4.5-4.5M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15",
  leak: "M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z",
  bolt: "M13 3 5 13.5h6L10 21l8-10.5h-6z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2",
  mind: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8M9 9.5h.01M15 9.5h.01",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 12h.01",
  shield: "M12 3.5 5 6.5v5c0 4.5 3 7.8 7 9 4-1.2 7-4.5 7-9v-5z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, strokeWidth = 1.75, className = "" }: {
  name: IconName; size?: number; strokeWidth?: number; className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
         strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
         className={`shrink-0 ${className}`} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
