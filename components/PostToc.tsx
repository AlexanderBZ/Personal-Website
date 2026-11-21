"use client";

import { useEffect, useState } from "react";
import { captureClientEvent } from "@/lib/posthog-client";

export interface TocItem {
  id: string;
  label: string;
}

interface PostTocProps {
  /** Post title, shown at the top of the table of contents once scrolled. */
  title?: string;
  /** Section headings for the table of contents. */
  items: TocItem[];
}

/**
 * Sticky table of contents for writing pages that highlights the section in view.
 */
export default function PostToc({ title, items }: PostTocProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (items.length === 0) return;

    let frameId: number | null = null;

    const updateScrollState = () => {
      frameId = null;
      setScrolled(window.scrollY > 80);

      // Active section = the last heading that has scrolled past the top third.
      const threshold = window.innerHeight / 3;
      let current: string | null = null;
      for (const { id } of items) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= threshold) current = id;
      }
      setActiveId(current);
    };

    const onScroll = () => {
      if (frameId === null) {
        frameId = window.requestAnimationFrame(updateScrollState);
      }
    };

    updateScrollState();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [items]);

  if (items.length === 0) return null;

  return (
    <nav
      className="post-toc"
      aria-label="Table of contents"
      data-scrolled={scrolled}
    >
      {title ? (
        <button
          type="button"
          className="post-toc-title"
          data-active={activeId === null}
          tabIndex={scrolled ? 0 : -1}
          onClick={() => window.scrollTo({ top: 0 })}
        >
          {title}
        </button>
      ) : null}
      <ul>
        {items.map((item) => (
          <li key={item.id} data-active={activeId === item.id}>
            <a
              href={`#${item.id}`}
              aria-current={activeId === item.id ? "location" : undefined}
              onClick={() =>
                captureClientEvent("toc_section_clicked", {
                  section_id: item.id,
                  section_label: item.label,
                })
              }
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
