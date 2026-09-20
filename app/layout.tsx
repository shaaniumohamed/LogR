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
  title: "LogR",
  description: "A trade journal for leveraged traders.",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
