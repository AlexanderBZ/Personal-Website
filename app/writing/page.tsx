import type { Metadata } from "next";
import PageLayout from "@/components/PageLayout";
import SectionList from "@/components/SectionList";
import { getAllPosts, toPostListItems } from "@/lib/posts";
import { createPageMetadata } from "@/lib/site";

export const metadata: Metadata = createPageMetadata({
  title: "Writing",
  description:
    "Essays and notes on building and investing at the earliest stages.",
  path: "/writing",
});

export default async function WritingPage() {
  const posts = await getAllPosts();
  const postItems = toPostListItems(posts);

  return (
    <PageLayout
      title="Writing"
      after={<SectionList title="All posts" items={postItems} />}
    >
      {posts.length === 0 ? <p>No posts yet.</p> : null}
    </PageLayout>
  );
}
