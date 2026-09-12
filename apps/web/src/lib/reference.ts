/**
 * Real-world reference data for the onboarding pickers.
 *
 * Time zones and currencies come from the browser's own ICU tables via
 * `Intl.supportedValuesOf`, not from a list typed out by hand. That is
 * deliberate: a hand-maintained list is how you end up offering "EST"
 * and "GMT+5:30" as if they were zones, or a currency that stopped
 * existing in 2002. ICU ships the real IANA and ISO 4217 sets and keeps
 * them current, and offsets are computed from the zone rather than
 * stored, so daylight saving is right without anyone remembering it.
 *
 * The job titles and skills below *are* curated, because no standard
 * list exists — they are drawn from what freelance marketplaces actually
 * categorise people as. Both pickers accept free text, so the list is a
 * shortcut rather than a cage.
 */

/** Zones offered first, because most freelance work happens in them.
 *  Everything else still appears, just below.
 *
 *  Written in modern IANA spelling and resolved against whatever the
 *  runtime actually ships -- see `resolveZone`. */
const PROMINENT_ZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Warsaw",
  "Europe/Kyiv",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

/**
 * IANA renamed a number of zones and every runtime made its own choice
 * about which spelling to ship. This is not trivia: `supportedValuesOf`
 * here returns `Asia/Calcutta` and not `Asia/Kolkata`, so a prominent
 * list written in the modern spelling was filtered against the supported
 * set and silently lost India altogether -- the country with the largest
 * freelance population on earth was reachable only by scrolling four
 * hundred rows to a name nobody has called it since 2001.
 *
 * Each pair is the two spellings of one zone. Which one is offered
 * depends on which the runtime knows; the other becomes a search term,
 * so typing either finds it.
 */
const ZONE_ALIASES: [string, string][] = [
  ["Asia/Kolkata", "Asia/Calcutta"],
  ["Asia/Ho_Chi_Minh", "Asia/Saigon"],
  ["Asia/Yangon", "Asia/Rangoon"],
  ["Asia/Kathmandu", "Asia/Katmandu"],
  ["Europe/Kyiv", "Europe/Kiev"],
  ["America/Argentina/Buenos_Aires", "America/Buenos_Aires"],
  ["Pacific/Chuuk", "Pacific/Truk"],
  ["Pacific/Pohnpei", "Pacific/Ponape"],
  ["Atlantic/Faroe", "Atlantic/Faeroe"],
  ["America/Nuuk", "America/Godthab"],
  ["Asia/Chongqing", "Asia/Chungking"],
];

/**
 * What people type when they look for their own zone: a country, a city
 * that isn't in the zone's name, or an abbreviation. ICU's long name
 * covers a lot of this for free -- Asia/Kolkata is "India Standard Time"
 * -- but not "UK", not "Mumbai", and not "IST".
 */
const ZONE_SEARCH_TERMS: Record<string, string> = {
  "Asia/Kolkata": "India IST Delhi New Delhi Mumbai Bangalore Bengaluru Chennai Hyderabad Pune Kolkata Calcutta",
  "Asia/Karachi": "Pakistan PKT Lahore Islamabad",
  "Asia/Dhaka": "Bangladesh BST",
  "Asia/Dubai": "UAE United Arab Emirates Gulf GST Abu Dhabi",
  "Asia/Singapore": "Singapore SGT",
  "Asia/Bangkok": "Thailand Vietnam Hanoi ICT",
  "Asia/Shanghai": "China Beijing Shenzhen CST",
  "Asia/Tokyo": "Japan JST",
  "Europe/London": "UK United Kingdom Britain England Scotland Wales GMT BST",
  "Europe/Dublin": "Ireland IST",
  "Europe/Paris": "France CET CEST",
  "Europe/Berlin": "Germany CET CEST",
  "Europe/Madrid": "Spain CET",
  "Europe/Lisbon": "Portugal WET",
  "Europe/Warsaw": "Poland CET",
  "Europe/Kyiv": "Ukraine EET",
  "America/New_York": "USA United States US East Coast Eastern EST EDT NYC New York Boston Atlanta Miami Toronto",
  "America/Chicago": "USA United States US Central CST CDT Texas Dallas Austin Houston",
  "America/Denver": "USA United States US Mountain MST MDT Colorado",
  "America/Los_Angeles": "USA United States US Pacific PST PDT California San Francisco Seattle Bay Area",
  "America/Sao_Paulo": "Brazil Brasil BRT",
  "Africa/Lagos": "Nigeria WAT",
  "Africa/Nairobi": "Kenya EAT",
  "Africa/Johannesburg": "South Africa SAST",
  "Australia/Sydney": "Australia AEST AEDT Melbourne Canberra",
  "Pacific/Auckland": "New Zealand NZST NZDT",
};

/** A small, genuinely real fallback for runtimes without
 *  `Intl.supportedValuesOf` -- never a made-up zone. */
const FALLBACK_ZONES = PROMINENT_ZONES;

function allTimeZones(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (supported?.length) return supported;
  } catch {
    /* older runtime */
  }
  return FALLBACK_ZONES;
}

/** The spelling this runtime actually knows, given either spelling.
 *  Returns null when neither is supported, so nothing offers a zone that
 *  will throw the moment it is formatted. */
function resolveZone(zone: string, supported: Set<string>): string | null {
  if (supported.has(zone)) return zone;
  for (const [modern, legacy] of ZONE_ALIASES) {
    if (zone === modern && supported.has(legacy)) return legacy;
    if (zone === legacy && supported.has(modern)) return modern;
  }
  return null;
}

/** Both spellings of a zone, for searching. */
function zoneSpellings(zone: string): string[] {
  const out = [zone];
  for (const [modern, legacy] of ZONE_ALIASES) {
    if (zone === modern) out.push(legacy);
    if (zone === legacy) out.push(modern);
  }
  return out;
}

function zoneName(zone: string, style: "long" | "longOffset", at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: style,
    }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** "GMT+05:30" for a zone, right now. Computed, never stored, so it
 *  follows daylight saving without anyone maintaining it. */
export function utcOffsetLabel(zone: string, at = new Date()): string {
  // ICU gives "GMT+05:30", or a bare "GMT" at zero -- which reads as a
  // missing value next to twenty rows that all show a number.
  return zoneName(zone, "longOffset", at) || "GMT+00:00";
}

/** Minutes east of UTC, parsed back out of the offset label. Used only
 *  for ordering, which is why a zone that cannot be read sorts last
 *  rather than throwing. */
function offsetMinutes(zone: string, at = new Date()): number {
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(utcOffsetLabel(zone, at));
  if (!match) return 9999;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** The spelling to put in front of a person, which is not always the one
 *  the runtime uses internally. ICU here still calls it `Asia/Calcutta`;
 *  nobody in India has since 2001. The stored value stays whatever the
 *  runtime supports, so formatting still works -- only the label moves. */
function displayZone(zone: string): string {
  for (const [modern, legacy] of ZONE_ALIASES) {
    if (zone === legacy) return modern;
  }
  return zone;
}

/** "Asia/Kolkata" -> "Kolkata". The region prefix is already implied by
 *  where the row sits and by the offset next to it. */
function zoneCity(zone: string): string {
  const shown = displayZone(zone);
  return shown.split("/").slice(1).join(" / ").replace(/_/g, " ") || shown;
}

export type Option = {
  value: string;
  label: string;
  hint?: string;
  group?: string;
  /** Extra text the picker matches against but never displays --
   *  countries, cities and abbreviations that are not in the label. */
  search?: string;
};

/**
 * Every real time zone, labelled the way every other site labels them:
 * the offset first, because that is what makes a long list scannable,
 * then the place. Ordered by offset rather than alphabetically, so the
 * list reads as a sweep around the world instead of an index.
 */
export function timeZoneOptions(at = new Date()): Option[] {
  const all = allTimeZones();
  const supported = new Set(all);

  const prominent = PROMINENT_ZONES.map((z) => resolveZone(z, supported)).filter(
    (z): z is string => z !== null,
  );
  const prominentSet = new Set(prominent);
  const rest = all.filter((z) => !prominentSet.has(z));

  const toOption = (zone: string, group: string): Option => {
    const longName = zoneName(zone, "long", at);
    const spellings = zoneSpellings(zone);
    // Terms are keyed on the modern spelling; look under both so the
    // runtime's choice of name does not decide whether India is findable.
    const extra = spellings.map((s) => ZONE_SEARCH_TERMS[s] ?? "").join(" ");
    const offset = utcOffsetLabel(zone, at);
    return {
      value: zone,
      label: `(${offset}) ${zoneCity(zone)}`,
      hint: longName,
      group,
      search: [
        ...spellings,
        longName,
        extra,
        offset,
        // "+5:30" as well as "+05:30" -- nobody types the leading zero.
        offset.replace("GMT", "").replace(/^([+-])0/, "$1"),
        offset.replace("GMT", "UTC"),
      ]
        .join(" ")
        .replace(/_/g, " "),
    };
  };

  const byOffset = (a: string, b: string) =>
    offsetMinutes(a, at) - offsetMinutes(b, at) || a.localeCompare(b);

  return [
    ...prominent.sort(byOffset).map((z) => toOption(z, "Common")),
    ...rest.sort(byOffset).map((z) => toOption(z, "All time zones")),
  ];
}

/**
 * The zone this browser is actually in -- the right default, and the one
 * a person is least likely to have to think about.
 *
 * Resolved against the supported set, because the browser can report a
 * spelling its own `supportedValuesOf` does not list. When that happened
 * the strict picker had a value matching no option and rendered blank,
 * which reads as "it didn't save" rather than "the two lists disagree".
 */
export function guessTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (!zone) return "";
    return resolveZone(zone, new Set(allTimeZones())) ?? zone;
  } catch {
    return "";
  }
}

const PROMINENT_CURRENCIES = [
  "USD", "EUR", "GBP", "CAD", "AUD", "INR", "SGD", "CHF",
  "JPY", "NZD", "AED", "ZAR", "BRL", "MXN", "SEK", "PLN", "NGN",
];

function allCurrencies(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf?.("currency");
    if (supported?.length) return supported;
  } catch {
    /* older runtime */
  }
  return PROMINENT_CURRENCIES;
}

function currencyName(code: string): string {
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "currency" }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

export function currencySymbol(code: string): string {
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(1);
    return parts.find((p) => p.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}

export function currencyOptions(): Option[] {
  const all = allCurrencies();
  const prominent = PROMINENT_CURRENCIES.filter((c) => all.includes(c));
  const rest = all.filter((c) => !prominent.includes(c));

  const toOption = (code: string, group: string): Option => ({
    value: code,
    label: `${code} — ${currencyName(code)}`,
    hint: currencySymbol(code),
    group,
  });

  return [
    ...prominent.map((c) => toOption(c, "Common")),
    ...rest.map((c) => toOption(c, "All currencies")),
  ];
}

/**
 * Professional titles, grouped the way freelance marketplaces group
 * them. Curated because there is no standard list, and offered rather
 * than enforced -- the field takes free text, because the person who
 * types "Shopify performance specialist" knows their market better than
 * any dropdown does.
 */
export const TITLE_OPTIONS: Option[] = [
  // Engineering
  ...[
    "Full-stack developer",
    "Frontend developer",
    "Backend developer",
    "Mobile developer",
    "iOS developer",
    "Android developer",
    "Web developer",
    "WordPress developer",
    "Shopify developer",
    "Game developer",
    "Embedded systems engineer",
    "QA engineer",
    "Automation engineer",
  ].map((label) => ({ value: label, label, group: "Engineering" })),

  // Data and AI
  ...[
    "Data engineer",
    "Data analyst",
    "Data scientist",
    "Machine learning engineer",
    "AI engineer",
    "Analytics engineer",
  ].map((label) => ({ value: label, label, group: "Data & AI" })),

  // Infrastructure
  ...[
    "DevOps engineer",
    "Platform engineer",
    "Site reliability engineer",
    "Cloud architect",
    "Security engineer",
    "Database administrator",
  ].map((label) => ({ value: label, label, group: "Infrastructure" })),

  // Design
  ...[
    "Product designer",
    "UX designer",
    "UI designer",
    "Graphic designer",
    "Brand designer",
    "Motion designer",
    "Illustrator",
    "3D artist",
  ].map((label) => ({ value: label, label, group: "Design" })),

  // Product and delivery
  ...[
    "Product manager",
    "Project manager",
    "Business analyst",
    "Scrum master",
    "Technical writer",
  ].map((label) => ({ value: label, label, group: "Product & delivery" })),

  // Marketing and content
  ...[
    "Copywriter",
    "Content writer",
    "SEO specialist",
    "Performance marketer",
    "Social media manager",
    "Email marketing specialist",
    "Video editor",
  ].map((label) => ({ value: label, label, group: "Marketing & content" })),

  // Business
  ...[
    "Bookkeeper",
    "Accountant",
    "Financial analyst",
    "Virtual assistant",
    "Customer support specialist",
    "Sales consultant",
    "Recruiter",
    "Translator",
  ].map((label) => ({ value: label, label, group: "Business & support" })),
];

/**
 * Skill suggestions. Same principle as titles: a shortcut, not a cage.
 * Anything typed is accepted, because the useful skill is often the
 * specific one no list has heard of.
 */
export const SKILL_SUGGESTIONS: string[] = [
  // Languages
  "JavaScript", "TypeScript", "Python", "Go", "Rust", "Java", "Kotlin", "Swift",
  "C#", "C++", "PHP", "Ruby", "Elixir", "Scala", "SQL", "R", "Dart",
  // Frontend
  "React", "Next.js", "Vue", "Nuxt", "Svelte", "Angular", "Tailwind CSS",
  "HTML", "CSS", "React Native", "Flutter", "Astro",
  // Backend
  "Node.js", "Django", "FastAPI", "Flask", "Rails", "Laravel", "Spring Boot",
  "GraphQL", "REST APIs", "gRPC", "WebSockets",
  // Data
  "Postgres", "MySQL", "MongoDB", "Redis", "Elasticsearch", "ClickHouse",
  "Snowflake", "BigQuery", "dbt", "Airflow", "Spark", "Pandas",
  // Infra
  "AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform", "CI/CD",
  "GitHub Actions", "Linux", "Nginx", "Cloudflare", "Vercel",
  // AI
  "LLM integration", "OpenAI API", "LangChain", "RAG", "Prompt engineering",
  "PyTorch", "TensorFlow", "Computer vision", "NLP",
  // Payments and commerce
  "Stripe", "Stripe Billing", "PayPal", "Shopify", "WooCommerce",
  "Subscription billing", "Payment integration",
  // Design
  "Figma", "Adobe Photoshop", "Adobe Illustrator", "After Effects", "Blender",
  "Design systems", "Wireframing", "Prototyping", "Accessibility",
  // Marketing
  "SEO", "Google Ads", "Meta Ads", "Copywriting", "Content strategy",
  "Email marketing", "Analytics", "Google Analytics",
  // Practice
  "Technical writing", "Code review", "System design", "Testing", "Agile",
];
