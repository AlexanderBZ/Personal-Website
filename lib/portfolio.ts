import type { SectionListItem } from "@/components/SectionList";

export interface Investment {
  name: string;
  description: string;
  href?: string;
}

export const investments: Investment[] = [
  {
    name: "AstroForge",
    description: "Series B",
    href: "https://www.astroforge.com/",
  },
];

/** Maps `Investment[]` into items for `<SectionList />`. */
export function toInvestmentListItems(
  items: Investment[],
): SectionListItem[] {
  return items.map((investment) => ({
    id: investment.name,
    title: investment.name,
    meta: investment.description,
    href: investment.href,
    external: Boolean(investment.href),
  }));
}
