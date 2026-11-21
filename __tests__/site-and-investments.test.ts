import { describe, expect, it } from "vitest";
import { investments, toInvestmentListItems } from "@/lib/portfolio";
import { createPageMetadata, SITE_CONFIG } from "@/lib/site";

describe("lib/site", () => {
  it("exposes valid site configuration and mailto link", () => {
    expect(SITE_CONFIG.name).toBe("Alexander Zwerner");
    expect(SITE_CONFIG.url).toBe("https://alexanderzwerner.com");
    expect(SITE_CONFIG.links.mailto).toContain(
      "mailto:alexander@alexanderzwerner.com?subject=",
    );
  });

  it("builds website metadata with normalized canonical paths", () => {
    const meta = createPageMetadata({
      title: "Writing",
      description: "Essays and notes.",
      path: "writing",
    });

    expect(meta.title).toBe("Writing");
    expect(meta.description).toBe("Essays and notes.");
    expect(meta.alternates?.canonical).toBe("/writing");
    expect(meta.alternates?.types?.["application/rss+xml"]).toBeDefined();
    expect(meta.openGraph).toMatchObject({
      title: `Writing | ${SITE_CONFIG.name}`,
      description: "Essays and notes.",
      url: "/writing",
      type: "website",
    });
  });

  it("builds article metadata with author and publishedTime", () => {
    const meta = createPageMetadata({
      title: "Hello Again",
      description: "Why I redesigned this site.",
      path: "/writing/hello-again",
      type: "article",
      publishedTime: "2026-04-05",
    });

    expect(meta.alternates?.canonical).toBe("/writing/hello-again");
    expect(meta.openGraph).toMatchObject({
      title: "Hello Again",
      type: "article",
      authors: [SITE_CONFIG.name],
      publishedTime: "2026-04-05",
    });
  });
});

describe("lib/portfolio", () => {
  it("maps investments into SectionListItem records", () => {
    expect(investments.length).toBeGreaterThan(0);

    const mapped = toInvestmentListItems([
      {
        name: "AstroForge",
        description: "Series B",
        href: "https://www.astroforge.com/",
      },
      {
        name: "Stealth Co",
        description: "Seed",
      },
    ]);

    expect(mapped).toEqual([
      {
        id: "AstroForge",
        title: "AstroForge",
        meta: "Series B",
        href: "https://www.astroforge.com/",
        external: true,
      },
      {
        id: "Stealth Co",
        title: "Stealth Co",
        meta: "Seed",
        href: undefined,
        external: false,
      },
    ]);
  });
});

