import type { Metadata } from "next";

const EMAIL_ADDRESS = "alexander@alexanderzwerner.com";
const EMAIL_SUBJECT = "Hey Alexander!";
const EMAIL_BODY = `1) What are you exploring now and why?
2) What non-traditional things were you doing as a kid?
3) Anything else on your mind`;

export const SITE_CONFIG = {
  name: "Alexander Zwerner",
  url: "https://alexanderzwerner.com",
  description:
    "Builder. Angel Investor. Optimist. Helping founders go from -1 to 0 with ideas, beta testing, customer intros, and occasional angel checks.",
  location: "San Francisco",
  timeZone: "America/Los_Angeles",
  themeColor: "#fdfdfc",
  twitterHandle: "@hey_zwerner",
  links: {
    linkedin: "https://www.linkedin.com/in/alexander-zwerner/",
    x: "https://x.com/hey_zwerner",
    email: EMAIL_ADDRESS,
    mailto: `mailto:${EMAIL_ADDRESS}?subject=${encodeURIComponent(
      EMAIL_SUBJECT,
    )}&body=${encodeURIComponent(EMAIL_BODY)}`,
  },
} as const;

export const SITE_RSS_ALTERNATES = {
  "application/rss+xml": [
    { url: "/feed.xml", title: `${SITE_CONFIG.name} | Writing RSS Feed` },
  ],
};

interface PageMetadataOptions {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
  publishedTime?: string;
}

/** Builds consistent Next.js Metadata with canonical URLs, OpenGraph, and Twitter cards. */
export function createPageMetadata({
  title,
  description,
  path,
  type = "website",
  publishedTime,
}: PageMetadataOptions): Metadata {
  const fullTitle =
    type === "article" ? title : `${title} | ${SITE_CONFIG.name}`;
  const canonicalPath = path.startsWith("/") ? path : `/${path}`;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalPath,
      types: SITE_RSS_ALTERNATES,
    },
    openGraph: {
      title: fullTitle,
      description,
      url: canonicalPath,
      siteName: SITE_CONFIG.name,
      locale: "en_US",
      type,
      ...(type === "article"
        ? {
            authors: [SITE_CONFIG.name],
            ...(publishedTime ? { publishedTime } : {}),
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      creator: SITE_CONFIG.twitterHandle,
    },
  };
}

/** Serializes JSON-LD safely for inline `<script type="application/ld+json">` tags. */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
