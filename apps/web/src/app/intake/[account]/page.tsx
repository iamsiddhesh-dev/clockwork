import { notFound } from "next/navigation";
import { API_URL } from "@/lib/api";
import { IntakeForm } from "./intake-form";

export const dynamic = "force-dynamic";

type Freelancer = { name: string; title: string | null; positioning: string | null };

/**
 * The public lead-capture form. No workspace cookie, no app chrome, no
 * sign-in -- the person filling this in is a stranger, which is the
 * entire point. proxy.ts exempts this path for that reason.
 */
export default async function IntakePage(props: PageProps<"/intake/[account]">) {
  const { account } = await props.params;

  const response = await fetch(`${API_URL}/intake/${account}`, { cache: "no-store" }).catch(
    () => null,
  );

  // A 404 here means the link is wrong or the freelancer never finished
  // onboarding. Either way there is nobody to write to, and an empty
  // form that silently goes nowhere would be worse than saying so.
  if (!response || !response.ok) notFound();

  const freelancer = (await response.json()) as Freelancer;
  return <IntakeForm account={account} freelancer={freelancer} />;
}
