import type { NextConfig } from "next";

/**
 * Refuse to build a deployment that would call localhost.
 *
 * `NEXT_PUBLIC_API_URL` is inlined into the bundle at build time, and
 * `lib/api.ts` falls back to http://localhost:8000 when it is missing so
 * local development needs no setup. On Vercel that fallback is a trap: the
 * build succeeds, the site loads, and every page says it can't reach the
 * agent -- because each visitor's browser is trying their own machine.
 * Failing here turns a confusing live site into a clear build error.
 *
 * `VERCEL` is set by Vercel during its builds, so a local `npm run build`
 * is unaffected.
 */
if (process.env.VERCEL) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!apiUrl) {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not set. Add it in the Vercel project's Environment Variables " +
        "(the agent API's URL, e.g. https://clockwork-api.vercel.app) and redeploy.",
    );
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(apiUrl)) {
    throw new Error(
      `NEXT_PUBLIC_API_URL points at ${apiUrl}, which no visitor can reach. ` +
        "Set it to the deployed agent API's URL and redeploy.",
    );
  }
}

const nextConfig: NextConfig = {};

export default nextConfig;
