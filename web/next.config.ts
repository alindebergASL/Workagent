import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname, "..") },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
