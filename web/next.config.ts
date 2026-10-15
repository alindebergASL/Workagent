import type { NextConfig } from "next";
import path from "node:path";
import { APP_SECURITY_HEADERS } from "./src/lib/security-headers.mjs";

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname, "..") },
  reactStrictMode: true,
  poweredByHeader: false,
  webpack(config, { isServer }) {
    // Next 16.3.4 omits concatenated client module ID 0 from its manifest.
    // Named client IDs avoid that omission without patching the dependency.
    if (!isServer) config.optimization.moduleIds = "named";
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: APP_SECURITY_HEADERS }];
  },
};

export default nextConfig;
