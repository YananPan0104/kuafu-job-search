import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export async function acquireRunLock(lockPath, options) {
  const {
    runId,
    pid = process.pid,
    now = () => new Date(),
    isProcessAlive = defaultIsProcessAlive,
  } = options;
  const token = randomUUID();
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  let recoveredStaleLock = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const timestamp = now().toISOString();
    const record = {
      schema_version: "1.0",
      run_id: runId,
      pid,
      host: os.hostname(),
      token,
      started_at: timestamp,
      heartbeat_at: timestamp,
    };
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      await handle.close();
      return {
        record,
        recoveredStaleLock,
        async release() {
          try {
            const current = JSON.parse(await fs.readFile(lockPath, "utf8"));
            if (current.token === token) await fs.unlink(lockPath);
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const current = JSON.parse(await fs.readFile(lockPath, "utf8"));
      if (isProcessAlive(Number(current.pid))) {
        throw new Error(`Cannot start ${runId}: active run lock belongs to ${current.run_id}`);
      }
      const stalePath = `${lockPath}.stale-${Date.now()}`;
      await fs.rename(lockPath, stalePath);
      recoveredStaleLock = true;
    }
  }
  throw new Error(`Unable to acquire run lock: ${lockPath}`);
}
