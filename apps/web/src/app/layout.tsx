import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Clockwork",
  description: "Runs the business half of freelancing, on a clock, while nobody is watching.",
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
