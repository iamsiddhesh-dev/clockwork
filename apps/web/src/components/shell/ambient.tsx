/**
 * The lighting behind the interface: four blurred colour fields that
 * drift slowly, plus a grain overlay that stops the gradients banding on
 * cheap panels.
 *
 * Fixed and pointer-events:none so it never participates in layout or
 * intercepts a click. Every colour comes from a token, so the light and
 * dark palettes and the "ambient off" switch all work without this file
 * knowing anything about them.
 */
export function Ambient() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "-16%",
          left: "-16%",
          width: "70%",
          height: "125%",
          background:
            "radial-gradient(42% 46% at 50% 50%, var(--l-warm), transparent 72%)",
          filter: "blur(80px)",
          animation: "cw-drift 36s ease-in-out infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "-20%",
          right: "-18%",
          width: "74%",
          height: "130%",
          background:
            "radial-gradient(42% 46% at 50% 50%, var(--l-cool), transparent 72%)",
          filter: "blur(80px)",
          animation: "cw-drift-b 44s ease-in-out infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "-28%",
          left: "44%",
          width: "36%",
          height: "115%",
          background:
            "radial-gradient(38% 46% at 50% 50%, var(--l-white), transparent 70%)",
          filter: "blur(90px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "-30%",
          left: "12%",
          width: "56%",
          height: "78%",
          background:
            "radial-gradient(44% 48% at 50% 50%, var(--l-low), transparent 72%)",
          filter: "blur(90px)",
          animation: "cw-drift-b 52s ease-in-out infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: "var(--grain)",
          mixBlendMode: "overlay",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}
