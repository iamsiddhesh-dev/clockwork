import { ImageResponse } from "next/og";
import { BrandMark } from "./brand-mark";

// The card shown when the link is pasted into Devpost, Slack, X or a chat.
// Without it most platforms show a bare URL, which is the first thing a
// judge sees of the project.
export const alt = "Clockwork — the business half of freelancing, handled";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#050505",
          backgroundImage:
            "radial-gradient(circle at 18% 30%, rgba(255,122,24,0.34), transparent 45%), radial-gradient(circle at 86% 70%, rgba(77,163,255,0.28), transparent 45%)",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <BrandMark size={84} />
          <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: "-0.04em" }}>Clockwork</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              fontSize: 72,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
              maxWidth: 960,
            }}
          >
            The business half of freelancing, handled.
          </div>
          <div style={{ fontSize: 30, color: "#a29d97", maxWidth: 980, lineHeight: 1.35 }}>
            Finds work, pitches, quotes, invoices and chases payment. Nothing is sent until you
            approve it.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
