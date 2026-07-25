import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // The file itself is capped at 4 MiB. This leaves multipart overhead
      // below Vercel's 4.5 MB function request limit.
      bodySizeLimit: "4.5mb",
    },
  },
};

export default nextConfig;
