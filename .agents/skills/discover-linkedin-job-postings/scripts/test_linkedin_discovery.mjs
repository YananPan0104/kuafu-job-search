#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  buildActiveSearchPlan,
  buildSmartSearchBootstrapUrl,
  classifyJobCards,
  extractLinkedInJobId,
} from "./linkedin_discovery.mjs";

const query = {
  query_id: "Q1",
  purpose: "Test",
  search_mode: "smart_natural_language",
  smart_search: { submitted_query: "Entry-level business analyst roles in finance" },
  status: "active",
  filters: {
    location: "Germany",
    date_posted: "Past week",
    employment_type: ["Full-time"],
    experience_level: ["Entry level", "Associate"],
  },
};

const url = new URL(buildSmartSearchBootstrapUrl(query));
assert.equal(url.origin, "https://www.linkedin.com");
assert.equal(url.pathname, "/jobs/");
assert.equal(url.searchParams.has("keywords"), false);
assert.equal(url.search, "");

assert.deepEqual(buildActiveSearchPlan({ queries: [query, { ...query, query_id: "Q2", status: "draft" }] }).map((item) => item.query_id), ["Q1"]);
assert.equal(buildActiveSearchPlan({ queries: [query] })[0].submitted_query, query.smart_search.submitted_query);
assert.equal(buildActiveSearchPlan({ queries: [{ ...query, ranking_mode: "semantic_relevance" }] })[0].ranking_mode, "semantic_relevance");
assert.equal(extractLinkedInJobId("https://www.linkedin.com/jobs/view/123456789/?trackingId=x"), "123456789");

const policy = {
  proposed_preferences: {
    title_language_policy: {
      de: { enabled: true, mode: "high_precision", action: "skip_detail" },
    },
  },
  metadata_triage: {
    skip_by_title_signals: ["head of", "software engineer"],
    review_if_time_signals: ["senior"],
  },
};

const decisions = classifyJobCards([
  { job_id: "1", title: "Business Analyst Customer Intelligence (m/w/d)" },
  { job_id: "2", title: "Business Analyst Firmenkunden" },
  { job_id: "3", title: "Business Analyst (m/w/d) im Bereich Data" },
  { job_id: "4", title: "Head of Finance Transformation" },
  { job_id: "5", title: "Consultant / Business Analyst (Senior)" },
  { job_id: "6", title: "Business Analyst:In Provision" },
  { job_id: "7", title: "Senior Business Analyst zur Unterstützung der Digitalen Transformation" },
  { job_id: "8", title: "Business Analyst (gn) (befristet)" },
  { job_id: "9", title: "Business Analyst Schwerpunkt Prozessmanagement" },
  { job_id: "10", title: "Business Analyst Risikosteuerung" },
  { job_id: "11", title: "Agiler Business Analyst | Requirements Engineering" },
  { job_id: "12", title: "Business Analyst Internet-Filiale Vertrieb" },
  { job_id: "13", title: "Business Analyst Kundenselbstbedienung-Server" },
  { job_id: "14", title: "Berater SAP Finance Transformation (w/m/d)" },
  { job_id: "15", title: "Leiter Finance Transformation & Systems (w/m/d)" },
  { job_id: "16", title: "Business Analyst", visible_status_markers: ["Reposted 3 hours ago"] },
], policy);

assert.deepEqual(decisions.map((item) => item.first_level_decision), [
  "FORWARD",
  "SKIP_FIRST_LEVEL",
  "SKIP_FIRST_LEVEL",
  "SKIP_FIRST_LEVEL",
  "MANUAL_REVIEW",
  "SKIP_FIRST_LEVEL",
  "SKIP_FIRST_LEVEL",
  "SKIP_FIRST_LEVEL",
  "SKIP_FIRST_LEVEL",
  "SKIP_FIRST_LEVEL",
  "SKIP_FIRST_LEVEL",
  "SKIP_FIRST_LEVEL",
  "SKIP_FIRST_LEVEL",
  "SKIP_FIRST_LEVEL",
  "SKIP_FIRST_LEVEL",
  "SKIP_FIRST_LEVEL",
]);
assert.deepEqual(decisions[1].reason_codes, ["GERMAN_TITLE_HIGH_CONFIDENCE"]);
assert.deepEqual(decisions[3].reason_codes, ["EXPLICIT_TITLE_EXCLUSION"]);
assert.deepEqual(decisions[15].reason_codes, ["REPOSTED_JOB"]);
assert.deepEqual(decisions[15].matched_markers, ["Reposted 3 hours ago"]);
assert.equal(classifyJobCards(
  [{ job_id: "legacy", title: "Business Analyst Firmenkunden" }],
  { title_language_policy: { de: { enabled: true, mode: "high_precision", action: "skip_detail" } } },
)[0].first_level_decision, "SKIP_FIRST_LEVEL");

process.stdout.write("linkedin_discovery tests passed\n");
