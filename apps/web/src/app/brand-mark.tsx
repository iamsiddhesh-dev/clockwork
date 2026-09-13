/**
 * The Clockwork mark as plain, self-contained SVG, for the generated
 * images (home-screen icon, link preview). Those render outside the page,
 * so the CSS variables the in-app `Logo` uses do not exist there -- every
 * colour here is literal. Same geometry as `icon.svg`.
 */
export function BrandMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="20.4" fill="none" stroke="rgba(255,255,255,0.24)" strokeWidth="3.4" />
      <path
        d="M32 11.6a20.4 20.4 0 0 1 17.8 10.4"
        fill="none"
        stroke="#ff7a18"
        strokeWidth="4.2"
        strokeLinecap="round"
      />
      <path
        d="M32 21.6V32l7 4.2"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
