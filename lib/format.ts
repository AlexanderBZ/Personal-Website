/**
 * A block of post content: a plain string renders as a paragraph, and
 * `{ heading }` starts a new section (shown with a divider and in the
 * table of contents).
 */
export type PostBlock = string | { heading: string };

export type PostStatus = "draft" | "published";

export interface WritingPost {
  id: string;
  title: string;
  date: string;
  summary: string;
  content: PostBlock[];
  status?: PostStatus;
  previousIds?: string[];
}

/** Returns true when a post should be visible on public routes (defaults to true for legacy posts). */
export function isPostPublished(post: Pick<WritingPost, "status">): boolean {
  return post.status !== "draft";
}

export interface PostSection {
  id: string;
  label: string;
}

export type RenderedPostBlock =
  | { type: "paragraph"; key: string; text: string }
  | { type: "heading"; key: string; id: string; heading: string };

export interface PostListItem {
  id: string;
  title: string;
  meta: string;
  dateTime: string;
  href: string;
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Turns a heading or title into a URL-friendly anchor/slug, e.g. "What's in it" -> "whats-in-it". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Converts an array of `PostBlock` items into plain freewrite text (`## Heading` + paragraphs). */
export function blocksToText(blocks: PostBlock[]): string {
  return blocks
    .map((block) =>
      typeof block === "string" ? block : `## ${block.heading}`,
    )
    .join("\n\n");
}

/** Parses freewrite plain text (blocks separated by blank lines, `## Heading` for sections) into `PostBlock[]`. */
export function textToBlocks(text: string): PostBlock[] {
  return text
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      if (chunk === "##" || chunk.startsWith("## ")) {
        const heading = chunk.slice(2).trim();
        return heading ? { heading } : "";
      }
      if (chunk === "#" || chunk.startsWith("# ")) {
        const heading = chunk.slice(1).trim();
        return heading ? { heading } : "";
      }
      return chunk.replace(/\n+/g, " ");
    })
    .filter((block) => (typeof block === "string" ? block.length > 0 : true));
}

/**
 * Pre-computes unique section anchor IDs and renderable blocks for a post so that
 * duplicate headings never collide in DOM `id`s or React keys.
 */
export function parsePostContent(content: PostBlock[]): {
  sections: PostSection[];
  blocks: RenderedPostBlock[];
} {
  const sections: PostSection[] = [];
  const blocks: RenderedPostBlock[] = [];
  const seenCounts = new Map<string, number>();

  content.forEach((block, index) => {
    if (typeof block === "string") {
      blocks.push({
        type: "paragraph",
        key: `p-${index}`,
        text: block,
      });
      return;
    }

    const baseId = slugify(block.heading) || `section-${index + 1}`;
    const count = seenCounts.get(baseId) ?? 0;
    seenCounts.set(baseId, count + 1);
    const uniqueId = count === 0 ? baseId : `${baseId}-${count + 1}`;

    sections.push({ id: uniqueId, label: block.heading });
    blocks.push({
      type: "heading",
      key: `h-${uniqueId}`,
      id: uniqueId,
      heading: block.heading,
    });
  });

  return { sections, blocks };
}

/** Maps `WritingPost[]` into items for `<SectionList />`. */
export function toPostListItems(posts: WritingPost[]): PostListItem[] {
  return posts.map((post) => ({
    id: post.id,
    title: post.title,
    meta: formatNumericDate(post.date),
    dateTime: post.date,
    href: `/writing/${post.id}`,
  }));
}

/** Returns today's UTC date formatted as `YYYY-MM-DD`. */
export function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Validates that a string is a strict `YYYY-MM-DD` date representing a real calendar day. */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_REGEX.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Formats an ISO date (YYYY-MM-DD) as "MM/DD/YYYY". */
export function formatNumericDate(isoDate: string): string {
  if (!isValidIsoDate(isoDate)) return isoDate;
  const [year, month, day] = isoDate.split("-");
  return `${month}/${day}/${year}`;
}

/** Formats an ISO date (YYYY-MM-DD) as "11 November, 2026". */
export function formatLongDate(isoDate: string): string {
  if (!isValidIsoDate(isoDate)) return isoDate;
  const [year, month, day] = isoDate.split("-").map(Number);
  const monthName = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
    "en-US",
    { month: "long", timeZone: "UTC" },
  );
  return `${day} ${monthName}, ${year}`;
}

/** Formats an ISO date string (YYYY-MM-DD) for display without timezone drift. */
export function formatPostDate(isoDate: string): string {
  if (!isValidIsoDate(isoDate)) return isoDate;
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
