import type { PostHog } from "posthog-js";

let posthogPromise: Promise<PostHog | null> | null = null;
let loadedPostHog: PostHog | null = null;
let initialized = false;

function getPostHogToken(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ||
    process.env.NEXT_PUBLIC_POSTHOG_KEY
  );
}

export function isLocalClientHost(hostname?: string): boolean {
  const host =
    hostname ?? (typeof window !== "undefined" ? window.location.hostname : "");
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".localhost")
  );
}

export function shouldEnableClientPostHog(params?: {
  token?: string;
  nodeEnv?: string;
  enableLocal?: string;
  hostname?: string;
}): boolean {
  const token = params?.token ?? getPostHogToken();
  const nodeEnv = params?.nodeEnv ?? process.env.NODE_ENV;
  const enableLocal =
    params?.enableLocal ?? process.env.NEXT_PUBLIC_POSTHOG_ENABLE_LOCAL;
  const isLocalEnv =
    nodeEnv !== "production" || isLocalClientHost(params?.hostname);
  return Boolean(token) && (!isLocalEnv || enableLocal === "true");
}

/**
 * Lazily imports and initializes `posthog-js` only when analytics are enabled,
 * keeping the ~350 KB SDK out of the initial critical bundle.
 */
export function loadPostHog(): Promise<PostHog | null> {
  const token = getPostHogToken();
  if (typeof window === "undefined" || !token || !shouldEnableClientPostHog()) {
    return Promise.resolve(null);
  }

  if (loadedPostHog) {
    return Promise.resolve(loadedPostHog);
  }

  if (!posthogPromise) {
    posthogPromise = import("posthog-js")
      .then(({ default: posthog }) => {
        if (!initialized) {
          const isLocalEnabled =
            process.env.NEXT_PUBLIC_POSTHOG_ENABLE_LOCAL === "true";
          posthog.init(token, {
            api_host: "/ingest",
            ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST?.includes("eu.")
              ? "https://eu.posthog.com"
              : "https://us.posthog.com",
            defaults: "2026-08-30",
            capture_exceptions: true,
            debug: isLocalEnabled,
          });
          initialized = true;
        }
        loadedPostHog = posthog;
        return posthog;
      })
      .catch(() => {
        posthogPromise = null;
        return null;
      });
  }

  return posthogPromise;
}

/** Defers PostHog loading until the browser is idle after initial hydration. */
export function initPostHogDeferred(): void {
  if (typeof window === "undefined") return;

  const isLocalEnabled =
    process.env.NEXT_PUBLIC_POSTHOG_ENABLE_LOCAL === "true";
  if (!shouldEnableClientPostHog()) {
    if (isLocalEnabled && !getPostHogToken()) {
      console.warn(
        "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured",
      );
    }
    return;
  }

  const start = () => {
    void loadPostHog();
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(start, { timeout: 2000 });
  } else {
    window.setTimeout(start, 1);
  }
}

export function captureClientEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (loadedPostHog) {
    loadedPostHog.capture(event, properties);
    return;
  }
  void loadPostHog().then((ph) => {
    ph?.capture(event, properties);
  });
}

export function captureClientException(error: unknown): void {
  if (loadedPostHog) {
    loadedPostHog.captureException(error);
    return;
  }
  void loadPostHog().then((ph) => {
    ph?.captureException(error);
  });
}

export function identifyClientUser(
  distinctId: string,
  properties?: Record<string, unknown>,
): void {
  if (loadedPostHog) {
    loadedPostHog.identify(distinctId, properties);
    return;
  }
  void loadPostHog().then((ph) => {
    ph?.identify(distinctId, properties);
  });
}

export function resetClientPostHog(): void {
  loadedPostHog?.reset();
}

export function getPostHogCorrelationHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const distinctId = loadedPostHog?.get_distinct_id?.();
  const sessionId = loadedPostHog?.get_session_id?.();
  if (distinctId) headers["X-POSTHOG-DISTINCT-ID"] = distinctId;
  if (sessionId) headers["X-POSTHOG-SESSION-ID"] = sessionId;
  return headers;
}
