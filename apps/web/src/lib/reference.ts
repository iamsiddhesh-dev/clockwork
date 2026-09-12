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
 *  Everything else still appears, just below. */
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

/** A small, genuinely real fallback for runtimes without
 *  `Intl.supportedValuesOf` — never a made-up zone. */
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

/** "UTC+05:30" for a zone, right now. Computed, never stored, so it
 *  follows daylight saving without anyone maintaining it. */
export function utcOffsetLabel(zone: string, at = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    }).formatToParts(at);
    const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    // ICU gives "GMT+05:30", or a bare "GMT" at zero.
    return name.replace("GMT", "UTC") || "UTC";
  } catch {
    return "";
  }
}

export type Option = { value: string; label: string; hint?: string; group?: string };

export function timeZoneOptions(): Option[] {
  const all = allTimeZones();
  const prominent = PROMINENT_ZONES.filter((z) => all.includes(z));
  const rest = all.filter((z) => !prominent.includes(z));

  const toOption = (zone: string, group: string): Option => ({
    value: zone,
    label: zone.replace(/_/g, " "),
    hint: utcOffsetLabel(zone),
    group,
  });

  return [
    ...prominent.map((z) => toOption(z, "Common")),
    ...rest.map((z) => toOption(z, "All time zones")),
  ];
}

/** The zone this browser is actually in — the right default, and the one
 *  a person is least likely to have to think about. */
export function guessTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
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
