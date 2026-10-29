/**
 * Self-contained pose-tracking page. The same page runs in a WebView on iOS
 * and Android and in an iframe on web, so the tracking code is identical on
 * every platform. It loads Google's MediaPipe Pose Landmarker (Apache-2.0)
 * and its model, opens the camera, draws the skeleton, and posts landmark
 * coordinates (never images) to the app. Video never leaves the device.
 *
 * Host → page: {type:"start"} | {type:"stop"} | {type:"facing", facing}
 * Page → host: {type:"status", status, message?} | {type:"frames", frames:[{t, lm:[[x,y,z,v]×33]}]}
 *   (x and z are multiplied by the frame aspect ratio so all axes share units)
 */

export const MEDIAPIPE_VERSION = "1.1.1";
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export function poseHtml(opts: { facing: "user" | "environment"; accent: string }): string {
  return `<!doctype html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden}
  #wrap{position:relative;width:100%;height:100%}
  video,canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .mirror{transform:scaleX(-1)}
</style></head>
<body><div id="wrap"><video id="v" playsinline muted autoplay></video><canvas id="c"></canvas></div>
<script type="module">
const post = (m) => {
  const s = JSON.stringify(m);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s); else window.parent.postMessage(s, "*");
};
const video = document.getElementById("v"), canvas = document.getElementById("c"), ctx = canvas.getContext("2d");
let facing = ${JSON.stringify(opts.facing)}, running = false, landmarker = null, stream = null, buffer = [], lastFlush = 0, lastVideoTime = -1, t0 = 0;
const EDGES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,31],[28,32]];

async function openCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  video.srcObject = stream;
  await video.play();
  const mirror = facing === "user";
  video.classList.toggle("mirror", mirror);
  canvas.classList.toggle("mirror", mirror);
}

async function init() {
  post({ type: "status", status: "loading", message: "Loading pose model" });
  try {
    const { PoseLandmarker, FilesetResolver } = await import("${CDN}/vision_bundle.mjs");
    const files = await FilesetResolver.forVisionTasks("${CDN}/wasm");
    const make = (delegate) => PoseLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: "${MODEL}", delegate }, runningMode: "VIDEO", numPoses: 1 });
    try { landmarker = await make("GPU"); } catch { landmarker = await make("CPU"); }
  } catch (e) {
    post({ type: "status", status: "error", message: "Couldn't load the pose model. Check your connection and try again." });
    return;
  }
  try { await openCamera(); } catch (e) {
    post({ type: "status", status: "error", message: "Camera unavailable. Allow camera access in settings." });
    return;
  }
  post({ type: "status", status: "ready" });
  requestAnimationFrame(loop);
}

function draw(lm) {
  canvas.width = canvas.clientWidth * devicePixelRatio; canvas.height = canvas.clientHeight * devicePixelRatio;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!lm) return;
  // Map normalized video coordinates onto the cover-fitted canvas.
  const vw = video.videoWidth, vh = video.videoHeight, cw = canvas.width, ch = canvas.height;
  const s = Math.max(cw / vw, ch / vh), ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
  const P = (p) => [p.x * vw * s + ox, p.y * vh * s + oy];
  ctx.lineWidth = 4 * devicePixelRatio; ctx.strokeStyle = ${JSON.stringify(opts.accent)}; ctx.fillStyle = "#fff";
  for (const [a, b] of EDGES) {
    if ((lm[a].visibility ?? 1) < 0.5 || (lm[b].visibility ?? 1) < 0.5) continue;
    const [x1, y1] = P(lm[a]), [x2, y2] = P(lm[b]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  for (const i of [11,12,13,14,15,16,23,24,25,26,27,28]) {
    if ((lm[i].visibility ?? 1) < 0.5) continue;
    const [x, y] = P(lm[i]); ctx.beginPath(); ctx.arc(x, y, 5 * devicePixelRatio, 0, 7); ctx.fill();
  }
}

function loop() {
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const now = performance.now();
    const res = landmarker.detectForVideo(video, now);
    const lm = res.landmarks && res.landmarks[0];
    draw(lm);
    if (running) {
      if (!t0) t0 = now;
      // x (and z, which MediaPipe scales like x) are normalised to the frame width, y to its height.
      // Rescale x and z by width/height so angles are measured in square units.
      const ar = video.videoWidth / video.videoHeight;
      buffer.push({ t: Math.round(now - t0), lm: lm ? lm.map((p) => [+(p.x * ar).toFixed(4), +p.y.toFixed(4), +((p.z ?? 0) * ar).toFixed(4), +(p.visibility ?? 0).toFixed(3)]) : null });
      if (now - lastFlush > 300) { post({ type: "frames", frames: buffer }); buffer = []; lastFlush = now; }
    }
  }
  requestAnimationFrame(loop);
}

function handle(raw) {
  let m = raw;
  try { if (typeof raw === "string") m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m !== "object") return;
  if (m.type === "start") { running = true; t0 = 0; buffer = []; }
  if (m.type === "stop") { running = false; if (buffer.length) post({ type: "frames", frames: buffer }); buffer = []; post({ type: "status", status: "stopped" }); }
  if (m.type === "facing" && m.facing !== facing) { facing = m.facing; openCamera().catch(() => post({ type: "status", status: "error", message: "Couldn't switch camera." })); }
}
window.__cmd = handle;
window.addEventListener("message", (e) => handle(e.data));
init();
</script></body></html>`;
}
