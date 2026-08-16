import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["esbuild"],
  outputFileTracingIncludes: {
    "/preview/*": [
      "./node_modules/react/**/*",
      "./node_modules/react-dom/**/*",
      "./node_modules/scheduler/**/*",
    ],
  },
};

export default nextConfig;
