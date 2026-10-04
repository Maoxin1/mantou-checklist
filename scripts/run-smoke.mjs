import { spawn } from "node:child_process";
import path from "node:path";
import { startTestServer } from "./test-server.mjs";

const project = path.resolve(import.meta.dirname, "..");
const server = await startTestServer(path.join(project, "dist"));
try {
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(project, "scripts/smoke.mjs")], {
      cwd: project, stdio: "inherit", env: { ...process.env, CHECKLIST_BASE_URL: server.url }
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await server.close();
}
