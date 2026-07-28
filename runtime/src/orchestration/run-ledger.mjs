import fs from "node:fs/promises";
import path from "node:path";
import { DailyStateMachine } from "./daily-state-machine.mjs";

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await fs.rename(tempPath, filePath);
}

export class RunLedger {
  constructor(filePath, data, now = () => new Date()) {
    this.filePath = filePath;
    this.data = data;
    this.now = now;
    this.machine = new DailyStateMachine(data.state);
  }

  static async create(filePath, { runId, candidateId, triggerFingerprint }, options = {}) {
    const now = options.now ?? (() => new Date());
    const timestamp = now().toISOString();
    const data = {
      schema_version: "1.0",
      run_id: runId,
      candidate_id: candidateId,
      trigger_fingerprint: triggerFingerprint,
      state: "TRIGGERED",
      created_at: timestamp,
      updated_at: timestamp,
      history: [{ state: "TRIGGERED", at: timestamp, details: {} }],
    };
    await atomicWriteJson(filePath, data);
    return new RunLedger(filePath, data, now);
  }

  static async load(filePath, options = {}) {
    const data = JSON.parse(await fs.readFile(filePath, "utf8"));
    return new RunLedger(filePath, data, options.now ?? (() => new Date()));
  }

  async transition(nextState, details = {}) {
    this.machine.transition(nextState);
    const timestamp = this.now().toISOString();
    this.data.state = nextState;
    this.data.updated_at = timestamp;
    this.data.history.push({ state: nextState, at: timestamp, details });
    await atomicWriteJson(this.filePath, this.data);
    return nextState;
  }
}
