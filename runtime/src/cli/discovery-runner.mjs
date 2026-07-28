#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { CdpBrowserAdapter } from "../browser/cdp-browser-adapter.mjs";
import { findChromeExecutable, launchDedicatedChrome } from "../browser/chrome-launcher.mjs";
import { runLinkedInPreflight } from "../browser/linkedin-preflight.mjs";
import { runDiscoveryPhase3 } from "../pipeline/discovery-stage.mjs";
import { validateRunId } from "../orchestration/trigger-id.mjs";
import { runValidationScript } from "./daily-runner.mjs";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] == null) throw new Error(`Invalid argument: ${argv[index]}`);
    values[argv[index].slice(2)] = argv[index + 1];
  }
  return values;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function main(argv) {
  const args = parseArgs(argv);
  const repoRoot = path.resolve(args["repo-root"] ?? process.cwd());
  const candidateRoot = path.resolve(args["candidate-root"]);
  const runId = validateRunId(args["run-id"]);
  const runDir = path.join(candidateRoot, "runs", runId);
  const artifacts = {
    profile: path.join(candidateRoot, "candidate-profile.json"),
    policy: path.join(candidateRoot, "job-search-policy.json"),
    confirmations: path.join(candidateRoot, "candidate-confirmations.json"),
    portfolio: path.join(candidateRoot, "query-portfolio-daily.json"),
  };
  const skillScripts = path.join(repoRoot, ".agents", "skills", "discover-linkedin-job-postings", "scripts");
  await runValidationScript({
    python: args.python,
    validatorScript: path.join(skillScripts, "validate_discovery_inputs.py"),
    artifacts,
    candidateRoot,
  });
  try {
    await fs.access(path.join(runDir, "run-manifest.json"));
    throw new Error(`Run already materialized: ${runDir}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.mkdir(runDir, { recursive: true });

  let launched;
  let browser;
  try {
    launched = await launchDedicatedChrome({
      executablePath: args.chrome ?? findChromeExecutable(),
      profilePath: args["profile-path"],
      startUrl: "https://www.linkedin.com/jobs/",
    });
    browser = await CdpBrowserAdapter.connect(launched.endpoint);
    const authentication = await runLinkedInPreflight(browser);
    if (authentication.status !== "AUTHENTICATED") {
      throw new Error(`LinkedIn preflight stopped with ${authentication.status}`);
    }
    const result = await runDiscoveryPhase3({
      runId,
      checkpointPath: path.join(runDir, "browser-checkpoint.json"),
      portfolio: await readJson(artifacts.portfolio),
      policy: await readJson(artifacts.policy),
      browser,
      budgets: {
        maxQueries: Number(args["max-queries"] ?? 5),
        maxCardsPerQuery: Number(args["max-cards"] ?? 25),
        maxUniqueJobs: Number(args["max-unique-jobs"] ?? 60),
        maxDetailJobs: Number(args["max-details"] ?? 30),
        detailConcurrency: Number(args["detail-concurrency"] ?? 5),
      },
    });
    await execFileAsync(args.python, [
      path.join(skillScripts, "materialize_browser_checkpoint.py"),
      path.join(runDir, "browser-checkpoint.json"),
      "--portfolio", artifacts.portfolio,
      "--policy", artifacts.policy,
      "--cache-run", path.resolve(args["cache-run"]),
    ], { windowsHide: true });
    const { stdout } = await execFileAsync(args.python, [
      path.join(skillScripts, "validate_discovery_run.py"),
      path.join(runDir, "run-manifest.json"),
    ], { windowsHide: true });
    process.stdout.write(`${JSON.stringify({ ...result, validation: JSON.parse(stdout.trim()), next_phase: "SCREENING_NOT_RUN" })}\n`);
  } finally {
    if (browser) await browser.close();
    if (launched?.process && launched.process.exitCode == null) launched.process.kill();
  }
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
