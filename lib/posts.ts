import fs from "node:fs";
import path from "node:path";
import { get, list, put } from "@vercel/blob";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import {
  isPostPublished,
  type PostBlock,
  type WritingPost,
} from "@/lib/format";

export {
  blocksToText,
  formatLongDate,
  formatNumericDate,
  formatPostDate,
  getTodayIso,
  isPostPublished,
  isValidIsoDate,
  parsePostContent,
  slugify,
  textToBlocks,
  toPostListItems,
  type PostBlock,
  type PostListItem,
  type PostSection,
  type PostStatus,
  type RenderedPostBlock,
  type WritingPost,
} from "@/lib/format";

const POSTS_BLOB_KEY = "posts.json";
export const POSTS_CACHE_TAG = "posts";
const DEFAULT_POSTS_FILE_PATH = path.join(process.cwd(), "lib", "posts.json");

export class PostConflictError extends Error {
  constructor(slug: string) {
    super(`A post with the URL slug "${slug}" already exists.`);
    this.name = "PostConflictError";
  }
}

function shouldUseVercelBlob(): boolean {
  if (process.env.USE_LOCAL_BLOB === "true") {
    return false;
  }
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
      process.env.BLOB_STORE_ID?.trim(),
  );
}

function isValidPostBlock(block: unknown): block is PostBlock {
  if (typeof block === "string") return true;
  if (
    typeof block === "object" &&
    block !== null &&
    "heading" in block &&
    typeof (block as { heading: unknown }).heading === "string"
  ) {
    return true;
  }
  return false;
}

function isValidWritingPost(item: unknown): item is WritingPost {
  if (typeof item !== "object" || item === null) return false;
  const candidate = item as Record<string, unknown>;
  const hasValidStatus =
    candidate.status === undefined ||
    candidate.status === "draft" ||
    candidate.status === "published";
  const hasValidPreviousIds =
    candidate.previousIds === undefined ||
    (Array.isArray(candidate.previousIds) &&
      candidate.previousIds.every(
        (prev) => typeof prev === "string" && prev.length > 0,
      ));
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.title === "string" &&
    typeof candidate.date === "string" &&
    typeof candidate.summary === "string" &&
    Array.isArray(candidate.content) &&
    candidate.content.every(isValidPostBlock) &&
    hasValidStatus &&
    hasValidPreviousIds
  );
}

function parsePostsArray(raw: unknown): WritingPost[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter(isValidWritingPost);
}

/** Reads local posts from the configured local blob file (`lib/posts.json` by default). */
export function readPostsFromDisk(): WritingPost[] {
  try {
    const configured = process.env.LOCAL_BLOB_PATH?.trim();
    const raw = configured
      ? fs.readFileSync(
          /*turbopackIgnore: true*/ path.resolve(
            /*turbopackIgnore: true*/ process.cwd(),
            configured,
          ),
          "utf8",
        )
      : fs.readFileSync(DEFAULT_POSTS_FILE_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return parsePostsArray(parsed) ?? [];
  } catch {
    return [];
  }
}

/** Writes posts to the local blob file, creating parent directories if needed. */
function writePostsToDisk(posts: WritingPost[]): void {
  const serialized = `${JSON.stringify(posts, null, 2)}\n`;
  const configured = process.env.LOCAL_BLOB_PATH?.trim();
  if (configured) {
    const filePath = path.resolve(
      /*turbopackIgnore: true*/ process.cwd(),
      configured,
    );
    fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(filePath), {
      recursive: true,
    });
    fs.writeFileSync(/*turbopackIgnore: true*/ filePath, serialized, "utf8");
    return;
  }
  fs.writeFileSync(DEFAULT_POSTS_FILE_PATH, serialized, "utf8");
}

/** Best-effort sync to local disk when running alongside Vercel Blob. */
function tryWritePostsToDisk(posts: WritingPost[]): void {
  try {
    writePostsToDisk(posts);
  } catch {
    // Read-only filesystem in serverless production environments; safe to ignore.
  }
}

async function readBlobPayload(url: string): Promise<WritingPost[]> {
  const result = await get(url, {
    access: "private",
    useCache: false,
  });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error(
      `Failed to read "${POSTS_BLOB_KEY}" from private Vercel Blob store.`,
    );
  }
  const parsed: unknown = await new Response(result.stream).json();
  const validated = parsePostsArray(parsed);
  if (!validated) {
    throw new Error(`Invalid "${POSTS_BLOB_KEY}" payload in Vercel Blob.`);
  }
  return validated;
}

/** Reads `posts.json` from Vercel Blob when enabled, falling back to local disk for public reads. */
async function readPostsStore(options?: {
  allowDiskFallback?: boolean;
}): Promise<WritingPost[]> {
  const allowDiskFallback = options?.allowDiskFallback ?? true;

  if (shouldUseVercelBlob()) {
    try {
      const { blobs } = await list({ prefix: POSTS_BLOB_KEY, limit: 10 });
      const match = blobs.find((b) => b.pathname === POSTS_BLOB_KEY);

      if (match?.url) {
        return await readBlobPayload(match.url);
      }

      // Seed initial posts from local disk into Vercel Blob on first read
      const initialPosts = readPostsFromDisk();
      if (allowDiskFallback && initialPosts.length > 0) {
        await writePostsStore(initialPosts);
      }
      return initialPosts;
    } catch (error) {
      if (!allowDiskFallback) {
        throw error;
      }
      if (
        process.env.NEXT_PHASE === "phase-production-build" &&
        error instanceof Error &&
        error.message.includes("No blob credentials found")
      ) {
        console.warn(
          "Vercel Blob credentials unavailable during build; using local posts fallback.",
        );
      } else {
        console.error(
          "Failed to read posts from Vercel Blob, falling back to local disk:",
          error,
        );
      }
    }
  }

  return readPostsFromDisk();
}

/** Writes the full `WritingPost[]` list to private Vercel Blob (when enabled) and local disk. */
async function writePostsStore(posts: WritingPost[]): Promise<void> {
  const serialized = `${JSON.stringify(posts, null, 2)}\n`;

  if (shouldUseVercelBlob()) {
    await put(POSTS_BLOB_KEY, serialized, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
    });

    tryWritePostsToDisk(posts);
    return;
  }

  writePostsToDisk(posts);
}

function sortPostsNewestFirst(posts: WritingPost[]): WritingPost[] {
  return [...posts].sort((a, b) => b.date.localeCompare(a.date));
}

const cachedReadPostsStore =
  typeof unstable_cache === "function"
    ? unstable_cache(
        async (): Promise<WritingPost[]> => readPostsStore(),
        ["posts-store"],
        { tags: [POSTS_CACHE_TAG], revalidate: false },
      )
    : null;

async function readPublicPostsStore(): Promise<WritingPost[]> {
  // Next.js `unstable_cache` provides an isolated cache boundary for ISR/static routes
  // (so inner `no-store` Blob reads don't throw static-to-dynamic errors at runtime).
  // Skip it under Vitest where no Next.js incrementalCache exists.
  if (!cachedReadPostsStore || process.env.VITEST) {
    return readPostsStore();
  }
  return cachedReadPostsStore();
}

/**
 * Returns all writing posts (including drafts) sorted from newest to oldest.
 * Intended for authenticated admin views only; always bypasses the public ISR cache.
 */
export const getAllAdminPosts = cache(async (): Promise<WritingPost[]> => {
  const posts = await readPostsStore();
  return sortPostsNewestFirst(posts);
});

/**
 * Returns all published writing posts sorted from newest to oldest.
 * Backed by `unstable_cache` (tagged `POSTS_CACHE_TAG`) for ISR/CDN caching and
 * wrapped in `React.cache` to deduplicate reads within a single render pass.
 */
export const getAllPosts = cache(async (): Promise<WritingPost[]> => {
  const posts = await readPublicPostsStore();
  return sortPostsNewestFirst(posts).filter(isPostPublished);
});

/**
 * Finds a single published writing post by its id, or returns undefined if not found.
 * Reuses the per-request cached `getAllPosts` list.
 */
export const getPostById = cache(
  async (id: string): Promise<WritingPost | undefined> => {
    const posts = await getAllPosts();
    return posts.find((post) => post.id === id);
  },
);

/**
 * Finds a published post that previously used `id` as its slug, or returns undefined.
 * Used to redirect old post URLs to their current canonical slug after a rename.
 */
export const getPostRedirectByPreviousId = cache(
  async (id: string): Promise<WritingPost | undefined> => {
    const posts = await getAllPosts();
    return posts.find(
      (post) => post.id !== id && post.previousIds?.includes(id),
    );
  },
);

function removeSlugFromOtherPreviousIds(
  posts: WritingPost[],
  claimedId: string,
  ignoreIndex?: number,
): void {
  for (let i = 0; i < posts.length; i++) {
    if (i === ignoreIndex) continue;
    const prev = posts[i].previousIds;
    if (!prev || !prev.includes(claimedId)) continue;
    const filtered = prev.filter((slug) => slug !== claimedId);
    if (filtered.length > 0) {
      posts[i] = { ...posts[i], previousIds: filtered };
    } else {
      const { previousIds: _removed, ...rest } = posts[i];
      void _removed;
      posts[i] = rest;
    }
  }
}

/** Upserts a post and returns the saved post, sorted list, and whether it was previously published. */
export async function savePostAndList(params: {
  originalId?: string;
  post: WritingPost;
}): Promise<{ post: WritingPost; posts: WritingPost[]; wasPublished: boolean }> {
  const existing = await readPostsStore({ allowDiskFallback: false });
  const { originalId, post } = params;
  let wasPublished = false;
  let savedPost: WritingPost = post;

  if (originalId) {
    // Editing an existing post: ensure the new slug doesn't collide with a different post
    if (
      originalId !== post.id &&
      existing.some((p) => p.id === post.id)
    ) {
      throw new PostConflictError(post.id);
    }

    const index = existing.findIndex((p) => p.id === originalId);
    if (index >= 0) {
      const previousPost = existing[index];
      wasPublished = isPostPublished(previousPost);

      const previousIdsSet = new Set(previousPost.previousIds ?? []);
      if (wasPublished && originalId !== post.id) {
        previousIdsSet.add(originalId);
      }
      previousIdsSet.delete(post.id);

      const nextPreviousIds = [...previousIdsSet];
      if (nextPreviousIds.length > 0) {
        savedPost = { ...post, previousIds: nextPreviousIds };
      } else {
        const { previousIds: _removed, ...rest } = post;
        void _removed;
        savedPost = rest;
      }

      existing[index] = savedPost;
      removeSlugFromOtherPreviousIds(existing, savedPost.id, index);
    } else {
      removeSlugFromOtherPreviousIds(existing, savedPost.id);
      existing.unshift(savedPost);
    }
  } else {
    // Creating a new post: reject if slug is already taken
    if (existing.some((p) => p.id === post.id)) {
      throw new PostConflictError(post.id);
    }
    removeSlugFromOtherPreviousIds(existing, savedPost.id);
    existing.unshift(savedPost);
  }

  await writePostsStore(existing);
  return { post: savedPost, posts: sortPostsNewestFirst(existing), wasPublished };
}

/** Upserts a post in Vercel Blob (and local `lib/posts.json` in dev), preventing slug collisions. */
export async function savePost(params: {
  originalId?: string;
  post: WritingPost;
}): Promise<WritingPost> {
  const { post } = await savePostAndList(params);
  return post;
}

/** Deletes a post by id and returns the remaining sorted posts along with the removed post (if any). */
export async function deletePostAndList(
  id: string,
): Promise<{ posts: WritingPost[]; deletedPost?: WritingPost }> {
  const existing = await readPostsStore({ allowDiskFallback: false });
  const deletedPost = existing.find((post) => post.id === id);
  const filtered = existing.filter((post) => post.id !== id);
  await writePostsStore(filtered);
  return { posts: sortPostsNewestFirst(filtered), deletedPost };
}

/** Deletes a post by id from Vercel Blob (and local `lib/posts.json` in dev). */
export async function deletePost(id: string): Promise<void> {
  await deletePostAndList(id);
}
