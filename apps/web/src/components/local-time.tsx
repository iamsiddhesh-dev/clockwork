"use client";

import { useSyncExternalStore } from "react";

const subscribeNever = () => () => {};

const FORMATS: Record<"datetime" | "time", Intl.DateTimeFormatOptions> = {
  datetime: { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" },
  time: { hour: "2-digit", minute: "2-digit" },
};

/**
 * A timestamp in the viewer's own time zone.
 *
 * Pages render on the server, where the clock is UTC, so a server-formatted
 * time disagreed with the times client components showed: the same approval
 * read 08:36 AM in the inbox and 3:07 AM in the history below it. The server
 * pass renders UTC (the only zone it knows), and the browser re-renders in
 * local time straight after hydration.
 */
export function LocalTime({ iso, mode = "datetime" }: { iso: string; mode?: "datetime" | "time" }) {
  const inBrowser = useSyncExternalStore(subscribeNever, () => true, () => false);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const options = inBrowser ? FORMATS[mode] : { ...FORMATS[mode], timeZone: "UTC" };
  return <time dateTime={iso}>{date.toLocaleString("en-US", options)}</time>;
}
