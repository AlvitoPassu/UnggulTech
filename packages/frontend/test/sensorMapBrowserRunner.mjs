// Run the local browser fixture with installed Chromium. No production API or DB.
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const runs = Number(process.argv.find((arg) => arg.startsWith("--runs="))?.split("=")[1] || 1);
if (!Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error("--runs must be between 1 and 5");
const port = Number(process.env.SENSOR_MAP_TEST_PORT || 5182);
const origin = `http://127.0.0.1:${port}`;
const candidates = [process.env.SENSOR_MAP_TEST_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean);
let executable;
for (const candidate of candidates) {
  try { await access(candidate); executable = candidate; break; } catch { /* Try next installed browser. */ }
}
if (!executable) throw new Error("Set SENSOR_MAP_TEST_BROWSER to an installed Chromium executable");

const server = spawn(process.execPath, [fileURLToPath(new URL("./sensorMapBrowserServer.mjs", import.meta.url))], {
  env: { ...process.env, SENSOR_MAP_TEST_PORT: String(port) }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
});
let browser;
const profiles = [];
try {
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error("Fixture server startup timed out")), 20_000);
    server.once("error", (error) => { clearTimeout(timer); reject(error); });
    server.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Fixture server exited: ${code}`)); });
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes("LOCAL TEST FIXTURE ONLY")) { clearTimeout(timer); resolveReady(); }
    });
  });
  for (let run = 1; run <= runs; run++) {
    // Clear only the report: deliberately leave the previous polling state dirty.
    await fetch(`${origin}/__test__/results`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "null" });
    const profile = await mkdtemp(join(tmpdir(), "unggul-sensor-browser-"));
    profiles.push(profile);
    browser = spawn(executable, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
      `--user-data-dir=${profile}`, `${origin}/test/sensor-map-browser.html`], { windowsHide: true, stdio: "ignore" });
    let launchError;
    browser.once("error", (error) => { launchError = error; });
    const deadline = Date.now() + 180_000;
    let result;
    while (!result && Date.now() < deadline) {
      if (launchError) throw launchError;
      if (browser.exitCode !== null) throw new Error(`Browser exited before reporting: ${browser.exitCode}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      result = await (await fetch(`${origin}/__test__/results`)).json();
    }
    if (!result) throw new Error("Browser fixture did not finish within 180 seconds");
    console.log(`Run ${run}/${runs}: ${result.outcomes.length - result.failures}/${result.outcomes.length} passed (real 30s polling)`);
    for (const outcome of result.outcomes) console.log(`${outcome.passed ? "PASS" : "FAIL"} ${outcome.name}${outcome.error ? `: ${outcome.error}` : ""}`);
    if (result.failures) throw new Error(`${result.failures} browser tests failed`);
    browser.kill();
    await new Promise((resolveExit) => browser.exitCode !== null ? resolveExit() : browser.once("exit", resolveExit));
    browser = null;
    // Windows may keep Chromium child processes alive briefly; cleanup in finally.
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  browser?.kill();
  server.kill();
  for (const profile of profiles) {
    const target = resolve(profile);
    const tempRoot = resolve(tmpdir()) + sep;
    if (target.startsWith(tempRoot) && target.slice(tempRoot.length).startsWith("unggul-sensor-browser-")) {
      await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
    }
  }
}
