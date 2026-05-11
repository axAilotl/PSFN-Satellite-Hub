import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const studioDir = path.join(rootDir, "dist", "device-studio");
const host = process.env.DEVICE_STUDIO_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.DEVICE_STUDIO_PORT || process.env.PORT || "8790", 10);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function send(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(body);
}

function resolveRequestPath(urlPathname) {
  const normalizedPath = decodeURIComponent(urlPathname) === "/"
    ? "/index.html"
    : decodeURIComponent(urlPathname);
  const candidate = path.normalize(path.join(studioDir, normalizedPath));
  if (!candidate.startsWith(`${studioDir}${path.sep}`)) {
    return undefined;
  }
  return candidate;
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    send(res, 400, "Bad request");
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  const filePath = resolveRequestPath(requestUrl.pathname);
  if (!filePath) {
    send(res, 403, "Forbidden");
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    send(res, 200, body, contentTypes.get(path.extname(filePath)) || "application/octet-stream");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      send(res, 404, "Not found");
      return;
    }
    console.error(error);
    send(res, 500, "Internal server error");
  }
});

server.listen(port, host, () => {
  console.log(`Device Studio: http://${host}:${port}`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
