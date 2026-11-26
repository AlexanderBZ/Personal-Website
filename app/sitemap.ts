import type { MetadataRoute } from "next";
import { getAllPosts, isValidIsoDate } from "@/lib/posts";
import { SITE_CONFIG } from "@/lib/site";

function toValidDate(isoDate?: string): Date | undefined {
  return isoDate && isValidIsoDate(isoDate) ? new Date(isoDate) : undefined;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getAllPosts();
  const latestPostDate = toValidDate(posts[0]?.date);

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: SITE_CONFIG.url,
      ...(latestPostDate ? { lastModified: latestPostDate } : {}),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_CONFIG.url}/writing`,
      ...(latestPostDate ? { lastModified: latestPostDate } : {}),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${SITE_CONFIG.url}/portfolio`,
      changeFrequency: "monthly",
      priority: 0.7,
    },
  ];

  const postRoutes: MetadataRoute.Sitemap = posts.map((post) => {
    const lastModified = toValidDate(post.date);
    return {
      url: `${SITE_CONFIG.url}/writing/${encodeURIComponent(post.id)}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: "monthly",
      priority: 0.6,
    };
  });

  return [...staticRoutes, ...postRoutes];
}

