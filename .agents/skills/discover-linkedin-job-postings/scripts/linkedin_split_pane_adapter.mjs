import { extractLinkedInJobId } from "./linkedin_discovery.mjs";

export const MAX_DIRECT_DETAIL_CONCURRENCY = 5;

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalized(value) {
  return compact(value).normalize("NFKC").toLowerCase();
}

export function escapeCssAttributeValue(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\d ")
    .replace(/\n/g, "\\a ")
    .replace(/\f/g, "\\c ");
}

export function parseVisibleJobCard(raw, queryId) {
  const sourceHref = String(raw?.source_href ?? raw?.href ?? "").trim();
  const jobId = extractLinkedInJobId(sourceHref);
  const title = compact(raw?.title);
  if (!jobId || !title) return null;

  const lines = String(raw?.card_text ?? raw?.cardText ?? "")
    .split(/\r?\n/)
    .map(compact)
    .filter(Boolean);
  const titleKey = normalized(title);
  const metadata = lines.filter((line) => {
    const key = normalized(line);
    return key !== titleKey
      && !key.includes("with verification")
      && !key.startsWith("easy apply")
      && !key.startsWith("promoted")
      && !key.startsWith("viewed")
      && !key.startsWith("actively reviewing");
  });

  return {
    job_id: jobId,
    title,
    company: compact(raw?.company) || metadata[0] || null,
    location: compact(raw?.location) || metadata[1] || null,
    source_url: new URL(sourceHref, "https://www.linkedin.com").toString(),
    source_href: sourceHref,
    query_ids: queryId ? [queryId] : [],
    visible_status_markers: lines.filter((line) =>
      /^(promoted|viewed|easy apply|actively reviewing)/i.test(line),
    ),
  };
}

export function mergeJobCardsById(cards) {
  const merged = new Map();
  for (const card of cards) {
    if (!card?.job_id) continue;
    const prior = merged.get(card.job_id);
    if (!prior) {
      merged.set(card.job_id, { ...card, query_ids: [...new Set(card.query_ids ?? [])] });
      continue;
    }
    merged.set(card.job_id, {
      ...prior,
      ...Object.fromEntries(Object.entries(card).filter(([, value]) => value != null && value !== "")),
      query_ids: [...new Set([...(prior.query_ids ?? []), ...(card.query_ids ?? [])])],
      visible_status_markers: [...new Set([
        ...(prior.visible_status_markers ?? []),
        ...(card.visible_status_markers ?? []),
      ])],
    });
  }
  return [...merged.values()];
}

export function buildSplitPaneSelectionUrl(searchUrl, jobId) {
  const id = String(jobId ?? "").trim();
  if (!/^\d+$/.test(id)) throw new Error("jobId must contain digits only");
  const url = new URL(searchUrl);
  if (url.hostname !== "www.linkedin.com" || url.pathname !== "/jobs/search/") {
    throw new Error("searchUrl must be a LinkedIn jobs search URL");
  }
  url.searchParams.set("currentJobId", id);
  return url.toString();
}

export function buildDirectJobUrl(jobId) {
  const id = String(jobId ?? "").trim();
  if (!/^\d+$/.test(id)) throw new Error("jobId must contain digits only");
  return `https://www.linkedin.com/jobs/view/${id}/`;
}

function inspectDetailSnapshot(snapshot, card) {
  const value = String(snapshot ?? "");
  const key = normalized(value);
  return {
    expected_title_seen: key.includes(normalized(card?.title)),
    detail_heading_visible: /about the job|über den job|infos zur stelle/i.test(value),
    login_required: /sign in|join now/i.test(value),
    access_challenge: /captcha|security verification|verify (?:that )?you(?:'re| are) human|quick security check/i.test(value),
    job_unavailable: /no longer accepting applications|job is no longer available|stelle ist nicht mehr verfügbar/i.test(value),
  };
}

export async function collectVisibleJobCards(tab, { queryId, limit = 25 } = {}) {
  const rawCards = await tab.playwright.evaluate(
    ({ maxAnchors }) => Array.from(document.querySelectorAll('a[href*="/jobs/view/"]'))
      .slice(0, maxAnchors)
      .map((anchor) => {
        const card = anchor.closest("li");
        return {
          source_href: anchor.getAttribute("href") || "",
          title: (anchor.querySelector("strong")?.textContent || anchor.textContent || "").trim(),
          card_text: (card?.innerText || "").trim(),
        };
      }),
    { maxAnchors: Math.max(limit * 4, 40) },
  );

  const parsed = rawCards
    .map((raw) => parseVisibleJobCard(raw, queryId))
    .filter(Boolean)
    .filter((card) => card.company || card.location);
  return mergeJobCardsById(parsed).slice(0, limit);
}

export async function clickJobCardInSplitPane(tab, card) {
  if (!card?.source_href || !card?.job_id || !card?.title) {
    throw new Error("card must include source_href, job_id, and title");
  }

  const before = await tab.playwright.domSnapshot();
  const selector = `a[href="${escapeCssAttributeValue(card.source_href)}"]`;
  const exactHrefLocator = tab.playwright.locator(selector);
  const exactHrefCount = await exactHrefLocator.count();
  if (exactHrefCount !== 1) {
    throw new Error(`Expected one visible card link for ${card.job_id}; found ${exactHrefCount}`);
  }
  // LinkedIn card URLs can be very long. The exact href locator is the identity
  // guard; the unique accessible name is the more reliable click target.
  const clickLocator = tab.playwright.getByRole("link", { name: card.title, exact: true });
  const clickCount = await clickLocator.count();
  if (clickCount === 1) {
    await clickLocator.click();
  } else {
    // Duplicate titles are common. Fall back to a short, job-ID-specific link
    // locator after the full captured href has already passed the identity guard.
    const jobIdLocator = tab.playwright.locator(`a[href*="/jobs/view/${card.job_id}/"]`);
    const jobIdCount = await jobIdLocator.count();
    if (jobIdCount !== 1) {
      throw new Error(
        `Could not isolate clickable card ${card.job_id}; title count ${clickCount}, job ID count ${jobIdCount}`,
      );
    }
    await jobIdLocator.click();
  }
  const after = await tab.playwright.domSnapshot();
  const titleSeen = normalized(after).includes(normalized(card.title));
  const detailSeen = /about the job/i.test(after);
  return {
    before_snapshot_had_job: normalized(before).includes(normalized(card.title)),
    selected_job_verified: titleSeen && detailSeen,
    detail_heading_visible: detailSeen,
  };
}

export async function extractSelectedJobDetail(tab, card) {
  const extracted = await tab.playwright.evaluate(({ expectedTitle }) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const heading = Array.from(document.querySelectorAll("h1, h2, h3"))
      .find((node) => /^(about the job|über den job|infos zur stelle)$/i.test(clean(node.textContent)));
    if (!heading) return { description: "", selected_title: "" };

    const section = heading.parentElement?.parentElement || heading.parentElement;
    const text = clean(section?.innerText || "").replace(/^About the job\s*/i, "");
    const headings = Array.from(document.querySelectorAll("h1"))
      .map((node) => clean(node.textContent))
      .filter(Boolean);
    const expected = clean(expectedTitle).toLowerCase();
    const selected = headings.find((value) => value.toLowerCase().includes(expected))
      || headings[headings.length - 1]
      || "";
    return { description: text, selected_title: selected };
  }, { expectedTitle: card?.title ?? "" });

  const description = compact(extracted?.description);
  const titleMatches = !extracted?.selected_title
    || normalized(extracted.selected_title).includes(normalized(card?.title));
  const warnings = [];
  if (!description) warnings.push("ABOUT_SECTION_NOT_VISIBLE");
  if (!titleMatches) warnings.push("SELECTED_TITLE_MISMATCH");
  if (description && description.length < 300) warnings.push("DESCRIPTION_MAY_BE_INCOMPLETE");

  return {
    job_id: card?.job_id ?? null,
    title: card?.title ?? null,
    company: card?.company ?? null,
    location: card?.location ?? null,
    source_url: card?.source_url ?? null,
    retrieval_status: description && titleMatches ? "retrieved" : "retrieval_failed",
    description,
    extraction_warnings: warnings,
  };
}

export async function extractDirectJobPage(
  tab,
  card,
  { waitScheduleMs = [500, 1000, 2000], scrollY = 700 } = {},
) {
  if (!card?.job_id || !card?.title) {
    throw new Error("card must include job_id and title");
  }
  const targetUrl = buildDirectJobUrl(card.job_id);
  await tab.goto(targetUrl);
  const finalUrl = typeof tab.url === "function" ? await tab.url() : targetUrl;
  const pageTitle = typeof tab.title === "function" ? await tab.title() : null;
  const jobIdVerified = extractLinkedInJobId(finalUrl) === String(card.job_id);
  let snapshot = await tab.playwright.domSnapshot();
  let state = inspectDetailSnapshot(snapshot, card);
  let usedScrollFallback = false;
  let waitAttempts = 0;

  if (state.login_required || state.access_challenge) {
    return {
      job_id: card.job_id,
      title: card.title,
      company: card.company ?? null,
      location: card.location ?? null,
      source_url: card.source_url ?? targetUrl,
      query_ids: card.query_ids ?? [],
      retrieval_status: "retrieval_failed",
      description: "",
      extraction_warnings: [state.access_challenge ? "ACCESS_CHALLENGE" : "LOGIN_REQUIRED"],
      retrieval_method: "direct_job_page_parallel",
      selection: {
        mode: "direct_job_page",
        selected_job_verified: false,
        detail_heading_visible: false,
        used_scroll_fallback: false,
        wait_attempts: 0,
        target_url: targetUrl,
        final_url: finalUrl,
        page_title: pageTitle,
        job_id_verified: jobIdVerified,
      },
    };
  }

  if (!state.detail_heading_visible) {
    await tab.dom_cua.scroll({ x: 0, y: scrollY });
    usedScrollFallback = true;
    snapshot = await tab.playwright.domSnapshot();
    state = inspectDetailSnapshot(snapshot, card);
  }

  for (const delayMs of waitScheduleMs) {
    if (state.expected_title_seen && state.detail_heading_visible) break;
    await tab.playwright.waitForTimeout(delayMs);
    waitAttempts += 1;
    snapshot = await tab.playwright.domSnapshot();
    state = inspectDetailSnapshot(snapshot, card);
    if (state.login_required || state.access_challenge || state.job_unavailable) break;
  }

  if (!jobIdVerified || !state.expected_title_seen || !state.detail_heading_visible) {
    const warnings = [];
    if (state.login_required) warnings.push("LOGIN_REQUIRED");
    if (state.access_challenge) warnings.push("ACCESS_CHALLENGE");
    if (state.job_unavailable) warnings.push("JOB_UNAVAILABLE");
    if (!jobIdVerified) warnings.push("DIRECT_PAGE_JOB_ID_MISMATCH");
    if (!state.expected_title_seen) warnings.push("DIRECT_PAGE_TITLE_NOT_VERIFIED");
    if (!state.detail_heading_visible) warnings.push("ABOUT_SECTION_NOT_VISIBLE");
    return {
      job_id: card.job_id,
      title: card.title,
      company: card.company ?? null,
      location: card.location ?? null,
      source_url: card.source_url ?? targetUrl,
      query_ids: card.query_ids ?? [],
      retrieval_status: "retrieval_failed",
      description: "",
      extraction_warnings: warnings,
      retrieval_method: "direct_job_page_parallel",
      selection: {
        mode: "direct_job_page",
        selected_job_verified: state.expected_title_seen,
        detail_heading_visible: state.detail_heading_visible,
        used_scroll_fallback: usedScrollFallback,
        wait_attempts: waitAttempts,
        target_url: targetUrl,
        final_url: finalUrl,
        page_title: pageTitle,
        job_id_verified: jobIdVerified,
      },
    };
  }

  const detail = await extractSelectedJobDetail(tab, card);
  return {
    ...detail,
    query_ids: card.query_ids ?? [],
    retrieval_method: "direct_job_page_parallel",
    selection: {
      mode: "direct_job_page",
      selected_job_verified: true,
      detail_heading_visible: true,
      used_scroll_fallback: usedScrollFallback,
      wait_attempts: waitAttempts,
      target_url: targetUrl,
      final_url: finalUrl,
      page_title: pageTitle,
      job_id_verified: jobIdVerified,
    },
  };
}

export async function extractJobDetailsInParallel(
  browser,
  cards,
  {
    concurrency = MAX_DIRECT_DETAIL_CONCURRENCY,
    onDetail = async () => {},
    directOptions = {},
  } = {},
) {
  if (!browser?.tabs?.new) throw new Error("browser must expose tabs.new()");
  if (!Array.isArray(cards)) throw new Error("cards must be an array");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_DIRECT_DETAIL_CONCURRENCY) {
    throw new Error(`concurrency must be an integer between 1 and ${MAX_DIRECT_DETAIL_CONCURRENCY}`);
  }
  if (typeof onDetail !== "function") throw new Error("onDetail must be a function");

  const results = new Array(cards.length);
  let nextIndex = 0;
  let stopReason = null;

  const worker = async () => {
    while (!stopReason) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= cards.length) return;
      const card = cards[index];
      let tab;
      let detail;
      try {
        tab = await browser.tabs.new();
        detail = await extractDirectJobPage(tab, card, directOptions);
      } catch (error) {
        detail = {
          job_id: card?.job_id ?? null,
          title: card?.title ?? null,
          company: card?.company ?? null,
          location: card?.location ?? null,
          source_url: card?.source_url ?? null,
          query_ids: card?.query_ids ?? [],
          retrieval_status: "retrieval_failed",
          description: "",
          extraction_warnings: ["DIRECT_PAGE_NAVIGATION_FAILED"],
          retrieval_method: "direct_job_page_parallel",
          failure_stage: "navigation_or_extraction",
        };
      }
      results[index] = detail;
      try {
        await onDetail(detail, card, index);
      } catch {
        detail.checkpoint_warning = "CHECKPOINT_CALLBACK_FAILED";
        stopReason = stopReason ?? "CHECKPOINT_CALLBACK_FAILED";
      }
      if (detail.extraction_warnings?.includes("ACCESS_CHALLENGE")) stopReason = "ACCESS_CHALLENGE";
      if (detail.extraction_warnings?.includes("LOGIN_REQUIRED")) stopReason = "LOGIN_REQUIRED";
      if (tab) {
        try { await tab.close(); } catch { /* tab cleanup is best effort */ }
      }
    }
  };

  const workerCount = Math.min(concurrency, cards.length);
  await Promise.allSettled(Array.from({ length: workerCount }, () => worker()));
  return {
    concurrency,
    max_concurrency: MAX_DIRECT_DETAIL_CONCURRENCY,
    stopped: Boolean(stopReason),
    stop_reason: stopReason,
    results: results.filter(Boolean),
  };
}

export async function selectAndExtractSplitPane(tab, card) {
  const selection = await clickJobCardInSplitPane(tab, card);
  if (!selection.selected_job_verified) {
    return {
      job_id: card.job_id,
      title: card.title,
      source_url: card.source_url,
      retrieval_status: "retrieval_failed",
      description: "",
      extraction_warnings: ["SPLIT_PANE_SELECTION_NOT_VERIFIED"],
      selection,
    };
  }
  return { ...(await extractSelectedJobDetail(tab, card)), selection };
}

export async function navigateAndExtractSplitPane(
  tab,
  searchUrl,
  card,
  { renderWaitMs = 800, extractionRetryMs = 400 } = {},
) {
  const targetUrl = buildSplitPaneSelectionUrl(searchUrl, card?.job_id);
  await tab.goto(targetUrl);
  let snapshot = await tab.playwright.domSnapshot();
  let usedDelayedRenderFallback = false;
  const verified = () => normalized(snapshot).includes(normalized(card?.title))
    && /about the job/i.test(snapshot);

  if (!verified() && renderWaitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, renderWaitMs));
    snapshot = await tab.playwright.domSnapshot();
    usedDelayedRenderFallback = true;
  }
  if (!verified()) {
    return {
      job_id: card?.job_id ?? null,
      title: card?.title ?? null,
      source_url: card?.source_url ?? null,
      retrieval_status: "retrieval_failed",
      description: "",
      extraction_warnings: ["SPLIT_PANE_URL_SELECTION_NOT_VERIFIED"],
      selection: {
        mode: "currentJobId_url",
        selected_job_verified: false,
        used_delayed_render_fallback: usedDelayedRenderFallback,
      },
    };
  }

  let detail = await extractSelectedJobDetail(tab, card);
  let usedExtractionRetry = false;
  if (
    detail.retrieval_status === "retrieval_failed"
    && detail.extraction_warnings.includes("ABOUT_SECTION_NOT_VISIBLE")
    && extractionRetryMs > 0
  ) {
    await new Promise((resolve) => setTimeout(resolve, extractionRetryMs));
    detail = await extractSelectedJobDetail(tab, card);
    usedExtractionRetry = true;
  }

  return {
    ...detail,
    selection: {
      mode: "currentJobId_url",
      selected_job_verified: true,
      detail_heading_visible: true,
      used_delayed_render_fallback: usedDelayedRenderFallback,
      used_extraction_retry: usedExtractionRetry,
    },
  };
}
