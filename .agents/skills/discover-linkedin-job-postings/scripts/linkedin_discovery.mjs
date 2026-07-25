#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DATE_POSTED_CODES = new Map([
  ["any time", null],
  ["past 24 hours", "r86400"],
  ["past week", "r604800"],
  ["past month", "r2592000"],
]);

const EMPLOYMENT_TYPE_CODES = new Map([
  ["full-time", "F"],
  ["part-time", "P"],
  ["contract", "C"],
  ["temporary", "T"],
  ["volunteer", "V"],
  ["internship", "I"],
]);

const EXPERIENCE_LEVEL_CODES = new Map([
  ["internship", "1"],
  ["entry level", "2"],
  ["associate", "3"],
  ["mid-senior level", "4"],
  ["director", "5"],
  ["executive", "6"],
]);

const SORT_CODES = new Map([
  ["most relevant", "R"],
  ["most recent", "DD"],
]);

const HIGH_PRECISION_GERMAN_MARKERS = [
  "im bereich",
  "mit schwerpunkt",
  "schwerpunkt",
  "zur unterstützung",
  "der digitalen transformation",
  "für firmenkunden",
  "für privatkunden",
  "firmenkunden",
  "privatkunden",
  "für das",
  "sachbearbeiter",
  "referent",
  "kundenberater",
  "berater",
  "leiter",
  "projektleiter",
  "projektmanagerin",
  "projektmanager",
  "zahlungsverkehr",
  "risikosteuerung",
  "energiewirtschaft",
  "agiler business analyst",
  "internet-filiale vertrieb",
  "kundenselbstbedienung",
  "kreditsicherheiten",
  "kreditkalkulation",
  "finanzprozesse",
  "geschäftsprozesse",
  "versicherungskaufmann",
  "versicherungskauffrau",
  "haftpflicht",
  "sachschadenversicherung",
  "aktuar",
  "befristet",
  "mit koreanischkenntnissen",
  "quereinstieg",
  ":in ",
];

const AGGRESSIVE_GERMAN_MARKERS = [
  ...HIGH_PRECISION_GERMAN_MARKERS,
  "berater",
  "mitarbeiter",
  "spezialist",
  "spezialistin",
  "prozessmanagement",
  "prozessoptimierung",
  "kreditsachbearbeitung",
  "bankwesen",
  "buchhaltung",
  "rechnungswesen",
  "controlling und",
  "mensch",
];

function normalizeLabel(value) {
  return String(value ?? "").trim().toLowerCase();
}

function requireNonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function codesFor(values, mapping, label) {
  const result = [];
  for (const value of values ?? []) {
    const normalized = normalizeLabel(value);
    if (!mapping.has(normalized)) {
      throw new Error(`Unsupported ${label}: ${value}`);
    }
    const code = mapping.get(normalized);
    if (code) result.push(code);
  }
  return result;
}

export function buildLinkedInSearchUrl(querySpec) {
  const statement = requireNonEmpty(querySpec.statement, "statement");
  const filters = querySpec.filters ?? {};
  const url = new URL("https://www.linkedin.com/jobs/search/");

  url.searchParams.set("keywords", statement);
  if (filters.location) url.searchParams.set("location", filters.location);

  const dateLabel = normalizeLabel(filters.date_posted ?? "any time");
  if (!DATE_POSTED_CODES.has(dateLabel)) {
    throw new Error(`Unsupported date_posted: ${filters.date_posted}`);
  }
  const dateCode = DATE_POSTED_CODES.get(dateLabel);
  if (dateCode) url.searchParams.set("f_TPR", dateCode);

  const employmentCodes = codesFor(
    filters.employment_type,
    EMPLOYMENT_TYPE_CODES,
    "employment type",
  );
  if (employmentCodes.length) url.searchParams.set("f_JT", employmentCodes.join(","));

  const experienceCodes = codesFor(
    filters.experience_level,
    EXPERIENCE_LEVEL_CODES,
    "experience level",
  );
  if (experienceCodes.length) url.searchParams.set("f_E", experienceCodes.join(","));

  const sortLabel = normalizeLabel(filters.sort_by ?? "most relevant");
  if (!SORT_CODES.has(sortLabel)) {
    throw new Error(`Unsupported sort_by: ${filters.sort_by}`);
  }
  url.searchParams.set("sortBy", SORT_CODES.get(sortLabel));

  return url.toString();
}

export function buildActiveSearchPlan(portfolio) {
  if (!Array.isArray(portfolio.queries)) {
    throw new Error("query portfolio must contain a queries array");
  }
  return portfolio.queries
    .filter((query) => query.status === "active")
    .map((query) => ({
      query_id: requireNonEmpty(query.query_id, "query_id"),
      purpose: requireNonEmpty(query.purpose, "purpose"),
      url: buildLinkedInSearchUrl(query),
      requested_filters: query.filters ?? {},
    }));
}

export function extractLinkedInJobId(value) {
  const match = String(value ?? "").match(/\/jobs\/view\/(\d+)/i);
  return match?.[1] ?? null;
}

function normalizedTitle(title) {
  return requireNonEmpty(title, "card.title")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\((?:m|w|d|f|x|gn)(?:\s*[\/|,]\s*(?:m|w|d|f|x|gn))+\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchedMarkers(title, markers) {
  return [...new Set(markers.filter((marker) => title.includes(normalizeLabel(marker))))];
}

function germanPolicy(policy) {
  const configured = (
    policy.proposed_preferences?.title_language_policy
    ?? policy.title_language_policy
    ?? {}
  ).de ?? {};
  return {
    enabled: configured.enabled === true,
    mode: configured.mode ?? "off",
    action: configured.action ?? "skip_detail",
  };
}

export function classifyJobCard(card, policy = {}) {
  const title = normalizedTitle(card.title);
  const explicitSkips = policy.metadata_triage?.skip_by_title_signals ?? [];
  const explicitMatches = matchedMarkers(title, explicitSkips);

  if (explicitMatches.length) {
    return {
      ...card,
      first_level_decision: "SKIP_FIRST_LEVEL",
      reason_codes: ["EXPLICIT_TITLE_EXCLUSION"],
      matched_markers: explicitMatches,
    };
  }

  const languagePolicy = germanPolicy(policy);
  if (languagePolicy.enabled && languagePolicy.mode !== "off") {
    const markers = languagePolicy.mode === "aggressive"
      ? AGGRESSIVE_GERMAN_MARKERS
      : HIGH_PRECISION_GERMAN_MARKERS;
    const germanMatches = matchedMarkers(title, markers);
    if (germanMatches.length) {
      const skip = languagePolicy.action === "skip_detail";
      return {
        ...card,
        first_level_decision: skip ? "SKIP_FIRST_LEVEL" : "MANUAL_REVIEW",
        reason_codes: ["GERMAN_TITLE_HIGH_CONFIDENCE"],
        matched_markers: germanMatches,
      };
    }
  }

  const reviewSignals = policy.metadata_triage?.review_if_time_signals ?? [];
  const reviewMatches = matchedMarkers(title, reviewSignals);
  if (reviewMatches.length) {
    return {
      ...card,
      first_level_decision: "MANUAL_REVIEW",
      reason_codes: ["TITLE_REVIEW_SIGNAL"],
      matched_markers: reviewMatches,
    };
  }

  return {
    ...card,
    first_level_decision: "FORWARD",
    reason_codes: [],
    matched_markers: [],
  };
}

export function classifyJobCards(cards, policy = {}) {
  if (!Array.isArray(cards)) throw new Error("cards must be a JSON array");
  return cards.map((card) => classifyJobCard(card, policy));
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main(argv) {
  const [command, ...args] = argv;
  if (command === "build-url" && args.length === 1) {
    process.stdout.write(`${buildLinkedInSearchUrl(await loadJson(args[0]))}\n`);
    return;
  }
  if (command === "build-portfolio" && args.length === 1) {
    const output = buildActiveSearchPlan(await loadJson(args[0]));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }
  if (command === "classify" && args.length === 2) {
    const output = classifyJobCards(await loadJson(args[0]), await loadJson(args[1]));
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }
  throw new Error(
    "Usage: linkedin_discovery.mjs build-url <query-spec.json> | build-portfolio <query-portfolio.json> | classify <cards.json> <policy.json>",
  );
}

if (
  typeof process !== "undefined"
  && Array.isArray(process.argv)
  && process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
