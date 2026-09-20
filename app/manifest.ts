import type { MetadataRoute } from "next";

/**
 * Makes the journal installable to a home screen.
 *
 * Worth the twenty lines because of where this app is actually used: on a
 * phone, in the evening, after the session. Added to the home screen it opens
 * without a browser bar — which is a third of a small screen back, no address
 * field to fat-finger, and the bottom tab bar sitting where a native app's
 * would. Nothing else in this file changes behaviour; it changes whether the
 * thing feels like an app or like a website you have to go and find.
 *
 * Portrait only, because every layout here is a single column and a landscape
 * phone would show three lines of content between two bars.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LogR — trade journal",
    short_name: "LogR",
    description: "A trade journal for leveraged traders.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0b0d",
    theme_color: "#0a0b0d",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android launchers crop to their own shape, so this one keeps the drawing
      // well inside the circle they are allowed to cut to.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
