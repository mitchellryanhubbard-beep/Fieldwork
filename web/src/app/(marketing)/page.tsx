import { Hero } from "@/components/marketing/hero";
import { ProblemBlock } from "@/components/marketing/problem-block";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { ProductVisual } from "@/components/marketing/product-visual";
import { TrustCompliance } from "@/components/marketing/trust-compliance";
import { Pricing } from "@/components/marketing/pricing";
import { CtaBand } from "@/components/marketing/cta-band";

export default function MarketingHome() {
  return (
    <main>
      <Hero />
      <ProblemBlock />
      <HowItWorks />
      <ProductVisual />
      <TrustCompliance />
      <Pricing />
      <CtaBand />
    </main>
  );
}
