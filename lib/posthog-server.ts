import { PostHog } from "posthog-node";

let posthogClient: PostHog | null = null;

export function isLocalhostHost(host?: string | null): boolean {
  if (!host) return false;
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return false;

  // Strip port from IPv4/hostname (e.g., localhost:3000) or bracketed IPv6 (e.g., [::1]:3000)
  const hostname = trimmed.startsWith("[")
    ? trimmed.slice(0, trimmed.indexOf("]") + 1)
    : trimmed.split(":")[0];

  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

export function shouldEnablePostHog(options?: {
  token?: string;
  nodeEnv?: string;
  enableLocal?: string;
  host?: string | null;
}): boolean {
  const token = (
    options?.token ??
    (process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ||
      process.env.NEXT_PUBLIC_POSTHOG_KEY ||
      "")
  ).trim();

  if (!token) return false;

  const nodeEnv = options?.nodeEnv ?? process.env.NODE_ENV;
  const enableLocal =
    options?.enableLocal ?? process.env.NEXT_PUBLIC_POSTHOG_ENABLE_LOCAL;

  const isLocalEnabled = enableLocal === "true";
  const isLocalEnv =
    nodeEnv !== "production" || isLocalhostHost(options?.host);

  if (isLocalEnv && !isLocalEnabled) {
    return false;
  }

  return true;
}

function getRequestHost(request?: Request): string | null {
  if (!request) return null;
  const headerHost =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (headerHost) return headerHost;
  try {
    return new URL(request.url).host;
  } catch {
    return null;
  }
}

export function getPostHogClient(request?: Request): PostHog | null {
  const token =
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ||
    process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const isLocalEnabled =
    process.env.NEXT_PUBLIC_POSTHOG_ENABLE_LOCAL === "true";

  if (!token) {
    if (isLocalEnabled) {
      console.warn(
        "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured",
      );
    }
    return null;
  }

  if (!shouldEnablePostHog({ token, host: getRequestHost(request) })) {
    return null;
  }

  if (!posthogClient) {
    posthogClient = new PostHog(token, {
      host:
        process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
      requestTimeout: 2000,
      fetchRetryCount: 0,
      enableExceptionAutocapture: process.env.NEXT_RUNTIME === "nodejs",
    });

    if (isLocalEnabled) {
      posthogClient.debug(true);
    }
  }

  return posthogClient;
}

export function getPostHogCorrelationFromRequest(request?: Request): {
  distinctId?: string;
  sessionId?: string;
} {
  if (!request) return {};
  const distinctId =
    request.headers.get("x-posthog-distinct-id")?.trim() || undefined;
  const sessionId =
    request.headers.get("x-posthog-session-id")?.trim() || undefined;
  return { distinctId, sessionId };
}

export async function shutdownPostHog(): Promise<void> {
  if (posthogClient) {
    const client = posthogClient;
    posthogClient = null;
    await client.shutdown(3000).catch(() => {});
  }
}

