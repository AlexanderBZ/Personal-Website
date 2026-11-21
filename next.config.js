import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== "production";

// Proxy to the region in NEXT_PUBLIC_POSTHOG_HOST: us.i.posthog.com or eu.i.posthog.com
let apiHost = "us.i.posthog.com";
try {
  if (process.env.NEXT_PUBLIC_POSTHOG_HOST) {
    apiHost = new URL(process.env.NEXT_PUBLIC_POSTHOG_HOST).hostname;
  }
} catch {
  apiHost = "us.i.posthog.com";
}
const assetHost = apiHost.replace(".i.posthog.com", "-assets.i.posthog.com");

const cspHeader = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://*.posthog.com`,
  "style-src 'self' 'unsafe-inline' https://*.posthog.com",
  "img-src 'self' data: blob: https://*.posthog.com",
  "font-src 'self' https://*.posthog.com",
  "connect-src 'self' https://*.posthog.com",
  "worker-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const adminNoCacheHeaders = [
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive",
  },
  {
    key: "Cache-Control",
    value: "no-store, max-age=0",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: `https://${assetHost}/static/:path*`,
      },
      {
        source: "/ingest/array/:path*",
        destination: `https://${assetHost}/array/:path*`,
      },
      {
        source: "/ingest/:path*",
        destination: `https://${apiHost}/:path*`,
      },
    ];
  },
  // Required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      {
        // Public static/ISR routes use the static CSP; /studio gets a strict per-request nonce CSP in proxy.ts.
        source: "/((?!studio(?:/|$)).*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: cspHeader,
          },
        ],
      },
      {
        source: "/studio",
        headers: adminNoCacheHeaders,
      },
      {
        source: "/studio/:path*",
        headers: adminNoCacheHeaders,
      },
      {
        source: "/api/studio/:path*",
        headers: adminNoCacheHeaders,
      },
      {
        source: "/api/auth/:path*",
        headers: adminNoCacheHeaders,
      },
    ];
  },
};

export default nextConfig;
