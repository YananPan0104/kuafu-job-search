import { extractLinkedInJobId } from "./linkedin_discovery.mjs";

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
      .find((node) => clean(node.textContent).toLowerCase() === "about the job");
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
