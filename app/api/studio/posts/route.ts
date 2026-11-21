import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { isAdminAuthenticated, verifySameOrigin } from "@/lib/auth";
import {
  getPostHogClient,
  getPostHogCorrelationFromRequest,
} from "@/lib/posthog-server";
import {
  deletePostAndList,
  getAllAdminPosts,
  getTodayIso,
  isPostPublished,
  isValidIsoDate,
  PostConflictError,
  POSTS_CACHE_TAG,
  type PostStatus,
  savePostAndList,
  slugify,
  textToBlocks,
  type WritingPost,
} from "@/lib/posts";

const MAX_BODY_CHARS = 100_000;
const MAX_TITLE_CHARS = 200;
const MAX_SUMMARY_CHARS = 500;
const MAX_SLUG_CHARS = 100;
const VALID_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function revalidatePublicPosts(postPaths: string[]): void {
  revalidateTag(POSTS_CACHE_TAG, { expire: 0 });
  revalidatePath("/");
  revalidatePath("/writing");
  revalidatePath("/sitemap.xml");
  revalidatePath("/feed.xml");
  for (const postPath of postPaths) {
    revalidatePath(postPath);
  }
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const posts = await getAllAdminPosts();
  return NextResponse.json({ posts });
}

export async function POST(request: Request) {
  if (!(await verifySameOrigin())) {
    return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  }

  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { distinctId, sessionId } = getPostHogCorrelationFromRequest(request);

  try {
    let rawPayload: unknown;
    try {
      rawPayload = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    if (
      typeof rawPayload !== "object" ||
      rawPayload === null ||
      Array.isArray(rawPayload)
    ) {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const payload = rawPayload as Record<string, unknown>;
    const bodyText = readOptionalString(payload.bodyText) ?? "";
    if (bodyText.length > MAX_BODY_CHARS) {
      return NextResponse.json(
        { error: "Post body exceeds maximum size limit" },
        { status: 413 },
      );
    }

    const rawTitle = readOptionalString(payload.title)?.trim() ?? "";
    const title = (rawTitle || "Untitled").slice(0, MAX_TITLE_CHARS);

    const rawId = readOptionalString(payload.id)?.trim() ?? "";
    const slugBase = slugify(rawId || title)
      .slice(0, MAX_SLUG_CHARS)
      .replace(/-+$/, "");
    const id = slugBase || `post-${Date.now()}`;

    const rawOriginalId = readOptionalString(payload.originalId)?.trim();
    const originalId =
      rawOriginalId &&
      rawOriginalId.length <= MAX_SLUG_CHARS &&
      VALID_SLUG_REGEX.test(rawOriginalId)
        ? rawOriginalId
        : undefined;

    const rawDate = readOptionalString(payload.date)?.trim() ?? "";
    const date = isValidIsoDate(rawDate) ? rawDate : getTodayIso();

    const content = textToBlocks(bodyText);
    const firstParagraph = content.find(
      (block): block is string => typeof block === "string",
    );
    const rawStatus = readOptionalString(payload.status)?.trim();
    if (
      rawStatus !== undefined &&
      rawStatus !== "draft" &&
      rawStatus !== "published"
    ) {
      return NextResponse.json(
        { error: "Invalid post status" },
        { status: 400 },
      );
    }
    const status: PostStatus = rawStatus === "draft" ? "draft" : "published";

    const rawSummary = readOptionalString(payload.summary)?.trim() ?? "";
    const summary = (
      rawSummary || (firstParagraph ? firstParagraph.slice(0, 140) : title)
    ).slice(0, MAX_SUMMARY_CHARS);

    const newPost: WritingPost = {
      id,
      title,
      date,
      summary,
      content,
      status,
    };

    const { post: saved, posts, wasPublished } = await savePostAndList({
      originalId,
      post: newPost,
    });

    if (isPostPublished(saved) || wasPublished) {
      const postPaths = new Set([`/writing/${saved.id}`]);
      if (originalId && originalId !== saved.id) {
        postPaths.add(`/writing/${originalId}`);
      }
      for (const previousId of saved.previousIds ?? []) {
        postPaths.add(`/writing/${previousId}`);
      }
      revalidatePublicPosts([...postPaths]);
    }

    const posthog = getPostHogClient(request);
    posthog?.capture({
      distinctId: distinctId || "admin",
      event: "admin_post_saved",
      properties: {
        ...(sessionId ? { $session_id: sessionId } : {}),
        post_id: saved.id,
        status: saved.status ?? "published",
        is_new_post: !originalId,
        renamed_slug: Boolean(originalId && originalId !== saved.id),
        block_count: content.length,
      },
    });
    await posthog?.flush().catch(() => {});

    return NextResponse.json({ post: saved, posts });
  } catch (error) {
    if (error instanceof PostConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const posthog = getPostHogClient(request);
    posthog?.captureException(error, distinctId || "admin", {
      ...(sessionId ? { $session_id: sessionId } : {}),
      route: "/api/studio/posts",
      method: "POST",
    });
    await posthog?.flush().catch(() => {});

    console.error("Failed to save post:", error);
    return NextResponse.json(
      { error: "Failed to save post" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!(await verifySameOrigin())) {
    return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  }

  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { distinctId, sessionId } = getPostHogCorrelationFromRequest(request);

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();
    if (!id || id.length > MAX_SLUG_CHARS || !VALID_SLUG_REGEX.test(id)) {
      return NextResponse.json({ error: "Invalid post id" }, { status: 400 });
    }

    const { posts, deletedPost } = await deletePostAndList(id);

    const postPaths = new Set([`/writing/${id}`]);
    for (const previousId of deletedPost?.previousIds ?? []) {
      postPaths.add(`/writing/${previousId}`);
    }
    revalidatePublicPosts([...postPaths]);

    const posthog = getPostHogClient(request);
    posthog?.capture({
      distinctId: distinctId || "admin",
      event: "admin_post_deleted",
      properties: {
        ...(sessionId ? { $session_id: sessionId } : {}),
        post_id: id,
      },
    });
    await posthog?.flush().catch(() => {});

    return NextResponse.json({ posts });
  } catch (error) {
    const posthog = getPostHogClient(request);
    posthog?.captureException(error, distinctId || "admin", {
      ...(sessionId ? { $session_id: sessionId } : {}),
      route: "/api/studio/posts",
      method: "DELETE",
    });
    await posthog?.flush().catch(() => {});

    console.error("Failed to delete post:", error);
    return NextResponse.json(
      { error: "Failed to delete post" },
      { status: 500 },
    );
  }
}
