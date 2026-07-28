#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildDailyRunId, buildTriggerFingerprint, validateRunId } from "../src/orchestration/trigger-id.mjs";
import { RunLedger } from "../src/orchestration/run-ledger.mjs";
import { acquireRunLock } from "../src/orchestration/run-lock.mjs";
import { DailyStateMachine } from "../src/orchestration/daily-state-machine.mjs";
import { executeDailyPreflight } from "../src/cli/daily-runner.mjs";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kuafu-phase1-"));

try {
  assert.equal(buildDailyRunId("yanan-pan", "2026-07-29", 1), "2026-07-29-daily-01");
  assert.equal(buildDailyRunId("yanan-pan", "2026-07-29", 12), "2026-07-29-daily-12");
  assert.throws(() => buildDailyRunId("yanan-pan", "29-07-2026", 1), /YYYY-MM-DD/);
  assert.equal(validateRunId("2026-07-29-daily-01"), "2026-07-29-daily-01");
  assert.throws(() => validateRunId("../../outside"), /safe filename/);

  const fingerprintA = buildTriggerFingerprint({
    candidateId: "yanan-pan",
    localDate: "2026-07-29",
    runProfile: "daily",
    profileAsOf: "2026-07-28",
    policyVersion: "1.0",
    portfolio: { queries: [{ query_id: "Q1", status: "active" }] },
  });
  const fingerprintB = buildTriggerFingerprint({
    portfolio: { queries: [{ status: "active", query_id: "Q1" }] },
    policyVersion: "1.0",
    profileAsOf: "2026-07-28",
    runProfile: "daily",
    localDate: "2026-07-29",
    candidateId: "yanan-pan",
  });
  assert.equal(fingerprintA, fingerprintB);
  assert.match(fingerprintA, /^[a-f0-9]{64}$/);

  const ledgerPath = path.join(tempRoot, "ledger.json");
  const ledger = await RunLedger.create(ledgerPath, {
    runId: "2026-07-29-daily-01",
    candidateId: "yanan-pan",
    triggerFingerprint: fingerprintA,
  });
  await ledger.transition("LOCK_ACQUIRED");
  await ledger.transition("INPUT_VALIDATED", { activeQueries: 5 });
  const reloaded = await RunLedger.load(ledgerPath);
  assert.equal(reloaded.data.state, "INPUT_VALIDATED");
  assert.equal(reloaded.data.history.at(-1).details.activeQueries, 5);
  await assert.rejects(() => reloaded.transition("COMPLETED"), /Invalid transition/);

  const machine = new DailyStateMachine("TRIGGERED");
  assert.equal(machine.transition("LOCK_ACQUIRED"), "LOCK_ACQUIRED");
  assert.equal(machine.transition("INPUT_VALIDATED"), "INPUT_VALIDATED");
  assert.throws(() => machine.transition("COMPLETED"), /Invalid transition/);

  const lockPath = path.join(tempRoot, "daily.lock");
  const lock = await acquireRunLock(lockPath, {
    runId: "2026-07-29-daily-01",
    pid: process.pid,
    now: () => new Date("2026-07-29T05:30:00.000Z"),
  });
  await assert.rejects(
    acquireRunLock(lockPath, {
      runId: "2026-07-29-daily-02",
      pid: process.pid,
      isProcessAlive: () => true,
    }),
    /active run lock/,
  );
  await lock.release();
  await assert.rejects(fs.access(lockPath));

  await fs.writeFile(lockPath, JSON.stringify({
    run_id: "stale-run",
    pid: 999999,
    heartbeat_at: "2026-07-28T00:00:00.000Z",
  }));
  const recovered = await acquireRunLock(lockPath, {
    runId: "2026-07-29-daily-01",
    pid: process.pid,
    isProcessAlive: () => false,
    now: () => new Date("2026-07-29T05:30:00.000Z"),
  });
  assert.equal(recovered.recoveredStaleLock, true);
  await recovered.release();

  const candidateRoot = path.join(tempRoot, "candidate");
  await fs.mkdir(candidateRoot, { recursive: true });
  const artifacts = {
    profile: path.join(candidateRoot, "candidate-profile.json"),
    policy: path.join(candidateRoot, "job-search-policy.json"),
    confirmations: path.join(candidateRoot, "candidate-confirmations.json"),
    portfolio: path.join(candidateRoot, "query-portfolio-daily.json"),
  };
  await fs.writeFile(artifacts.profile, JSON.stringify({ candidate_id: "yanan-pan", as_of: "2026-07-28" }));
  await fs.writeFile(artifacts.policy, JSON.stringify({ candidate_id: "yanan-pan", status: "confirmed", version: "1.0" }));
  await fs.writeFile(artifacts.confirmations, JSON.stringify({ candidate_id: "yanan-pan", confirmations: [] }));
  await fs.writeFile(artifacts.portfolio, JSON.stringify({
    candidate_id: "yanan-pan",
    run_profile: "daily",
    queries: [{ query_id: "Q1", status: "active" }],
  }));
  let validatorCalls = 0;
  const preflight = await executeDailyPreflight({
    candidateId: "yanan-pan",
    localDate: "2026-07-29",
    candidateRoot,
    artifacts,
    runtimeRoot: path.join(candidateRoot, "runtime"),
    dryRun: true,
  }, {
    validateInputs: async () => {
      validatorCalls += 1;
      return { valid: true, active_queries: 1 };
    },
  });
  assert.equal(validatorCalls, 1);
  assert.equal(preflight.state, "INPUT_VALIDATED");
  assert.equal(preflight.runId, "2026-07-29-daily-01");
  assert.equal(preflight.dryRun, true);
  await assert.rejects(fs.access(path.join(candidateRoot, "runtime", "daily.lock")));
  const persistedPreflight = JSON.parse(await fs.readFile(preflight.ledgerPath, "utf8"));
  assert.equal(persistedPreflight.state, "INPUT_VALIDATED");

  const legacyCandidateRoot = path.join(tempRoot, "legacy-candidate");
  const legacyRunRoot = path.join(legacyCandidateRoot, "runs", "2026-07-29-daily-01");
  await fs.mkdir(legacyRunRoot, { recursive: true });
  await fs.writeFile(path.join(legacyRunRoot, "run-manifest.json"), JSON.stringify({
    run_id: "2026-07-29-daily-01",
    trigger: { type: "manual", id: "2026-07-29-daily-01" },
  }));
  const legacyResult = await executeDailyPreflight({
    candidateId: "yanan-pan",
    localDate: "2026-07-29",
    candidateRoot: legacyCandidateRoot,
    artifacts,
    runtimeRoot: path.join(legacyCandidateRoot, "runtime"),
    dryRun: true,
  }, {
    validateInputs: async () => { throw new Error("validator must not run for a legacy run"); },
  });
  assert.equal(legacyResult.state, "LEGACY_RUN_PRESENT");
  assert.equal(legacyResult.existingDiscoveryRun, true);
  await assert.rejects(fs.access(legacyResult.ledgerPath));
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

process.stdout.write("phase1 runner tests passed\n");
