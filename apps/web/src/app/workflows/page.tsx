import Link from "next/link";
import { api } from "@/lib/api";
import { requireAccount } from "@/lib/account-server";
import { ApiDown, Dot, Empty, PageHead, TONES } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const TONE: Record<string, keyof typeof TONES> = {
  pending: "active",
  done: "ok",
  idle: "quiet",
};

export default async function WorkflowsPage() {
  const account = await requireAccount();
  const data = await api.overview(account).catch(() => null);
  if (!data) return <ApiDown what="Workflows" />;
  const workflows = data.workflows;

  return (
    <>
      <PageHead
        kicker="Workflows"
        title="One agent, four stages"
        aside={
          <p
            className="cw-mono"
            style={{ margin: 0, fontSize: 11, lineHeight: 1.6, color: "var(--quiet)", textAlign: "right" }}
          >
{workflows.filter((w) => w.tone !== "idle").length} of {workflows.length} active · 12 tools
          </p>
        }
      />

      {workflows.length === 0 ? (
<Empty title="Nothing has run yet">Start from Opportunities.</Empty>
      ) : (
        <div className="cw-stack">
          {workflows.map((flow) => (
            <div
              key={flow.key}
              className="cw-card"
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 16,
                padding: "18px 20px",
                borderColor: flow.waiting ? "var(--orange-bd)" : "var(--rim)",
              }}
            >
              <Dot tone={TONE[flow.tone] ?? "quiet"} live={flow.tone === "pending"} />

              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.012em" }}>
                  {flow.name}
                </div>
                <div style={{ marginTop: 4, fontSize: 13, color: "var(--dim)", lineHeight: 1.5 }}>
                  {flow.blurb}
                </div>
                <div className="cw-mono" style={{ marginTop: 8, fontSize: 11, color: "var(--quiet)" }}>
                  {flow.tools.join(" · ")}
                </div>
              </div>

              <div
                className="cw-mono"
                style={{
                  flex: "none",
                  width: 150,
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: flow.waiting ? "var(--orange-ink)" : "var(--quiet)",
                }}
              >
                {flow.state}
                <br />
                <span style={{ color: "var(--quiet)" }}>
                  {flow.last_at ? formatDateTime(flow.last_at) : "—"}
                </span>
              </div>

              <div
                className="cw-mono"
                style={{ flex: "none", width: 92, textAlign: "right", fontSize: 11, color: "var(--quiet)" }}
              >
                {flow.calls} call{flow.calls === 1 ? "" : "s"}
                <br />
                {flow.cost_usd > 0 ? `$${flow.cost_usd.toFixed(4)}` : "—"}
              </div>

              {flow.waiting ? (
                <Link href="/approvals" className="cw-btn cw-btn-sm cw-btn-primary" style={{ flex: "none" }}>
                  Review
                </Link>
              ) : (
                <Link href="/runs" className="cw-btn cw-btn-sm" style={{ flex: "none" }}>
                  Trace
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
