import { createHash } from "node:crypto";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function buildDailyRunId(candidateId, localDate, sequence = 1) {
  if (!candidateId) throw new Error("candidateId is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    throw new Error("localDate must use YYYY-MM-DD format");
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 99) {
    throw new Error("sequence must be an integer between 1 and 99");
  }
  return `${localDate}-daily-${String(sequence).padStart(2, "0")}`;
}

export function buildTriggerFingerprint(trigger) {
  const payload = JSON.stringify(canonicalize(trigger));
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function validateRunId(runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(String(runId ?? ""))) {
    throw new Error("runId must be a safe filename containing only letters, digits, underscores, and hyphens");
  }
  return runId;
}
