import { ImageResponse } from "next/og";
import { BrandMark } from "./brand-mark";

// iOS home-screen icons must be PNG, so this one is drawn at build time
// from the same mark as icon.svg rather than kept as a second image file
// that drifts out of step with it.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0a09",
        }}
      >
        <BrandMark size={150} />
      </div>
    ),
    size,
  );
}
