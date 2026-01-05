#!/usr/bin/env node
const http = require("http");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 5173;
const PUBLIC_DIR = path.join(__dirname, "..", "public");

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html";
    case ".js":
      return "application/javascript";
    case ".css":
      return "text/css";
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

function serveStatic(req, res) {
  const sanitizedPath = path.normalize(req.url.split("?")[0]).replace(/^\/+/, "");
  let filePath = path.join(PUBLIC_DIR, sanitizedPath);

  if (req.url === "/" || req.url.startsWith("/?")) {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    const stream = fs.createReadStream(filePath);
    res.writeHead(200, {
      "Content-Type": getContentType(filePath),
      "Cache-Control": "no-store",
    });
    stream.pipe(res);
  });
}

const server = http.createServer(serveStatic);

server.listen(PORT, () => {
  console.log(`Dev server running at http://localhost:${PORT}`);
  console.log("Tip: open this URL from your phone on the same network.");
});
