import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/themes";

/**
 * Fonts are bundled with the app, not fetched from Google at run time.
 *
 * A stylesheet link to fonts.googleapis.com blocks the first paint on a round
 * trip to Google, then a second one to fonts.gstatic.com for the files
 * themselves — and this app is read on a phone, often on mobile data, a long
 * way from either. Self-hosting removes both crossings and the layout shift
 * that follows them, and costs nothing but build time.
 */
/*
 * Geist, with Geist Mono kept for prices only.
 *
 * Every figure in the app used to be set in a monospace face, which is how a
 * terminal looks rather than how a finance app does — the money in Revolut,
 * Robinhood and Stripe is a proportional face with TABULAR figures, so columns
 * still line up without every number looking like code. Geist has those
 * figures built in. The monospace stays where it earns its place: a price
 * ladder on a chart, where digit-for-digit alignment is the point.
 */
const sans = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist",
  display: "swap",
});
const mono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "LogR", template: "%s · LogR" },
  description: "A trade journal for leveraged traders.",
  applicationName: "LogR",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    // iOS ignores the manifest's icons and transparency both, so it gets its own.
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "LogR", statusBarStyle: "black-translucent" },
  // A journal is nobody's business but the trader's, and a search engine has
  // nothing to index here but a sign-in page.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the layout paint under the notch and the home indicator; the tab bar
  // already pads itself with the safe-area inset.
  viewportFit: "cover",
  // Matched to each theme's page background, so the phone's own status bar and
  // the app are the same colour instead of meeting at a seam.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f3f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0b0d" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Before anything paints — see THEME_BOOT_SCRIPT. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
