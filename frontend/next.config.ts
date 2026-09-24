import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The Docker image runs the standalone server output.
  output: "standalone",
};

export default nextConfig;
