import Link from "next/link";
import { useId } from "react";

export interface SectionListItem {
  id: string;
  title: string;
  meta: string;
  /** Optional ISO date string when `meta` represents a date/time. */
  dateTime?: string;
  /** Optional internal or external link URL. */
  href?: string;
  /** Whether the link should open in a new tab. */
  external?: boolean;
}

interface SectionListProps {
  title: string;
  /** Optional internal link for the section heading (e.g. `"/writing"`). */
  titleHref?: string;
  items: SectionListItem[];
}

function isSafeHref(href: string): boolean {
  if (href.startsWith("/") && !href.startsWith("//")) return true;
  try {
    const parsed = new URL(href);
    return (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:" ||
      parsed.protocol === "mailto:"
    );
  } catch {
    return false;
  }
}

/**
 * Reusable section list with a hairline heading, item titles on the left,
 * and muted metadata/dates on the right. Used for Writing posts and Angel Investments.
 */
export default function SectionList({
  title,
  titleHref,
  items,
}: SectionListProps) {
  const headingId = useId();

  if (items.length === 0) return null;

  const safeTitleHref =
    titleHref && isSafeHref(titleHref) ? titleHref : undefined;

  return (
    <section className="post-list" aria-labelledby={headingId}>
      <h2 id={headingId} className="post-list-title">
        {safeTitleHref ? <Link href={safeTitleHref}>{title}</Link> : title}
      </h2>
      <ul>
        {items.map((item) => {
          const safeHref =
            item.href && isSafeHref(item.href) ? item.href : undefined;
          const content = (
            <>
              <h3>{item.title}</h3>
              {item.dateTime ? (
                <time dateTime={item.dateTime}>{item.meta}</time>
              ) : (
                <span className="post-list-meta">{item.meta}</span>
              )}
            </>
          );

          return (
            <li key={item.id}>
              {safeHref ? (
                item.external ? (
                  <a
                    href={safeHref}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {content}
                  </a>
                ) : (
                  <Link href={safeHref}>{content}</Link>
                )
              ) : (
                <div className="post-list-row">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
