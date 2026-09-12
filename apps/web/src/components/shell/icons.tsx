/**
 * The icon set, drawn as bare path data so every icon inherits stroke
 * colour from its button and there is no icon dependency to ship.
 * 24x24 viewBox, 1.5 stroke, round caps -- matching the design.
 */

const PATHS = {
  overview:
    '<rect x="3.2" y="3.2" width="7.4" height="7.4" rx="1.6"/><rect x="13.4" y="3.2" width="7.4" height="7.4" rx="1.6"/><rect x="3.2" y="13.4" width="7.4" height="7.4" rx="1.6"/><rect x="13.4" y="13.4" width="7.4" height="7.4" rx="1.6"/>',
  workflows:
    '<rect x="7.5" y="7.5" width="9" height="9" rx="2"/><path d="M10 3.5v4M14 3.5v4M10 16.5v4M14 16.5v4M3.5 10h4M3.5 14h4M16.5 10h4M16.5 14h4"/>',
  runs: '<path d="M3 12.5h3.4l2.4-6.6 3.9 13.2 2.4-6.6H21"/>',
  approvals:
    '<path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7.5"/><path d="M3 11.5 5.6 4.2A1.6 1.6 0 0 1 7.1 3h9.8a1.6 1.6 0 0 1 1.5 1.2L21 11.5"/><path d="M3 11.5h4.2l1.4 2.6h6.8l1.4-2.6H21"/>',
  opportunities: '<path d="M3.5 16.6 9 11l3.5 3.5L20.5 6.5"/><path d="M15 6.5h5.5V12"/>',
  money:
    '<path d="M3 8.2a2 2 0 0 1 2-2h11.4a2 2 0 0 1 2 2"/><rect x="3" y="8.2" width="18" height="11.6" rx="2.4"/><path d="M16.2 14h1.6"/>',
  settings:
    '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.3"/><circle cx="8" cy="17" r="2.3"/>',
  threads:
    '<path d="M20.5 12.5a7.5 7.5 0 0 1-10.8 6.7L4 20.5l1.4-5.4A7.5 7.5 0 1 1 20.5 12.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"/>',
  moon: '<path d="M20 14.2A8.4 8.4 0 0 1 9.8 4 8.6 8.6 0 1 0 20 14.2"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3.1 2"/>',
  zap: '<path d="M12.8 2.5 4.6 13.4h5.6l-1 8.1 8.2-10.9h-5.6z"/>',
  inbox:
    '<path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7.5"/><path d="M3 11.5h4.2l1.4 2.6h6.8l1.4-2.6H21"/>',
  coin: '<circle cx="12" cy="12" r="8.6"/><path d="M14.6 9.2a3 3 0 0 0-2.6-1.3c-1.6 0-2.6.8-2.6 2s1 1.8 2.6 2 2.8.7 2.8 2-1.2 2.1-2.8 2.1a3 3 0 0 1-2.7-1.4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
  alert: '<path d="M12 8.4v4.2M12 16.4h.01"/><circle cx="12" cy="12" r="8.6"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 17,
  className,
  strokeWidth = 1.5,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flex: "none" }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}

/** The clock-face mark. Its hand is the only filled-in stroke, which is
 *  what makes it read as a clock rather than a generic circle. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 26 26"
      fill="none"
      style={{ flex: "none" }}
      aria-hidden="true"
    >
      <circle cx="13" cy="13" r="10.2" stroke="var(--rim2)" strokeWidth="1.3" />
      <path
        d="M13 2.8a10.2 10.2 0 0 1 8.9 5.2"
        stroke="var(--ink)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M13 7.8V13l3.5 2.1"
        stroke="var(--ink)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
