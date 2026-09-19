import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Domain logic lives in lib/core and must stay free of framework imports so it
  // can run in the browser (statement parsing) and on the server (ingest) alike.
  typedRoutes: true,
};

export default nextConfig;
