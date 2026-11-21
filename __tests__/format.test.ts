import { describe, expect, it } from "vitest";
import {
  blocksToText,
  formatLongDate,
  formatNumericDate,
  formatPostDate,
  getTodayIso,
  isPostPublished,
  isValidIsoDate,
  parsePostContent,
  slugify,
  textToBlocks,
  toPostListItems,
  type WritingPost,
} from "@/lib/format";

describe("lib/format", () => {
  describe("slugify", () => {
    it("converts titles and headings into lowercase hyphenated slugs", () => {
      expect(slugify("Hello Again")).toBe("hello-again");
      expect(slugify("What's in it for 2026?")).toBe("whats-in-it-for-2026");
      expect(slugify("  ---Multiple   Spaces & Symbols!---  ")).toBe(
        "multiple-spaces-symbols",
      );
    });

    it("returns an empty string for symbol-only input", () => {
      expect(slugify("!!!")).toBe("");
      expect(slugify("")).toBe("");
    });
  });

  describe("blocksToText and textToBlocks", () => {
    it("converts PostBlock arrays to freewrite text and back", () => {
      const blocks = [
        "First paragraph of the essay.",
        { heading: "Section One" },
        "Second paragraph under section one.",
      ];

      const text = blocksToText(blocks);
      expect(text).toBe(
        "First paragraph of the essay.\n\n## Section One\n\nSecond paragraph under section one.",
      );
      expect(textToBlocks(text)).toEqual(blocks);
    });

    it("normalizes single-# headings and collapses intra-paragraph newlines", () => {
      const raw = "# Top Heading\n\nLine one\nline two\n\n##   \n\nFinal line";
      expect(textToBlocks(raw)).toEqual([
        { heading: "Top Heading" },
        "Line one line two",
        "Final line",
      ]);
    });
  });

  describe("parsePostContent", () => {
    it("generates unique section IDs when duplicate headings appear", () => {
      const { sections, blocks } = parsePostContent([
        "Intro text",
        { heading: "Notes" },
        "First note",
        { heading: "Notes" },
        { heading: "!!!" },
      ]);

      expect(sections).toEqual([
        { id: "notes", label: "Notes" },
        { id: "notes-2", label: "Notes" },
        { id: "section-5", label: "!!!" },
      ]);

      expect(blocks).toEqual([
        { type: "paragraph", key: "p-0", text: "Intro text" },
        { type: "heading", key: "h-notes", id: "notes", heading: "Notes" },
        { type: "paragraph", key: "p-2", text: "First note" },
        { type: "heading", key: "h-notes-2", id: "notes-2", heading: "Notes" },
        { type: "heading", key: "h-section-5", id: "section-5", heading: "!!!" },
      ]);
    });
  });

  describe("date validation and formatting", () => {
    it("validates strict YYYY-MM-DD calendar dates including leap years", () => {
      expect(isValidIsoDate("2026-11-11")).toBe(true);
      expect(isValidIsoDate("2024-02-29")).toBe(true); // leap year
      expect(isValidIsoDate("2025-02-29")).toBe(false); // non-leap year
      expect(isValidIsoDate("2026-02-30")).toBe(false);
      expect(isValidIsoDate("2026-13-01")).toBe(false);
      expect(isValidIsoDate("2026-00-10")).toBe(false);
      expect(isValidIsoDate("11/11/2026")).toBe(false);
    });

    it("formats valid ISO dates and returns invalid strings unchanged", () => {
      expect(formatNumericDate("2026-04-05")).toBe("04/05/2026");
      expect(formatNumericDate("invalid")).toBe("invalid");

      expect(formatLongDate("2026-11-11")).toBe("11 November, 2026");
      expect(formatLongDate("invalid")).toBe("invalid");

      expect(formatPostDate("2026-04-05")).toBe("Apr 5, 2026");
      expect(formatPostDate("invalid")).toBe("invalid");

      expect(isValidIsoDate(getTodayIso())).toBe(true);
    });
  });

  describe("toPostListItems", () => {
    it("maps WritingPost objects into SectionList-ready items", () => {
      const posts: WritingPost[] = [
        {
          id: "hello-again",
          title: "Hello Again",
          date: "2026-04-05",
          summary: "Summary",
          content: ["Hello world"],
        },
      ];

      expect(toPostListItems(posts)).toEqual([
        {
          id: "hello-again",
          title: "Hello Again",
          meta: "04/05/2026",
          dateTime: "2026-04-05",
          href: "/writing/hello-again",
        },
      ]);
    });
  });

  describe("isPostPublished", () => {
    it("treats missing status and published status as published, and draft as unpublished", () => {
      const base: WritingPost = {
        id: "sample",
        title: "Sample",
        date: "2026-11-11",
        summary: "",
        content: ["Hello"],
      };

      expect(isPostPublished(base)).toBe(true);
      expect(isPostPublished({ ...base, status: "published" })).toBe(true);
      expect(isPostPublished({ ...base, status: "draft" })).toBe(false);
    });
  });
});

