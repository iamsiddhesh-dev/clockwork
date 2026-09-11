"use client";

import { usePathname } from "next/navigation";
import { Ambient } from "./ambient";
import { ShellProvider } from "./shell-context";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

/** Routes that get the lighting and the page ground but none of the app
 *  chrome: there is nothing to navigate to before you are signed in, and
 *  onboarding is deliberately a one-way corridor that ends in its own
 *  explicit buttons. */
const BARE = ["/login", "/auth/", "/onboarding"];

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
      <div className="cw-page">
        <div className="cw-shell">
          <Sidebar />
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
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
