#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  escapeCssAttributeValue,
  parseVisibleJobCard,
  mergeJobCardsById,
  collectVisibleJobCards,
  collectSearchCardsAcrossPages,
  advanceLinkedInSearchResults,
  isNextPageLabel,
  selectAndExtractSplitPane,
  buildSplitPaneSelectionUrl,
  buildDirectJobUrl,
  navigateAndExtractSplitPane,
  extractDirectJobPage,
  extractJobDetailsInParallel,
  MAX_DIRECT_DETAIL_CONCURRENCY,
  hasCollapsedDescriptionMarker,
  extractSmartJobIdFromComponentKey,
} from "./linkedin_split_pane_adapter.mjs";

assert.equal(escapeCssAttributeValue('a"b\\c'), 'a\\"b\\\\c');

const parsed = parseVisibleJobCard({
  source_href: "/jobs/view/123456789/?trackingId=test",
  title: "Business Analyst",
  card_text: "Business Analyst\nwith verification\nExample GmbH\nBerlin, Germany\nEasy Apply",
}, "Q1");
assert.equal(parsed.job_id, "123456789");
assert.equal(parsed.company, "Example GmbH");
assert.equal(parsed.location, "Berlin, Germany");
assert.deepEqual(parsed.query_ids, ["Q1"]);

const merged = mergeJobCardsById([
  parsed,
  { ...parsed, query_ids: ["Q2"], visible_status_markers: ["Viewed"] },
]);
assert.equal(merged.length, 1);
assert.deepEqual(merged[0].query_ids, ["Q1", "Q2"]);

const selectionUrl = new URL(buildSplitPaneSelectionUrl(
  "https://www.linkedin.com/jobs/search/?keywords=test&start=25",
  "123456789",
));
assert.equal(selectionUrl.searchParams.get("currentJobId"), "123456789");
assert.equal(selectionUrl.searchParams.get("start"), "25");
assert.equal(buildDirectJobUrl("123456789"), "https://www.linkedin.com/jobs/view/123456789/");
assert.throws(() => buildDirectJobUrl("not-an-id"), /digits only/);

let clicked = false;
const fakeTab = {
  playwright: {
    evaluate: async (fn, args) => {
      if (args?.maxAnchors) {
        return [
          {
            source_href: "/jobs/view/123456789/?trackingId=test",
            title: "Business Analyst",
            card_text: "Business Analyst\nExample GmbH\nBerlin, Germany",
          },
          {
            source_href: "/jobs/view/123456789/?trackingId=detail",
            title: "Business Analyst",
            card_text: "",
          },
        ];
      }
      return {
        selected_title: "Business Analyst",
        description: "A".repeat(350),
      };
    },
    domSnapshot: async () => "Business Analyst\nAbout the job",
    locator: (selector) => ({
      count: async () => {
        assert.match(selector, /trackingId=test/);
        return 1;
      },
      click: async () => { clicked = true; },
    }),
    getByRole: (role, options) => ({
      count: async () => {
        assert.equal(role, "link");
        assert.deepEqual(options, { name: "Business Analyst", exact: true });
        return 1;
      },
      click: async () => { clicked = true; },
    }),
  },
};

const cards = await collectVisibleJobCards(fakeTab, { queryId: "Q1", limit: 10 });
assert.equal(cards.length, 1);
assert.equal(cards[0].job_id, "123456789");

const pageBatches = [
  [{ job_id: "1", title: "A", company: "One", query_ids: ["Q1"] }],
  [
    { job_id: "1", title: "A", company: "One", query_ids: ["Q1"] },
    { job_id: "2", title: "B", company: "Two", query_ids: ["Q1"] },
  ],
  [{ job_id: "3", title: "C", company: "Three", query_ids: ["Q1"] }],
];
let pageIndex = 0;
const observations = [];
const paged = await collectSearchCardsAcrossPages({}, {
  queryId: "Q1",
  limit: 3,
  maxPages: 5,
  collectPage: async () => pageBatches[pageIndex],
  advance: async () => {
    if (pageIndex >= pageBatches.length - 1) return { advanced: false, reason: "EXHAUSTED_RESULTS" };
    pageIndex += 1;
    return { advanced: true, mode: pageIndex === 1 ? "appended" : "next_page" };
  },
  onObservation: async (observation) => observations.push(observation),
});
assert.deepEqual(paged.cards.map((card) => card.job_id), ["1", "2", "3"]);
assert.equal(paged.stop_reason, "QUERY_COLLECTION_LIMIT_REACHED");
assert.equal(paged.pages_observed, 3);
assert.equal(observations.length, 3);

const bounded = await collectSearchCardsAcrossPages({}, {
  queryId: "SMART1",
  limit: 10,
  collectPage: async () => ({
    cards: [
      { job_id: "41", title: "Exact", company: "One", query_ids: ["SMART1"] },
      { job_id: "42", title: "Related", company: "Two", query_ids: ["SMART1"] },
    ],
    boundary: {
      status: "reached",
      marker_text: "We found more results related to your search that may not be exact matches",
      first_related_card_index: 1,
      cards_below_observed: 1,
    },
  }),
  advance: async () => { throw new Error("must stop at boundary"); },
});
assert.deepEqual(bounded.cards.map((card) => card.job_id), ["41"]);
assert.equal(bounded.stop_reason, "RELATED_RESULTS_BOUNDARY_REACHED");
assert.equal(bounded.boundary.status, "reached");
assert.equal(bounded.boundary.cards_below_observed, 1);

const ambiguousBoundary = await collectSearchCardsAcrossPages({}, {
  queryId: "SMART2",
  limit: 10,
  collectPage: async () => ({
    cards: [{ job_id: "51", title: "Uncertain", company: "One", query_ids: ["SMART2"] }],
    boundary: { status: "ambiguous", marker_text: "More related jobs" },
  }),
  advance: async () => { throw new Error("must stop on ambiguity"); },
});
assert.deepEqual(ambiguousBoundary.cards, []);
assert.equal(ambiguousBoundary.stop_reason, "RELATED_RESULTS_BOUNDARY_AMBIGUOUS");

assert.equal(hasCollapsedDescriptionMarker("Long description … more"), true);
assert.equal(hasCollapsedDescriptionMarker("Long description Show more"), true);
assert.equal(hasCollapsedDescriptionMarker("Long description Mehr anzeigen"), true);
assert.equal(hasCollapsedDescriptionMarker("A complete description with more responsibilities."), false);
assert.equal(extractSmartJobIdFromComponentKey("job-card-component-ref-4385086301"), "4385086301");
assert.equal(extractSmartJobIdFromComponentKey("job-card-component-ref-not-an-id"), null);

const adapterSource = fs.readFileSync(new URL("./linkedin_split_pane_adapter.mjs", import.meta.url), "utf8");
assert.doesNotMatch(adapterSource, /marker\.compareDocumentPosition\s*\(/);
assert.match(adapterSource, /markerDocumentIndex/);

let stagnantAdvanceCalls = 0;
const stagnant = await collectSearchCardsAcrossPages({}, {
  queryId: "Q2",
  limit: 10,
  maxPages: 8,
  maxStagnantObservations: 2,
  collectPage: async () => [{ job_id: "9", title: "Same", company: "Nine", query_ids: ["Q2"] }],
  advance: async () => {
    stagnantAdvanceCalls += 1;
    return { advanced: true, mode: "appended" };
  },
});
assert.equal(stagnant.stop_reason, "PAGINATION_NO_PROGRESS");
assert.equal(stagnantAdvanceCalls, 2);

let navigatedTo = null;
const nextPageWaits = [];
const nextPageAdvance = await advanceLinkedInSearchResults({
  goto: async (url) => { navigatedTo = url; },
  playwright: {
    evaluate: async () => ({ next_href: "https://www.linkedin.com/jobs/search/?start=25", next_button_available: false }),
    waitForTimeout: async (milliseconds) => nextPageWaits.push(milliseconds),
  },
}, {
  queryId: "Q3",
  knownJobIds: ["20"],
  collectPage: async () => navigatedTo
    ? [{ job_id: "21", title: "New", company: "New Co", query_ids: ["Q3"] }]
    : [{ job_id: "20", title: "Old", company: "Old Co", query_ids: ["Q3"] }],
});
assert.equal(nextPageAdvance.mode, "next_page");
assert.equal(navigatedTo, "https://www.linkedin.com/jobs/search/?start=25");
assert.deepEqual(nextPageWaits, [1000, 2000, 3000, 4000]);

const appendedAdvance = await advanceLinkedInSearchResults({
  playwright: {
    evaluate: async () => ({ next_href: null, next_button_available: false }),
    waitForTimeout: async () => {},
  },
}, {
  queryId: "Q4",
  knownJobIds: ["30"],
  collectPage: async () => [
    { job_id: "30", title: "Old", company: "Old Co", query_ids: ["Q4"] },
    { job_id: "31", title: "New", company: "New Co", query_ids: ["Q4"] },
  ],
});
assert.equal(appendedAdvance.mode, "appended");

const smartObjectAdvance = await advanceLinkedInSearchResults({
  playwright: {
    evaluate: async () => ({ next_href: null, next_button_available: false }),
    waitForTimeout: async () => {},
  },
}, {
  queryId: "SMART3",
  knownJobIds: ["40"],
  collectPage: async () => ({
    cards: [
      { job_id: "40", title: "Old", company: "Old Co", query_ids: ["SMART3"] },
      { job_id: "41", title: "New", company: "New Co", query_ids: ["SMART3"] },
    ],
    boundary: { status: "not_observed", marker_text: null, cards_below_observed: 0 },
  }),
});
assert.equal(smartObjectAdvance.mode, "appended");
assert.equal(isNextPageLabel("View next page"), true);
assert.equal(isNextPageLabel("View next page, page 2"), true);
assert.equal(isNextPageLabel("Page 2"), false);
assert.equal(isNextPageLabel("Next job"), false);
const detail = await selectAndExtractSplitPane(fakeTab, cards[0]);
assert.equal(clicked, true);
assert.equal(detail.retrieval_status, "retrieved");
assert.deepEqual(detail.extraction_warnings, []);

const collapsedTab = {
  playwright: {
    evaluate: async () => ({
      selected_title: "Business Analyst",
      description: `${"C".repeat(350)} … more`,
      description_expansion: {
        required: true,
        attempted: true,
        control_text: "… more",
        outcome: "failed",
        wait_ms: 10000,
      },
    }),
  },
};
const collapsedDetail = await (await import("./linkedin_split_pane_adapter.mjs"))
  .extractSelectedJobDetail(collapsedTab, cards[0]);
assert.equal(collapsedDetail.retrieval_status, "incomplete_description");
assert.equal(collapsedDetail.description_completeness, "incomplete_expansion_failed");
assert.match(collapsedDetail.description, /more$/);

let duplicateTitleClicked = false;
const duplicateTitleTab = {
  playwright: {
    evaluate: fakeTab.playwright.evaluate,
    domSnapshot: fakeTab.playwright.domSnapshot,
    getByRole: () => ({ count: async () => 2 }),
    locator: (selector) => ({
      count: async () => 1,
      click: async () => {
        assert.match(selector, /\/jobs\/view\/123456789\//);
        duplicateTitleClicked = true;
      },
    }),
  },
};
const duplicateDetail = await selectAndExtractSplitPane(duplicateTitleTab, cards[0]);
assert.equal(duplicateTitleClicked, true);
assert.equal(duplicateDetail.retrieval_status, "retrieved");

let navigatedUrl = "";
const urlSelectionTab = {
  goto: async (url) => { navigatedUrl = url; },
  playwright: {
    evaluate: fakeTab.playwright.evaluate,
    domSnapshot: async () => "Business Analyst\nAbout the job",
  },
};
const urlDetail = await navigateAndExtractSplitPane(
  urlSelectionTab,
  "https://www.linkedin.com/jobs/search/?keywords=test",
  cards[0],
);
assert.equal(new URL(navigatedUrl).searchParams.get("currentJobId"), "123456789");
assert.equal(urlDetail.retrieval_status, "retrieved");
assert.equal(urlDetail.selection.mode, "currentJobId_url");

let directScrolled = false;
const directTab = {
  goto: async (url) => assert.equal(url, "https://www.linkedin.com/jobs/view/123456789/"),
  dom_cua: {
    scroll: async ({ x, y }) => {
      assert.deepEqual({ x, y }, { x: 0, y: 700 });
      directScrolled = true;
    },
  },
  playwright: {
    domSnapshot: async () => directScrolled
      ? "Business Analyst\nheading About the job"
      : "Business Analyst",
    waitForTimeout: async () => {},
    evaluate: async (fn, args) => ({
      selected_title: args.expectedTitle,
      description: "D".repeat(350),
    }),
  },
};
const directDetail = await extractDirectJobPage(directTab, cards[0]);
assert.equal(directScrolled, true);
assert.equal(directDetail.retrieval_status, "retrieved");
assert.equal(directDetail.retrieval_method, "direct_job_page_parallel");
assert.equal(directDetail.selection.mode, "direct_job_page");

let delayedDescriptionReads = 0;
const delayedDescriptionWaits = [];
const delayedDescriptionTab = {
  goto: async () => {},
  dom_cua: { scroll: async () => {} },
  playwright: {
    domSnapshot: async () => "Business Analyst\nAbout the job",
    waitForTimeout: async (milliseconds) => delayedDescriptionWaits.push(milliseconds),
    evaluate: async (fn, args) => {
      delayedDescriptionReads += 1;
      return {
        selected_title: args.expectedTitle,
        description: delayedDescriptionReads >= 3 ? "R".repeat(350) : "",
      };
    },
  },
};
const delayedDescriptionDetail = await extractDirectJobPage(delayedDescriptionTab, cards[0]);
assert.equal(delayedDescriptionDetail.retrieval_status, "retrieved");
assert.equal(delayedDescriptionReads, 3);
assert.deepEqual(delayedDescriptionWaits, [1000, 2000]);

let germanWaits = 0;
const germanHeadingTab = {
  goto: async () => {},
  dom_cua: { scroll: async () => {} },
  playwright: {
    domSnapshot: async () => "Business Analyst\nÜber den Job",
    waitForTimeout: async () => { germanWaits += 1; },
    evaluate: async (fn, args) => ({
      selected_title: args.expectedTitle,
      description: "G".repeat(350),
    }),
  },
};
const germanDetail = await extractDirectJobPage(germanHeadingTab, cards[0]);
assert.equal(germanDetail.retrieval_status, "retrieved");
assert.equal(germanWaits, 0);

let activeTabs = 0;
let peakTabs = 0;
let checkpointed = 0;
const parallelBrowser = {
  tabs: {
    new: async () => {
      activeTabs += 1;
      peakTabs = Math.max(peakTabs, activeTabs);
      let scrolled = false;
      return {
        goto: async () => new Promise((resolve) => setTimeout(resolve, 5)),
        dom_cua: { scroll: async () => { scrolled = true; } },
        playwright: {
          domSnapshot: async () => scrolled ? "Business Analyst\nAbout the job" : "Business Analyst",
          waitForTimeout: async () => {},
          evaluate: async (fn, args) => ({
            selected_title: args.expectedTitle,
            description: "P".repeat(350),
          }),
        },
        close: async () => { activeTabs -= 1; },
      };
    },
  },
};
const parallelCards = Array.from({ length: 8 }, (_, index) => ({
  ...cards[0],
  job_id: String(200000000 + index),
}));
const parallelResult = await extractJobDetailsInParallel(parallelBrowser, parallelCards, {
  concurrency: 5,
  onDetail: async () => { checkpointed += 1; },
});
assert.equal(MAX_DIRECT_DETAIL_CONCURRENCY, 5);
assert.equal(parallelResult.results.length, 8);
assert.equal(parallelResult.results.every((item) => item.retrieval_status === "retrieved"), true);
assert.equal(checkpointed, 8);
assert.equal(peakTabs, 5);
assert.equal(activeTabs, 0);
await assert.rejects(
  extractJobDetailsInParallel(parallelBrowser, parallelCards, { concurrency: 6 }),
  /between 1 and 5/,
);

process.stdout.write("linkedin_split_pane_adapter tests passed\n");
