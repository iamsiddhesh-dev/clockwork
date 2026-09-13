/**
 * Date formatting with an explicit locale. `.toLocaleString()`/`Date`
 * with no locale argument resolves the *ambient* default locale, which
 * differs between the Node SSR runtime and the browser -- that mismatch
 * is exactly what caused a hydration error here (confirmed via the Next
 * dev overlay). Pinning the locale makes server and client render
 * identical text.
 */

const LOCALE = "en-US";

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(LOCALE);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE);
}

// Same ambient-locale hazard applies to Number.prototype.toLocaleString()
// (grouping separators, decimal marks) -- pin it here too.
export function formatNumber(n: number): string {
  return n.toLocaleString(LOCALE);
}

/** What woke a run, said the way a person would. "manual trigger" was
 *  the column value leaking straight onto the screen. */
export function triggerLabel(triggerType: string): string {
  switch (triggerType) {
    case "manual":
      return "Started by you";
    case "schedule":
      return "Woke up on schedule";
    case "message":
      return "A client wrote in";
    default:
      return triggerType;
  }
}
