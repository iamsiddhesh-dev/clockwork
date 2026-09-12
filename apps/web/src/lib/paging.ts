/**
 * Reading a page number out of a URL, in one place.
 *
 * Every server-rendered list uses `?page=`, and every one of them has to
 * survive the same nonsense: `?page=0`, `?page=-3`, `?page=abc`,
 * `?page=1&page=2`. Each of those turns into a negative or NaN offset
 * that PostgREST answers with an error rather than an empty page, so the
 * list would break rather than degrade.
 */

/** Rows per page for the server-rendered lists. */
export const PAGE_SIZE = 20;

export function pageFrom(params: Record<string, string | string[] | undefined>): number {
  const raw = params.page;
  // A repeated query param arrives as an array. Last one wins, the way
  // a browser resolves a duplicated field.
  const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  const page = Number(value);
  return Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
}

export function offsetFor(page: number, pageSize = PAGE_SIZE): number {
  return (page - 1) * pageSize;
}

/** `?page=2`, or a bare path for page one -- so the first page has one
 *  canonical address rather than two. */
export function pageHref(path: string, page: number): string {
  return page <= 1 ? path : `${path}?page=${page}`;
}
