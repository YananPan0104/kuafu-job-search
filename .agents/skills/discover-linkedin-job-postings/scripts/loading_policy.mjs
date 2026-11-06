export const MAX_LOAD_WAIT_MS = 10_000;
export const LOAD_CHECK_SCHEDULE_MS = Object.freeze([1000, 2000, 3000, 4000]);

export async function pollUntilLoaded({
  check,
  wait,
  scheduleMs = LOAD_CHECK_SCHEDULE_MS,
} = {}) {
  if (typeof check !== "function" || typeof wait !== "function") {
    throw new Error("check and wait functions are required");
  }
  const total = scheduleMs.reduce((sum, value) => sum + value, 0);
  if (total > MAX_LOAD_WAIT_MS) {
    throw new Error(`load check schedule exceeds ${MAX_LOAD_WAIT_MS} ms`);
  }
  let attempts = 1;
  let elapsedMs = 0;
  let value = await check();
  if (value) return { loaded: true, value, attempts, elapsed_ms: elapsedMs };
  for (const delayMs of scheduleMs) {
    await wait(delayMs);
    elapsedMs += delayMs;
    attempts += 1;
    value = await check();
    if (value) return { loaded: true, value, attempts, elapsed_ms: elapsedMs };
  }
  return { loaded: false, value: null, attempts, elapsed_ms: elapsedMs };
}
