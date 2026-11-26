import { getAllPosts, isValidIsoDate } from "@/lib/posts";
import { SITE_CONFIG } from "@/lib/site";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toRssUtcDate(isoDate?: string): string {
  if (isoDate && isValidIsoDate(isoDate)) {
    return new Date(`${isoDate}T00:00:00Z`).toUTCString();
  }
  return new Date().toUTCString();
}

export async function GET() {
  const posts = await getAllPosts();
  const lastBuildDate = toRssUtcDate(posts[0]?.date);

  const itemsXml = posts
    .map((post) => {
      const postUrl = `${SITE_CONFIG.url}/writing/${encodeURIComponent(post.id)}`;
      const pubDate = toRssUtcDate(post.date);
      return [
        "    <item>",
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(postUrl)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(postUrl)}</guid>`,
        `      <pubDate>${escapeXml(pubDate)}</pubDate>`,
        `      <description>${escapeXml(post.summary)}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  const rssXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(SITE_CONFIG.name)}</title>`,
    `    <link>${escapeXml(SITE_CONFIG.url)}</link>`,
    `    <description>${escapeXml(SITE_CONFIG.description)}</description>`,
    "    <language>en-us</language>",
    `    <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(`${SITE_CONFIG.url}/feed.xml`)}" rel="self" type="application/rss+xml" />`,
    itemsXml,
    "  </channel>",
    "</rss>",
  ].join("\n");

  return new Response(rssXml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      // Keep the edge cache short so `revalidatePath("/feed.xml")` on publish
      // takes effect quickly instead of serving a stale feed for an hour.
      "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    },
  });
}

