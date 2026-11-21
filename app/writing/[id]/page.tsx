import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import PageLayout from "@/components/PageLayout";
import {
  formatLongDate,
  getAllPosts,
  getPostById,
  getPostRedirectByPreviousId,
  parsePostContent,
} from "@/lib/posts";
import { createPageMetadata, serializeJsonLd, SITE_CONFIG } from "@/lib/site";

export async function generateStaticParams() {
  const posts = await getAllPosts();
  return posts.map((post) => ({
    id: post.id,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const post = await getPostById(id);

  if (!post) {
    return {
      title: "Not Found",
    };
  }

  return createPageMetadata({
    title: post.title,
    description: post.summary,
    path: `/writing/${post.id}`,
    type: "article",
    publishedTime: post.date,
  });
}

export default async function WritingPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const post = await getPostById(id);

  if (!post) {
    const redirectedPost = await getPostRedirectByPreviousId(id);
    if (redirectedPost) {
      permanentRedirect(`/writing/${encodeURIComponent(redirectedPost.id)}`);
    }
    notFound();
  }

  const { sections, blocks } = parsePostContent(post.content);
  const postUrl = `${SITE_CONFIG.url}/writing/${encodeURIComponent(post.id)}`;
  const postJsonLd = serializeJsonLd({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.summary,
    datePublished: post.date,
    dateModified: post.date,
    image: `${postUrl}/opengraph-image`,
    url: postUrl,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": postUrl,
    },
    author: {
      "@type": "Person",
      name: SITE_CONFIG.name,
      url: SITE_CONFIG.url,
    },
    publisher: {
      "@type": "Person",
      name: SITE_CONFIG.name,
      url: SITE_CONFIG.url,
    },
  });

  return (
    <PageLayout
      title={post.title}
      meta={<time dateTime={post.date}>{formatLongDate(post.date)}</time>}
      tocTitle={post.title}
      tocItems={sections}
      backHref="/writing"
      backLabel="Writing"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: postJsonLd }}
      />
      {blocks.map((block) =>
        block.type === "paragraph" ? (
          <p key={block.key}>{block.text}</p>
        ) : (
          <div key={block.key} className="section-heading">
            <hr />
            <h2 id={block.id}>
              <span>{block.heading}</span>
            </h2>
          </div>
        ),
      )}
    </PageLayout>
  );
}
