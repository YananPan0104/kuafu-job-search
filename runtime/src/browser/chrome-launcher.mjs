import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { MAX_LOAD_WAIT_MS } from "../../../.agents/skills/discover-linkedin-job-postings/scripts/loading_policy.mjs";

export function findChromeExecutable(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const existsSync = options.existsSync ?? fsSync.existsSync;
  const candidates = platform === "win32"
    ? [
        env.PROGRAMFILES && path.win32.join(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
        env["PROGRAMFILES(X86)"] && path.win32.join(env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
        env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
      ]
    : platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const resolved = candidates.filter(Boolean).find((candidate) => existsSync(candidate));
  if (!resolved) throw new Error(`Google Chrome executable not found for ${platform}`);
  return resolved;
}

export function buildChromeLaunchSpec({ executablePath, profilePath, startUrl = "https://www.linkedin.com/jobs/" }) {
  if (!executablePath) throw new Error("executablePath is required");
  if (!profilePath) throw new Error("A dedicated profilePath is required");
  const resolvedProfile = path.resolve(profilePath);
  return {
    command: executablePath,
    profilePath: resolvedProfile,
    args: [
      `--user-data-dir=${resolvedProfile}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      startUrl,
    ],
  };
}

export function parseDevToolsActivePort(contents) {
  const [portLine, browserPath] = String(contents).trim().split(/\r?\n/);
  const port = Number(portLine);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !browserPath?.startsWith("/")) {
    throw new Error("Invalid DevToolsActivePort contents");
  }
  return { port, browserPath, endpoint: `http://127.0.0.1:${port}` };
}

export async function waitForDevToolsEndpoint(profilePath, options = {}) {
  const timeoutMs = options.timeoutMs ?? MAX_LOAD_WAIT_MS;
  const pollMs = options.pollMs ?? 100;
  const activePortPath = path.join(path.resolve(profilePath), "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return parseDevToolsActivePort(await fs.readFile(activePortPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT" && !/DevToolsActivePort/.test(error?.message ?? "")) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Chrome did not publish DevToolsActivePort within ${timeoutMs} ms`);
}

async function defaultProbeEndpoint(endpoint) {
  try {
    const response = await fetch(`${endpoint}/json/version`, {
      signal: AbortSignal.timeout(MAX_LOAD_WAIT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function clearStaleDevToolsActivePort(profilePath, options = {}) {
  const activePortPath = path.join(path.resolve(profilePath), "DevToolsActivePort");
  try {
    const contents = await fs.readFile(activePortPath, "utf8");
    try {
      const { endpoint } = parseDevToolsActivePort(contents);
      const probeEndpoint = options.probeEndpoint ?? defaultProbeEndpoint;
      if (await probeEndpoint(endpoint)) {
        throw new Error(`PROFILE_LOCKED: dedicated Chrome is already running at ${endpoint}`);
      }
    } catch (error) {
      if (/PROFILE_LOCKED/.test(error?.message ?? "")) throw error;
    }
    await fs.unlink(activePortPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function launchDedicatedChrome(options) {
  const spec = buildChromeLaunchSpec(options);
  await fs.mkdir(spec.profilePath, { recursive: true });
  await clearStaleDevToolsActivePort(spec.profilePath);
  const child = spawn(spec.command, spec.args, {
    stdio: "ignore",
    windowsHide: true,
  });
  child.once("error", () => {});
  const devtools = await waitForDevToolsEndpoint(spec.profilePath, options);
  return {
    ...spec,
    ...devtools,
    pid: child.pid,
    process: child,
  };
}
