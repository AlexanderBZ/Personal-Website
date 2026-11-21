import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAllAdminPosts = vi.fn();

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: vi.fn(() => null),
  })),
}));

vi.mock("@/lib/posts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/posts")>();
  return {
    ...actual,
    getAllAdminPosts: (...args: unknown[]) => mockGetAllAdminPosts(...args),
  };
});

import StudioPage from "@/app/studio/page";
import { auth } from "@/lib/auth";

describe("Admin page server component", () => {
  let getSessionSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ADMIN_ALLOWED_EMAILS", "admin@example.com");
    getSessionSpy = vi.spyOn(auth.api, "getSession");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("renders only the GitHub login gate and skips loading posts when signed out", async () => {
    getSessionSpy.mockResolvedValue(null);

    const html = renderToStaticMarkup(await StudioPage());

    expect(html).toContain("Continue with GitHub");
    expect(html).not.toContain(">Publish<");
    expect(mockGetAllAdminPosts).not.toHaveBeenCalled();
  });

  it("renders an authorization error when redirected back with ACCESS_DENIED", async () => {
    getSessionSpy.mockResolvedValue(null);

    const html = renderToStaticMarkup(
      await StudioPage({ searchParams: Promise.resolve({ error: "ACCESS_DENIED" }) }),
    );

    expect(html).toContain("That GitHub account is not authorized for this studio.");
    expect(mockGetAllAdminPosts).not.toHaveBeenCalled();
  });

  it("loads posts including drafts and renders the studio when the session email is allowlisted", async () => {
    getSessionSpy.mockResolvedValue({
      user: { email: "admin@example.com", emailVerified: true },
    });
    mockGetAllAdminPosts.mockResolvedValue([
      {
        id: "admin-page-post",
        title: "Admin Page Post",
        date: "2026-11-11",
        summary: "Loaded by the admin page.",
        status: "draft",
        content: ["Body copy for the studio."],
      },
    ]);

    const html = renderToStaticMarkup(await StudioPage());

    expect(mockGetAllAdminPosts).toHaveBeenCalledTimes(1);
    expect(html).toContain(">Publish<");
    expect(html).not.toContain("Save draft");
    expect(html).toContain('<span class="freewrite-badge">Draft</span>');
    expect(html).toContain('value="Admin Page Post"');
    expect(html).toContain("History (1)");
    expect(html).not.toContain("Continue with GitHub");
  });

  it("renders the login gate when the session email is not on the allowlist", async () => {
    getSessionSpy.mockResolvedValue({
      user: { email: "stranger@example.com", emailVerified: true },
    });

    const html = renderToStaticMarkup(await StudioPage());

    expect(html).toContain("Continue with GitHub");
    expect(mockGetAllAdminPosts).not.toHaveBeenCalled();
  });
});
