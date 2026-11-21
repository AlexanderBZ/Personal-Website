import Link from "next/link";
import PostToc, { type TocItem } from "@/components/PostToc";

export type { TocItem };

interface PostAsideProps {
  /** Where the back button goes, defaults to "/" */
  backHref?: string;
  /** Text next to the back arrow, defaults to "Index" */
  backLabel?: string;
  /** Post title, shown at the top of the table of contents once scrolled. */
  title?: string;
  /** Section headings for the table of contents. Hidden when empty. */
  items?: TocItem[];
}

const EMPTY_TOC_ITEMS: TocItem[] = [];

const backArrowIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M5.5 4L1.5 8M1.5 8L5.5 12M1.5 8H10C11.3807 8 12.5 6.88071 12.5 5.5V5.5C12.5 4.11929 11.3807 3 10 3H8.5"
      stroke="currentColor"
    />
  </svg>
);

/**
 * Left-hand aside for subpages and writing pages: a server-rendered back button and,
 * when section items are provided, the client-side sticky table of contents.
 */
export default function PostAside({
  backHref = "/",
  backLabel = "Index",
  title,
  items = EMPTY_TOC_ITEMS,
}: PostAsideProps) {
  return (
    <aside className="post-aside" data-ready="true">
      <Link className="post-back" href={backHref}>
        {backArrowIcon}
        {backLabel}
      </Link>

      {items.length > 0 ? <PostToc title={title} items={items} /> : null}
    </aside>
  );
}
