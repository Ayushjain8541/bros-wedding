import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// The resettable test database must never be a hosted or production target.
function testDatabase(value = process.env.TEST_DATABASE_URL) {
  try {
    const url = new URL(value ?? "");
    const database = decodeURIComponent(url.pathname.slice(1));
    if (!["postgres:", "postgresql:"].includes(url.protocol)
      || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || !/(^|[_-])test([_-]|$)/i.test(database)
      || url.search || url.hash) throw new Error();
    return url.toString();
  } catch {
    throw new Error("TEST_DATABASE_URL must target a dedicated loopback test database");
  }
}

let server;
let tests;
let stopping = false;
let lockPath;
function releaseLock() {
  if (lockPath) { unlinkSync(lockPath); lockPath = undefined; }
}
async function waitForExit(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(4000)]);
}
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  tests?.kill(signal);
  server?.kill(signal);
  // Bounded cleanup even if a dev server ignores SIGTERM.
  const timer = setTimeout(() => { tests?.kill("SIGKILL"); server?.kill("SIGKILL"); }, 3000);
  timer.unref();
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { process.exitCode = signal === "SIGINT" ? 130 : 143; stop(signal); });
}
process.on("exit", () => { stop(); releaseLock(); });

try {
  const database = testDatabase();
  const adminDatabase = process.env.TEST_DATABASE_ADMIN_URL ? testDatabase(process.env.TEST_DATABASE_ADMIN_URL) : "";
  const target = new URL(database);
  if (adminDatabase) {
    const admin = new URL(adminDatabase);
    if (admin.host !== target.host || admin.pathname !== target.pathname) throw new Error("Test admin and restricted database targets must match");
  }
  const identity = `${target.host}${target.pathname}`;
  const candidate = `node_modules/.cache/wedding-tests/${createHash("sha256").update(identity).digest("hex")}.lock`;
  mkdirSync(dirname(candidate), { recursive: true });
  if (existsSync(candidate)) {
    const pid = Number(readFileSync(candidate, "utf8"));
    let active = true;
    try { process.kill(pid, 0); } catch (error) { if (error.code === "ESRCH") active = false; }
    if (active) throw new Error("Another test suite is using this database");
    unlinkSync(candidate);
  }
  const lock = openSync(candidate, "wx");
  lockPath = candidate;
  writeFileSync(lock, String(process.pid));
  closeSync(lock);
  const { default: postgres } = await import("postgres");
  const db = postgres(database, { max: 1, connect_timeout: 5 });
  try { await db`SELECT 1`; }
  catch { throw new Error("Local test database is unavailable; start the local test stack first"); }
  finally { await db.end({ timeout: 1 }); }
  const e2e = process.argv.includes("--serve-e2e");
  const port = e2e ? 3200 : 3100;
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, DATABASE_URL: database, DATABASE_ADMIN_URL: adminDatabase, APP_ORIGIN: origin, TEST_APP_ORIGIN: origin };
  // Refuse occupied ports so readiness cannot mistake another server for ours.
  const { createServer } = await import("node:net");
  await new Promise((resolve, reject) => {
    const check = createServer();
    check.once("error", reject);
    check.listen(port, "127.0.0.1", () => check.close(resolve));
  });
  server = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)), "dev", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: "inherit" });
  let serverExited = false;
  server.once("exit", () => { serverExited = true; });
  server.once("error", () => { serverExited = true; });
  let ready = false;
  for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
    if (serverExited) throw new Error("Local test server exited before readiness");
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).ok === true) { ready = true; break; }
    } catch { /* The server is still starting. */ }
    await delay(500);
  }
  if (!ready) throw new Error("Local test server did not become ready");
  if (e2e) {
    await new Promise(resolve => server.once("exit", resolve));
    if (!stopping) process.exitCode = 1;
  } else {
    tests = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)), "run", "--config", "vitest.integration.config.ts", ...process.argv.slice(2)], { env, stdio: "inherit" });
    process.exitCode = await new Promise(resolve => {
      tests.once("error", () => resolve(1));
      tests.once("exit", code => resolve(code ?? 1));
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local test runner failed");
  process.exitCode = 1;
} finally {
  stop();
  await Promise.all([waitForExit(tests), waitForExit(server)]);
  releaseLock();
}
