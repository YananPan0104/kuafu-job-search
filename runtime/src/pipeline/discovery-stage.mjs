import fs from "node:fs/promises";
import path from "node:path";

import {
  buildActiveSearchPlan,
  classifyJobCards,
} from "../../../.agents/skills/discover-linkedin-job-postings/scripts/linkedin_discovery.mjs";
import {
  collectVisibleJobCards,
  collectSmartSearchPage,
  collectSearchCardsAcrossPages,
  extractJobDetailsInParallel,
  mergeJobCardsById,
} from "../../../.agents/skills/discover-linkedin-job-postings/scripts/linkedin_split_pane_adapter.mjs";
import {
  LOAD_CHECK_SCHEDULE_MS,
  pollUntilLoaded,
} from "../../../.agents/skills/discover-linkedin-job-postings/scripts/loading_policy.mjs";

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
        stop_reason: null,
        extraction_stopped: false,
        filter_verification: {},
        query_progress: {},
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
  const visibleDate = !requested.date_posted || dateMarkers.some((marker) => visibleText.includes(marker));
  return {
    status: visibleDate ? "verified_visible_controls" : "visible_filter_confirmation_incomplete",
    requested,
    observed: {
      url,
      date_posted_visible: visibleDate,
      ranking_mode: query.ranking_mode ?? "semantic_relevance",
      sort_control_expected: false,
      visible_controls: controlTexts,
      visible_control_labels: controlLabels,
    },
    ui_fallback_used: false,
    warnings: visibleDate ? [] : ["VISIBLE_FILTER_MARKERS_INCOMPLETE"],
  };
}

export async function submitSmartSearch({ tab, query }) {
  if (query.search_mode !== "smart_natural_language") {
    throw new Error(`Unsupported search mode: ${query.search_mode}`);
  }
  const aiEntry = tab.page?.getByRole?.("button", { name: "Try AI job search", exact: true });
  if (aiEntry && await aiEntry.count() === 1) await aiEntry.click();
  let input;
  const inputReady = await pollUntilLoaded({
    check: async () => {
      input = tab.page?.getByRole?.("textbox", { name: "Describe the job you want", exact: true });
      return input && await input.count() === 1 ? input : null;
    },
    wait: async (milliseconds) => tab.playwright?.waitForTimeout?.(milliseconds),
    scheduleMs: LOAD_CHECK_SCHEDULE_MS,
  });
  if (!inputReady.loaded) {
    throw new Error(`Query ${query.query_id} Smart Search input was not uniquely visible`);
  }
  await input.fill(query.submitted_query);
  await input.press("Enter");
  return {
    search_mode: query.search_mode,
    submitted_query: query.submitted_query,
    query_fingerprint: query.query_fingerprint,
    status: "submitted_visible_ui",
  };
}

export async function applySmartSearchFilters({ tab, query }) {
  const requested = query.filters ?? query.requested_filters ?? {};
  if (requested.date_posted !== "Past 24 hours") return { date_posted: requested.date_posted ?? null };
  const waitForRole = async (role, name) => {
    let locator;
    const ready = await pollUntilLoaded({
      check: async () => {
        locator = tab.page?.getByRole?.(role, { name, exact: true });
        return locator && await locator.count() === 1 ? locator : null;
      },
      wait: async (milliseconds) => tab.playwright?.waitForTimeout?.(milliseconds),
      scheduleMs: LOAD_CHECK_SCHEDULE_MS,
    });
    return ready.loaded ? ready.value : null;
  };
  const dateButton = await waitForRole("button", "Filter by Date posted");
  if (!dateButton) throw new Error(`Query ${query.query_id} Date posted filter was not visible`);
  await dateButton.click();
  const past24 = await waitForRole("radio", "Past 24 hours");
  if (!past24) throw new Error(`Query ${query.query_id} Past 24 hours option was not visible`);
  await past24.click();
  const showResults = await waitForRole("link", "Show results");
  if (!showResults) throw new Error(`Query ${query.query_id} Show results control was not visible`);
  await showResults.click();
  return { date_posted: "Past 24 hours" };
}

async function verifyFiltersWithinBudget({ tab, query, url, verifyFilters }) {
  let latest;
  const result = await pollUntilLoaded({
    check: async () => {
      latest = await verifyFilters({ tab, query, url });
      return latest.status === "verified_visible_controls" ? latest : null;
    },
    wait: async (milliseconds) => {
      if (typeof tab.playwright?.waitForTimeout === "function") {
        await tab.playwright.waitForTimeout(milliseconds);
      }
    },
    scheduleMs: LOAD_CHECK_SCHEDULE_MS,
  });
  return result.loaded ? result.value : latest;
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
  const collectCards = dependencies.collectCards ?? collectSmartSearchPage;
  const collectQueryCards = dependencies.collectQueryCards ?? collectSearchCardsAcrossPages;
  const classifyCards = dependencies.classifyCards ?? classifyJobCards;
  const extractDetails = dependencies.extractDetails ?? extractJobDetailsInParallel;
  const verifyFilters = dependencies.verifyFilters ?? verifyLinkedInFilters;
  const submitSearch = dependencies.submitSearch ?? submitSmartSearch;
  const applyFilters = dependencies.applyFilters ?? applySmartSearchFilters;
  const mergeCards = dependencies.mergeCards ?? mergeJobCardsById;
  const { checkpoint, resumed } = await loadCheckpoint(config.checkpointPath, config.runId);
  checkpoint.query_progress ??= {};
  checkpoint.detail_requested_job_ids ??= checkpoint.details.map((detail) => String(detail.job_id));
  const plan = buildSearchPlan(config.portfolio).slice(0, budgets.maxQueries);
  let cards = checkpoint.cards;

  for (const query of plan) {
    if (checkpoint.query_progress[query.query_id]?.status === "completed") continue;
    if (cards.length >= budgets.maxUniqueJobs) {
      checkpoint.query_progress[query.query_id] = {
        status: "not_started",
        stop_reason: "GLOBAL_COLLECTION_LIMIT_REACHED",
        pages_observed: 0,
        unique_cards_collected: 0,
      };
      continue;
    }
    const tab = await config.browser.openTab(query.url);
    try {
      if (typeof tab.goto === "function") await tab.goto(query.url);
      const searchSubmission = await submitSearch({ tab, query });
      const appliedFilters = await applyFilters({ tab, query });
      checkpoint.query_progress[query.query_id] = {
        status: "search_submitted",
        ...searchSubmission,
        applied_filters: appliedFilters,
        pages_observed: 0,
        unique_cards_collected: 0,
        stop_reason: null,
      };
      await atomicWriteJson(config.checkpointPath, checkpoint);
      const filterResult = await verifyFiltersWithinBudget({ tab, query, url: query.url, verifyFilters });
      checkpoint.filter_verification[query.query_id] = filterResult;
      checkpoint.captured_at = new Date().toISOString();
      await atomicWriteJson(config.checkpointPath, checkpoint);
      if (config.requireVisibleFilters !== false && filterResult.status !== "verified_visible_controls") {
        if (typeof tab.page?.screenshot === "function") {
          await tab.page.screenshot({ path: `${config.checkpointPath}.filters.png`, fullPage: false });
        }
        throw new Error(`Query ${query.query_id} visible filter verification failed`);
      }
      const configuredLimit = Number(config.portfolio.collection_limit ?? budgets.maxCardsPerQuery ?? 25);
      const runtimeCap = Number(budgets.maxCardsPerQuery ?? 0);
      const effectiveLimit = runtimeCap > 0 ? Math.min(configuredLimit, runtimeCap) : configuredLimit;
      const queryLimit = Math.min(effectiveLimit, budgets.maxUniqueJobs);
      const collection = await collectQueryCards(tab, {
        queryId: query.query_id,
        limit: queryLimit,
        maxPages: budgets.maxPagesPerQuery ?? 8,
        maxStagnantObservations: budgets.maxStagnantObservations ?? 2,
        collectPage: collectCards,
        advance: dependencies.advanceSearchResults
          ?? (dependencies.collectCards ? async () => ({ advanced: false, reason: "EXHAUSTED_RESULTS" }) : undefined),
        onObservation: async (observation) => {
          if (observation.observation > 1) {
            const currentUrl = typeof tab.url === "function" ? await tab.url() : query.url;
            const pageFilterResult = await verifyFiltersWithinBudget({ tab, query, url: currentUrl, verifyFilters });
            checkpoint.filter_verification[query.query_id].page_checks ??= [];
            checkpoint.filter_verification[query.query_id].page_checks.push({
              observation: observation.observation,
              status: pageFilterResult.status,
              url: currentUrl,
            });
            if (pageFilterResult.status !== "verified_visible_controls") {
              checkpoint.query_progress[query.query_id] = {
                status: "operational_stop",
                stop_reason: "FILTER_STATE_LOST",
                pages_observed: observation.observation,
              };
              await atomicWriteJson(config.checkpointPath, checkpoint);
              throw new Error(`Query ${query.query_id} visible filter verification was lost during pagination`);
            }
          }
          const queryCards = observation.cards ?? [];
          cards = mergeCards([...cards, ...queryCards]).slice(0, budgets.maxUniqueJobs);
          checkpoint.cards = cards;
          checkpoint.query_progress[query.query_id] = {
            status: "collecting",
            configured_limit: configuredLimit,
            runtime_cap: runtimeCap || null,
            effective_limit: queryLimit,
            pages_observed: observation.observation,
            unique_cards_collected: queryCards.length,
            stagnant_observations: observation.stagnant_observations,
            last_navigation_mode: observation.navigation_mode,
            stop_reason: null,
          };
          checkpoint.captured_at = new Date().toISOString();
          await atomicWriteJson(config.checkpointPath, checkpoint);
        },
      });
      cards = mergeCards([...cards, ...collection.cards]).slice(0, budgets.maxUniqueJobs);
      checkpoint.cards = cards;
      checkpoint.query_progress[query.query_id] = {
        ...(checkpoint.query_progress[query.query_id] ?? {}),
        status: "completed",
        configured_limit: configuredLimit,
        runtime_cap: runtimeCap || null,
        effective_limit: queryLimit,
        pages_observed: collection.pages_observed,
        unique_cards_collected: collection.cards.length,
        stop_reason: cards.length >= budgets.maxUniqueJobs
          ? "GLOBAL_COLLECTION_LIMIT_REACHED"
          : collection.stop_reason,
        boundary: collection.boundary ?? null,
      };
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
  checkpoint.stop_reason = extraction.stop_reason ?? null;
  checkpoint.extraction_stopped = Boolean(extraction.stopped);
  checkpoint.captured_at = new Date().toISOString();
  await atomicWriteJson(config.checkpointPath, checkpoint);
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
    stop_reason: checkpoint.stop_reason,
    extraction_stopped: checkpoint.extraction_stopped,
    filterVerification: checkpoint.filter_verification,
  };
}
