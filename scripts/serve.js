// Serves the repo on localhost so the standalone import page and the Lab
// share an origin (and localStorage). Local only; no outside requests.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".");
const port = Number(process.argv[2] ?? 8787);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".ttf": "font/ttf", ".wasm": "application/wasm", ".gz": "application/gzip",
};

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/") {
    res.writeHead(302, { Location: "/standalone/" });
    return res.end();
  }
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
}).listen(port, "127.0.0.1", () => console.log(`Serving on http://localhost:${port}/standalone/  (Ctrl+C to stop)`));
