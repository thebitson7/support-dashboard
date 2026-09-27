import type { NextConfig } from "next";

/**
 * Security headers on every response this server sends. It's the only thing
 * browsers talk to (Django sits behind it), so they belong here.
 *
 * HSTS is opt-in, as on the Django side: browsers remember it, so set
 * HSTS_MAX_AGE (seconds, e.g. 31536000) only once HTTPS is confirmed working.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.HSTS_MAX_AGE
    ? [{ key: "Strict-Transport-Security", value: `max-age=${process.env.HSTS_MAX_AGE}` }]
    : []),
];

const nextConfig: NextConfig = {
  // Don't advertise the framework.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
