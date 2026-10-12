import type { NextConfig } from "next";
import path from "node:path";
import { APP_SECURITY_HEADERS } from "./src/lib/security-headers.mjs";

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname, "..") },
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: APP_SECURITY_HEADERS }];
  },
};

export default nextConfig;
