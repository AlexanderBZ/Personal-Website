import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getRssFeed } from "@/app/feed.xml/route";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import {
  getPostHogCorrelationHeaders,
  isLocalClientHost,
  loadPostHog,
  shouldEnableClientPostHog,
} from "@/lib/posthog-client";
import {
  getPostHogClient,
  getPostHogCorrelationFromRequest,
  isLocalhostHost,
  shouldEnablePostHog,
  shutdownPostHog,
} from "@/lib/posthog-server";
import {
  deletePost,
  getAllPosts,
  getPostById,
  PostConflictError,
  readPostsFromDisk,
  savePost,
  type WritingPost,
} from "@/lib/posts";
import { SITE_CONFIG } from "@/lib/site";

const POSTS_FILE_PATH = path.join(process.cwd(), "lib", "posts.json");

describe("lib/posts, SEO routes, and PostHog server helpers", () => {
  let originalPostsJson: string;

  beforeEach(() => {
    originalPostsJson = fs.readFileSync(POSTS_FILE_PATH, "utf8");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("BLOB_STORE_ID", "");
  });

  afterEach(async () => {
    fs.writeFileSync(POSTS_FILE_PATH, originalPostsJson, "utf8");
    await shutdownPostHog();
    vi.unstubAllEnvs();
  });

  it("reads, creates, updates, renames, and deletes posts with conflict detection", async () => {
    const initial = readPostsFromDisk();
    expect(Array.isArray(initial)).toBe(true);

    const newPost: WritingPost = {
      id: "unit-test-post",
      title: "Unit Test Post & <script>",
      date: "2026-11-11",
      summary: "Testing post persistence & XML escaping",
      content: ["Paragraph one.", { heading: "Details" }, "Paragraph two."],
    };

    const created = await savePost({ post: newPost });
    expect(created.id).toBe("unit-test-post");

    // Duplicate creation should throw PostConflictError
    await expect(savePost({ post: newPost })).rejects.toThrow(
      PostConflictError,
    );

    // Updating existing post and renaming slug
    const renamed = await savePost({
      originalId: "unit-test-post",
      post: { ...newPost, id: "unit-test-post-renamed" },
    });
    expect(renamed.id).toBe("unit-test-post-renamed");

    // Deleting the post restores original state
    await deletePost("unit-test-post-renamed");
    expect(readPostsFromDisk().some((p) => p.id === "unit-test-post-renamed")).toBe(
      false,
    );
  });

  it("generates robots.txt, sitemap.xml, and RSS 2.0 feed.xml", async () => {
    const robotsConfig = robots();
    expect(robotsConfig.sitemap).toBe(`${SITE_CONFIG.url}/sitemap.xml`);
    expect(robotsConfig.rules).toEqual({
      userAgent: "*",
      allow: "/",
      disallow: ["/studio", "/api/", "/ingest/"],
    });

    const posts = await getAllPosts();
    if (posts[0]) {
      const found = await getPostById(posts[0].id);
      expect(found?.title).toBe(posts[0].title);
    }

    const sitemapEntries = await sitemap();
    expect(sitemapEntries.some((entry) => entry.url === SITE_CONFIG.url)).toBe(
      true,
    );
    expect(
      sitemapEntries.some((entry) => entry.url === `${SITE_CONFIG.url}/writing`),
    ).toBe(true);
    expect(
      sitemapEntries.some(
        (entry) => entry.url === `${SITE_CONFIG.url}/portfolio`,
      ),
    ).toBe(true);

    const rssResponse = await getRssFeed();
    expect(rssResponse.headers.get("Content-Type")).toContain(
      "application/rss+xml",
    );
    const rssXml = await rssResponse.text();
    expect(rssXml).toContain("<rss version=\"2.0\"");
    expect(rssXml).toContain(`<title>${SITE_CONFIG.name}</title>`);
  });

  it("extracts PostHog correlation headers and guards server client initialization", () => {
    const req = new Request("https://alexanderzwerner.com/api/studio/posts", {
      headers: {
        "X-POSTHOG-DISTINCT-ID": "  admin-user  ",
        "X-POSTHOG-SESSION-ID": "  session-123  ",
      },
    });

    expect(getPostHogCorrelationFromRequest(req)).toEqual({
      distinctId: "admin-user",
      sessionId: "session-123",
    });
    expect(getPostHogCorrelationFromRequest()).toEqual({});

    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    expect(getPostHogClient()).toBeNull();

    // Detects localhost hosts (with or without ports)
    expect(isLocalhostHost("localhost:3000")).toBe(true);
    expect(isLocalhostHost("127.0.0.1:3000")).toBe(true);
    expect(isLocalhostHost("[::1]:3000")).toBe(true);
    expect(isLocalhostHost("dev.localhost")).toBe(true);
    expect(isLocalhostHost("alexanderzwerner.com")).toBe(false);

    // Disabled in development / localhost by default even when token is present
    expect(
      shouldEnablePostHog({
        token: "phc_test",
        nodeEnv: "development",
        enableLocal: "false",
      }),
    ).toBe(false);
    expect(
      shouldEnablePostHog({
        token: "phc_test",
        nodeEnv: "production",
        host: "localhost:3000",
      }),
    ).toBe(false);

    // Enabled in production on non-localhost domain or when NEXT_PUBLIC_POSTHOG_ENABLE_LOCAL=true
    expect(
      shouldEnablePostHog({
        token: "phc_test",
        nodeEnv: "production",
        host: "alexanderzwerner.com",
      }),
    ).toBe(true);
    expect(
      shouldEnablePostHog({
        token: "phc_test",
        nodeEnv: "development",
        enableLocal: "true",
        host: "localhost:3000",
      }),
    ).toBe(true);

    // getPostHogClient skips initialization on localhost unless NEXT_PUBLIC_POSTHOG_ENABLE_LOCAL=true
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_ENABLE_LOCAL", "false");
    const localhostReq = new Request("http://localhost:3000/api/studio/posts");
    expect(getPostHogClient(localhostReq)).toBeNull();
  });

  it("guards lazy client PostHog loading on localhost/SSR and preserves extra headers", async () => {
    expect(isLocalClientHost("localhost")).toBe(true);
    expect(isLocalClientHost("127.0.0.1")).toBe(true);
    expect(isLocalClientHost("[::1]")).toBe(true);
    expect(isLocalClientHost("app.localhost")).toBe(true);
    expect(isLocalClientHost("alexanderzwerner.com")).toBe(false);

    expect(
      shouldEnableClientPostHog({
        token: "phc_test",
        nodeEnv: "development",
        enableLocal: "false",
        hostname: "localhost",
      }),
    ).toBe(false);
    expect(
      shouldEnableClientPostHog({
        token: "phc_test",
        nodeEnv: "production",
        enableLocal: "false",
        hostname: "alexanderzwerner.com",
      }),
    ).toBe(true);

    expect(await loadPostHog()).toBeNull();
    expect(
      getPostHogCorrelationHeaders({ "Content-Type": "application/json" }),
    ).toEqual({ "Content-Type": "application/json" });
  });
});

