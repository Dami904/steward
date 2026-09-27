import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @steward/engine ships as raw TS (packages/engine/src, no build step — it runs unbuilt
  // via node --experimental-strip-types elsewhere in this repo too). Next.js
  // doesn't transpile workspace-linked node_modules by default; this opts it in so the
  // verifier can import the exact same policy engine the contracts and CI differential
  // suite already agree on, not a reimplementation.
  transpilePackages: ["@steward/engine"],
};

export default nextConfig;
