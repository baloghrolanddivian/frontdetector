#!/usr/bin/env node
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");

const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "..", "public");

function listAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

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

const server = http.createServer((req, res) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url} from ${req.socket.remoteAddress}`);
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  const addresses = listAddresses();
  console.log(`Dev server running at:`);
  console.log(`- http://localhost:${PORT}`);
  addresses.forEach((addr) => console.log(`- http://${addr}:${PORT}`));
  console.log("Tip: open one of the above URLs from your phone on the same network.");
  console.log(
    "If you're running in a remote dev container or cloud IDE, these LAN IPs may not be reachable directly; use a tunnel (e.g. `ngrok http 5173`)."
  );
});
