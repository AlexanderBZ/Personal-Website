import { headers } from "next/headers";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24 hours

/**
 * Parses `ADMIN_ALLOWED_EMAILS` (comma-separated) into a normalized lowercase set.
 * Fails closed: returns an empty set when unset or blank.
 */
export function getAllowedAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_ALLOWED_EMAILS;
  if (!raw) return new Set();

  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Checks whether an email address is on the `ADMIN_ALLOWED_EMAILS` allowlist. */
export function isAllowedAdminEmail(email: unknown): boolean {
  if (typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  return getAllowedAdminEmails().has(normalized);
}

/**
 * Enforces that incoming GitHub OAuth users have a verified email on
 * `ADMIN_ALLOWED_EMAILS`. Throws `APIError("FORBIDDEN")` so Better Auth aborts
 * sign-in and redirects to `errorCallbackURL` with `?error=ACCESS_DENIED`.
 */
export function assertAllowedAdminUser(user: {
  email?: string | null;
  emailVerified?: boolean | null;
}): void {
  if (user.emailVerified !== true || !isAllowedAdminEmail(user.email)) {
    throw new APIError("FORBIDDEN", {
      code: "ACCESS_DENIED",
      message: "That GitHub account is not authorized for this studio.",
    });
  }
}

export const auth = betterAuth({
  // Stateless mode (no database): encrypted JWE session cookie + cookie OAuth state
  baseURL: process.env.BETTER_AUTH_URL || undefined,
  secret: process.env.BETTER_AUTH_SECRET || undefined,
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    },
  },
  session: {
    expiresIn: SESSION_TTL_SECONDS,
    cookieCache: {
      enabled: true,
      maxAge: SESSION_TTL_SECONDS,
      strategy: "jwe",
      refreshCache: true,
    },
  },
  account: {
    storeStateStrategy: "cookie",
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          assertAllowedAdminUser(user);
          return { data: user };
        },
      },
    },
  },
  plugins: [nextCookies()], // keep last — sets cookies from Server Actions
});

/**
 * Checks whether the current request has a valid Better Auth session whose
 * verified email is still on `ADMIN_ALLOWED_EMAILS` (defense-in-depth DAL check).
 */
export async function isAdminAuthenticated(): Promise<boolean> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  return Boolean(
    session?.user?.emailVerified === true &&
      isAllowedAdminEmail(session.user.email),
  );
}

/**
 * Verifies that state-changing requests (`POST`, `DELETE`) originate from the same host
 * to prevent Cross-Site Request Forgery (CSRF).
 *
 * When `BETTER_AUTH_URL` is configured, compares `Origin` strictly against that canonical
 * origin (preventing `x-forwarded-host` spoofing on self-hosted deployments). Otherwise
 * falls back to `host` (or `x-forwarded-host` on Vercel, where the edge proxy overwrites it).
 */
export async function verifySameOrigin(): Promise<boolean> {
  const headerStore = await headers();

  // Reject cross-site requests flagged by modern Fetch Metadata headers
  const secFetchSite = headerStore.get("sec-fetch-site");
  if (
    secFetchSite &&
    secFetchSite !== "same-origin" &&
    secFetchSite !== "none"
  ) {
    return false;
  }

  const origin = headerStore.get("origin");
  if (!origin) return false;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const configuredBaseUrl = process.env.BETTER_AUTH_URL?.trim();
  if (configuredBaseUrl) {
    try {
      const expectedOrigin = new URL(configuredBaseUrl).origin;
      return originUrl.origin.toLowerCase() === expectedOrigin.toLowerCase();
    } catch {
      return false;
    }
  }

  const rawForwardedHost = process.env.VERCEL
    ? headerStore.get("x-forwarded-host")
    : null;
  const host =
    rawForwardedHost?.split(",")[0]?.trim() || headerStore.get("host");

  if (!host) return false;

  return originUrl.host.toLowerCase() === host.toLowerCase();
}
