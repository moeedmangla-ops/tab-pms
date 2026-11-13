import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["@prisma/client", "exceljs", "pg-boss"],
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
    ] }];
  },
};
export default config;
