#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildChromeLaunchSpec,
  clearStaleDevToolsActivePort,
  findChromeExecutable,
  parseDevToolsActivePort,
  waitForDevToolsEndpoint,
} from "../src/browser/chrome-launcher.mjs";
import { classifyLinkedInPage, runLinkedInPreflight } from "../src/browser/linkedin-preflight.mjs";
import { executeBrowserPreflight } from "../src/cli/browser-preflight.mjs";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kuafu-phase2-"));

try {
  const profilePath = path.join(tempRoot, "chrome-profile");
  const spec = buildChromeLaunchSpec({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    profilePath,
    startUrl: "https://www.linkedin.com/jobs/",
  });
  assert.equal(spec.command.endsWith("chrome.exe"), true);
  assert.equal(spec.args.includes(`--user-data-dir=${path.resolve(profilePath)}`), true);
  assert.equal(spec.args.includes("--remote-debugging-port=0"), true);
  assert.equal(spec.args.includes("--remote-debugging-address=127.0.0.1"), true);
  assert.equal(spec.args.at(-1), "https://www.linkedin.com/jobs/");
  assert.throws(
    () => buildChromeLaunchSpec({ executablePath: "chrome", profilePath: "", startUrl: "https://www.linkedin.com" }),
    /dedicated profilePath/,
  );

  const chromePath = findChromeExecutable({
    platform: "win32",
    env: { PROGRAMFILES: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
    existsSync: (candidate) => candidate === "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  assert.equal(chromePath, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");

  assert.deepEqual(parseDevToolsActivePort("54123\n/devtools/browser/abc\n"), {
    port: 54123,
    browserPath: "/devtools/browser/abc",
    endpoint: "http://127.0.0.1:54123",
  });
  assert.throws(() => parseDevToolsActivePort("invalid"), /DevToolsActivePort/);

  await fs.mkdir(profilePath, { recursive: true });
  const activePortPath = path.join(profilePath, "DevToolsActivePort");
  await fs.writeFile(activePortPath, "44111\n/devtools/browser/stale\n");
  await assert.rejects(
    clearStaleDevToolsActivePort(profilePath, { probeEndpoint: async () => true }),
    /PROFILE_LOCKED/,
  );
  await fs.access(activePortPath);
  assert.equal(await clearStaleDevToolsActivePort(profilePath, { probeEndpoint: async () => false }), true);
  await assert.rejects(fs.access(activePortPath));
  setTimeout(() => fs.writeFile(activePortPath, "55111\n/devtools/browser/test\n"), 20);
  const endpoint = await waitForDevToolsEndpoint(profilePath, { timeoutMs: 1000, pollMs: 10 });
  assert.equal(endpoint.endpoint, "http://127.0.0.1:55111");

  assert.equal(classifyLinkedInPage({
    url: "https://www.linkedin.com/jobs/",
    snapshot: "Jobs My Network Messaging",
  }).status, "AUTHENTICATED");
  assert.equal(classifyLinkedInPage({
    url: "https://www.linkedin.com/login",
    snapshot: "Sign in Email Password",
  }).status, "AUTHENTICATION_REQUIRED");
  assert.equal(classifyLinkedInPage({
    url: "https://www.linkedin.com/checkpoint/challenge/123",
    snapshot: "Security verification",
  }).status, "ACCESS_CHALLENGE");
  assert.equal(classifyLinkedInPage({
    url: "https://www.linkedin.com/jobs/",
    snapshot: "Let's do a quick security check CAPTCHA",
  }).status, "CAPTCHA_DETECTED");

  const fakeTab = {
    url: () => "https://www.linkedin.com/jobs/",
    goto: async (url) => assert.equal(url, "https://www.linkedin.com/jobs/"),
    snapshot: async () => "Jobs My Network Messaging",
  };
  const preflight = await runLinkedInPreflight({
    openTab: async () => fakeTab,
  });
  assert.equal(preflight.status, "AUTHENTICATED");

  let delayedSnapshots = 0;
  const preflightWaits = [];
  const delayedPreflight = await runLinkedInPreflight({
    openTab: async () => ({
      goto: async () => {},
      url: () => "https://www.linkedin.com/jobs/",
      snapshot: async () => {
        delayedSnapshots += 1;
        return delayedSnapshots === 5 ? "Jobs My Network Messaging" : "Loading";
      },
      playwright: { waitForTimeout: async (milliseconds) => preflightWaits.push(milliseconds) },
    }),
  });
  assert.equal(delayedPreflight.status, "AUTHENTICATED");
  assert.deepEqual(preflightWaits, [1000, 2000, 3000, 4000]);

  let adapterClosed = false;
  let chromeStopped = false;
  const coordinated = await executeBrowserPreflight({
    executablePath: "chrome",
    profilePath,
  }, {
    launchChrome: async () => ({ endpoint: "http://127.0.0.1:55111", process: { kill: () => { chromeStopped = true; } } }),
    connectBrowser: async () => ({
      openTab: async () => fakeTab,
      close: async () => { adapterClosed = true; },
    }),
  });
  assert.equal(coordinated.status, "AUTHENTICATED");
  assert.equal(adapterClosed, true);
  assert.equal(chromeStopped, true);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

process.stdout.write("phase2 browser tests passed\n");
