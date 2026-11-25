import type { Metadata } from "next";
import PageLayout from "@/components/PageLayout";
import SectionList from "@/components/SectionList";
import { investments, toInvestmentListItems } from "@/lib/portfolio";
import { createPageMetadata } from "@/lib/site";

export const metadata: Metadata = createPageMetadata({
  title: "Portfolio",
  description:
    "Angel investments and portfolio companies backed by Alexander Zwerner, helping founders go from -1 to 0.",
  path: "/portfolio",
});

export default function PortfolioPage() {
  const investmentItems = toInvestmentListItems(investments);

  return (
    <PageLayout
      title="Portfolio"
      after={<SectionList title="Angel Investments" items={investmentItems} />}
    >
      {investments.length === 0 ? <p>No investments listed yet.</p> : null}
    </PageLayout>
  );
}

