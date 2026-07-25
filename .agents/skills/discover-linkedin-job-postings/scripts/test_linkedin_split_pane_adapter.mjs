#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  escapeCssAttributeValue,
  parseVisibleJobCard,
  mergeJobCardsById,
  collectVisibleJobCards,
  selectAndExtractSplitPane,
  buildSplitPaneSelectionUrl,
  navigateAndExtractSplitPane,
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
const detail = await selectAndExtractSplitPane(fakeTab, cards[0]);
assert.equal(clicked, true);
assert.equal(detail.retrieval_status, "retrieved");
assert.deepEqual(detail.extraction_warnings, []);

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
  { renderWaitMs: 0 },
);
assert.equal(new URL(navigatedUrl).searchParams.get("currentJobId"), "123456789");
assert.equal(urlDetail.retrieval_status, "retrieved");
assert.equal(urlDetail.selection.mode, "currentJobId_url");

process.stdout.write("linkedin_split_pane_adapter tests passed\n");
