"use client";

import Link from "next/link";

/**
 * One pager for every list in the app.
 *
 * Two kinds of screen need it and they page differently. A server-
 * rendered list (Runs, Threads, Pipeline) pages by URL, so the page
 * number is in the address bar, survives a reload, and can be linked to
 * or opened in a new tab. An interactive list (Opportunities, which
 * dismisses and scores rows in place) pages in component state, because
 * a navigation there would throw away the work it just did. Same
 * control, same behaviour, two ways of moving: pass `href` for the first
 * and `onPage` for the second.
 *
 * It renders nothing at all when everything fits on one page. A pager
 * under a list of four items is noise pretending to be a feature.
 */
export function Pager({
  page,
  pageSize,
  total,
  href,
  onPage,
  busy,
  noun = "item",
}: {
  /** 1-based, because it is shown to a person. */
  page: number;
  pageSize: number;
  total: number;
  href?: (page: number) => string;
  onPage?: (page: number) => void;
  busy?: boolean;
  noun?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const current = Math.min(Math.max(1, page), pages);
  const first = (current - 1) * pageSize + 1;
  // The last row on this page, not `first + pageSize - 1`: on the final
  // page that would promise twenty and show three.
  const last = Math.min(current * pageSize, total);

  return (
    <nav
      className="cw-row"
      aria-label="Pagination"
      style={{ gap: 10, justifyContent: "space-between", padding: "4px 2px" }}
    >
      <span className="cw-mono" style={{ fontSize: 11, color: "var(--quiet)" }}>
        {first}&ndash;{last} of {total} {noun}
        {total === 1 ? "" : "s"}
      </span>

      <span className="cw-row" style={{ gap: 6 }}>
        <Step
          to={current - 1}
          disabled={current === 1 || busy}
          label="Previous page"
          href={href}
          onPage={onPage}
        >
          &lsaquo;
        </Step>

        {pageNumbers(current, pages).map((entry, i) =>
          entry === null ? (
            <span
              key={`gap${i}`}
              className="cw-mono"
              style={{ padding: "0 2px", fontSize: 12, color: "var(--quiet)" }}
            >
              &hellip;
            </span>
          ) : (
            <Step
              key={entry}
              to={entry}
              current={entry === current}
              disabled={busy}
              label={`Page ${entry}`}
              href={href}
              onPage={onPage}
            >
              {entry}
            </Step>
          ),
        )}

        <Step
          to={current + 1}
          disabled={current === pages || busy}
          label="Next page"
          href={href}
          onPage={onPage}
        >
          &rsaquo;
        </Step>
      </span>
    </nav>
  );
}

/**
 * Up to seven slots: always the first and last page, always a window
 * around the current one, and `null` wherever a run was skipped. Keeping
 * the ends visible is what makes "how long is this list" answerable
 * without clicking through it.
 */
export function pageNumbers(current: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);

  const window = new Set<number>([1, pages, current]);
  for (const n of [current - 1, current + 1]) {
    if (n > 1 && n < pages) window.add(n);
  }
  // Near an end there is room to show more of it, so the control does
  // not shrink to three numbers and two ellipses at page 1.
  if (current <= 3) [2, 3, 4].forEach((n) => window.add(n));
  if (current >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((n) => window.add(n));

  const sorted = [...window].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}

function Step({
  to,
  current,
  disabled,
  label,
  href,
  onPage,
  children,
}: {
  to: number;
  current?: boolean;
  disabled?: boolean;
  label: string;
  href?: (page: number) => string;
  onPage?: (page: number) => void;
  children: React.ReactNode;
}) {
  const style: React.CSSProperties = {
    minWidth: 30,
    height: 30,
    padding: "0 9px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "var(--r-ctl)",
    border: `1px solid ${current ? "var(--orange-bd)" : "var(--rim)"}`,
    background: current ? "var(--orange-bg)" : "transparent",
    color: current ? "var(--orange-ink)" : "var(--dim)",
    fontSize: 12.5,
    fontWeight: current ? 600 : 400,
    lineHeight: 1,
    transition: "background var(--t), color var(--t), border-color var(--t)",
  };

  if (disabled || current) {
    return (
      <span
        aria-label={label}
        aria-current={current ? "page" : undefined}
        aria-disabled={disabled || undefined}
        style={{ ...style, opacity: disabled && !current ? 0.4 : 1 }}
      >
        {children}
      </span>
    );
  }

  if (href) {
    return (
      <Link href={href(to)} aria-label={label} style={style}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" aria-label={label} onClick={() => onPage?.(to)} style={style}>
      {children}
    </button>
  );
}
