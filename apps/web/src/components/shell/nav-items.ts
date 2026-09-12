import type { IconName } from "./icons";

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** Shown as the header title. Kept next to the nav so the two can never
   *  drift apart. */
  title: string;
  /** Routes that belong to this nav item but are not it -- a thread
   *  detail page still highlights Threads, a run detail still highlights
   *  Runs. Without this, drilling in makes the sidebar look like nothing
   *  is selected. */
  also?: string[];
};

export const PRIMARY_NAV: NavItem[] = [
  { href: "/overview", label: "Overview", icon: "overview", title: "Overview" },
  { href: "/workflows", label: "Workflows", icon: "workflows", title: "Workflows" },
  { href: "/runs", label: "Runs", icon: "runs", title: "Run trace" },
  { href: "/approvals", label: "Approvals", icon: "approvals", title: "Approval inbox" },
  {
    href: "/opportunities",
    label: "Opportunities",
    icon: "opportunities",
    title: "Opportunities",
  },
  {
    href: "/money",
    label: "Money",
    icon: "money",
    title: "Money",
    also: ["/deals", "/threads"],
  },
];

/** Reachable from the header box rather than the sidebar, but it still
 *  needs a title, so it lives in the map. */
export const UNLISTED_NAV: NavItem[] = [
  { href: "/search", label: "Search", icon: "search", title: "Search" },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: "/settings", label: "Settings", icon: "settings", title: "Settings", also: ["/profile"] },
];

export const ALL_NAV = [...PRIMARY_NAV, ...SECONDARY_NAV];

/** Everything with a title, including screens the sidebar doesn't list. */
const TITLED_NAV = [...ALL_NAV, ...UNLISTED_NAV];

/** Longest match wins, so /runs/abc picks Runs rather than falling
 *  through to whichever item happens to be listed first. */
export function activeItem(pathname: string): NavItem | null {
  let best: NavItem | null = null;
  let bestLength = -1;
  for (const item of TITLED_NAV) {
    for (const prefix of [item.href, ...(item.also ?? [])]) {
      if (
        (pathname === prefix || pathname.startsWith(`${prefix}/`)) &&
        prefix.length > bestLength
      ) {
        best = item;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}
