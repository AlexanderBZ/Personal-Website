import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockHeaderGet = vi.fn();

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: mockHeaderGet,
  })),
}));

import {
  assertAllowedAdminUser,
  auth,
  getAllowedAdminEmails,
  isAdminAuthenticated,
  isAllowedAdminEmail,
  verifySameOrigin,
} from "@/lib/auth";

describe("lib/auth (Better Auth)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "ADMIN_ALLOWED_EMAILS",
      "Admin@Example.com, coauthor@example.com ",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("getAllowedAdminEmails & isAllowedAdminEmail", () => {
    it("normalizes comma-separated allowlist emails and fails closed when unset", () => {
      expect(Array.from(getAllowedAdminEmails())).toEqual([
        "admin@example.com",
        "coauthor@example.com",
      ]);

      expect(isAllowedAdminEmail("admin@example.com")).toBe(true);
      expect(isAllowedAdminEmail("  ADMIN@EXAMPLE.COM  ")).toBe(true);
      expect(isAllowedAdminEmail("intruder@example.com")).toBe(false);
      expect(isAllowedAdminEmail("")).toBe(false);
      expect(isAllowedAdminEmail(null)).toBe(false);

      vi.stubEnv("ADMIN_ALLOWED_EMAILS", "");
      expect(getAllowedAdminEmails().size).toBe(0);
      expect(isAllowedAdminEmail("admin@example.com")).toBe(false);
    });
  });

  describe("assertAllowedAdminUser", () => {
    it("allows verified GitHub emails on the allowlist", () => {
      expect(() =>
        assertAllowedAdminUser({
          email: "Admin@Example.com",
          emailVerified: true,
        }),
      ).not.toThrow();
    });

    it("rejects unverified or non-allowlisted emails with ACCESS_DENIED", () => {
      expect(() =>
        assertAllowedAdminUser({
          email: "admin@example.com",
          emailVerified: false,
        }),
      ).toThrowError(/not authorized/i);

      expect(() =>
        assertAllowedAdminUser({
          email: "stranger@example.com",
          emailVerified: true,
        }),
      ).toThrowError(/not authorized/i);

      expect(() =>
        assertAllowedAdminUser({
          email: null,
          emailVerified: true,
        }),
      ).toThrowError(/not authorized/i);
    });
  });

  describe("Better Auth handler", () => {
    it("responds with { ok: true } on GET /api/auth/ok", async () => {
      const response = await auth.handler(
        new Request("http://localhost:3000/api/auth/ok"),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    });
  });

  describe("isAdminAuthenticated", () => {
    it("verifies an active session, verified email, and current allowlist membership", async () => {
      const getSessionSpy = vi.spyOn(auth.api, "getSession");

      getSessionSpy.mockResolvedValueOnce({
        user: { email: "admin@example.com", emailVerified: true },
      } as Awaited<ReturnType<typeof auth.api.getSession>>);
      await expect(isAdminAuthenticated()).resolves.toBe(true);

      // Unverified email rejected
      getSessionSpy.mockResolvedValueOnce({
        user: { email: "admin@example.com", emailVerified: false },
      } as Awaited<ReturnType<typeof auth.api.getSession>>);
      await expect(isAdminAuthenticated()).resolves.toBe(false);

      // Email removed from allowlist is rejected immediately
      getSessionSpy.mockResolvedValueOnce({
        user: { email: "revoked@example.com", emailVerified: true },
      } as Awaited<ReturnType<typeof auth.api.getSession>>);
      await expect(isAdminAuthenticated()).resolves.toBe(false);

      // Missing session
      getSessionSpy.mockResolvedValueOnce(null);
      await expect(isAdminAuthenticated()).resolves.toBe(false);
    });
  });

  describe("verifySameOrigin", () => {
    beforeEach(() => {
      vi.stubEnv("BETTER_AUTH_URL", "");
      vi.stubEnv("VERCEL", "");
    });

    it("allows same-origin requests and blocks cross-origin requests", async () => {
      mockHeaderGet.mockImplementation((name: string) => {
        const map: Record<string, string> = {
          "sec-fetch-site": "same-origin",
          origin: "https://alexanderzwerner.com",
          host: "alexanderzwerner.com",
        };
        return map[name] ?? null;
      });
      await expect(verifySameOrigin()).resolves.toBe(true);

      // Cross-site sec-fetch-site header
      mockHeaderGet.mockImplementation((name: string) => {
        const map: Record<string, string> = {
          "sec-fetch-site": "cross-site",
          origin: "https://alexanderzwerner.com",
          host: "alexanderzwerner.com",
        };
        return map[name] ?? null;
      });
      await expect(verifySameOrigin()).resolves.toBe(false);

      // Mismatched origin host
      mockHeaderGet.mockImplementation((name: string) => {
        const map: Record<string, string> = {
          "sec-fetch-site": "same-origin",
          origin: "https://evil.example.com",
          host: "alexanderzwerner.com",
        };
        return map[name] ?? null;
      });
      await expect(verifySameOrigin()).resolves.toBe(false);
    });

    it("enforces BETTER_AUTH_URL origin strictly and ignores spoofed forwarded hosts", async () => {
      vi.stubEnv("BETTER_AUTH_URL", "https://alexanderzwerner.com");

      mockHeaderGet.mockImplementation((name: string) => {
        const map: Record<string, string> = {
          "sec-fetch-site": "same-origin",
          origin: "https://alexanderzwerner.com",
          host: "internal-service:3000",
          "x-forwarded-host": "evil.example.com",
        };
        return map[name] ?? null;
      });
      await expect(verifySameOrigin()).resolves.toBe(true);

      // Spoofed x-forwarded-host matching attacker origin is rejected
      mockHeaderGet.mockImplementation((name: string) => {
        const map: Record<string, string> = {
          "sec-fetch-site": "same-origin",
          origin: "https://evil.example.com",
          host: "alexanderzwerner.com",
          "x-forwarded-host": "evil.example.com",
        };
        return map[name] ?? null;
      });
      await expect(verifySameOrigin()).resolves.toBe(false);

      // Scheme downgrade (http vs https) is rejected
      mockHeaderGet.mockImplementation((name: string) => {
        const map: Record<string, string> = {
          "sec-fetch-site": "same-origin",
          origin: "http://alexanderzwerner.com",
          host: "alexanderzwerner.com",
        };
        return map[name] ?? null;
      });
      await expect(verifySameOrigin()).resolves.toBe(false);
    });

    it("only trusts x-forwarded-host fallback when running on Vercel", async () => {
      mockHeaderGet.mockImplementation((name: string) => {
        const map: Record<string, string> = {
          "sec-fetch-site": "same-origin",
          origin: "https://evil.example.com",
          host: "alexanderzwerner.com",
          "x-forwarded-host": "evil.example.com",
        };
        return map[name] ?? null;
      });
      // Self-hosted (no VERCEL env): ignores spoofed x-forwarded-host
      await expect(verifySameOrigin()).resolves.toBe(false);

      // Vercel Preview (VERCEL=1, BETTER_AUTH_URL unset): trusts edge-rewritten x-forwarded-host
      vi.stubEnv("VERCEL", "1");
      mockHeaderGet.mockImplementation((name: string) => {
        const map: Record<string, string> = {
          "sec-fetch-site": "same-origin",
          origin: "https://preview-abc.vercel.app",
          host: "internal.vercel",
          "x-forwarded-host": "preview-abc.vercel.app",
        };
        return map[name] ?? null;
      });
      await expect(verifySameOrigin()).resolves.toBe(true);
    });
  });
});
