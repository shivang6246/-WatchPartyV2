import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // One less header on every response, and nothing to fingerprint.
  poweredByHeader: false,
  // The Docker image runs the standalone server output.
  output: "standalone",
};

export default nextConfig;
