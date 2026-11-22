import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import LocalTime from "@/components/LocalTime";
import SectionList from "@/components/SectionList";
import { formatPostDate, getAllPosts, toPostListItems } from "@/lib/posts";
import {
  serializeJsonLd,
  SITE_CONFIG,
  SITE_RSS_ALTERNATES,
} from "@/lib/site";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    types: SITE_RSS_ALTERNATES,
  },
};

const homeJsonLd = serializeJsonLd({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Person",
      name: SITE_CONFIG.name,
      url: SITE_CONFIG.url,
      description: SITE_CONFIG.description,
      jobTitle: "Product Manager & Angel Investor",
      homeLocation: {
        "@type": "Place",
        name: SITE_CONFIG.location,
      },
      sameAs: [SITE_CONFIG.links.linkedin, SITE_CONFIG.links.x],
    },
    {
      "@type": "WebSite",
      name: SITE_CONFIG.name,
      url: SITE_CONFIG.url,
      description: SITE_CONFIG.description,
    },
  ],
});

export default async function Home() {
  const posts = await getAllPosts();
  const lastUpdated = posts[0]?.date;
  const postItems = toPostListItems(posts);

  return (
    <div className="homepage">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: homeJsonLd }}
      />
      <article className="article">
        <header>
          <Image
            className="site-logo"
            src="/logo.svg"
            alt=""
            width={24}
            height={24}
            priority
          />
          <h1>{SITE_CONFIG.name}</h1>
          {lastUpdated ? (
            <span className="article-meta">
              Updated{" "}
              <time dateTime={lastUpdated}>{formatPostDate(lastUpdated)}</time>
            </span>
          ) : null}
        </header>
        <p>Builder. Angel Investor. Optimist.</p>
        <p>
          Helping founders go from -1 to 0. Ideas, beta testing, customer intros
          (+ occasional angel check). See my{" "}
          <Link className="basic-link" href="/portfolio">
            portfolio
          </Link>
          .
        </p>
        <p>
          Want to chat or looking for help? You can find me on{" "}
          <a
            className="basic-link"
            href={SITE_CONFIG.links.linkedin}
            target="_blank"
            rel="noopener noreferrer"
          >
            LinkedIn
          </a>
          ,{" "}
          <a
            className="basic-link"
            href={SITE_CONFIG.links.x}
            target="_blank"
            rel="noopener noreferrer"
          >
            X
          </a>
          , or{" "}
          <a className="basic-link" href={SITE_CONFIG.links.mailto}>
            email
          </a>
          .
        </p>
      </article>

      <SectionList title="Writing" titleHref="/writing" items={postItems} />

      <footer className="site-footer">
        <p>
          <LocalTime />
          {" · "}
          <a
            className="basic-link"
            href="/feed.xml"
            type="application/rss+xml"
          >
            RSS Feed
          </a>
        </p>
      </footer>
    </div>
  );
}
