#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { RunLedger } from "../orchestration/run-ledger.mjs";
import { acquireRunLock } from "../orchestration/run-lock.mjs";
import { buildDailyRunId, buildTriggerFingerprint } from "../orchestration/trigger-id.mjs";

const execFileAsync = promisify(execFile);

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function runValidationScript({ python, validatorScript, artifacts, candidateRoot }) {
  const args = [
    validatorScript,
    "--profile", artifacts.profile,
    "--policy", artifacts.policy,
    "--portfolio", artifacts.portfolio,
    "--confirmations", artifacts.confirmations,
    "--candidate-root", candidateRoot,
  ];
  const { stdout } = await execFileAsync(python, args, { windowsHide: true });
  const result = JSON.parse(stdout.trim());
  if (!result.valid) throw new Error("Discovery inputs failed validation");
  return result;
}

export async function executeDailyPreflight(config, dependencies = {}) {
  const {
    candidateId,
    localDate,
    candidateRoot,
    artifacts,
    runtimeRoot,
    dryRun = false,
    sequence = 1,
  } = config;
  const profile = await readJson(artifacts.profile);
  const policy = await readJson(artifacts.policy);
  const portfolio = await readJson(artifacts.portfolio);
  const runId = buildDailyRunId(candidateId, localDate, sequence);
  const triggerFingerprint = buildTriggerFingerprint({
    candidateId,
    localDate,
    runProfile: portfolio.run_profile,
    profileAsOf: profile.as_of,
    policyVersion: policy.version ?? policy.policy_version ?? policy.schema_version,
    portfolio,
  });
  const ledgerPath = path.join(runtimeRoot, "runs", runId, "ledger.json");
  const lockPath = path.join(runtimeRoot, "daily.lock");
  const discoveryManifestPath = path.join(
    config.discoveryRunsRoot ?? path.join(candidateRoot, "runs"),
    runId,
    "run-manifest.json",
  );

  try {
    await fs.access(discoveryManifestPath);
    return {
      runId,
      ledgerPath,
      state: "LEGACY_RUN_PRESENT",
      dryRun,
      existingDiscoveryRun: true,
      discoveryManifestPath,
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  let existing;
  try {
    existing = await RunLedger.load(ledgerPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (existing) {
    if (existing.data.trigger_fingerprint !== triggerFingerprint) {
      throw new Error(`Existing run ${runId} has a different trigger fingerprint`);
    }
    return {
      runId,
      ledgerPath,
      state: existing.data.state,
      dryRun,
      existing: true,
    };
  }

  const lock = await acquireRunLock(lockPath, { runId });
  let ledger;
  try {
    ledger = await RunLedger.create(ledgerPath, { runId, candidateId, triggerFingerprint });
    await ledger.transition("LOCK_ACQUIRED", { recovered_stale_lock: lock.recoveredStaleLock });
    const validateInputs = dependencies.validateInputs ?? (() => runValidationScript({
      python: config.python,
      validatorScript: config.validatorScript,
      artifacts,
      candidateRoot,
    }));
    const validation = await validateInputs();
    if (!validation?.valid) {
      await ledger.transition("INPUT_INVALID", { validation });
      return { runId, ledgerPath, state: ledger.data.state, dryRun };
    }
    await ledger.transition("INPUT_VALIDATED", { validation });
    return {
      runId,
      ledgerPath,
      state: ledger.data.state,
      dryRun,
      triggerFingerprint,
      validation,
    };
  } finally {
    await lock.release();
  }
}

function parseArgs(argv) {
  const values = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--dry-run") {
      values.dryRun = true;
      continue;
    }
    if (!key?.startsWith("--") || argv[index + 1] == null) throw new Error(`Invalid argument: ${key ?? "<missing>"}`);
    values[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return values;
}

async function main(argv) {
  const args = parseArgs(argv);
  const candidateRoot = path.resolve(args["candidate-root"]);
  const repoRoot = path.resolve(args["repo-root"] ?? process.cwd());
  const result = await executeDailyPreflight({
    candidateId: args.candidate,
    localDate: args.date,
    candidateRoot,
    runtimeRoot: path.join(candidateRoot, "runtime"),
    dryRun: args.dryRun,
    python: args.python,
    validatorScript: path.join(
      repoRoot,
      ".agents",
      "skills",
      "discover-linkedin-job-postings",
      "scripts",
      "validate_discovery_inputs.py",
    ),
    artifacts: {
      profile: path.join(candidateRoot, "candidate-profile.json"),
      policy: path.join(candidateRoot, "job-search-policy.json"),
      confirmations: path.join(candidateRoot, "candidate-confirmations.json"),
      portfolio: path.join(candidateRoot, "query-portfolio-daily.json"),
    },
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.state === "INPUT_INVALID") process.exitCode = 30;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 50;
  });
}
