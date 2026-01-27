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
const overlay = document.getElementById("overlay");
const overlayCtx = overlay ? overlay.getContext("2d") : null;
let detectOnceButton = document.getElementById("detectOnceButton");

let currentStream = null;
let detectionRaf = null;

const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d");
const DETECT_WIDTH = 96;
const DETECT_HEIGHT = 54;
const CAMERA_HEIGHT_MM = 630;
const CALIBRATED_MM_PER_PX = 0.895;
const DETECT_INTERVAL_MS = 500;

let lastDetectAt = 0;
let lastBoxes = [];
let lastFrameSize = null;
let detectInFlight = false;
let sizeSeries = [];
let sizeSeriesLoaded = false;

const detectionState = {
  corsBlocked: false,
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
    clearOverlay();
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

function normalizeBoxes(result) {
  if (!result) return [];
  if (Array.isArray(result.boxes)) return result.boxes;
  if (Array.isArray(result.bboxes)) return result.bboxes;
  if (result.bbox) return [result.bbox];
  return [];
}

function normalizeSizeSeries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => ({
      label: entry.label || `${entry.width_mm}x${entry.height_mm}`,
      width: Number(entry.width_mm),
      height: Number(entry.height_mm),
    }))
    .filter((entry) => Number.isFinite(entry.width) && Number.isFinite(entry.height));
}

async function loadSizeSeries() {
  if (sizeSeriesLoaded) return;
  sizeSeriesLoaded = true;
  try {
    const response = await fetch("./size-series.json", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    sizeSeries = normalizeSizeSeries(data);
  } catch (err) {
    console.warn("Size series not loaded.", err);
  }
}

function findClosestSeries(widthMm, heightMm) {
  if (!sizeSeries.length) return null;
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;

  sizeSeries.forEach((entry) => {
    const dx1 = widthMm - entry.width;
    const dy1 = heightMm - entry.height;
    const score1 = dx1 * dx1 + dy1 * dy1;
    const dx2 = widthMm - entry.height;
    const dy2 = heightMm - entry.width;
    const score2 = dx2 * dx2 + dy2 * dy2;
    const score = Math.min(score1, score2);
    if (score < bestScore) {
      bestScore = score;
      best = entry;
    }
  });

  return best ? { ...best, distance: Math.sqrt(bestScore) } : null;
}

function captureFrameForBackend(source) {
  const sourceWidth = source.videoWidth || source.naturalWidth || DETECT_WIDTH;
  const sourceHeight = source.videoHeight || source.naturalHeight || DETECT_HEIGHT;
  const maxWidth = 960;
  const scale = sourceWidth > maxWidth ? maxWidth / sourceWidth : 1;
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

  try {
    captureCanvas.width = targetWidth;
    captureCanvas.height = targetHeight;
    captureCtx.drawImage(source, 0, 0, targetWidth, targetHeight);
    const dataUrl = captureCanvas.toDataURL("image/jpeg", 0.8);
    return { dataUrl, width: targetWidth, height: targetHeight };
  } catch (err) {
    if (err.name === "SecurityError" && !detectionState.corsBlocked) {
      log("A video forrasa CORS miatt nem elemezheto.", true);
      detectionState.corsBlocked = true;
    }
    console.warn("Detection skipped: cannot capture frame.", err);
    return null;
  }
}

async function requestBackendDetection(save, source) {
  const capture = captureFrameForBackend(source);
  if (!capture) return null;

  const endpoint = save ? "/detect" : "/detect-preview";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageDataUrl: capture.dataUrl }),
  });
  const payload = await response.json();
  if (!response.ok) {
    console.error("Detection backend error.", payload);
    return null;
  }
  payload._frameSize = { width: capture.width, height: capture.height };
  return payload;
}

function clearOverlay() {
  if (!overlay || !overlayCtx) return;
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
}

function updateOverlay(boxes, frameSize, source) {
  if (!overlay || !overlayCtx || !boxes || boxes.length === 0 || !source || !frameSize) return;
  const rect = source.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (overlay.width !== width || overlay.height !== height) {
    overlay.width = width;
    overlay.height = height;
  }

  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  const scaleX = overlay.width / frameSize.width;
  const scaleY = overlay.height / frameSize.height;
  overlayCtx.strokeStyle = "#22c55e";
  overlayCtx.lineWidth = Math.max(2, Math.round(Math.min(overlay.width, overlay.height) * 0.004));
  boxes.forEach((box) => {
    if (Array.isArray(box.points) && box.points.length >= 4) {
      overlayCtx.beginPath();
      box.points.forEach((point, index) => {
        const px = point[0] * scaleX;
        const py = point[1] * scaleY;
        if (index === 0) {
          overlayCtx.moveTo(px, py);
        } else {
          overlayCtx.lineTo(px, py);
        }
      });
      overlayCtx.closePath();
      overlayCtx.stroke();
    } else {
      const x = box.x * scaleX;
      const y = box.y * scaleY;
      const w = box.w * scaleX;
      const h = box.h * scaleY;
      overlayCtx.strokeRect(x, y, w, h);
    }
  });
}

async function runManualDetection() {
  await loadSizeSeries();
  const source = getActiveSource();
  if (!source) {
    console.log("Manual check: nincs elerheto video forras.");
    return;
  }

  let payload = null;
  try {
    payload = await requestBackendDetection(true, source);
  } catch (err) {
    console.error("Manual check: nem sikerult a detektalas.", err);
    return;
  }

  if (!payload) {
    console.log("Manual check: nincs detektalt front.");
    return;
  }

  const boxes = normalizeBoxes(payload.result);
  if (boxes.length === 0) {
    console.log("Manual check: nincs detektalt front.");
    return;
  }

  const frameSize = payload._frameSize || { width: 1, height: 1 };
  const sourceWidth = source.videoWidth || source.naturalWidth || frameSize.width;
  const sourceHeight = source.videoHeight || source.naturalHeight || frameSize.height;
  const scaleX = sourceWidth / frameSize.width;
  const scaleY = sourceHeight / frameSize.height;
  const mmPerPixel = Number.isFinite(CALIBRATED_MM_PER_PX)
    ? CALIBRATED_MM_PER_PX
    : sourceHeight
    ? CAMERA_HEIGHT_MM / sourceHeight
    : 0;
  boxes.forEach((box, index) => {
    const boxWidth = box.rw || box.w;
    const boxHeight = box.rh || box.h;
    const widthPx = Math.round(boxWidth * scaleX);
    const heightPx = Math.round(boxHeight * scaleY);
    const widthMmRaw = mmPerPixel ? boxWidth * mmPerPixel : null;
    const heightMmRaw = mmPerPixel ? boxHeight * mmPerPixel : null;
    const widthMm = widthMmRaw ? Math.round(widthMmRaw) : null;
    const heightMm = heightMmRaw ? Math.round(heightMmRaw) : null;
    const sizeMmText = widthMm ? `${widthMm} mm x ${heightMm} mm` : "n/a";
    console.log(
      `Manual check ${index + 1}/${boxes.length}: meret ${widthPx}x${heightPx} px (${sizeMmText}).`
    );
    if (widthMmRaw && heightMmRaw) {
      const closest = findClosestSeries(widthMmRaw, heightMmRaw);
      if (closest) {
        console.log(
          `Manual check ${index + 1}/${boxes.length}: legkozelebbi szeria ${closest.label} (elteres ~${Math.round(
            closest.distance
          )} mm).`
        );
      }
    }
  });

  if (payload.annotatedUrl || payload.rawUrl) {
    console.log(`Mentett kep: ${payload.annotatedUrl || payload.rawUrl}`);
  }
}

async function runPreviewDetection(source) {
  if (detectInFlight) return;
  const now = Date.now();
  if (now - lastDetectAt < DETECT_INTERVAL_MS) return;
  detectInFlight = true;
  lastDetectAt = now;

  try {
    const payload = await requestBackendDetection(false, source);
    if (payload) {
      lastBoxes = normalizeBoxes(payload.result);
      lastFrameSize = payload._frameSize;
    } else {
      lastBoxes = [];
      lastFrameSize = null;
    }
  } catch (err) {
    console.error("Preview detection failed.", err);
  } finally {
    detectInFlight = false;
  }
}

function analyzeFrame() {
  const source = getActiveSource();
  if (!source) {
    clearOverlay();
    detectionRaf = requestAnimationFrame(analyzeFrame);
    return;
  }

  runPreviewDetection(source);

  if (lastBoxes.length > 0 && lastFrameSize) {
    updateOverlay(lastBoxes, lastFrameSize, source);
  } else {
    clearOverlay();
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
  detectionState.corsBlocked = false;
  lastBoxes = [];
  lastFrameSize = null;
  lastDetectAt = 0;

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
  detectionState.corsBlocked = false;
  lastBoxes = [];
  lastFrameSize = null;
  lastDetectAt = 0;
  ipVideo.crossOrigin = "anonymous";
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
  loadSizeSeries();
  if (detectOnceButton) {
    detectOnceButton.addEventListener("click", () => runManualDetection());
  }

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

