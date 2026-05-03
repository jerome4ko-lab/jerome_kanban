import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiHandler } from "./server/api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "dist");
const port = Number(process.env.PORT || 4173);
const handleApiRequest = createApiHandler();

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const normalizedPath = path
    .normalize(decodedPath)
    .replace(/^(\.\.[/\\])+/, "");
  const requestedPath = path.join(
    distDir,
    normalizedPath === "/" ? "index.html" : normalizedPath,
  );
  const filePath =
    existsSync(requestedPath) && !requestedPath.endsWith(path.sep)
      ? requestedPath
      : path.join(distDir, "index.html");
  const extension = path.extname(filePath);

  if (!filePath.startsWith(distDir)) {
    sendJson(res, 403, { error: "허용되지 않은 경로입니다." });
    return;
  }

  try {
    res.writeHead(200, {
      "content-type": mimeTypes[extension] || "application/octet-stream",
      "cache-control":
        extension === ".html"
          ? "no-cache"
          : "public, max-age=31536000, immutable",
    });
    createReadStream(filePath).pipe(res);
  } catch {
    const indexHtml = await readFile(path.join(distDir, "index.html"), "utf8");
    res.writeHead(200, { "content-type": mimeTypes[".html"] });
    res.end(indexHtml);
  }
}

createServer(async (req, res) => {
  if (await handleApiRequest(req, res)) {
    return;
  }

  serveStatic(req, res);
}).listen(port, "0.0.0.0", () => {
  console.log(`AI study dashboard listening on port ${port}`);
});
