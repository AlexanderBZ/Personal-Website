import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockHeaderGet = vi.fn();
const mockRevalidatePath = vi.fn();
const mockRevalidateTag = vi.fn();
const mockBlobGet = vi.fn();
const mockBlobList = vi.fn();
const mockBlobPut = vi.fn();
const mockNotFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const mockPermanentRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_PERMANENT_REDIRECT:${url}`);
});

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

vi.mock("next/navigation", () => ({
  notFound: () => mockNotFound(),
  permanentRedirect: (url: string) => mockPermanentRedirect(url),
}));

vi.mock("@vercel/blob", () => ({
  get: (...args: unknown[]) => mockBlobGet(...args),
  list: (...args: unknown[]) => mockBlobList(...args),
  put: (...args: unknown[]) => mockBlobPut(...args),
}));

import { GET as getRssFeed } from "@/app/feed.xml/route";
import Home from "@/app/page";
import sitemap from "@/app/sitemap";
import WritingPostPage, {
  generateMetadata as generatePostMetadata,
  generateStaticParams as generatePostStaticParams,
} from "@/app/writing/[id]/page";
import PostOpenGraphImage from "@/app/writing/[id]/opengraph-image";
import WritingPage from "@/app/writing/page";
import {
  DELETE as deletePostRoute,
  GET as getPostsRoute,
  POST as savePostRoute,
} from "@/app/api/studio/posts/route";
import { auth } from "@/lib/auth";
import {
  deletePost,
  getAllAdminPosts,
  getAllPosts,
  getPostById,
  PostConflictError,
  readPostsFromDisk,
  savePost,
  type WritingPost,
} from "@/lib/posts";
import { SITE_CONFIG } from "@/lib/site";

describe("Publishing and local blob storage", () => {
  let tempDir: string;
  let localBlobFile: string;
  let mockAuth: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth = vi.spyOn(auth.api, "getSession");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-local-blob-"));
    localBlobFile = path.join(tempDir, "nested", "posts.json");

    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ADMIN_ALLOWED_EMAILS", "admin@example.com");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("BLOB_STORE_ID", "");
    vi.stubEnv("USE_LOCAL_BLOB", "false");
    vi.stubEnv("LOCAL_BLOB_PATH", localBlobFile);
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "");

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
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("local blob storage (lib/posts)", () => {
    it("resolves LOCAL_BLOB_PATH, creates parent directories on publish, and isolates from lib/posts.json", async () => {
      expect(readPostsFromDisk()).toEqual([]);

      const post: WritingPost = {
        id: "local-first-post",
        title: "Local First Post",
        date: "2026-11-11",
        summary: "Stored in local blob file.",
        content: ["Hello local blob."],
      };

      await savePost({ post });

      expect(fs.existsSync(localBlobFile)).toBe(true);
      expect(readPostsFromDisk()).toEqual([post]);
      expect(mockBlobList).not.toHaveBeenCalled();
      expect(mockBlobPut).not.toHaveBeenCalled();
    });

    it("uses local disk when USE_LOCAL_BLOB=true even if BLOB_READ_WRITE_TOKEN is set", async () => {
      vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_ignored_locally");
      vi.stubEnv("USE_LOCAL_BLOB", "true");

      await savePost({
        post: {
          id: "forced-local-post",
          title: "Forced Local",
          date: "2026-11-11",
          summary: "Bypasses Vercel Blob.",
          content: ["Local only."],
        },
      });

      const posts = await getAllPosts();
      expect(posts.map((p) => p.id)).toEqual(["forced-local-post"]);
      expect(mockBlobList).not.toHaveBeenCalled();
      expect(mockBlobPut).not.toHaveBeenCalled();
    });

    it("sorts posts newest-first, filters invalid entries, and handles updates and conflicts", async () => {
      fs.mkdirSync(path.dirname(localBlobFile), { recursive: true });
      fs.writeFileSync(
        localBlobFile,
        JSON.stringify([
          { id: "", title: "Missing ID", date: "2026-01-01", summary: "", content: [] },
          { id: "bad-block", title: "Bad Block", date: "2026-01-01", summary: "", content: [123] },
          {
            id: "older-post",
            title: "Older Post",
            date: "2026-01-15",
            summary: "Older",
            content: ["Older body."],
          },
          {
            id: "newer-post",
            title: "Newer Post",
            date: "2026-10-20",
            summary: "Newer",
            content: ["Newer body."],
          },
        ]),
        "utf8",
      );

      const sorted = await getAllPosts();
      expect(sorted.map((p) => p.id)).toEqual(["newer-post", "older-post"]);
      expect((await getPostById("older-post"))?.title).toBe("Older Post");
      expect(await getPostById("non-existent")).toBeUndefined();

      // In-place update with the same id succeeds without conflict
      await savePost({
        originalId: "older-post",
        post: {
          id: "older-post",
          title: "Older Post Revised",
          date: "2026-01-15",
          summary: "Revised",
          content: ["Updated body."],
        },
      });
      expect((await getPostById("older-post"))?.title).toBe("Older Post Revised");

      // Renaming onto another existing post's slug throws PostConflictError
      await expect(
        savePost({
          originalId: "older-post",
          post: {
            id: "newer-post",
            title: "Collision",
            date: "2026-01-15",
            summary: "Collision",
            content: [],
          },
        }),
      ).rejects.toThrow(PostConflictError);

      // Updating with an unknown originalId inserts the post cleanly
      await savePost({
        originalId: "missing-original",
        post: {
          id: "recovered-post",
          title: "Recovered",
          date: "2026-11-01",
          summary: "Recovered",
          content: ["Recovered body."],
        },
      });
      expect((await getPostById("recovered-post"))?.title).toBe("Recovered");

      // Deleting removes only the matching post
      await deletePost("older-post");
      expect((await getAllPosts()).map((p) => p.id)).toEqual([
        "recovered-post",
        "newer-post",
      ]);
    });

    it("surfaces write errors in local mode instead of silently succeeding", async () => {
      // Point LOCAL_BLOB_PATH to an existing directory so writeFileSync fails with EISDIR
      vi.stubEnv("LOCAL_BLOB_PATH", tempDir);

      await expect(
        savePost({
          post: {
            id: "unwritable",
            title: "Unwritable",
            date: "2026-11-11",
            summary: "Should fail",
            content: [],
          },
        }),
      ).rejects.toThrow();
    });

    it("seeds Vercel Blob from local posts on first read and falls back to local disk when Blob fails", async () => {
      vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test_token");
      const localSeed: WritingPost = {
        id: "seeded-post",
        title: "Seeded Post",
        date: "2026-11-10",
        summary: "Seeded from disk",
        content: ["Initial content."],
      };
      fs.mkdirSync(path.dirname(localBlobFile), { recursive: true });
      fs.writeFileSync(localBlobFile, JSON.stringify([localSeed]), "utf8");

      mockBlobList.mockResolvedValueOnce({ blobs: [] });
      mockBlobPut.mockResolvedValueOnce({
        url: "https://blob.vercel-storage.com/posts.json",
      });

      const seeded = await getAllPosts();
      expect(seeded).toEqual([localSeed]);
      expect(mockBlobPut).toHaveBeenCalledWith(
        "posts.json",
        expect.stringContaining('"id": "seeded-post"'),
        expect.objectContaining({ access: "private", allowOverwrite: true }),
      );

      // If Blob listing fails afterwards, it falls back cleanly to local disk
      mockBlobList.mockRejectedValueOnce(new Error("Network timeout"));
      const fallbackPosts = await getAllPosts();
      expect(fallbackPosts).toEqual([localSeed]);
    });

    it("uses private Vercel Blob when BLOB_STORE_ID (OIDC) is set without BLOB_READ_WRITE_TOKEN", async () => {
      vi.stubEnv("BLOB_STORE_ID", "store_oidc_private_123");
      mockBlobList.mockResolvedValueOnce({ blobs: [] });
      mockBlobPut.mockResolvedValueOnce({
        url: "https://oidc123.private.blob.vercel-storage.com/posts.json",
      });

      const saved = await savePost({
        post: {
          id: "oidc-created-post",
          title: "OIDC Created Post",
          date: "2026-11-11",
          summary: "Created using BLOB_STORE_ID.",
          content: ["Created via OIDC."],
        },
      });

      expect(saved.id).toBe("oidc-created-post");
      expect(mockBlobPut).toHaveBeenCalledWith(
        "posts.json",
        expect.stringContaining('"id": "oidc-created-post"'),
        expect.objectContaining({ access: "private", allowOverwrite: true }),
      );

      // Subsequent update reads existing Blob via private get() and updates in place
      mockBlobList.mockResolvedValueOnce({
        blobs: [
          {
            pathname: "posts.json",
            url: "https://oidc123.private.blob.vercel-storage.com/posts.json",
          },
        ],
      });
      mockBlobGet.mockResolvedValueOnce({
        statusCode: 200,
        stream: new Response(JSON.stringify([saved])).body,
      });
      mockBlobPut.mockResolvedValueOnce({
        url: "https://oidc123.private.blob.vercel-storage.com/posts.json",
      });

      const updated = await savePost({
        originalId: "oidc-created-post",
        post: {
          ...saved,
          title: "OIDC Updated Post",
          content: ["Updated via OIDC."],
        },
      });

      expect(updated.title).toBe("OIDC Updated Post");
      expect(mockBlobGet).toHaveBeenCalledWith(
        "https://oidc123.private.blob.vercel-storage.com/posts.json",
        { access: "private", useCache: false },
      );
      expect(mockBlobPut).toHaveBeenLastCalledWith(
        "posts.json",
        expect.stringContaining('"title": "OIDC Updated Post"'),
        expect.objectContaining({ access: "private", allowOverwrite: true }),
      );
    });

    it("never falls back to public Blob access if private put fails", async () => {
      vi.stubEnv("BLOB_STORE_ID", "store_misconfigured_public");

      mockBlobList.mockResolvedValueOnce({ blobs: [] });
      mockBlobPut.mockRejectedValueOnce(
        new Error("Vercel Blob: Cannot use private access on a public store"),
      );

      await expect(
        savePost({
          post: {
            id: "must-stay-private",
            title: "Must Stay Private",
            date: "2026-11-11",
            summary: "Drafts must never be written publicly.",
            content: ["Private draft body."],
          },
        }),
      ).rejects.toThrow("Cannot use private access on a public store");
      expect(mockBlobPut).toHaveBeenCalledTimes(1);
      expect(mockBlobPut).toHaveBeenCalledWith(
        "posts.json",
        expect.any(String),
        expect.objectContaining({ access: "private" }),
      );
    });

    it("refuses to overwrite Blob with empty local disk if reading existing posts from Blob fails during save or delete", async () => {
      vi.stubEnv("BLOB_STORE_ID", "store_failing_read_789");
      mockBlobList.mockResolvedValueOnce({
        blobs: [
          {
            pathname: "posts.json",
            url: "https://fail789.private.blob.vercel-storage.com/posts.json",
          },
        ],
      });
      mockBlobGet.mockResolvedValueOnce({
        statusCode: 503,
        stream: null,
      });

      await expect(
        savePost({
          post: {
            id: "must-not-wipe",
            title: "Must Not Wipe",
            date: "2026-11-11",
            summary: "Should fail instead of wiping.",
            content: ["Body."],
          },
        }),
      ).rejects.toThrow('Failed to read "posts.json"');
      expect(mockBlobPut).not.toHaveBeenCalled();

      mockBlobList.mockRejectedValueOnce(new Error("Blob unavailable"));
      await expect(deletePost("anything")).rejects.toThrow("Blob unavailable");
      expect(mockBlobPut).not.toHaveBeenCalled();
    });

    it("uses local disk when USE_LOCAL_BLOB=true even if BLOB_STORE_ID is set", async () => {
      vi.stubEnv("BLOB_STORE_ID", "store_ignored_locally");
      vi.stubEnv("USE_LOCAL_BLOB", "true");

      await savePost({
        post: {
          id: "local-override-store-id",
          title: "Local Override",
          date: "2026-11-11",
          summary: "Local only.",
          content: ["Body."],
        },
      });

      expect(mockBlobList).not.toHaveBeenCalled();
      expect(mockBlobPut).not.toHaveBeenCalled();
      expect(readPostsFromDisk().map((p) => p.id)).toEqual([
        "local-override-store-id",
      ]);
    });
  });

  describe("publishing API (/api/studio/posts)", () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({
        user: { email: "admin@example.com", emailVerified: true },
      });
    });

    it("returns 400 on malformed JSON instead of 500", async () => {
      const res = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: "{not-json",
        }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid request payload" });
    });

    it("auto-generates slug and summary fallbacks when publishing a new post", async () => {
      const fixedNow = Date.now();
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(fixedNow);

      // 1. Slug derived from title; summary derived from first paragraph (capped at 140 chars)
      const longParagraph = "Word ".repeat(40).trim();
      const fromTitleRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            title: "Notes on Building!",
            date: "2026-11-11",
            bodyText: `## Opening\n\n${longParagraph}`,
          }),
        }),
      );
      expect(fromTitleRes.status).toBe(200);
      const fromTitleData = (await fromTitleRes.json()) as {
        post: WritingPost;
      };
      expect(fromTitleData.post.id).toBe("notes-on-building");
      expect(fromTitleData.post.summary.length).toBeLessThanOrEqual(140);
      expect(fromTitleData.post.summary).toBe(longParagraph.slice(0, 140));

      // 2. Non-alphanumeric title falls back to `post-<timestamp>`, and heading-only body falls back summary to title
      const fallbackRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            title: "!!!",
            date: "2026-11-11",
            bodyText: "## Only a heading",
          }),
        }),
      );
      expect(fallbackRes.status).toBe(200);
      const fallbackData = (await fallbackRes.json()) as {
        post: WritingPost;
      };
      expect(fallbackData.post.id).toBe(`post-${fixedNow}`);
      expect(fallbackData.post.summary).toBe("!!!");
      nowSpy.mockRestore();
    });

    it("updates an existing post in-place and returns 409 when renaming to an existing slug", async () => {
      await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "first-post",
            title: "First Post",
            date: "2026-11-10",
            bodyText: "First body.",
          }),
        }),
      );
      await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "second-post",
            title: "Second Post",
            date: "2026-11-11",
            bodyText: "Second body.",
          }),
        }),
      );

      mockRevalidatePath.mockClear();
      const updateRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            originalId: "second-post",
            id: "second-post",
            title: "Second Post Edited",
            date: "2026-11-11",
            summary: "Edited summary",
            bodyText: "Edited body.",
          }),
        }),
      );
      expect(updateRes.status).toBe(200);
      expect(mockRevalidatePath).toHaveBeenCalledTimes(5);
      expect(mockRevalidatePath).toHaveBeenCalledWith("/writing/second-post");

      const renameConflictRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            originalId: "second-post",
            id: "first-post",
            title: "Conflict",
            date: "2026-11-11",
            bodyText: "Should 409.",
          }),
        }),
      );
      expect(renameConflictRes.status).toBe(409);
    });

    it("trims trailing hyphens on long generated slugs so posts can still be updated and deleted", async () => {
      const longSlugWithTrailingHyphenAt100 = `${"a".repeat(99)}-bbbb`;
      const createRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: longSlugWithTrailingHyphenAt100,
            title: "Long Slug Post",
            date: "2026-11-11",
            bodyText: "Initial body.",
          }),
        }),
      );
      expect(createRes.status).toBe(200);
      const created = (await createRes.json()) as { post: WritingPost };
      expect(created.post.id).toBe("a".repeat(99));

      const updateRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            originalId: created.post.id,
            id: created.post.id,
            title: "Long Slug Post Updated",
            date: "2026-11-11",
            bodyText: "Updated body.",
          }),
        }),
      );
      expect(updateRes.status).toBe(200);
      const updated = (await updateRes.json()) as {
        post: WritingPost;
        posts: WritingPost[];
      };
      expect(updated.posts).toHaveLength(1);
      expect(updated.post.title).toBe("Long Slug Post Updated");

      const deleteRes = await deletePostRoute(
        new Request(
          `http://localhost:3000/api/studio/posts?id=${created.post.id}`,
          { method: "DELETE" },
        ),
      );
      expect(deleteRes.status).toBe(200);
      expect((await deleteRes.json()) as { posts: WritingPost[] }).toEqual({
        posts: [],
      });
    });
  });

  describe("end-to-end publishing across pages, sitemap, and RSS feed", () => {
    it("reflects newly published and deleted posts across Home, Writing, Article, OG image, sitemap, and feed.xml", async () => {
      mockAuth.mockResolvedValue({
        user: { email: "admin@example.com", emailVerified: true },
      });

      // Empty state before publishing
      const emptyWritingHtml = renderToStaticMarkup(await WritingPage());
      expect(emptyWritingHtml).toContain("No posts yet.");

      // Publish a post with section headings and XML special characters
      const publishRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "shipping-local-first",
            title: "Shipping & Iterating <Fast>",
            date: "2026-11-11",
            summary: `Notes on "local" & 'fast' publishing.`,
            bodyText: [
              "Opening paragraph for the essay.",
              "## First Principles",
              "Keep publishing local and verifiable.",
            ].join("\n\n"),
          }),
        }),
      );
      expect(publishRes.status).toBe(200);

      // 1. Home page renders the published post, updated date, and footer RSS Feed link
      const homeHtml = renderToStaticMarkup(await Home());
      expect(homeHtml).toContain('href="/writing/shipping-local-first"');
      expect(homeHtml).toContain("Shipping &amp; Iterating &lt;Fast&gt;");
      expect(homeHtml).toContain('<time dateTime="2026-11-11">11/11/2026</time>');
      expect(homeHtml).toContain('href="/feed.xml"');
      expect(homeHtml).toContain("RSS Feed");

      // 2. Writing index lists the post instead of the empty message
      const writingHtml = renderToStaticMarkup(await WritingPage());
      expect(writingHtml).not.toContain("No posts yet.");
      expect(writingHtml).toContain('href="/writing/shipping-local-first"');

      // 3. Individual post page, static params, metadata, and OpenGraph image
      const staticParams = await generatePostStaticParams();
      expect(staticParams).toEqual([{ id: "shipping-local-first" }]);

      const postMeta = await generatePostMetadata({
        params: Promise.resolve({ id: "shipping-local-first" }),
      });
      expect(postMeta.title).toBe("Shipping & Iterating <Fast>");
      expect(postMeta.description).toBe(`Notes on "local" & 'fast' publishing.`);

      const postHtml = renderToStaticMarkup(
        await WritingPostPage({
          params: Promise.resolve({ id: "shipping-local-first" }),
        }),
      );
      expect(postHtml).toContain("<h1>Shipping &amp; Iterating &lt;Fast&gt;</h1>");
      expect(postHtml).toContain("11 November, 2026");
      expect(postHtml).toContain("Opening paragraph for the essay.");
      expect(postHtml).toContain('<h2 id="first-principles"><span>First Principles</span></h2>');
      expect(postHtml).toContain('href="#first-principles"');

      const ogResponse = await PostOpenGraphImage({
        params: Promise.resolve({ id: "shipping-local-first" }),
      });
      expect(ogResponse.status).toBe(200);
      expect(ogResponse.headers.get("content-type")).toContain("image/png");

      // 4. Sitemap includes the published post URL
      const sitemapEntries = await sitemap();
      expect(
        sitemapEntries.some(
          (entry) => entry.url === `${SITE_CONFIG.url}/writing/shipping-local-first`,
        ),
      ).toBe(true);

      // 5. RSS feed includes the item and escapes XML characters
      const rssRes = await getRssFeed();
      const rssXml = await rssRes.text();
      expect(rssXml).toContain(
        "<title>Shipping &amp; Iterating &lt;Fast&gt;</title>",
      );
      expect(rssXml).toContain(
        "<description>Notes on &quot;local&quot; &amp; &apos;fast&apos; publishing.</description>",
      );
      expect(rssXml).toContain(
        `<link>${SITE_CONFIG.url}/writing/shipping-local-first</link>`,
      );

      // 6. Delete the post and confirm it disappears everywhere
      const deleteRes = await deletePostRoute(
        new Request(
          "http://localhost:3000/api/studio/posts?id=shipping-local-first",
          { method: "DELETE" },
        ),
      );
      expect(deleteRes.status).toBe(200);

      const postDeleteHomeHtml = renderToStaticMarkup(await Home());
      expect(postDeleteHomeHtml).not.toContain("/writing/shipping-local-first");

      const postDeleteSitemap = await sitemap();
      expect(
        postDeleteSitemap.some(
          (entry) => entry.url === `${SITE_CONFIG.url}/writing/shipping-local-first`,
        ),
      ).toBe(false);

      const postDeleteRss = await (await getRssFeed()).text();
      expect(postDeleteRss).not.toContain("/writing/shipping-local-first");

      // Unknown / deleted post triggers notFound() and returns "Not Found" metadata
      const missingMeta = await generatePostMetadata({
        params: Promise.resolve({ id: "shipping-local-first" }),
      });
      expect(missingMeta).toEqual({ title: "Not Found" });
      await expect(
        WritingPostPage({
          params: Promise.resolve({ id: "shipping-local-first" }),
        }),
      ).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("keeps drafts private across storage and public routes until published, and hides unpublished posts", async () => {
      mockAuth.mockResolvedValue({
        user: { email: "admin@example.com", emailVerified: true },
      });
      mockRevalidatePath.mockClear();

      // Rejects invalid status with 400
      const invalidRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "invalid-status-post",
            title: "Invalid Status Post",
            date: "2026-11-11",
            status: "archived",
            bodyText: "Body copy.",
          }),
        }),
      );
      expect(invalidRes.status).toBe(400);

      // Save a draft
      const draftRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "work-in-progress",
            title: "Work in Progress",
            date: "2026-11-11",
            summary: "Unfinished notes",
            status: "draft",
            bodyText: "Still thinking this through.",
          }),
        }),
      );
      expect(draftRes.status).toBe(200);
      const draftJson = (await draftRes.json()) as {
        post: WritingPost;
        posts: WritingPost[];
      };
      expect(draftJson.post.status).toBe("draft");
      expect(mockRevalidateTag).not.toHaveBeenCalled();
      expect(mockRevalidatePath).not.toHaveBeenCalled();

      // Admin reads see the draft; public reads exclude it
      expect((await getAllAdminPosts()).map((post) => post.id)).toEqual([
        "work-in-progress",
      ]);
      const adminGetRes = await getPostsRoute();
      expect(adminGetRes.status).toBe(200);
      const adminGetJson = (await adminGetRes.json()) as {
        posts: WritingPost[];
      };
      expect(adminGetJson.posts.map((post) => post.id)).toEqual([
        "work-in-progress",
      ]);

      expect(await getAllPosts()).toEqual([]);
      expect(await getPostById("work-in-progress")).toBeUndefined();

      expect(renderToStaticMarkup(await Home())).not.toContain(
        "/writing/work-in-progress",
      );
      expect(renderToStaticMarkup(await WritingPage())).toContain(
        "No posts yet.",
      );
      await expect(
        WritingPostPage({
          params: Promise.resolve({ id: "work-in-progress" }),
        }),
      ).rejects.toThrow("NEXT_NOT_FOUND");

      const draftSitemap = await sitemap();
      expect(
        draftSitemap.some(
          (entry) => entry.url === `${SITE_CONFIG.url}/writing/work-in-progress`,
        ),
      ).toBe(false);
      expect(await (await getRssFeed()).text()).not.toContain(
        "/writing/work-in-progress",
      );

      // Publish the draft
      mockRevalidatePath.mockClear();
      mockRevalidateTag.mockClear();
      const publishRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "work-in-progress",
            originalId: "work-in-progress",
            title: "Work in Progress",
            date: "2026-11-11",
            summary: "Finished essay",
            status: "published",
            bodyText: "Ready to share.",
          }),
        }),
      );
      expect(publishRes.status).toBe(200);
      const publishJson = (await publishRes.json()) as { post: WritingPost };
      expect(publishJson.post.status).toBe("published");
      expect(mockRevalidateTag).toHaveBeenCalledWith("posts", { expire: 0 });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/writing");
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        "/writing/work-in-progress",
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith("/sitemap.xml");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/feed.xml");

      expect((await getAllPosts()).map((post) => post.id)).toEqual([
        "work-in-progress",
      ]);
      expect(renderToStaticMarkup(await Home())).toContain(
        "/writing/work-in-progress",
      );
      expect(renderToStaticMarkup(await WritingPage())).toContain(
        "/writing/work-in-progress",
      );
      expect(
        renderToStaticMarkup(
          await WritingPostPage({
            params: Promise.resolve({ id: "work-in-progress" }),
          }),
        ),
      ).toContain("Ready to share.");

      const publishedSitemap = await sitemap();
      expect(
        publishedSitemap.some(
          (entry) => entry.url === `${SITE_CONFIG.url}/writing/work-in-progress`,
        ),
      ).toBe(true);
      expect(await (await getRssFeed()).text()).toContain(
        "/writing/work-in-progress",
      );

      // Unpublish the post back to draft
      mockRevalidatePath.mockClear();
      mockRevalidateTag.mockClear();
      const unpublishRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "work-in-progress",
            originalId: "work-in-progress",
            title: "Work in Progress",
            date: "2026-11-11",
            summary: "Finished essay",
            status: "draft",
            bodyText: "Pulled back to draft.",
          }),
        }),
      );
      expect(unpublishRes.status).toBe(200);
      expect(mockRevalidateTag).toHaveBeenCalledWith("posts", { expire: 0 });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/writing");
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        "/writing/work-in-progress",
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith("/sitemap.xml");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/feed.xml");

      expect((await getAllAdminPosts()).map((post) => post.id)).toEqual([
        "work-in-progress",
      ]);
      expect(await getAllPosts()).toEqual([]);
      expect(renderToStaticMarkup(await Home())).not.toContain(
        "/writing/work-in-progress",
      );
      await expect(
        WritingPostPage({
          params: Promise.resolve({ id: "work-in-progress" }),
        }),
      ).rejects.toThrow("NEXT_NOT_FOUND");
      const unpublishedSitemap = await sitemap();
      expect(
        unpublishedSitemap.some(
          (entry) => entry.url === `${SITE_CONFIG.url}/writing/work-in-progress`,
        ),
      ).toBe(false);
      expect(await (await getRssFeed()).text()).not.toContain(
        "/writing/work-in-progress",
      );
    });

    it("permanently redirects old slugs after renaming published posts and handles chained, reverted, reused, unpublished, and deleted slugs", async () => {
      mockAuth.mockResolvedValue({
        user: { email: "admin@example.com", emailVerified: true },
      });
      mockPermanentRedirect.mockClear();

      // 1. Renaming a never-published draft does NOT record a redirect for the draft slug
      const draftCreateRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "draft-slug-v1",
            title: "Draft Essay",
            date: "2026-11-11",
            status: "draft",
            bodyText: "Still private.",
          }),
        }),
      );
      expect(draftCreateRes.status).toBe(200);

      const draftRenamePublishRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "slug-v1",
            originalId: "draft-slug-v1",
            title: "Published Essay",
            date: "2026-11-11",
            status: "published",
            bodyText: "Now public.",
          }),
        }),
      );
      expect(draftRenamePublishRes.status).toBe(200);
      expect((await draftRenamePublishRes.json()).post.previousIds).toBeUndefined();

      await expect(
        WritingPostPage({
          params: Promise.resolve({ id: "draft-slug-v1" }),
        }),
      ).rejects.toThrow("NEXT_NOT_FOUND");

      // 2. Rename published post slug-v1 -> slug-v2
      mockRevalidatePath.mockClear();
      const rename1Res = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "slug-v2",
            originalId: "slug-v1",
            title: "Published Essay",
            date: "2026-11-11",
            status: "published",
            bodyText: "Now at v2.",
          }),
        }),
      );
      expect(rename1Res.status).toBe(200);
      expect((await rename1Res.json()).post.previousIds).toEqual(["slug-v1"]);
      expect(mockRevalidatePath).toHaveBeenCalledWith("/writing/slug-v2");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/writing/slug-v1");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/sitemap.xml");

      // Old slug permanently redirects to new slug; sitemap only lists the new slug
      await expect(
        WritingPostPage({ params: Promise.resolve({ id: "slug-v1" }) }),
      ).rejects.toThrow("NEXT_PERMANENT_REDIRECT:/writing/slug-v2");

      const sitemapAfterRename1 = await sitemap();
      expect(
        sitemapAfterRename1.some(
          (entry) => entry.url === `${SITE_CONFIG.url}/writing/slug-v2`,
        ),
      ).toBe(true);
      expect(
        sitemapAfterRename1.some(
          (entry) => entry.url === `${SITE_CONFIG.url}/writing/slug-v1`,
        ),
      ).toBe(false);

      // 3. Chained rename slug-v2 -> slug-v3 redirects both v1 and v2 directly to v3
      mockRevalidatePath.mockClear();
      const rename2Res = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "slug-v3",
            originalId: "slug-v2",
            title: "Published Essay",
            date: "2026-11-11",
            status: "published",
            bodyText: "Now at v3.",
          }),
        }),
      );
      expect(rename2Res.status).toBe(200);
      expect((await rename2Res.json()).post.previousIds).toEqual([
        "slug-v1",
        "slug-v2",
      ]);
      expect(mockRevalidatePath).toHaveBeenCalledWith("/writing/slug-v3");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/writing/slug-v2");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/writing/slug-v1");

      await expect(
        WritingPostPage({ params: Promise.resolve({ id: "slug-v1" }) }),
      ).rejects.toThrow("NEXT_PERMANENT_REDIRECT:/writing/slug-v3");
      await expect(
        WritingPostPage({ params: Promise.resolve({ id: "slug-v2" }) }),
      ).rejects.toThrow("NEXT_PERMANENT_REDIRECT:/writing/slug-v3");

      // 4. Rename back slug-v3 -> slug-v1: no self-redirect on slug-v1, v2 & v3 redirect to v1
      const renameBackRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "slug-v1",
            originalId: "slug-v3",
            title: "Published Essay",
            date: "2026-11-11",
            status: "published",
            bodyText: "Back at v1.",
          }),
        }),
      );
      expect(renameBackRes.status).toBe(200);
      expect((await renameBackRes.json()).post.previousIds).toEqual([
        "slug-v2",
        "slug-v3",
      ]);

      const v1Html = renderToStaticMarkup(
        await WritingPostPage({ params: Promise.resolve({ id: "slug-v1" }) }),
      );
      expect(v1Html).toContain("Back at v1.");
      await expect(
        WritingPostPage({ params: Promise.resolve({ id: "slug-v3" }) }),
      ).rejects.toThrow("NEXT_PERMANENT_REDIRECT:/writing/slug-v1");

      // 5. Creating a new post that reuses an old slug (slug-v2) claims it cleanly
      const reuseRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "slug-v2",
            title: "Brand New Post",
            date: "2026-11-12",
            status: "published",
            bodyText: "Claimed slug-v2.",
          }),
        }),
      );
      expect(reuseRes.status).toBe(200);
      const reusedHtml = renderToStaticMarkup(
        await WritingPostPage({ params: Promise.resolve({ id: "slug-v2" }) }),
      );
      expect(reusedHtml).toContain("Claimed slug-v2.");

      const allPostsAfterReuse = await getAllAdminPosts();
      const originalPostAfterReuse = allPostsAfterReuse.find(
        (p) => p.id === "slug-v1",
      );
      expect(originalPostAfterReuse?.previousIds).toEqual(["slug-v3"]);

      // 6. Unpublishing slug-v1 stops slug-v3 from redirecting and revalidates slug-v3
      mockRevalidatePath.mockClear();
      const unpublishRenamedRes = await savePostRoute(
        new Request("http://localhost:3000/api/studio/posts", {
          method: "POST",
          body: JSON.stringify({
            id: "slug-v1",
            originalId: "slug-v1",
            title: "Published Essay",
            date: "2026-11-11",
            status: "draft",
            bodyText: "Back at v1.",
          }),
        }),
      );
      expect(unpublishRenamedRes.status).toBe(200);
      expect(mockRevalidatePath).toHaveBeenCalledWith("/writing/slug-v1");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/writing/slug-v3");
      await expect(
        WritingPostPage({ params: Promise.resolve({ id: "slug-v3" }) }),
      ).rejects.toThrow("NEXT_NOT_FOUND");

      // 7. Deleting slug-v1 also revalidates its previousIds paths
      mockRevalidatePath.mockClear();
      const deleteRenamedRes = await deletePostRoute(
        new Request("http://localhost:3000/api/studio/posts?id=slug-v1", {
          method: "DELETE",
        }),
      );
      expect(deleteRenamedRes.status).toBe(200);
      expect(mockRevalidatePath).toHaveBeenCalledWith("/writing/slug-v1");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/writing/slug-v3");
    });
  });
});
