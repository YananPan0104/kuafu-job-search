import fs from "node:fs/promises";
import path from "node:path";

import {
  buildActiveSearchPlan,
  classifyJobCards,
} from "../../../.agents/skills/discover-linkedin-job-postings/scripts/linkedin_discovery.mjs";
import {
  collectVisibleJobCards,
  extractJobDetailsInParallel,
  mergeJobCardsById,
} from "../../../.agents/skills/discover-linkedin-job-postings/scripts/linkedin_split_pane_adapter.mjs";

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await fs.rename(tempPath, filePath);
}

async function loadCheckpoint(checkpointPath, runId) {
  try {
    const checkpoint = JSON.parse(await fs.readFile(checkpointPath, "utf8"));
    if (checkpoint.run_id !== runId) throw new Error("Checkpoint run_id does not match requested run");
    return { checkpoint, resumed: true };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      resumed: false,
      checkpoint: {
        schema_version: "1.0",
        run_id: runId,
        captured_at: new Date().toISOString(),
        cards: [],
        details: [],
        detail_requested_job_ids: [],
        filter_verification: {},
        warnings: [],
      },
    };
  }
}

export async function verifyLinkedInFilters({ tab, query, url }) {
  const snapshot = String(await tab.snapshot()).toLowerCase();
  const controls = tab.page?.locator("button, select, [role='button'], [role='combobox']");
  const controlTexts = controls
    ? (await controls.allTextContents())
        .map((value) => String(value).trim())
        .filter(Boolean)
        .slice(0, 30)
    : [];
  const controlLabels = controls && typeof controls.evaluateAll === "function"
    ? (await controls.evaluateAll((elements) => elements.map((element) => [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-control-name"),
        element.getAttribute("data-test-text-entity-list-form-component"),
      ].filter(Boolean).join(" | "))))
        .map((value) => String(value).trim())
        .filter(Boolean)
        .slice(0, 50)
    : [];
  const visibleText = `${snapshot}\n${controlTexts.join("\n")}\n${controlLabels.join("\n")}`.toLowerCase();
  const requested = query.filters ?? query.requested_filters ?? {};
  const dateMarkers = requested.date_posted === "Past 24 hours"
    ? ["past 24 hours", "letzte 24 stunden"]
    : [String(requested.date_posted ?? "").toLowerCase()];
  const sortMarkers = requested.sort_by === "Most recent"
    ? ["most recent", "neueste"]
    : [String(requested.sort_by ?? "").toLowerCase()];
  const visibleDate = !requested.date_posted || dateMarkers.some((marker) => visibleText.includes(marker));
  const visibleSort = !requested.sort_by || sortMarkers.some((marker) => visibleText.includes(marker));
  return {
    status: visibleDate && visibleSort ? "verified_visible_controls" : "visible_filter_confirmation_incomplete",
    requested,
    observed: {
      url,
      date_posted_visible: visibleDate,
      sort_by_visible: visibleSort,
      visible_controls: controlTexts,
      visible_control_labels: controlLabels,
    },
    ui_fallback_used: false,
    warnings: visibleDate && visibleSort ? [] : ["VISIBLE_FILTER_MARKERS_INCOMPLETE"],
  };
}

export async function runDiscoveryPhase3(config, dependencies = {}) {
  const budgets = {
    maxQueries: 5,
    maxCardsPerQuery: 25,
    maxUniqueJobs: 60,
    maxDetailJobs: 30,
    detailConcurrency: 5,
    ...config.budgets,
  };
  if (budgets.detailConcurrency < 1 || budgets.detailConcurrency > 5) {
    throw new Error("detailConcurrency must be between 1 and 5");
  }
  const buildSearchPlan = dependencies.buildSearchPlan ?? buildActiveSearchPlan;
  const collectCards = dependencies.collectCards ?? collectVisibleJobCards;
  const classifyCards = dependencies.classifyCards ?? classifyJobCards;
  const extractDetails = dependencies.extractDetails ?? extractJobDetailsInParallel;
  const verifyFilters = dependencies.verifyFilters ?? verifyLinkedInFilters;
  const mergeCards = dependencies.mergeCards ?? mergeJobCardsById;
  const { checkpoint, resumed } = await loadCheckpoint(config.checkpointPath, config.runId);
  checkpoint.detail_requested_job_ids ??= checkpoint.details.map((detail) => String(detail.job_id));
  const plan = buildSearchPlan(config.portfolio).slice(0, budgets.maxQueries);
  let cards = checkpoint.cards;

  for (const query of plan) {
    const tab = await config.browser.openTab(query.url);
    try {
      if (typeof tab.goto === "function") await tab.goto(query.url);
      const retryDelays = dependencies.verifyFilters ? [0] : [0, 1000, 2000, 3000, 4000, 5000];
      let filterResult;
      for (const delay of retryDelays) {
        if (delay > 0 && typeof tab.playwright?.waitForTimeout === "function") {
          await tab.playwright.waitForTimeout(delay);
        }
        filterResult = await verifyFilters({ tab, query, url: query.url });
        if (filterResult.status === "verified_visible_controls") break;
      }
      checkpoint.filter_verification[query.query_id] = filterResult;
      checkpoint.captured_at = new Date().toISOString();
      await atomicWriteJson(config.checkpointPath, checkpoint);
      if (config.requireVisibleFilters !== false && filterResult.status !== "verified_visible_controls") {
        if (typeof tab.page?.screenshot === "function") {
          await tab.page.screenshot({ path: `${config.checkpointPath}.filters.png`, fullPage: false });
        }
        throw new Error(`Query ${query.query_id} visible filter verification failed`);
      }
      const observed = await collectCards(tab, {
        queryId: query.query_id,
        limit: budgets.maxCardsPerQuery,
      });
      cards = mergeCards([...cards, ...observed]).slice(0, budgets.maxUniqueJobs);
      checkpoint.cards = cards;
      checkpoint.captured_at = new Date().toISOString();
      await atomicWriteJson(config.checkpointPath, checkpoint);
    } finally {
      if (typeof tab.close === "function") await tab.close();
    }
  }

  checkpoint.cards = classifyCards(cards, config.policy);
  const completedIds = new Set(checkpoint.details.map((detail) => String(detail.job_id)));
  const previouslyRequestedIds = new Set(checkpoint.detail_requested_job_ids.map(String));
  const remainingDetailBudget = Math.max(0, budgets.maxDetailJobs - previouslyRequestedIds.size);
  const detailCards = checkpoint.cards
    .filter((card) => ["FORWARD", "MANUAL_REVIEW"].includes(card.first_level_decision))
    .filter((card) => !completedIds.has(String(card.job_id)))
    .slice(0, remainingDetailBudget);
  checkpoint.detail_requested_job_ids = Array.from(new Set([
    ...(checkpoint.detail_requested_job_ids ?? []).map(String),
    ...detailCards.map((card) => String(card.job_id)),
  ]));
  await atomicWriteJson(config.checkpointPath, checkpoint);

  const extraction = await extractDetails(config.browser, detailCards, {
    concurrency: budgets.detailConcurrency,
    onDetail: async (detail) => {
      const index = checkpoint.details.findIndex((item) => String(item.job_id) === String(detail.job_id));
      if (index >= 0) checkpoint.details[index] = detail;
      else checkpoint.details.push(detail);
      checkpoint.captured_at = new Date().toISOString();
      await atomicWriteJson(config.checkpointPath, checkpoint);
    },
  });
  for (const detail of extraction.results ?? []) {
    if (!checkpoint.details.some((item) => String(item.job_id) === String(detail.job_id))) {
      checkpoint.details.push(detail);
    }
  }
  await atomicWriteJson(config.checkpointPath, checkpoint);
  return {
    runId: config.runId,
    checkpointPath: config.checkpointPath,
    resumed,
    metrics: {
      queries_executed: plan.length,
      cards_discovered: checkpoint.cards.length,
      details_attempted: detailCards.length,
      details_checkpointed: checkpoint.details.length,
    },
    filterVerification: checkpoint.filter_verification,
  };
}
