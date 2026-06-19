import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ESLint flat-config crashes under `next build` ("nextVitals is not iterable");
  // lint runs separately. Types are still fully checked by tsc during the build.
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
