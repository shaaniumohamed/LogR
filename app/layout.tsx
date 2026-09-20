import type { Metadata, Viewport } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Fonts are bundled with the app, not fetched from Google at run time.
 *
 * A stylesheet link to fonts.googleapis.com blocks the first paint on a round
 * trip to Google, then a second one to fonts.gstatic.com for the files
 * themselves — and this app is read on a phone, often on mobile data, a long
 * way from either. Self-hosting removes both crossings and the layout shift
 * that follows them, and costs nothing but build time.
 */
const sans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-instrument",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains",
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
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
