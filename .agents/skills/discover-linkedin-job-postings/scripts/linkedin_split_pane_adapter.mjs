import { extractLinkedInJobId } from "./linkedin_discovery.mjs";
import { LOAD_CHECK_SCHEDULE_MS, pollUntilLoaded } from "./loading_policy.mjs";

export const MAX_DIRECT_DETAIL_CONCURRENCY = 5;

export function isNextPageLabel(label, rel = "") {
  if (String(rel).trim().toLowerCase() === "next") return true;
  const value = compact(label);
  return /\bnext\s+page\b/i.test(value)
    || /\bnächste\s+seite\b/i.test(value)
    || /\bseite\s+weiter\b/i.test(value)
    || /\bpage\s+suivante\b/i.test(value);
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalized(value) {
  return compact(value).normalize("NFKC").toLowerCase();
}

const COLLAPSED_DESCRIPTION_MARKER = /(?:\u2026|\.\.\.)?\s*(?:show more|see more|more|mehr anzeigen)\s*$/i;

export function hasCollapsedDescriptionMarker(value) {
  return COLLAPSED_DESCRIPTION_MARKER.test(compact(value));
}

export function extractSmartJobIdFromComponentKey(value) {
  return String(value ?? "").match(/^job-card-component-ref-(\d+)$/)?.[1] ?? null;
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

export async function collectSmartSearchPage(tab, { queryId, limit = 25 } = {}) {
  const page = await tab.playwright.evaluate(({ maxAnchors }) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const markerPattern = /more results related to your search.*(?:may not be exact matches|might not be exact matches)/i;
    const markerCandidates = Array.from(document.querySelectorAll("h1, h2, h3, p, div, span"))
      .filter((node) => markerPattern.test(clean(node.textContent)))
      .sort((a, b) => clean(a.textContent).length - clean(b.textContent).length);
    const marker = markerCandidates[0] || null;
    // Some LinkedIn Smart Search renderers expose element-like wrappers whose
    // textContent is readable but whose Node prototype methods are unavailable.
    // Compare stable indexes from one DOM snapshot instead of relying on a
    // node-prototype document-position method.
    const documentElements = Array.from(document.querySelectorAll("body *"));
    const markerDocumentIndex = marker ? documentElements.indexOf(marker) : -1;
    const containers = Array.from(document.querySelectorAll('main [role="button"]'))
      .filter((node) => node.querySelector('button[aria-label^="Dismiss "]'))
      .slice(0, maxAnchors);
    const rawCards = containers.map((card, index) => {
      const dismiss = card.querySelector('button[aria-label^="Dismiss "]');
      const paragraphs = Array.from(card.querySelectorAll("p")).map((node) => clean(node.textContent)).filter(Boolean);
      const dismissLabel = dismiss?.getAttribute("aria-label") || "";
      return {
        card_index: index,
        component_key: card.getAttribute("componentkey") || "",
        title: dismissLabel.replace(/^Dismiss\s+/i, "").replace(/\s+job$/i, "").trim() || paragraphs[0] || "",
        company: paragraphs[1] || "",
        location: paragraphs[2] || "",
        card_text: (card?.innerText || "").trim(),
        below_boundary: Boolean(marker && markerDocumentIndex >= 0
          && documentElements.indexOf(card) > markerDocumentIndex),
      };
    });
    const firstRelated = rawCards.findIndex((card) => card.below_boundary);
    return {
      raw_cards: rawCards,
      boundary: marker && markerDocumentIndex < 0 ? {
        status: "ambiguous",
        marker_text: clean(marker.textContent),
        cards_below_observed: 0,
      } : marker ? {
        status: "reached",
        marker_text: clean(marker.textContent),
        first_related_card_index: firstRelated < 0 ? rawCards.length : firstRelated,
        cards_below_observed: rawCards.filter((card) => card.below_boundary).length,
      } : { status: "not_observed", marker_text: null, cards_below_observed: 0 },
    };
  }, { maxAnchors: Math.max(limit * 4, 40) });
  const eligibleRaw = (page.boundary.status === "reached"
    ? page.raw_cards.filter((raw) => !raw.below_boundary)
    : page.raw_cards).slice(0, limit);
  const cards = eligibleRaw.map((raw) => {
    const jobId = extractSmartJobIdFromComponentKey(raw.component_key);
    if (!jobId || !raw.title) return null;
    return {
      job_id: jobId,
      title: raw.title,
      company: raw.company || null,
      location: raw.location || null,
      source_url: buildDirectJobUrl(jobId),
      source_href: buildDirectJobUrl(jobId),
      query_ids: queryId ? [queryId] : [],
      card_text: raw.card_text,
      visible_status_markers: String(raw.card_text || "").split(/\r?\n/)
        .map((value) => value.trim())
        .filter((value) => /\breposted\s+\d+\s+(?:minute|hour|day|week)s?\s+ago\b/i.test(value)),
    };
  }).filter(Boolean);
  if (page.boundary.status === "reached") page.boundary.first_related_card_index = cards.length;
  return { cards: mergeJobCardsById(cards), boundary: page.boundary };
}

async function waitFor(tab, milliseconds) {
  if (typeof tab?.playwright?.waitForTimeout === "function") {
    await tab.playwright.waitForTimeout(milliseconds);
  }
}

export async function advanceLinkedInSearchResults(
  tab,
  { queryId, knownJobIds = [], collectPage = collectVisibleJobCards, probeLimit = 400 } = {},
) {
  const known = new Set(knownJobIds.map(String));
  const state = await tab.playwright.evaluate(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
    };
    const resultList = document.querySelector([
      ".jobs-search-results-list",
      ".scaffold-layout__list",
      "[data-results-list-top-scroll-sentinel-sibling]",
    ].join(","));
    const scrollTarget = resultList || document.scrollingElement;
    if (scrollTarget) scrollTarget.scrollBy({ top: Math.max(scrollTarget.clientHeight * 0.8, 600), behavior: "instant" });

    const candidates = Array.from(document.querySelectorAll('a, button')).filter(visible);
    const next = candidates.find((element) => {
      const label = [element.getAttribute("aria-label"), element.getAttribute("title"), element.textContent]
        .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      const rel = element.getAttribute("rel") || "";
      return rel.toLowerCase() === "next"
        || /\bnext\s+page\b/i.test(label)
        || /\bnächste\s+seite\b/i.test(label)
        || /\bseite\s+weiter\b/i.test(label)
        || /\bpage\s+suivante\b/i.test(label);
    });
    const disabled = next && (
      next.hasAttribute("disabled")
      || next.getAttribute("aria-disabled") === "true"
      || next.classList.contains("disabled")
    );
    return {
      next_href: !disabled && next?.tagName === "A" ? next.href : null,
      next_button_available: Boolean(next && !disabled && next.tagName !== "A"),
    };
  });

  const waitForNewCards = () => pollUntilLoaded({
    check: async () => {
      const observed = await collectPage(tab, { queryId, limit: probeLimit });
      const cards = Array.isArray(observed) ? observed : observed?.cards;
      return Array.isArray(cards) && cards.some((card) => !known.has(String(card.job_id))) ? observed : null;
    },
    wait: (milliseconds) => waitFor(tab, milliseconds),
  });
  const appended = await waitForNewCards();
  if (appended.loaded) {
    return { advanced: true, mode: "appended", wait_ms: appended.elapsed_ms };
  }

  if (state.next_href && typeof tab.goto === "function") {
    await tab.goto(state.next_href);
    const loaded = await waitForNewCards();
    return loaded.loaded
      ? { advanced: true, mode: "next_page", url: state.next_href, wait_ms: loaded.elapsed_ms }
      : { advanced: false, reason: "PAGINATION_NO_PROGRESS", url: state.next_href, wait_ms: loaded.elapsed_ms };
  }
  if (state.next_button_available) {
    const clicked = await tab.playwright.evaluate(() => {
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
      };
      const next = Array.from(document.querySelectorAll('button')).filter(visible).find((element) => {
        const label = [element.getAttribute("aria-label"), element.getAttribute("title"), element.textContent]
          .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        return /\bnext\s+page\b/i.test(label)
          || /\bnächste\s+seite\b/i.test(label)
          || /\bseite\s+weiter\b/i.test(label)
          || /\bpage\s+suivante\b/i.test(label);
      });
      if (!next || next.disabled || next.getAttribute("aria-disabled") === "true") return false;
      next.click();
      return true;
    });
    if (clicked) {
      const loaded = await waitForNewCards();
      return loaded.loaded
        ? { advanced: true, mode: "next_page", wait_ms: loaded.elapsed_ms }
        : { advanced: false, reason: "PAGINATION_NO_PROGRESS", wait_ms: loaded.elapsed_ms };
    }
  }
  return { advanced: false, reason: "EXHAUSTED_RESULTS" };
}

export async function collectSearchCardsAcrossPages(tab, {
  queryId,
  limit = 25,
  maxPages = 8,
  maxStagnantObservations = 2,
  collectPage = collectVisibleJobCards,
  advance = advanceLinkedInSearchResults,
  onObservation,
} = {}) {
  if (!queryId) throw new Error("queryId is required");
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error("maxPages must be a positive integer");
  const cards = [];
  let pagesObserved = 0;
  let stagnantObservations = 0;
  let lastAdvanceMode = "initial";

  while (pagesObserved < maxPages) {
    const pageResult = await collectPage(tab, { queryId, limit });
    const observed = Array.isArray(pageResult) ? pageResult : (pageResult?.cards ?? []);
    const boundary = Array.isArray(pageResult) ? null : pageResult?.boundary;
    const boundaryIndex = boundary?.status === "reached"
      ? Math.max(0, Number(boundary.first_related_card_index ?? observed.length))
      : observed.length;
    if (["ambiguous", "not_observable"].includes(boundary?.status)) {
      await onObservation?.({
        query_id: queryId,
        observation: pagesObserved + 1,
        navigation_mode: lastAdvanceMode,
        unique_cards_collected: 0,
        stagnant_observations: stagnantObservations,
        cards: [],
        boundary,
      });
      return {
        cards: [], pages_observed: pagesObserved + 1,
        stop_reason: boundary.status === "ambiguous"
          ? "RELATED_RESULTS_BOUNDARY_AMBIGUOUS"
          : "RELATED_RESULTS_BOUNDARY_NOT_OBSERVABLE",
        boundary,
      };
    }
    const eligibleObserved = observed.slice(0, boundaryIndex);
    const before = cards.length;
    const merged = mergeJobCardsById([...cards, ...eligibleObserved]).slice(0, limit);
    cards.splice(0, cards.length, ...merged);
    pagesObserved += 1;
    stagnantObservations = cards.length === before ? stagnantObservations + 1 : 0;
    await onObservation?.({
      query_id: queryId,
      observation: pagesObserved,
      navigation_mode: lastAdvanceMode,
      unique_cards_collected: cards.length,
      stagnant_observations: stagnantObservations,
      cards: [...cards],
      boundary: boundary ?? null,
    });
    if (boundary?.status === "reached") {
      return {
        cards,
        pages_observed: pagesObserved,
        stop_reason: "RELATED_RESULTS_BOUNDARY_REACHED",
        boundary: {
          ...boundary,
          cards_above: cards.length,
          cards_below_observed: Number(boundary.cards_below_observed ?? Math.max(0, observed.length - boundaryIndex)),
        },
      };
    }
    if (cards.length >= limit) {
      return { cards, pages_observed: pagesObserved, stop_reason: "QUERY_COLLECTION_LIMIT_REACHED" };
    }
    if (stagnantObservations >= maxStagnantObservations) {
      return { cards, pages_observed: pagesObserved, stop_reason: "PAGINATION_NO_PROGRESS" };
    }
    const result = await advance(tab, {
      queryId,
      knownJobIds: cards.map((card) => card.job_id),
      collectPage,
    });
    if (!result?.advanced) {
      return { cards, pages_observed: pagesObserved, stop_reason: result?.reason || "EXHAUSTED_RESULTS" };
    }
    lastAdvanceMode = result.mode || "unknown";
  }
  return { cards, pages_observed: pagesObserved, stop_reason: "MAX_PAGES_REACHED" };
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
  const selectionPoll = await pollUntilLoaded({
    check: async () => {
      const snapshot = await tab.playwright.domSnapshot();
      const state = inspectDetailSnapshot(snapshot, card);
      return state.expected_title_seen && state.detail_heading_visible ? snapshot : null;
    },
    wait: (milliseconds) => waitFor(tab, milliseconds),
  });
  const after = selectionPoll.value ?? await tab.playwright.domSnapshot();
  const titleSeen = normalized(after).includes(normalized(card.title));
  const detailSeen = /about the job|über den job|infos zur stelle/i.test(after);
  return {
    before_snapshot_had_job: normalized(before).includes(normalized(card.title)),
    selected_job_verified: titleSeen && detailSeen,
    detail_heading_visible: detailSeen,
    load_wait_ms: selectionPoll.elapsed_ms,
  };
}

export async function extractSelectedJobDetail(tab, card) {
  const extracted = await tab.playwright.evaluate(async ({ expectedTitle }) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const isCollapsed = (value) => /(?:\u2026|\.\.\.)?\s*(?:show more|see more|more|mehr anzeigen)\s*$/i.test(clean(value));
    const isVisible = (node) => {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
    };
    const heading = Array.from(document.querySelectorAll("h1, h2, h3"))
      .find((node) => /^(about the job|über den job|infos zur stelle)$/i.test(clean(node.textContent)));
    if (!heading) return { description: "", selected_title: "" };

    const section = heading.parentElement?.parentElement || heading.parentElement;
    const readText = () => clean(section?.innerText || "").replace(/^(?:About the job|\u00dcber den Job|Infos zur Stelle)\s*/i, "");
    let text = readText();
    const controlLabel = (node) => clean([
      node.getAttribute("aria-label"), node.getAttribute("title"), node.textContent,
    ].filter(Boolean).join(" "));
    const matchesExpansion = (node) => /^(?:\u2026\s*)?(?:show more|see more|more|mehr anzeigen)$/i.test(controlLabel(node));
    const controls = Array.from(section?.querySelectorAll("button, a, [role='button']") || [])
      .filter(isVisible).filter(matchesExpansion);
    const expansion = {
      required: isCollapsed(text) || controls.length > 0,
      attempted: false,
      control_text: controls.length === 1 ? controlLabel(controls[0]) : null,
      control_identity: controls.length === 1 ? "description_section_unique_control" : null,
      outcome: "not_required",
      wait_ms: 0,
    };
    if (expansion.required) {
      if (controls.length !== 1) {
        expansion.outcome = controls.length ? "ambiguous_control" : "marker_without_control";
      } else {
        expansion.attempted = true;
        const before = text;
        const started = Date.now();
        controls[0].click();
        while (Date.now() - started < 10000) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          text = readText();
          const remains = Array.from(section?.querySelectorAll("button, a, [role='button']") || [])
            .filter(isVisible).some(matchesExpansion);
          if (text !== before && !isCollapsed(text) && !remains) {
            expansion.outcome = "expanded_verified";
            break;
          }
        }
        expansion.wait_ms = Date.now() - started;
        if (expansion.outcome !== "expanded_verified") expansion.outcome = "failed";
      }
    }
    const headings = Array.from(document.querySelectorAll("h1"))
      .map((node) => clean(node.textContent))
      .filter(Boolean);
    const expected = clean(expectedTitle).toLowerCase();
    const selected = headings.find((value) => value.toLowerCase().includes(expected))
      || headings[headings.length - 1]
      || "";
    return { description: text, selected_title: selected, description_expansion: expansion };
  }, { expectedTitle: card?.title ?? "" });

  const description = compact(extracted?.description);
  const titleMatches = !extracted?.selected_title
    || normalized(extracted.selected_title).includes(normalized(card?.title));
  const warnings = [];
  if (!description) warnings.push("ABOUT_SECTION_NOT_VISIBLE");
  if (!titleMatches) warnings.push("SELECTED_TITLE_MISMATCH");
  if (description && description.length < 300) warnings.push("DESCRIPTION_MAY_BE_INCOMPLETE");
  const descriptionExpansion = extracted?.description_expansion ?? {
    required: hasCollapsedDescriptionMarker(description),
    attempted: false,
    control_text: null,
    outcome: hasCollapsedDescriptionMarker(description) ? "marker_without_control" : "not_required",
    wait_ms: 0,
  };
  const incomplete = hasCollapsedDescriptionMarker(description)
    || ["failed", "ambiguous_control", "marker_without_control"].includes(descriptionExpansion.outcome);
  if (incomplete) warnings.push("DESCRIPTION_INCOMPLETE_OR_COLLAPSED");
  const descriptionCompleteness = incomplete
    ? (descriptionExpansion.outcome === "failed"
      ? "incomplete_expansion_failed"
      : "incomplete_collapsed_marker_remaining")
    : (descriptionExpansion.outcome === "expanded_verified"
      ? "complete_expanded_verified"
      : "complete_already_expanded");

  return {
    job_id: card?.job_id ?? null,
    title: card?.title ?? null,
    company: card?.company ?? null,
    location: card?.location ?? null,
    source_url: card?.source_url ?? null,
    retrieval_status: incomplete
      ? "incomplete_description"
      : (description && titleMatches ? "retrieved" : "retrieval_failed"),
    description,
    description_expansion: descriptionExpansion,
    description_completeness: descriptionCompleteness,
    extraction_warnings: warnings,
  };
}

export async function extractDirectJobPage(
  tab,
  card,
  { waitScheduleMs = LOAD_CHECK_SCHEDULE_MS, scrollY = 700 } = {},
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

  let detail;
  const detailPoll = await pollUntilLoaded({
    check: async () => {
      detail = await extractSelectedJobDetail(tab, card);
      return detail.retrieval_status === "retrieved" ? detail : null;
    },
    wait: (milliseconds) => waitFor(tab, milliseconds),
    scheduleMs: waitScheduleMs,
  });
  detail = detailPoll.value ?? detail;
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
      description_wait_ms: detailPoll.elapsed_ms,
      description_retry_attempts: detailPoll.attempts,
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
    maxExtractionAttempts = 2,
  } = {},
) {
  if (!browser?.tabs?.new) throw new Error("browser must expose tabs.new()");
  if (!Array.isArray(cards)) throw new Error("cards must be an array");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_DIRECT_DETAIL_CONCURRENCY) {
    throw new Error(`concurrency must be an integer between 1 and ${MAX_DIRECT_DETAIL_CONCURRENCY}`);
  }
  if (typeof onDetail !== "function") throw new Error("onDetail must be a function");
  if (!Number.isInteger(maxExtractionAttempts) || maxExtractionAttempts < 1) {
    throw new Error("maxExtractionAttempts must be a positive integer");
  }

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
      for (let attempt = 1; attempt <= maxExtractionAttempts; attempt += 1) {
        try {
          tab = tab ?? await browser.tabs.new();
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
        detail.extraction_attempts = attempt;
        const terminal = detail.extraction_warnings?.some((warning) =>
          ["ACCESS_CHALLENGE", "LOGIN_REQUIRED", "JOB_UNAVAILABLE"].includes(warning));
        if (detail.retrieval_status === "retrieved" || terminal || attempt === maxExtractionAttempts) break;
        await waitFor(tab, LOAD_CHECK_SCHEDULE_MS[0]);
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
  let detail;
  const detailPoll = await pollUntilLoaded({
    check: async () => {
      detail = await extractSelectedJobDetail(tab, card);
      return detail.retrieval_status === "retrieved" ? detail : null;
    },
    wait: (milliseconds) => waitFor(tab, milliseconds),
  });
  if (detailPoll.loaded) detail = detailPoll.value;
  return {
    ...detail,
    selection: { ...selection, detail_load_wait_ms: detailPoll.elapsed_ms },
  };
}

export async function navigateAndExtractSplitPane(
  tab,
  searchUrl,
  card,
  { waitScheduleMs = LOAD_CHECK_SCHEDULE_MS } = {},
) {
  const targetUrl = buildSplitPaneSelectionUrl(searchUrl, card?.job_id);
  await tab.goto(targetUrl);
  const selectionPoll = await pollUntilLoaded({
    check: async () => {
      const snapshot = await tab.playwright.domSnapshot();
      return normalized(snapshot).includes(normalized(card?.title))
        && /about the job|über den job|infos zur stelle/i.test(snapshot)
        ? snapshot
        : null;
    },
    wait: (milliseconds) => waitFor(tab, milliseconds),
    scheduleMs: waitScheduleMs,
  });
  if (!selectionPoll.loaded) {
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
        used_delayed_render_fallback: selectionPoll.attempts > 1,
        load_wait_ms: selectionPoll.elapsed_ms,
      },
    };
  }

  let detail = await extractSelectedJobDetail(tab, card);
  if (
    detail.retrieval_status === "retrieval_failed"
    && detail.extraction_warnings.includes("ABOUT_SECTION_NOT_VISIBLE")
  ) {
    const extractionPoll = await pollUntilLoaded({
      check: async () => {
        const candidate = await extractSelectedJobDetail(tab, card);
        detail = candidate;
        return candidate.retrieval_status === "retrieved" ? candidate : null;
      },
      wait: (milliseconds) => waitFor(tab, milliseconds),
      scheduleMs: waitScheduleMs,
    });
    if (extractionPoll.loaded) detail = extractionPoll.value;
    detail.selection_load_wait_ms = extractionPoll.elapsed_ms;
    detail.used_extraction_retry = extractionPoll.attempts > 1;
  }

  return {
    ...detail,
    selection: {
      mode: "currentJobId_url",
      selected_job_verified: true,
      detail_heading_visible: true,
      used_delayed_render_fallback: selectionPoll.attempts > 1,
      load_wait_ms: selectionPoll.elapsed_ms,
      used_extraction_retry: Boolean(detail.used_extraction_retry),
    },
  };
}
