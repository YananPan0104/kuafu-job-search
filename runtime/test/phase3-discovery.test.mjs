#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runDiscoveryPhase3, verifyLinkedInFilters, submitSmartSearch, applySmartSearchFilters } from "../src/pipeline/discovery-stage.mjs";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kuafu-phase3-"));

try {
  let smartInputChecks = 0;
  const smartWaits = [];
  const smartActions = [];
  const delayedSubmission = await submitSmartSearch({
    query: { query_id: "T0", search_mode: "smart_natural_language", submitted_query: "analyst roles", ranking_mode: "semantic_relevance" },
    tab: {
      playwright: { waitForTimeout: async (milliseconds) => smartWaits.push(milliseconds) },
      page: {
        getByRole: (role, options) => ({
          count: async () => {
            if (role === "button") return 1;
            smartInputChecks += 1;
            return smartInputChecks >= 3 ? 1 : 0;
          },
          click: async () => smartActions.push(`click:${options.name}`),
          fill: async (value) => smartActions.push(`fill:${value}`),
          press: async (value) => smartActions.push(`press:${value}`),
        }),
      },
    },
  });
  assert.equal(delayedSubmission.status, "submitted_visible_ui");
  assert.deepEqual(smartWaits, [1000, 2000]);
  assert.deepEqual(smartActions, ["click:Try AI job search", "fill:analyst roles", "press:Enter"]);

  const filterActions = [];
  const filterPage = {
    getByRole: (role, options) => ({
      count: async () => 1,
      click: async () => filterActions.push(`${role}:${options.name}`),
    }),
  };
  const applied = await applySmartSearchFilters({
    tab: { page: filterPage, playwright: { waitForTimeout: async () => {} } },
    query: { query_id: "T0", filters: { date_posted: "Past 24 hours" } },
  });
  assert.equal(applied.date_posted, "Past 24 hours");
  assert.deepEqual(filterActions, [
    "button:Filter by Date posted",
    "radio:Past 24 hours",
    "link:Show results",
  ]);

  const localizedVerification = await verifyLinkedInFilters({
    tab: {
      snapshot: async () => "Jobs in Deutschland",
      page: { locator: () => ({ allTextContents: async () => ["Letzte 24 Stunden"] }) },
    },
    query: { ranking_mode: "semantic_relevance", filters: { date_posted: "Past 24 hours" } },
    url: "https://www.linkedin.com/jobs/search/?f_TPR=r86400&sortBy=DD",
  });
  assert.equal(localizedVerification.status, "verified_visible_controls");
  assert.equal(localizedVerification.observed.ranking_mode, "semantic_relevance");
  assert.equal(localizedVerification.observed.sort_control_expected, false);

  const checkpointPath = path.join(tempRoot, "browser-checkpoint.json");
  const portfolio = {
    run_profile: "daily",
    collection_limit: 100,
    queries: [
      { query_id: "T1", status: "active", search_mode: "smart_natural_language", ranking_mode: "semantic_relevance", smart_search: { submitted_query: "analyst" }, filters: { date_posted: "Past 24 hours" } },
      { query_id: "T2", status: "active", search_mode: "smart_natural_language", ranking_mode: "semantic_relevance", smart_search: { submitted_query: "finance" }, filters: { date_posted: "Past 24 hours" } },
      { query_id: "D1", status: "draft", search_mode: "smart_natural_language", smart_search: { submitted_query: "ignored" }, filters: {} },
    ],
  };
  const browser = {
    openTab: async () => ({ close: async () => {} }),
  };
  const collectedByQuery = {
    T1: [
      { job_id: "101", title: "Business Analyst", company: "A", query_ids: ["T1"] },
      { job_id: "102", title: "Head of Finance", company: "B", query_ids: ["T1"] },
    ],
    T2: [
      { job_id: "101", title: "Business Analyst", company: "A", query_ids: ["T2"] },
      { job_id: "103", title: "Finance Analyst", company: "C", query_ids: ["T2"] },
    ],
  };
  let extractedIds = [];
  const result = await runDiscoveryPhase3({
    runId: "2026-07-29-phase3-test",
    checkpointPath,
    portfolio,
    policy: {},
    browser,
    budgets: { maxQueries: 2, maxCardsPerQuery: 10, maxUniqueJobs: 3, maxDetailJobs: 2, detailConcurrency: 2 },
  }, {
    buildSearchPlan: (value) => value.queries.filter((query) => query.status === "active").map((query) => ({ ...query, url: `https://example.test/${query.query_id}` })),
    verifyFilters: async ({ query }) => ({ status: "verified_visible_controls", requested: query.filters }),
    submitSearch: async ({ query }) => ({ search_mode: query.search_mode, submitted_query: query.submitted_query, status: "submitted_visible_ui" }),
    applyFilters: async ({ query }) => ({ date_posted: query.filters.date_posted }),
    collectCards: async (_tab, { queryId }) => collectedByQuery[queryId],
    classifyCards: (cards) => cards.map((card) => ({
      ...card,
      first_level_decision: card.job_id === "102" ? "SKIP_FIRST_LEVEL" : "FORWARD",
      reason_codes: card.job_id === "102" ? ["EXPLICIT_TITLE_EXCLUSION"] : [],
    })),
    extractDetails: async (_browser, cards, options) => {
      extractedIds = cards.map((card) => card.job_id);
      const details = cards.map((card) => ({ ...card, retrieval_status: "retrieved", description: "D".repeat(350) }));
      for (const detail of details) await options.onDetail(detail);
      return { results: details, stopped: true, stop_reason: "CHECKPOINT_CALLBACK_FAILED" };
    },
  });
  assert.deepEqual(extractedIds, ["101", "103"]);
  assert.equal(result.metrics.queries_executed, 2);
  assert.equal(result.metrics.cards_discovered, 3);
  assert.equal(result.metrics.details_attempted, 2);
  const checkpoint = JSON.parse(await fs.readFile(checkpointPath, "utf8"));
  assert.equal(checkpoint.cards.length, 3);
  assert.equal(checkpoint.details.length, 2);
  assert.equal(checkpoint.stop_reason, "CHECKPOINT_CALLBACK_FAILED");
  assert.equal(checkpoint.extraction_stopped, true);
  assert.equal(result.stop_reason, "CHECKPOINT_CALLBACK_FAILED");
  assert.deepEqual(checkpoint.cards.find((card) => card.job_id === "101").query_ids, ["T1", "T2"]);
  assert.equal(Object.keys(checkpoint.filter_verification).length, 2);
  assert.equal(checkpoint.query_progress.T1.status, "completed");
  assert.equal(checkpoint.query_progress.T2.status, "completed");
  assert.equal(checkpoint.query_progress.T1.effective_limit, 3);

  let resumedExtraction = [];
  const resumed = await runDiscoveryPhase3({
    runId: "2026-07-29-phase3-test",
    checkpointPath,
    portfolio,
    policy: {},
    browser,
    budgets: { maxQueries: 2, maxCardsPerQuery: 10, maxUniqueJobs: 3, maxDetailJobs: 3, detailConcurrency: 2 },
  }, {
    buildSearchPlan: (value) => value.queries.filter((query) => query.status === "active").map((query) => ({ ...query, url: `https://example.test/${query.query_id}` })),
    verifyFilters: async ({ query }) => ({ status: "verified_visible_controls", requested: query.filters }),
    submitSearch: async ({ query }) => ({ search_mode: query.search_mode, submitted_query: query.submitted_query, status: "submitted_visible_ui" }),
    applyFilters: async ({ query }) => ({ date_posted: query.filters.date_posted }),
    collectCards: async (_tab, { queryId }) => collectedByQuery[queryId],
    classifyCards: (cards) => cards.map((card) => ({ ...card, first_level_decision: "FORWARD", reason_codes: [] })),
    extractDetails: async (_browser, cards) => {
      resumedExtraction = cards.map((card) => card.job_id);
      return { results: [], stopped: false, stop_reason: null };
    },
  });
  assert.deepEqual(resumedExtraction, ["102"]);
  assert.equal(resumed.resumed, true);

  const filterWaits = [];
  await assert.rejects(
    runDiscoveryPhase3({
      runId: "filter-failure",
      checkpointPath: path.join(tempRoot, "filter-failure.json"),
      portfolio: { ...portfolio, queries: [portfolio.queries[0]] },
      policy: {},
      browser: {
        openTab: async () => ({
          close: async () => {},
          playwright: { waitForTimeout: async (milliseconds) => filterWaits.push(milliseconds) },
        }),
      },
    }, {
      buildSearchPlan: () => [{ ...portfolio.queries[0], url: "https://example.test/T1" }],
      verifyFilters: async () => ({ status: "visible_filter_confirmation_incomplete" }),
      submitSearch: async () => ({ status: "submitted_visible_ui" }),
      applyFilters: async () => ({ date_posted: "Past 24 hours" }),
      collectCards: async () => { throw new Error("cards must not be collected"); },
    }),
    /visible filter verification failed/,
  );
  assert.deepEqual(filterWaits, [1000, 2000, 3000, 4000]);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

process.stdout.write("phase3 discovery tests passed\n");
