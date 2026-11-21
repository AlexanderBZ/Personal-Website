import type { ReactNode } from "react";
import PostAside, { type TocItem } from "@/components/PostAside";

interface PageLayoutProps {
  title: string;
  /** Optional subtitle/date element rendered inside the `<header>` below `<h1>`. */
  meta?: ReactNode;
  /** Optional Table of Contents heading title (typically `title` for long-form posts). */
  tocTitle?: string;
  /** Optional Table of Contents section items for the left aside. */
  tocItems?: TocItem[];
  /** Custom back link destination (defaults to `"/""`). */
  backHref?: string;
  /** Custom back link label (defaults to `"Index"`). */
  backLabel?: string;
  /** Article body content rendered inside `<article className="article">`. */
  children?: ReactNode;
  /** Additional sections rendered below `<article>` (e.g., `<SectionList />`). */
  after?: ReactNode;
}

/**
 * Shared layout shell for subpages (`/writing`, `/writing/[id]`, `/portfolio`, 404).
 * Renders the left-hand `<PostAside />` navigation, the `<article>` header/body, and trailing sections.
 */
export default function PageLayout({
  title,
  meta,
  tocTitle,
  tocItems,
  backHref,
  backLabel,
  children,
  after,
}: PageLayoutProps) {
  return (
    <div className="post-layout">
      <PostAside
        backHref={backHref}
        backLabel={backLabel}
        title={tocTitle}
        items={tocItems}
      />
      <article className="article">
        <header>
          <h1>{title}</h1>
          {meta}
        </header>
        {children}
      </article>
      {after}
    </div>
  );
}
