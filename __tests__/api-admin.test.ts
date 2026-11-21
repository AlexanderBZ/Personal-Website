import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockHeaderGet = vi.fn();
const mockRevalidatePath = vi.fn();
const mockRevalidateTag = vi.fn();
const mockBlobGet = vi.fn();
const mockBlobList = vi.fn();
const mockBlobPut = vi.fn();

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: mockHeaderGet,
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

vi.mock("@vercel/blob", () => ({
  get: (...args: unknown[]) => mockBlobGet(...args),
  list: (...args: unknown[]) => mockBlobList(...args),
  put: (...args: unknown[]) => mockBlobPut(...args),
}));

import {
  DELETE as deletePostRoute,
  GET as getPostsRoute,
  POST as savePostRoute,
} from "@/app/api/studio/posts/route";
import { auth } from "@/lib/auth";

const POSTS_FILE_PATH = path.join(process.cwd(), "lib", "posts.json");
const ADMIN_SESSION = {
  user: { email: "admin@example.com", emailVerified: true },
};

describe("Admin API routes (/api/studio/posts)", () => {
  let originalPostsJson: string;
  let mockAuth: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    originalPostsJson = fs.readFileSync(POSTS_FILE_PATH, "utf8");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ADMIN_ALLOWED_EMAILS", "admin@example.com");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("BLOB_STORE_ID", "");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "");
    mockAuth = vi.spyOn(auth.api, "getSession");

    // Default same-origin headers
    mockHeaderGet.mockImplementation((name: string) => {
      const map: Record<string, string> = {
        "sec-fetch-site": "same-origin",
        origin: "http://localhost:3000",
        host: "localhost:3000",
      };
      return map[name] ?? null;
    });
  });

  afterEach(() => {
    fs.writeFileSync(POSTS_FILE_PATH, originalPostsJson, "utf8");
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("/api/studio/posts", () => {
    it("rejects unauthenticated GET, POST, and DELETE requests with 401", async () => {
      mockAuth.mockResolvedValue(null);

      const getRes = await getPostsRoute();
      expect(getRes.status).toBe(401);

      const postRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({ title: "Test", bodyText: "Body" }),
        }),
      );
      expect(postRes.status).toBe(401);

      const delRes = await deletePostRoute(
        new Request("http://localhost:3000/api/studio/posts?id=test", {
          method: "DELETE",
        }),
      );
      expect(delRes.status).toBe(401);
    });

    it("rejects sessions whose email is not on the allowlist with 401", async () => {
      mockAuth.mockResolvedValue({ user: { email: "stranger@example.com" } });

      const getRes = await getPostsRoute();
      expect(getRes.status).toBe(401);
    });

    it("rejects cross-origin POST and DELETE requests with 403", async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION);
      mockHeaderGet.mockImplementation((name: string) => {
        if (name === "sec-fetch-site") return "cross-site";
        return null;
      });

      const postRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({ title: "Test", bodyText: "Body" }),
        }),
      );
      expect(postRes.status).toBe(403);

      const delRes = await deletePostRoute(
        new Request("http://localhost:3000/api/studio/posts?id=test", {
          method: "DELETE",
        }),
      );
      expect(delRes.status).toBe(403);
    });

    it("validates payload types and maximum body size (400 and 413)", async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION);

      const arrayPayloadRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify(["not", "an", "object"]),
        }),
      );
      expect(arrayPayloadRes.status).toBe(400);

      const oversizedBodyRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            title: "Too Large",
            bodyText: "a".repeat(100_001),
          }),
        }),
      );
      expect(oversizedBodyRes.status).toBe(413);
    });

    it("saves, lists, updates/renames, and deletes posts with path revalidation", async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION);

      // 1. Create a new post (omitting summary and title to test fallback defaults)
      const createRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "api-route-post",
            title: "   ",
            date: "invalid-date",
            bodyText: "## Section 1\n\nFirst paragraph becomes the summary.",
          }),
        }),
      );
      expect(createRes.status).toBe(200);
      const createdData = (await createRes.json()) as {
        post: { id: string; title: string; summary: string; date: string };
      };
      expect(createdData.post.id).toBe("api-route-post");
      expect(createdData.post.title).toBe("Untitled");
      expect(createdData.post.summary).toBe(
        "First paragraph becomes the summary.",
      );
      expect(createdData.post.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(mockRevalidateTag).toHaveBeenCalledWith("posts", { expire: 0 });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/writing");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/writing/api-route-post");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/sitemap.xml");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/feed.xml");

      // 2. GET /api/studio/posts returns the created post
      const listRes = await getPostsRoute();
      expect(listRes.status).toBe(200);
      const listData = (await listRes.json()) as {
        posts: Array<{ id: string }>;
      };
      expect(listData.posts.some((p) => p.id === "api-route-post")).toBe(true);

      // 3. Conflict when creating a new post with the same slug
      const conflictRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "api-route-post",
            title: "Duplicate",
            bodyText: "Duplicate slug",
          }),
        }),
      );
      expect(conflictRes.status).toBe(409);

      // 4. Rename the post slug via originalId and verify both old & new paths are revalidated
      mockRevalidatePath.mockClear();
      const renameRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            originalId: "api-route-post",
            id: "api-route-post-v2",
            title: "Updated Title",
            date: "2026-11-11",
            summary: "Updated summary",
            bodyText: "Updated body.",
          }),
        }),
      );
      expect(renameRes.status).toBe(200);
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        "/writing/api-route-post-v2",
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        "/writing/api-route-post",
      );

      // 5. Delete the renamed post
      const delRes = await deletePostRoute(
        new Request(
          "http://localhost:3000/api/studio/posts?id=api-route-post-v2",
          { method: "DELETE" },
        ),
      );
      expect(delRes.status).toBe(200);
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        "/writing/api-route-post-v2",
      );

      // 6. Invalid slug on DELETE returns 400
      const badDelRes = await deletePostRoute(
        new Request(
          "http://localhost:3000/api/studio/posts?id=../invalid-slug",
          { method: "DELETE" },
        ),
      );
      expect(badDelRes.status).toBe(400);
    });

    it("falls back to safe defaults when fields have the wrong type", async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION);

      const res = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "   ",
            title: 42,
            date: 20261111,
            summary: { text: "not a string" },
            bodyText: null,
          }),
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        post: {
          id: string;
          title: string;
          date: string;
          summary: string;
          content: unknown[];
        };
      };
      expect(data.post.id).toBe("untitled");
      expect(data.post.title).toBe("Untitled");
      expect(data.post.summary).toBe("Untitled");
      expect(data.post.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(data.post.content).toEqual([]);
    });

    it("truncates oversized titles and summaries instead of rejecting them", async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION);

      const res = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "truncation-post",
            title: "T".repeat(250),
            summary: "S".repeat(600),
            bodyText: "Body copy.",
          }),
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        post: { title: string; summary: string };
      };
      expect(data.post.title).toHaveLength(200);
      expect(data.post.summary).toHaveLength(500);
    });

    it("ignores an invalid originalId so the save is treated as a new post", async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION);

      const createRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "admin-original-id-guard",
            title: "Original",
            bodyText: "Body copy.",
          }),
        }),
      );
      expect(createRes.status).toBe(200);

      // "../..." fails the slug check, so this is a create (not an update/rename)
      // and collides with the post created above.
      const res = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            originalId: "../admin-original-id-guard",
            id: "admin-original-id-guard",
            title: "Attempted rename",
            bodyText: "Body copy.",
          }),
        }),
      );
      expect(res.status).toBe(409);
    });

    it("rejects malformed DELETE ids before touching storage", async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION);

      for (const badId of ["", "Bad Slug", "UPPER-CASE", "a".repeat(101)]) {
        const res = await deletePostRoute(
          new Request(
            `http://localhost:3000/api/studio/posts?id=${encodeURIComponent(badId)}`,
            { method: "DELETE" },
          ),
        );
        expect(res.status).toBe(400);
      }
    });

    it("syncs with Vercel Blob when BLOB_READ_WRITE_TOKEN is set", async () => {
      vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test_token");
      mockAuth.mockResolvedValue(ADMIN_SESSION);

      mockBlobList.mockResolvedValue({
        blobs: [
          {
            pathname: "posts.json",
            url: "https://store.private.blob.vercel-storage.com/posts.json",
          },
        ],
      });
      mockBlobGet.mockResolvedValue({
        statusCode: 200,
        stream: new Response(JSON.stringify([])).body,
      });
      mockBlobPut.mockResolvedValue({
        url: "https://store.private.blob.vercel-storage.com/posts.json",
      });

      const saveRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            title: "Blob Backed Post",
            date: "2026-11-11",
            bodyText: "Stored in Vercel Blob.",
          }),
        }),
      );
      expect(saveRes.status).toBe(200);
      expect(mockBlobList).toHaveBeenCalledTimes(1);
      expect(mockBlobGet).toHaveBeenCalledWith(
        "https://store.private.blob.vercel-storage.com/posts.json",
        { access: "private", useCache: false },
      );
      expect(mockBlobPut).toHaveBeenCalledWith(
        "posts.json",
        expect.stringContaining('"id": "blob-backed-post"'),
        expect.objectContaining({
          access: "private",
          allowOverwrite: true,
        }),
      );
    });
  });
});
