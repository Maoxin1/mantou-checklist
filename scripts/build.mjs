import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const projectDir = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(projectDir, "dist");
if (path.dirname(outputDir) !== projectDir || path.basename(outputDir) !== "dist") {
  throw new Error("Refusing to clean an unexpected build directory");
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const files = [
  "index.html",
  "editor.html",
  "styles.css",
  "editor.css",
  "app.js",
  "editor.js",
  "sw.js",
  "config.json",
  "manifest.webmanifest",
  "editor.webmanifest",
  "_headers"
];

for (const file of files) {
  await cp(path.join(projectDir, file), path.join(outputDir, file));
}
await cp(path.join(projectDir, "icons"), path.join(outputDir, "icons"), { recursive: true });

console.log(`Built ${files.length} files and icons into ${outputDir}`);
