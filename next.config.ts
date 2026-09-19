import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // typedRoutes is deliberately off: it cannot express hrefs built from a
  // template literal (the period tabs append ?period=…), and working around that
  // with casts costs more clarity than the checking buys back.
  typedRoutes: false,
};

export default nextConfig;
