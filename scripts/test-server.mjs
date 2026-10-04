import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

/** An isolated, no-cache loopback origin; never contacts or changes the live site. */
export async function startTestServer(root) {
  const directory = path.resolve(root);
  const server = createServer(async (request, response) => {
    try {
      if (!["GET", "HEAD"].includes(request.method)) {
        response.writeHead(405).end();
        return;
      }
      let pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname === "/") pathname = "/index.html";
      if (pathname === "/editor" || pathname === "/editor/") pathname = "/editor.html";
      const filename = path.resolve(directory, `.${pathname}`);
      if (!filename.startsWith(`${directory}${path.sep}`) || pathname.split("/").some((part) => part.startsWith("."))) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(filename);
      response.writeHead(200, {
        "Content-Type": mimeTypes[path.extname(filename)] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}
