#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { CdpBrowserAdapter } from "../browser/cdp-browser-adapter.mjs";
import { findChromeExecutable, launchDedicatedChrome } from "../browser/chrome-launcher.mjs";
import { runLinkedInPreflight } from "../browser/linkedin-preflight.mjs";

export async function executeBrowserPreflight(config, dependencies = {}) {
  const launchChrome = dependencies.launchChrome ?? launchDedicatedChrome;
  const connectBrowser = dependencies.connectBrowser ?? ((endpoint) => CdpBrowserAdapter.connect(endpoint));
  let launched;
  let adapter;
  try {
    launched = await launchChrome(config);
    adapter = await connectBrowser(launched.endpoint);
    const result = await runLinkedInPreflight(adapter, { jobsUrl: config.startUrl });
    return {
      ...result,
      endpoint_host: "127.0.0.1",
      profile_path: launched.profilePath ?? config.profilePath,
    };
  } finally {
    if (adapter) await adapter.close();
    if (launched?.process && launched.process.exitCode == null) {
      launched.process.kill();
    }
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument: ${key ?? "<missing>"}`);
    values[key.slice(2)] = value;
  }
  return values;
}

async function main(argv) {
  const args = parseArgs(argv);
  const result = await executeBrowserPreflight({
    executablePath: args.chrome ?? findChromeExecutable(),
    profilePath: args["profile-path"],
    startUrl: args.url ?? "https://www.linkedin.com/jobs/",
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "AUTHENTICATED") process.exitCode = 10;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 40;
  });
}
