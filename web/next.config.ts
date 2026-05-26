import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Repo root has a package-lock for the AJV schema-validation tooling.
  // Pin the workspace root to web/ so Next stops choosing the wrong one.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
