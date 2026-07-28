#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runDiscoveryPhase3, verifyLinkedInFilters } from "../src/pipeline/discovery-stage.mjs";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kuafu-phase3-"));

try {
  const localizedVerification = await verifyLinkedInFilters({
    tab: {
      snapshot: async () => "Jobs in Deutschland",
      page: { locator: () => ({ allTextContents: async () => ["Letzte 24 Stunden", "Neueste"] }) },
    },
    query: { filters: { date_posted: "Past 24 hours", sort_by: "Most recent" } },
    url: "https://www.linkedin.com/jobs/search/?f_TPR=r86400&sortBy=DD",
  });
  assert.equal(localizedVerification.status, "verified_visible_controls");

  const checkpointPath = path.join(tempRoot, "browser-checkpoint.json");
  const portfolio = {
    run_profile: "daily",
    queries: [
      { query_id: "T1", status: "active", statement: "analyst", filters: { date_posted: "Past 24 hours", sort_by: "Most recent" } },
      { query_id: "T2", status: "active", statement: "finance", filters: { date_posted: "Past 24 hours", sort_by: "Most recent" } },
      { query_id: "D1", status: "draft", statement: "ignored", filters: {} },
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
      return { results: details };
    },
  });
  assert.deepEqual(extractedIds, ["101", "103"]);
  assert.equal(result.metrics.queries_executed, 2);
  assert.equal(result.metrics.cards_discovered, 3);
  assert.equal(result.metrics.details_attempted, 2);
  const checkpoint = JSON.parse(await fs.readFile(checkpointPath, "utf8"));
  assert.equal(checkpoint.cards.length, 3);
  assert.equal(checkpoint.details.length, 2);
  assert.deepEqual(checkpoint.cards.find((card) => card.job_id === "101").query_ids, ["T1", "T2"]);
  assert.equal(Object.keys(checkpoint.filter_verification).length, 2);

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
    collectCards: async (_tab, { queryId }) => collectedByQuery[queryId],
    classifyCards: (cards) => cards.map((card) => ({ ...card, first_level_decision: "FORWARD", reason_codes: [] })),
    extractDetails: async (_browser, cards) => {
      resumedExtraction = cards.map((card) => card.job_id);
      return { results: [] };
    },
  });
  assert.deepEqual(resumedExtraction, ["102"]);
  assert.equal(resumed.resumed, true);

  await assert.rejects(
    runDiscoveryPhase3({
      runId: "filter-failure",
      checkpointPath: path.join(tempRoot, "filter-failure.json"),
      portfolio: { ...portfolio, queries: [portfolio.queries[0]] },
      policy: {},
      browser,
    }, {
      buildSearchPlan: () => [{ ...portfolio.queries[0], url: "https://example.test/T1" }],
      verifyFilters: async () => ({ status: "visible_filter_confirmation_incomplete" }),
      collectCards: async () => { throw new Error("cards must not be collected"); },
    }),
    /visible filter verification failed/,
  );
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

process.stdout.write("phase3 discovery tests passed\n");
