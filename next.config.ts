import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  experimental: { agentUpgrade: "security" },
};

export default withEve(nextConfig);
