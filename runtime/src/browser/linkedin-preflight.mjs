const LOGIN_MARKERS = ["sign in", "email", "password", "join now"];
const CAPTCHA_MARKERS = ["captcha", "quick security check", "verify you are human"];
const CHALLENGE_MARKERS = ["security verification", "verification code", "checkpoint"];
const AUTHENTICATED_MARKERS = ["jobs", "my network", "messaging", "notifications"];

function includesAny(text, markers) {
  return markers.some((marker) => text.includes(marker));
}

export function classifyLinkedInPage({ url, snapshot }) {
  const normalizedUrl = String(url ?? "").toLowerCase();
  const normalizedSnapshot = String(snapshot ?? "").toLowerCase();
  if (includesAny(normalizedSnapshot, CAPTCHA_MARKERS)) {
    return { status: "CAPTCHA_DETECTED", url };
  }
  if (normalizedUrl.includes("/checkpoint/") || includesAny(normalizedSnapshot, CHALLENGE_MARKERS)) {
    return { status: "ACCESS_CHALLENGE", url };
  }
  if (normalizedUrl.includes("/login") || LOGIN_MARKERS.filter((item) => normalizedSnapshot.includes(item)).length >= 2) {
    return { status: "AUTHENTICATION_REQUIRED", url };
  }
  if (normalizedUrl.includes("linkedin.com") && includesAny(normalizedSnapshot, AUTHENTICATED_MARKERS)) {
    return { status: "AUTHENTICATED", url };
  }
  return { status: "DOM_DRIFT", url, warning: "LinkedIn page state was not recognized" };
}

async function currentUrl(tab) {
  if (typeof tab.url === "function") return tab.url();
  return tab.url;
}

async function visibleSnapshot(tab) {
  if (typeof tab.snapshot === "function") return tab.snapshot();
  if (typeof tab.playwright?.domSnapshot === "function") return tab.playwright.domSnapshot();
  throw new Error("Browser tab does not expose a visible snapshot method");
}

export async function runLinkedInPreflight(browser, options = {}) {
  const jobsUrl = options.jobsUrl ?? "https://www.linkedin.com/jobs/";
  const tab = await browser.openTab(jobsUrl);
  if (typeof tab.goto === "function") await tab.goto(jobsUrl);
  const result = classifyLinkedInPage({
    url: await currentUrl(tab),
    snapshot: await visibleSnapshot(tab),
  });
  return { ...result, checked_at: new Date().toISOString() };
}
