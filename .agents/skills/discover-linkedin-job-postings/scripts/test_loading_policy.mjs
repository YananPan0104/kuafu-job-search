#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  LOAD_CHECK_SCHEDULE_MS,
  MAX_LOAD_WAIT_MS,
  pollUntilLoaded,
} from "./loading_policy.mjs";

assert.equal(MAX_LOAD_WAIT_MS, 10_000);
assert.equal(LOAD_CHECK_SCHEDULE_MS.reduce((sum, value) => sum + value, 0), MAX_LOAD_WAIT_MS);

const waits = [];
let attempts = 0;
const loaded = await pollUntilLoaded({
  check: async () => {
    attempts += 1;
    return attempts === 5 ? "ready" : null;
  },
  wait: async (milliseconds) => waits.push(milliseconds),
});
assert.equal(loaded.value, "ready");
assert.equal(loaded.elapsed_ms, 10_000);
assert.deepEqual(waits, [1000, 2000, 3000, 4000]);

const exhausted = await pollUntilLoaded({
  check: async () => false,
  wait: async () => {},
});
assert.equal(exhausted.loaded, false);
assert.equal(exhausted.elapsed_ms, 10_000);
assert.equal(exhausted.attempts, 5);

process.stdout.write("loading policy tests passed\n");
