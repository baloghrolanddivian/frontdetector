const video = document.getElementById("video");
const deviceSelect = document.getElementById("deviceSelect");
const startButton = document.getElementById("startButton");
const refreshButton = document.getElementById("refreshDevices");
const statusEl = document.getElementById("status");
const resolutionEl = document.getElementById("resolution");
const facingModeEl = document.getElementById("facingMode");
const deviceInfoEl = document.getElementById("deviceInfo");

let currentStream = null;

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

function updateInfo(trackSettings, deviceLabel) {
  const { width, height, facingMode } = trackSettings;
  resolutionEl.textContent = width && height ? `${width} x ${height}` : "–";
  facingModeEl.textContent = facingMode || "ismeretlen";
  deviceInfoEl.textContent = deviceLabel || "–";
}

async function startStream(deviceId) {
  await stopStream();

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

startButton.addEventListener("click", () => startStream(deviceSelect.value));
refreshButton.addEventListener("click", () => listDevices());

deviceSelect.addEventListener("change", (event) => {
  const { value } = event.target;
  startStream(value);
});

async function init() {
  if (!navigator.mediaDevices?.getUserMedia) {
    log("A böngésző nem támogatja a kamerát", true);
    startButton.disabled = true;
    return;
  }

  await listDevices();
  await startStream();
}

init();
