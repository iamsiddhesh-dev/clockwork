import { Suspense } from "react";
import { requireAccount } from "@/lib/account-server";
import { PageHead } from "@/components/ui";
import { SearchView } from "./search-view";

export const dynamic = "force-dynamic";

export default async function SearchPage() {
  // Gate on the workspace even though the view fetches client-side --
  // otherwise a cookie-less visitor gets an empty search box instead of
  // being sent to onboarding.
  await requireAccount();

  return (
    <>
      <PageHead kicker="Search" title="Everything, in one list" />
      {/* useSearchParams needs a Suspense boundary to prerender. */}
      <Suspense fallback={null}>
        <SearchView />
      </Suspense>
    </>
  );
}
