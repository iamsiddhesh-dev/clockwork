"use client";

import { usePathname } from "next/navigation";
import { Ambient } from "./ambient";
import { ShellProvider } from "./shell-context";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

/** Routes that get the lighting and the page ground but none of the app
 *  chrome. Onboarding is deliberately a one-way corridor that ends in its
 *  own explicit buttons, /signin is reached with no workspace to put in a
 *  sidebar, and /intake is a public page shown to someone else's client --
 *  putting a sidebar full of the freelancer's pipeline on it would be
 *  absurd. */
const BARE = ["/onboarding", "/signin", "/intake/"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = BARE.some((prefix) => pathname.startsWith(prefix));

  if (bare) {
    return (
      <>
        <Ambient />
        <div
          className="cw-page"
          style={{ display: "grid", placeItems: "center", position: "relative" }}
        >
          <div style={{ position: "relative", zIndex: 1, width: "100%" }}>{children}</div>
        </div>
      </>
    );
  }

  return (
    <ShellProvider>
      <Ambient />
      {/* cw-page-app, not just cw-page: only the shell layout is pinned
          to the window height, because only it has a sidebar that must
          stay put and a main column that scrolls on its own. The bare
          pages -- onboarding, sign-in, intake -- are ordinary documents
          taller than the viewport, and pinning those simply made them
          unscrollable. */}
      <div className="cw-page cw-page-app">
        <div className="cw-shell">
          <Sidebar />
          {/* cw-column, not just flex: the class carries the min-height
              that lets this column scroll inside the shell instead of
              stretching it. See globals.css. */}
          <div className="cw-column" style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
            <TopBar />
            <main className="cw-main cw-enter" key={pathname}>
              {children}
            </main>
          </div>
        </div>
      </div>
    </ShellProvider>
  );
}
