#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

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

export function buildSmartSearchBootstrapUrl(querySpec) {
  if (querySpec.search_mode !== "smart_natural_language") {
    throw new Error(`Unsupported search mode: ${querySpec.search_mode}`);
  }
  return "https://www.linkedin.com/jobs/";
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
      search_mode: query.search_mode,
      ranking_mode: query.ranking_mode,
      submitted_query: requireNonEmpty(query.smart_search?.submitted_query, "smart_search.submitted_query"),
      query_fingerprint: query.smart_search?.query_fingerprint ?? null,
      smoke_variants: query.smart_search?.smoke_variants ?? {},
      url: buildSmartSearchBootstrapUrl(query),
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
  const statusMarkers = [
    ...(card.visible_status_markers ?? []),
    card.posting_status,
    card.card_text,
  ].filter(Boolean).map(String);
  const repostMatches = statusMarkers.flatMap((value) =>
    value.match(/\breposted\s+\d+\s+(?:minute|hour|day|week)s?\s+ago\b/ig) ?? []
  );
  if (repostMatches.length) {
    return {
      ...card,
      first_level_decision: "SKIP_FIRST_LEVEL",
      reason_codes: ["REPOSTED_JOB"],
      matched_markers: [...new Set(repostMatches)],
    };
  }
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
    "Usage: linkedin_discovery.mjs build-portfolio <query-portfolio.json> | classify <cards.json> <policy.json>",
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
