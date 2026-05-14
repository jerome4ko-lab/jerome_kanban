import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
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
  ".mp3": "audio/mpeg",
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
    const fileStat = await stat(filePath);
    const fileSize = fileStat.size;
    const contentType = mimeTypes[extension] || "application/octet-stream";
    const cacheControl =
      extension === ".html"
        ? "no-cache"
        : "public, max-age=31536000, immutable";

    const rangeHeader = req.headers.range;
    const rangeMatch = rangeHeader && /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (rangeMatch) {
      const startStr = rangeMatch[1];
      const endStr = rangeMatch[2];
      let start = startStr === "" ? NaN : Number(startStr);
      let end = endStr === "" ? NaN : Number(endStr);
      if (Number.isNaN(start) && !Number.isNaN(end)) {
        // suffix range: bytes=-N → last N bytes
        start = Math.max(0, fileSize - end);
        end = fileSize - 1;
      } else if (!Number.isNaN(start) && Number.isNaN(end)) {
        end = fileSize - 1;
      }
      if (
        Number.isNaN(start) ||
        Number.isNaN(end) ||
        start > end ||
        start >= fileSize
      ) {
        res.writeHead(416, {
          "content-range": `bytes */${fileSize}`,
          "accept-ranges": "bytes",
        });
        res.end();
        return;
      }
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        "content-type": contentType,
        "content-range": `bytes ${start}-${end}/${fileSize}`,
        "accept-ranges": "bytes",
        "content-length": chunkSize,
        "cache-control": cacheControl,
      });
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      "content-type": contentType,
      "content-length": fileSize,
      "accept-ranges": "bytes",
      "cache-control": cacheControl,
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
