import { Page } from "@/components/ui";
import Simulator from "./Simulator";

export const metadata = {
  title: "Steward — simulate",
  description:
    "No wallet, no funds, no network call — mandate sliders and an attack lab run live in the browser through the real @steward/engine policy engine.",
};

export default function SimulatePage() {
  return (
    <Page
      current="/simulate"
      eyebrow="No wallet needed"
      title="Simulator"
      lead="Move anything. The real policy engine re-decides, in your browser."
      width="max-w-6xl"
    >
      <Simulator />
    </Page>
  );
}
