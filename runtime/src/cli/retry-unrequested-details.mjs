#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { extractJobDetailsInParallel } from "../../../.agents/skills/discover-linkedin-job-postings/scripts/linkedin_split_pane_adapter.mjs";
import { CdpBrowserAdapter } from "../browser/cdp-browser-adapter.mjs";
import { findChromeExecutable, launchDedicatedChrome } from "../browser/chrome-launcher.mjs";
import { runLinkedInPreflight } from "../browser/linkedin-preflight.mjs";
import { validateRunId } from "../orchestration/trigger-id.mjs";

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

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await fs.rename(temporaryPath, filePath);
}

async function main(argv) {
  const args = parseArgs(argv);
  const repoRoot = path.resolve(args["repo-root"] ?? process.cwd());
  const candidateRoot = path.resolve(args["candidate-root"]);
  const sourceRunId = validateRunId(args["source-run-id"]);
  const runId = validateRunId(args["run-id"]);
  const sourceRunDir = path.join(candidateRoot, "runs", sourceRunId);
  const runDir = path.join(candidateRoot, "runs", runId);
  const checkpointPath = path.join(runDir, "browser-checkpoint.json");
  const portfolioPath = path.resolve(args["portfolio-path"] ?? path.join(candidateRoot, "query-portfolio-daily.json"));
  const policyPath = path.join(candidateRoot, "job-search-policy.json");
  const scriptsPath = path.join(repoRoot, ".agents", "skills", "discover-linkedin-job-postings", "scripts");

  try {
    await fs.access(path.join(runDir, "run-manifest.json"));
    throw new Error(`Run already materialized: ${runDir}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const sourceManifest = await readJson(path.join(sourceRunDir, "run-manifest.json"));
  const cards = sourceManifest.jobs
    .filter((job) => job.collection_status === "not_requested")
    .map((job) => ({
      job_id: String(job.job_id), title: job.title, company: job.company,
      location: job.location ?? "", canonical_url: job.canonical_url,
      source_url: job.source_url ?? job.canonical_url, query_ids: job.query_ids ?? [],
      first_level_decision: job.first_level_decision, reason_codes: job.reason_codes ?? [],
      matched_markers: job.matched_markers ?? [],
    }));
  if (cards.length === 0) throw new Error(`Source run has no not_requested jobs: ${sourceRunId}`);

  const checkpoint = {
    schema_version: "1.1", run_id: runId, captured_at: new Date().toISOString(),
    trigger: "explicit_unrequested_details_recovery", source_run_id: sourceRunId,
    cards, details: [], detail_requested_job_ids: cards.map((card) => card.job_id),
    stop_reason: null, extraction_stopped: false,
    filter_verification: { source_run: sourceRunId, status: "reused_verified_daily_filters" }, warnings: [],
  };
  await atomicWriteJson(checkpointPath, checkpoint);

  let launched;
  let browser;
  try {
    launched = await launchDedicatedChrome({
      executablePath: args.chrome ?? findChromeExecutable(),
      profilePath: args["profile-path"], startUrl: "https://www.linkedin.com/jobs/",
    });
    browser = await CdpBrowserAdapter.connect(launched.endpoint);
    const authentication = await runLinkedInPreflight(browser);
    if (authentication.status !== "AUTHENTICATED") throw new Error(`LinkedIn preflight stopped with ${authentication.status}`);

    const extraction = await extractJobDetailsInParallel(browser, cards, {
      concurrency: Number(args.concurrency ?? 5),
      onDetail: async (detail) => {
        const index = checkpoint.details.findIndex((item) => String(item.job_id) === String(detail.job_id));
        if (index >= 0) checkpoint.details[index] = detail;
        else checkpoint.details.push(detail);
        checkpoint.captured_at = new Date().toISOString();
        await atomicWriteJson(checkpointPath, checkpoint);
      },
    });
    checkpoint.stop_reason = extraction.stop_reason ?? null;
    checkpoint.extraction_stopped = Boolean(extraction.stopped);
    checkpoint.captured_at = new Date().toISOString();
    await atomicWriteJson(checkpointPath, checkpoint);

    await execFileAsync(args.python, [
      path.join(scriptsPath, "materialize_browser_checkpoint.py"), checkpointPath,
      "--portfolio", portfolioPath, "--policy", policyPath, "--cache-run", sourceRunDir,
    ], { windowsHide: true });
    const { stdout } = await execFileAsync(args.python, [
      path.join(scriptsPath, "validate_discovery_run.py"), path.join(runDir, "run-manifest.json"),
    ], { windowsHide: true });
    process.stdout.write(`${JSON.stringify({
      run_id: runId, source_run_id: sourceRunId, attempted: cards.length,
      retrieved: checkpoint.details.filter((detail) => detail.retrieval_status === "retrieved").length,
      failed: checkpoint.details.filter((detail) => detail.retrieval_status !== "retrieved").length,
      stop_reason: checkpoint.stop_reason, validation: JSON.parse(stdout.trim()),
    })}\n`);
  } finally {
    if (browser) await browser.close();
    if (launched?.process && launched.process.exitCode == null) launched.process.kill();
  }
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
