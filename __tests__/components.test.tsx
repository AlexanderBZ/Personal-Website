import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { metadata as studioMetadata } from "@/app/studio/page";
import NotFound from "@/app/not-found";
import FreewriteAdmin from "@/components/FreewriteAdmin";
import PageLayout from "@/components/PageLayout";
import SectionList from "@/components/SectionList";

describe("UI Components", () => {
  describe("SectionList", () => {
    it("returns empty markup when items array is empty", () => {
      const html = renderToStaticMarkup(
        <SectionList title="Writing" items={[]} />,
      );
      expect(html).toBe("");
    });

    it("renders internal links, external links, time elements, and neutralizes unsafe hrefs", () => {
      const html = renderToStaticMarkup(
        <SectionList
          title="Links"
          items={[
            {
              id: "internal",
              title: "Hello Again",
              meta: "04/05/2026",
              dateTime: "2026-04-05",
              href: "/writing/hello-again",
            },
            {
              id: "external",
              title: "AstroForge",
              meta: "Series B",
              href: "https://www.astroforge.com/",
              external: true,
            },
            {
              id: "unsafe",
              title: "Unsafe Link",
              meta: "Blocked",
              href: "javascript:alert(1)",
            },
          ]}
        />,
      );

      expect(html).toContain('href="/writing/hello-again"');
      expect(html).toContain('<time dateTime="2026-04-05">04/05/2026</time>');
      expect(html).toContain(
        'href="https://www.astroforge.com/" target="_blank" rel="noopener noreferrer"',
      );
      expect(html).not.toContain("javascript:alert(1)");
      expect(html).toContain('<div class="post-list-row"><h3>Unsafe Link</h3>');
    });
  });

  describe("PageLayout and NotFound", () => {
    it("renders page layout with back link, table of contents, and body content", () => {
      const html = renderToStaticMarkup(
        <PageLayout
          title="Sample Essay"
          meta={<time dateTime="2026-11-11">11 November, 2026</time>}
          tocTitle="Sample Essay"
          tocItems={[{ id: "part-1", label: "Part 1" }]}
        >
          <p>Essay body paragraph.</p>
        </PageLayout>,
      );

      expect(html).toContain("<h1>Sample Essay</h1>");
      expect(html).toContain('href="#part-1"');
      expect(html).toContain("<p>Essay body paragraph.</p>");
    });

    it("renders NotFound page", () => {
      const html = renderToStaticMarkup(<NotFound />);
      expect(html).toContain("Page not found");
      expect(html).toContain("The page you are looking for does not exist.");
    });
  });

  describe("FreewriteAdmin and /studio page", () => {
    it("exports noindex/nofollow metadata on /studio", () => {
      expect(studioMetadata.title).toBe("Freewrite Studio");
      expect(studioMetadata.robots).toEqual({
        index: false,
        follow: false,
      });
    });

    it("renders GitHub login gate when unauthenticated", () => {
      const html = renderToStaticMarkup(
        <FreewriteAdmin initialAuthenticated={false} initialPosts={[]} />,
      );

      expect(html).toContain("<h1>freewrite</h1>");
      expect(html).toContain(
        "Sign in with an authorized GitHub account to open the writing studio.",
      );
      expect(html).toContain("Continue with GitHub");
      expect(html).not.toContain('type="password"');
      expect(html).not.toContain(">Publish<");
    });

    it("renders blank writing studio when authenticated with no existing posts", () => {
      const html = renderToStaticMarkup(
        <FreewriteAdmin initialAuthenticated={true} initialPosts={[]} />,
      );

      expect(html).toContain(">Publish<");
      expect(html).not.toContain("Save draft");
      expect(html).toContain("Post details");
      expect(html).toContain("0 words");
      expect(html).toContain("History (0)");
      expect(html).toContain("New Entry");
      expect(html).toContain("Sign out");
      expect(html).not.toContain("View live ↗");
    });

    it("renders writing studio preloaded with the latest post when authenticated", () => {
      const html = renderToStaticMarkup(
        <FreewriteAdmin
          initialAuthenticated={true}
          initialPosts={[
            {
              id: "first-essay",
              title: "First Essay",
              date: "2026-11-11",
              summary: "My first essay summary",
              content: [
                { heading: "Intro" },
                "One two three four five words.",
              ],
            },
          ]}
        />,
      );

      expect(html).toContain(">Update<");
      expect(html).not.toContain(">Publish<");
      expect(html).not.toContain("Save changes");
      expect(html).not.toContain("Unpublish");
      expect(html).toContain('href="/writing/first-essay"');
      expect(html).toContain("View live ↗");
      expect(html).toContain('value="First Essay"');
      expect(html).toContain("## Intro\n\nOne two three four five words.");
      expect(html).toContain("8 words");
      expect(html).toContain("History (1)");
    });

    it("renders draft badge, Publish as the only save action, and hides live link when preloaded post is a draft", () => {
      const html = renderToStaticMarkup(
        <FreewriteAdmin
          initialAuthenticated={true}
          initialPosts={[
            {
              id: "draft-essay",
              title: "Draft Essay",
              date: "2026-11-11",
              summary: "Work in progress",
              status: "draft",
              content: ["Working through ideas."],
            },
          ]}
        />,
      );

      expect(html).toContain(">Publish<");
      expect(html).not.toContain("Save draft");
      expect(html).not.toContain("Save changes");
      expect(html).toContain('<span class="freewrite-badge">Draft</span>');
      expect(html).not.toContain("View live ↗");
      expect(html).not.toContain("Unpublish");
    });
  });
});
