import type { NextConfig } from "next";

// Where sar-web-api (backend/ of this repository) listens. The browser never
// talks to it directly: /api/v2/* is rewritten to it (same origin, no CORS
// needed) and proxy.ts adds the bearer token from the httpOnly session cookie.
const apiUrl = (process.env.SAR_WEB_API_URL ?? "http://127.0.0.1:8200").replace(/\/$/, "");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    return [{ source: "/", destination: "/overview", permanent: false }];
  },
  async rewrites() {
    return [
      {
        source: "/api/v2/:path*",
        destination: `${apiUrl}/api/v2/:path*`,
      },
    ];
  },
};

export default nextConfig;
