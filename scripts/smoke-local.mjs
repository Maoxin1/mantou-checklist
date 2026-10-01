import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

const projectDir = path.resolve(import.meta.dirname, "..");
const port = Number(process.env.CHECKLIST_LOCAL_PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid CHECKLIST_LOCAL_PORT");
const baseUrl = `http://127.0.0.1:${port}`;
let occupied = false;
try {
  await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) });
  occupied = true;
} catch { /* No existing preview on this port. */ }
if (occupied) throw new Error(`Preview port ${port} is already in use`);
const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
const server = spawn(process.execPath, [
  path.join(projectDir, "node_modules/wrangler/bin/wrangler.js"),
  "pages", "dev", "dist", "--ip", "127.0.0.1", "--port", String(port),
  "--compatibility-date", "2026-10-01"
], { cwd: projectDir, env, stdio: "inherit" });
let serverError;
server.on("error", (error) => { serverError = error; });

try {
  const deadline = Date.now() + 45_000;
  while (true) {
    if (serverError) throw serverError;
    if (server.exitCode !== null) throw new Error(`Preview exited with code ${server.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/editor`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) break;
    } catch { /* Retry while Wrangler starts. */ }
    if (Date.now() >= deadline) throw new Error("Local preview did not start within 45 seconds");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const smoke = spawn(process.execPath, [path.join(projectDir, "scripts/smoke.mjs")], {
    cwd: projectDir, env: { ...env, CHECKLIST_BASE_URL: baseUrl }, stdio: "inherit"
  });
  const [code, signal] = await once(smoke, "exit");
  if (code !== 0) throw new Error(`Browser smoke failed (${signal || code})`);
} finally {
  if (server.exitCode === null && !serverError) {
    const stopped = once(server, "exit");
    server.kill("SIGTERM");
    const timer = setTimeout(() => server.kill("SIGKILL"), 5_000);
    try { await stopped; } finally { clearTimeout(timer); }
  }
}
