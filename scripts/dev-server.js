
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const PORT = process.env.PORT || 5173;
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const CAPTURE_DIR = path.join(PUBLIC_DIR, "captures");
const DETECT_SCRIPT = path.join(__dirname, "detect_front.py");
const PYTHON_BIN = process.env.PYTHON || "python";
const KNOWN_SIZE = "357x260";

function ensureCaptureDir() {
  if (!fs.existsSync(CAPTURE_DIR)) {
    fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  }
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

function runDetection(rawPath, annotatedPath, callback) {
  const args = [DETECT_SCRIPT, "--input", rawPath, "--output", annotatedPath, "--known", KNOWN_SIZE];
  const child = spawn(PYTHON_BIN, args);
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (data) => {
    stdout += data.toString();
  });
  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  child.on("close", (code) => {
    if (code !== 0) {
      callback(new Error(stderr || `Python exited with code ${code}`));
      return;
    }
    try {
      const parsed = JSON.parse(stdout.trim() || "{}");
      callback(null, parsed);
    } catch (err) {
      callback(new Error("Failed to parse detector output."));
    }
  });
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
  if (req.method === "POST" && (req.url === "/detect" || req.url === "/detect-preview")) {
    const shouldSave = req.url === "/detect";
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        const parsed = parseDataUrl(payload.imageDataUrl);
        if (!parsed) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Invalid image data." }));
          return;
        }

        let workDir = CAPTURE_DIR;
        let tempDir = null;
        if (shouldSave) {
          ensureCaptureDir();
        } else {
          tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "frontdetector-"));
          workDir = tempDir;
        }
        const timestamp = Date.now();
        const rawName = `raw-${timestamp}.jpg`;
        const annotatedName = `detected-${timestamp}.jpg`;
        const rawPath = path.join(workDir, rawName);
        const annotatedPath = path.join(workDir, annotatedName);

        fs.writeFileSync(rawPath, parsed.buffer);

        runDetection(rawPath, annotatedPath, (err, result) => {
          if (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
            return;
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: true,
              result,
              rawUrl: shouldSave ? `/captures/${rawName}` : null,
              annotatedUrl: shouldSave ? `/captures/${annotatedName}` : null,
            })
          );
          if (tempDir) {
            fs.rm(tempDir, { recursive: true, force: true }, () => {});
          }
        });
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Invalid JSON." }));
      }
    });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Dev server running at http://localhost:${PORT}`);
  console.log("Tip: open this URL from your phone on the same network.");
});
