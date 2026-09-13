/**
 * What a page shows while its data loads.
 *
 * Every app page renders on the server and waits on the API, so without
 * this a click did nothing visible until the whole page was ready. With a
 * `loading.tsx` per route, Next.js swaps this in immediately and streams
 * the real page over it.
 */
export function PageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <header className="cw-page-head">
        <div style={{ flex: "1 1 300px", minWidth: 0 }}>
          <div className="cw-skel" style={{ width: 90, height: 11 }} />
          <div className="cw-skel" style={{ width: "min(340px, 70%)", height: 30, marginTop: 14 }} />
        </div>
      </header>
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="cw-card" style={{ padding: 22 }}>
          <div className="cw-skel" style={{ width: "38%", height: 14 }} />
          <div className="cw-skel" style={{ width: "82%", height: 12, marginTop: 14 }} />
          <div className="cw-skel" style={{ width: "64%", height: 12, marginTop: 10 }} />
        </div>
      ))}
    </div>
  );
}
