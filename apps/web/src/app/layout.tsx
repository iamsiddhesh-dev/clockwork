import type { Metadata, Viewport } from "next";
import { Figtree, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/shell/app-shell";
import { NO_FLASH_SCRIPT } from "@/components/shell/shell-context";
import "./globals.css";

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

/**
 * The site's own public address, for absolute link-preview URLs. A share
 * card with a relative image path shows no image at all on most platforms.
 * Vercel exposes the production domain at build time; locally there is
 * nothing to share, so localhost is fine.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL
  ? process.env.NEXT_PUBLIC_SITE_URL
  : process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000";

const TITLE = "Clockwork — the business half of freelancing, handled";
const DESCRIPTION =
  "An autonomous agent for freelancers. It finds real work, scores it against your profile, drafts pitches and quotes, invoices, and chases payment — and nothing is sent until you approve it.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Pages set their own short title ("Overview") and this frames it,
  // so a row of open tabs says which screen each one is.
  title: { default: TITLE, template: "%s · Clockwork" },
  description: DESCRIPTION,
  applicationName: "Clockwork",
  openGraph: {
    type: "website",
    siteName: "Clockwork",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  // The browser chrome on mobile matches the page instead of flashing white.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#050505" },
    { media: "(prefers-color-scheme: light)", color: "#edeae6" },
  ],
  colorScheme: "dark light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // Written again on the client before paint; this is the
      // server-rendered default so the markup is never attribute-less.
      data-theme="dark"
      data-ambient="on"
      className={`${figtree.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
