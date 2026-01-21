const video = document.getElementById("video");
const ipVideo = document.getElementById("ipVideo");
const deviceSelect = document.getElementById("deviceSelect");
const startButton = document.getElementById("startButton");
const refreshButton = document.getElementById("refreshDevices");
const ipCameraUrl = document.getElementById("ipCameraUrl");
const connectIpButton = document.getElementById("connectIpButton");
const statusEl = document.getElementById("status");
const resolutionEl = document.getElementById("resolution");
const facingModeEl = document.getElementById("facingMode");
const deviceInfoEl = document.getElementById("deviceInfo");

let currentStream = null;
let detectionRaf = null;

const analysisCanvas = document.createElement("canvas");
const analysisCtx = analysisCanvas.getContext("2d", { willReadFrequently: true });
const DETECT_WIDTH = 96;
const DETECT_HEIGHT = 54;

const detectionState = {
  color: null,
  stableCount: 0,
  lastLoggedAt: 0,
  lastErrorAt: 0,
};

function log(message, isError = false) {
  console[isError ? "error" : "log"](message);
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoInputs = devices.filter((d) => d.kind === "videoinput");

  deviceSelect.innerHTML = "";

  videoInputs.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Kamera ${index + 1}`;
    deviceSelect.appendChild(option);
  });

  if (videoInputs.length === 0) {
    const option = document.createElement("option");
    option.textContent = "Nem található kamera";
    option.disabled = true;
    deviceSelect.appendChild(option);
    log("Nem található elérhető kamera", true);
  }
}

async function stopStream() {
  if (!currentStream) return;
  currentStream.getTracks().forEach((track) => track.stop());
  currentStream = null;
}

function setViewMode(mode) {
  if (mode === "ip") {
    video.classList.add("hidden");
    ipVideo.classList.remove("hidden");
  } else {
    ipVideo.classList.add("hidden");
    ipVideo.removeAttribute("src");
    video.classList.remove("hidden");
  }
}

function normalizeIpUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasScheme = /^https?:\/\//i.test(trimmed);
  const urlString = hasScheme ? trimmed : `http://${trimmed}`;

  try {
    const url = new URL(urlString);
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/video";
    }
    return url.toString();
  } catch (err) {
    return null;
  }
}

function updateInfo(trackSettings, deviceLabel) {
  const { width, height, facingMode } = trackSettings || {};
  resolutionEl.textContent = width && height ? `${width} x ${height}` : "n/a";
  facingModeEl.textContent = facingMode || "unknown";
  deviceInfoEl.textContent = deviceLabel || "n/a";
}

function getActiveSource() {
  if (!ipVideo.classList.contains("hidden") && ipVideo.complete && ipVideo.naturalWidth > 0) {
    return ipVideo;
  }
  if (!video.classList.contains("hidden") && video.readyState >= 2) {
    return video;
  }
  return null;
}

function rgbToName(r, g, b) {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;

  const v = max;
  const s = max === 0 ? 0 : delta / max;

  if (v < 0.2) return "black";
  if (s < 0.15 && v > 0.85) return "white";
  if (s < 0.15) return "gray";

  let h = 0;
  if (delta !== 0) {
    if (max === rNorm) {
      h = ((gNorm - bNorm) / delta) % 6;
    } else if (max === gNorm) {
      h = (bNorm - rNorm) / delta + 2;
    } else {
      h = (rNorm - gNorm) / delta + 4;
    }
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }

  if (h < 30 || h >= 330) return "red";
  if (h < 60) return "orange";
  if (h < 90) return "yellow";
  if (h < 150) return "green";
  if (h < 210) return "cyan";
  if (h < 270) return "blue";
  if (h < 330) return "magenta";
  return "unknown";
}

function findLargestRegion(data, width, height) {
  const total = width * height;
  const keys = new Uint16Array(total);
  const visited = new Uint8Array(total);

  for (let i = 0; i < total; i += 1) {
    const offset = i * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    keys[i] = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
  }

  let best = null;
  const stack = [];

  for (let index = 0; index < total; index += 1) {
    if (visited[index]) continue;

    const key = keys[index];
    let count = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;

    stack.length = 0;
    stack.push(index);
    visited[index] = 1;

    while (stack.length > 0) {
      const current = stack.pop();
      const x = current % width;
      const y = (current / width) | 0;

      count += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const offset = current * 4;
      sumR += data[offset];
      sumG += data[offset + 1];
      sumB += data[offset + 2];

      const left = current - 1;
      if (x > 0 && !visited[left] && keys[left] === key) {
        visited[left] = 1;
        stack.push(left);
      }
      const right = current + 1;
      if (x < width - 1 && !visited[right] && keys[right] === key) {
        visited[right] = 1;
        stack.push(right);
      }
      const up = current - width;
      if (y > 0 && !visited[up] && keys[up] === key) {
        visited[up] = 1;
        stack.push(up);
      }
      const down = current + width;
      if (y < height - 1 && !visited[down] && keys[down] === key) {
        visited[down] = 1;
        stack.push(down);
      }
    }

    if (!best || count > best.count) {
      best = {
        count,
        minX,
        maxX,
        minY,
        maxY,
        avgR: sumR / count,
        avgG: sumG / count,
        avgB: sumB / count,
      };
    }
  }

  return best;
}

function isRectangleLike(region, totalPixels) {
  if (!region) return false;
  const bboxArea = (region.maxX - region.minX + 1) * (region.maxY - region.minY + 1);
  const fillRatio = region.count / bboxArea;
  const coverage = region.count / totalPixels;
  const bboxCoverage = bboxArea / totalPixels;

  if (coverage < 0.12) return false;
  if (bboxCoverage > 0.85) return false;
  if (fillRatio < 0.7) return false;
  return true;
}

function analyzeFrame() {
  const source = getActiveSource();
  if (!source) {
    detectionRaf = requestAnimationFrame(analyzeFrame);
    return;
  }

  if (analysisCanvas.width !== DETECT_WIDTH || analysisCanvas.height !== DETECT_HEIGHT) {
    analysisCanvas.width = DETECT_WIDTH;
    analysisCanvas.height = DETECT_HEIGHT;
  }

  let imageData;
  try {
    analysisCtx.drawImage(source, 0, 0, DETECT_WIDTH, DETECT_HEIGHT);
    imageData = analysisCtx.getImageData(0, 0, DETECT_WIDTH, DETECT_HEIGHT);
  } catch (err) {
    const now = Date.now();
    if (now - detectionState.lastErrorAt > 2000) {
      console.warn("Detection skipped: cannot read pixels from video source.", err);
      detectionState.lastErrorAt = now;
    }
    detectionRaf = requestAnimationFrame(analyzeFrame);
    return;
  }

  const region = findLargestRegion(imageData.data, DETECT_WIDTH, DETECT_HEIGHT);

  if (isRectangleLike(region, DETECT_WIDTH * DETECT_HEIGHT)) {
    const colorName = rgbToName(region.avgR, region.avgG, region.avgB);
    if (detectionState.color === colorName) {
      detectionState.stableCount += 1;
    } else {
      detectionState.color = colorName;
      detectionState.stableCount = 1;
    }

    const now = Date.now();
    if (detectionState.stableCount >= 3 && now - detectionState.lastLoggedAt > 2000) {
      console.log(`Teglalap detektalva (szin: ${colorName})`);
      detectionState.lastLoggedAt = now;
    }
  } else {
    detectionState.color = null;
    detectionState.stableCount = 0;
  }

  detectionRaf = requestAnimationFrame(analyzeFrame);
}

function startDetectionLoop() {
  if (detectionRaf) return;
  detectionRaf = requestAnimationFrame(analyzeFrame);
}

async function startStream(deviceId) {
  await stopStream();
  setViewMode("local");

  const constraints = {
    audio: false,
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      facingMode: deviceId ? undefined : { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };

  try {
    log("Kamera engedély kérése...");
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    currentStream = stream;
    video.srcObject = stream;

    const [track] = stream.getVideoTracks();
    const settings = track.getSettings();
    updateInfo(settings, track.label);
    await listDevices();

    // Auto-select the active device if we know it.
    const activeOption = [...deviceSelect.options].find(
      (opt) => opt.textContent === track.label || opt.value === track.getSettings().deviceId
    );
    if (activeOption) {
      deviceSelect.value = activeOption.value;
    }

    log("Kamera aktív");
  } catch (err) {
    console.error(err);
    log(`Hiba: ${err.message}`, true);
  }
}

async function startIpStream() {
  const url = normalizeIpUrl(ipCameraUrl.value);
  if (!url) {
    log("Invalid IP camera URL", true);
    return;
  }

  await stopStream();
  setViewMode("ip");
  updateInfo(null, "IP camera");
  ipVideo.src = url;
  const warnings = [];
  if (window.location.protocol === "https:" && url.startsWith("http://")) {
    warnings.push("HTTPS page may block HTTP IP camera.");
  }
  const message = warnings.length
    ? `IP camera connected: ${url}. ${warnings.join(" ")}`
    : `IP camera connected: ${url}`;
  log(message, warnings.length > 0);
}

startButton.addEventListener("click", () => startStream(deviceSelect.value));
refreshButton.addEventListener("click", () => listDevices());
connectIpButton.addEventListener("click", () => startIpStream());

deviceSelect.addEventListener("change", (event) => {
  const { value } = event.target;
  startStream(value);
});

ipCameraUrl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    startIpStream();
  }
});

async function init() {
  if (!navigator.mediaDevices?.getUserMedia) {
    log("A böngésző nem támogatja a kamerát", true);
    startButton.disabled = true;
    return;
  }

  await listDevices();
  await startStream();
  startDetectionLoop();
}

init();
