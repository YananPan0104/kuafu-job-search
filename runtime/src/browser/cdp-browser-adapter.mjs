import { MAX_LOAD_WAIT_MS } from "../../../.agents/skills/discover-linkedin-job-postings/scripts/loading_policy.mjs";

export class CdpBrowserAdapter {
  constructor(browser, context) {
    this.browser = browser;
    this.context = context;
    this.tabs = { new: () => this.openTab() };
  }

  static async connect(endpoint, dependencies = {}) {
    const loadChromium = dependencies.loadChromium ?? (async () => {
      try {
        return (await import("playwright-core")).chromium;
      } catch (error) {
        throw new Error("playwright-core is required for the CDP browser adapter", { cause: error });
      }
    });
    const chromium = await loadChromium();
    const browser = await chromium.connectOverCDP(endpoint, { timeout: MAX_LOAD_WAIT_MS });
    const context = browser.contexts()[0];
    if (!context) throw new Error("Chrome CDP connection did not expose a browser context");
    context.setDefaultTimeout?.(MAX_LOAD_WAIT_MS);
    context.setDefaultNavigationTimeout?.(MAX_LOAD_WAIT_MS);
    return new CdpBrowserAdapter(browser, context);
  }

  async openTab(url) {
    const page = await this.context.newPage();
    const tab = {
      goto: (target) => page.goto(target, { waitUntil: "domcontentloaded", timeout: MAX_LOAD_WAIT_MS }),
      url: () => page.url(),
      snapshot: () => page.locator("body").innerText(),
      close: () => page.close(),
      playwright: {
        evaluate: (fn, args) => page.evaluate(fn, args),
        domSnapshot: () => page.locator("body").innerText(),
        locator: (...args) => page.locator(...args),
        getByRole: (...args) => page.getByRole(...args),
        waitForTimeout: (milliseconds) => page.waitForTimeout(milliseconds),
      },
      dom_cua: {
        scroll: async ({ x = 0, y = 0 }) => page.evaluate(
          ({ deltaX, deltaY }) => window.scrollBy(deltaX, deltaY),
          { deltaX: x, deltaY: y },
        ),
      },
      page,
    };
    if (url) await tab.goto(url);
    return tab;
  }

  async close() {
    await this.browser.close();
  }
}
