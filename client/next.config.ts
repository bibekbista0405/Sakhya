import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,

  // Keep App Router bundles alive longer during development. This avoids a
  // Windows/HMR edge case where an actively requested route can be evicted
  // while Next is still trying to serve its generated server file.
  onDemandEntries: {
    maxInactiveAge: 60 * 60 * 1000,
    pagesBufferLength: 20,
  },

  webpack: (config) => {
    // @matrix-org/olm is a browser-side WASM library, but its UMD wrapper
    // contains optional Node fs/path/crypto requires. Next.js can see those
    // requires while SSR-bundling a Client Component, so stub them out.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    };
    return config;
  },
};

export default nextConfig;
