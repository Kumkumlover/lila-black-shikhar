/* ══ LILA BLACK — Player Journey Visualizer ══ */

const MAP_IMAGES = {
  AmbroseValley: "maps/AmbroseValley_Minimap.png",
  GrandRift:     "maps/GrandRift_Minimap.png",
  Lockdown:      "maps/Lockdown_Minimap.jpg",
};

const MAP_SIZE = 1024;
const MAP_CENTER = { x: 512, y: 512 };
// Storm: safe zone starts large, closes to a small circle over match duration
const STORM_START_R = 650;
const STORM_END_R   = 80;

const C = {
  human:  "#4fc3f7", humanDim: "rgba(79,195,247,0.35)",
  bot:    "#ef5350", botDim:   "rgba(239,83,80,0.25)",
  agent:  "#ffd54f",                                     // amber — test agent
  kill:   "#ff9800", loot: "#66bb6a", storm: "#ce93d8", death: "#f44336",
  pvp:    "#ffffff",                                     // white — rare PvP kill
};

// Inferred extraction zone clusters per map (from cross-match last-position analysis)
// Methodology: cluster last-known positions of all no-death human sessions; peaks = extraction points
const EXTRACTION_ZONES = {
  AmbroseValley: [
    { px: 499, py: 832, n: 41 },
    { px: 653, py: 576, n: 38 },
    { px: 141, py: 422, n: 30 },
    { px: 653, py: 269, n: 24 },
    { px: 243, py: 781, n: 17 },
  ],
  GrandRift: [
    { px: 832, py: 243, n: 8  },
    { px: 243, py: 269, n: 5  },
    { px: 269, py: 704, n: 4  },
    { px: 678, py: 755, n: 3  },
  ],
  Lockdown: [
    { px: 832, py: 397, n: 14 },
    { px: 602, py: 704, n: 11 },
    { px: 269, py: 678, n:  9 },
    { px: 141, py: 525, n:  6 },
    { px: 653, py: 166, n:  4 },
  ],
};

// ── State ────────────────────────────────────────────────────────────────────
let allMatches      = [];
let filteredMatches = [];   // kept in sync with renderMatchList for prev/next nav
let currentMatchId  = null;
let currentMatch    = null;
let mapImage     = null;
let playing      = false;
let rafId        = null;
let ambientRafId = null;   // low-fps loop for storm/glow animation when paused
let lastRafTs    = null;
let currentTime  = 0;

let vp   = { scale: 1, ox: 0, oy: 0 };
let drag = null;

let playerPositions = {};  // uid → [{t,px,py,human}] sorted by t
let effects         = [];
let lastEffectTime  = -1;
const spawnedKeys   = new Set();

let inferenceData  = null;  // loaded per-map, cross-match bot data
const inferenceCache = {};  // mapName → parsed JSON (session cache)

// Storm lightning particles (persistent, regenerated each frame based on now)
const STORM_BOLTS = 12;

// ── DOM ──────────────────────────────────────────────────────────────────────
const canvas     = document.getElementById("map-canvas");
const ctx        = canvas.getContext("2d");
const wrap       = document.getElementById("canvas-wrap");
const emptyState = document.getElementById("empty-state");
const topbar     = document.getElementById("topbar");
const infoTitle  = document.getElementById("info-title");
const infoStats  = document.getElementById("info-stats");
const timeline   = document.getElementById("timeline");
const scrubber   = document.getElementById("scrubber");
const timeLabel  = document.getElementById("time-label");
const btnPlay    = document.getElementById("btn-play");
const matchList  = document.getElementById("match-list");
const matchCount = document.getElementById("match-count");
const evMarkers  = document.getElementById("event-markers");
const zoomLabel  = document.getElementById("zoom-label");

const togPaths   = document.getElementById("toggle-paths");
const togEvents  = document.getElementById("toggle-events");
const togHeatmap = document.getElementById("toggle-heatmap");
const togBots    = document.getElementById("toggle-bots");
const togHumans  = document.getElementById("toggle-humans");
const togStorm   = document.getElementById("toggle-storm");
const togInfer   = document.getElementById("toggle-infer");
const inferWrap  = document.getElementById("infer-toggle-wrap");
const inferBadge = document.getElementById("infer-badge");

const filterMap  = document.getElementById("filter-map");
const filterDay  = document.getElementById("filter-day");
const filterSort = document.getElementById("filter-sort");
const speedSel   = document.getElementById("playback-speed");
const btnPrev    = document.getElementById("btn-prev");
const btnNext    = document.getElementById("btn-next");
const playerPopup = document.getElementById("player-popup");

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const res = await fetch("data/index.json");
  allMatches = await res.json();
  renderMatchList();
  buildLegend();
  [filterMap, filterDay, filterSort].forEach(el =>
    el.addEventListener("change", renderMatchList));
}

// ── Match list ────────────────────────────────────────────────────────────────
function renderMatchList() {
  const mapF  = filterMap.value;
  const dayF  = filterDay.value;
  const sortF = filterSort.value;
  filteredMatches = allMatches
    .filter(m => (!mapF || m.map === mapF) && (!dayF || m.day === dayF))
    .sort((a, b) => b[sortF] - a[sortF]);
  const list = filteredMatches;

  updateNavButtons();
  matchCount.textContent = `(${list.length})`;
  matchList.innerHTML = list.map(m => {
    const dur = fmtTime(m.duration);
    const day = m.day.replace("February_", "Feb ");
    // Suspicious: died to bots >> bot kills (ratio > 2.5)
    const suspicious = m.bot_kills === 0 && m.bot_killed > 3;
  const hasAgent   = m.agents > 0;
  const agentBadge = hasAgent ? ` <span style="color:${C.agent};font-size:9px">&#9888;</span>` : "";
  const OUTCOME_ICON = { extracted:"&#x2191;", survived:"&#9679;", died:"&#x2715;", ragequit:"&#x21BA;", unknown:"" };
  const OUTCOME_COL  = { extracted:"#66bb6a",  survived:"#90caf9",  died:"#ef5350",  ragequit:"#bdbdbd",  unknown:"#555" };
  const oc   = m.outcome || "unknown";
  const ocBadge = oc !== "unknown"
    ? ` <span style="color:${OUTCOME_COL[oc]};font-size:9px;font-weight:bold" title="Outcome: ${oc}">${OUTCOME_ICON[oc]}</span>` : "";
    return `<li data-id="${m.id}" ${suspicious ? 'style="border-left-color:#ff9800"' : ''}>
      <div class="match-title">
        <span class="match-map-tag tag-${m.map}">${shortMap(m.map)}</span>
        ${m.id.slice(0, 8)}${suspicious ? ' <span style="color:#ff9800;font-size:9px">&#9888;</span>' : ""}${agentBadge}${ocBadge}
      </div>
      <div class="match-meta">
        ${day} · ${dur} · <b>${m.total_events}</b> ev · H:<b>${m.humans}</b>${m.agents > 0 ? ` A:<b style="color:${C.agent}">${m.agents}</b>` : ""} B:<b>${m.bots}</b>
      </div>
    </li>`;
  }).join("");
  matchList.querySelectorAll("li").forEach(li =>
    li.addEventListener("click", () => loadMatch(li.dataset.id)));
}

function shortMap(m) {
  return { AmbroseValley:"AV", GrandRift:"GR", Lockdown:"LK" }[m] || m;
}

// ── Load match ────────────────────────────────────────────────────────────────
function updateNavButtons() {
  const idx = filteredMatches.findIndex(m => m.id === currentMatchId);
  if (btnPrev) btnPrev.disabled = idx <= 0;
  if (btnNext) btnNext.disabled = idx < 0 || idx >= filteredMatches.length - 1;
}

btnPrev.addEventListener("click", () => {
  const idx = filteredMatches.findIndex(m => m.id === currentMatchId);
  if (idx > 0) loadMatch(filteredMatches[idx - 1].id);
});
btnNext.addEventListener("click", () => {
  const idx = filteredMatches.findIndex(m => m.id === currentMatchId);
  if (idx >= 0 && idx < filteredMatches.length - 1) loadMatch(filteredMatches[idx + 1].id);
});

async function loadMatch(id) {
  stopPlayback();
  stopAmbient();
  hidePlayerPopup();
  currentMatchId = id;
  updateNavButtons();
  matchList.querySelectorAll("li").forEach(li =>
    li.classList.toggle("active", li.dataset.id === id));

  const res = await fetch(`data/matches/${id}.json`);
  currentMatch = await res.json();
  currentTime  = 0;
  effects      = [];
  lastEffectTime = -1;
  spawnedKeys.clear();

  mapImage = await loadImage(MAP_IMAGES[currentMatch.meta.map]);
  await loadInferenceData(currentMatch.meta.map);
  buildPlayerPositions();

  // Auto-enable inference layer when match has bot kills but no bot telemetry
  const shouldInfer = currentMatch.meta.bots === 0 && currentMatch.meta.bot_kills > 0;
  togInfer.checked = shouldInfer;
  updateInferBadge();

  emptyState.classList.add("hidden");
  topbar.classList.remove("hidden");
  timeline.classList.remove("hidden");

  const m = currentMatch.meta;
  // Suspicious behavior flag
  const suspicious = m.bot_kills === 0 && m.bot_killed > 3;
  const suspTag = suspicious
    ? ` <span style="color:#ff9800;font-size:10px;margin-left:6px">⚠ Suspicious: ${m.bot_killed} deaths, 0 kills</span>`
    : "";

  infoTitle.innerHTML =
    `${m.map.replace("AmbroseValley","Ambrose Valley")} · ${m.day.replace("February_","Feb ")} · ${m.id.slice(0,8)}` + suspTag;
  const agentTag = m.agents > 0
    ? `<span class="stat-sep">|</span>Agents: <b style="color:${C.agent}">${m.agents}</b>` : "";
  const pvpTag = m.pvp_kills > 0
    ? `<span class="stat-sep">|</span><b style="color:#fff">PvP: ${m.pvp_kills}</b>` : "";
  const OC_COL  = { extracted:"#66bb6a", survived:"#90caf9", died:"#ef5350", ragequit:"#bdbdbd", unknown:"#888" };
  const OC_LABEL= { extracted:"Extracted", survived:"Survived", died:"Died", ragequit:"Rage-quit?", unknown:"Unknown" };
  const oc2 = m.outcome || "unknown";
  const outcomeTag = `<span class="stat-sep">|</span>Outcome: <b style="color:${OC_COL[oc2]}">${OC_LABEL[oc2]}</b>`;
  infoStats.innerHTML =
    `Duration: <b>${fmtTime(m.duration)}</b><span class="stat-sep">|</span>` +
    `Events: <b>${m.total_events}</b><span class="stat-sep">|</span>` +
    `Humans: <b>${m.humans}</b>${agentTag}<span class="stat-sep">|</span>` +
    `Bots: <b>${m.bots}</b><span class="stat-sep">|</span>` +
    `BotKills: <b>${m.bot_kills}</b><span class="stat-sep">|</span>` +
    `Died to bots: <b>${m.bot_killed}</b><span class="stat-sep">|</span>` +
    `Loot: <b>${m.loot}</b>${pvpTag}${outcomeTag}`;

  scrubber.max   = m.duration;
  scrubber.value = 0;
  updateTimeLabel(0);
  buildEventMarkers();
  resizeCanvas();
  fitViewport();
  draw();
  startAmbient();  // keeps storm/glow animated even while paused
}

function buildPlayerPositions() {
  playerPositions = {};
  for (const e of currentMatch.events) {
    if (e.ev !== "Position" && e.ev !== "BotPosition") continue;
    if (e.px == null) continue;
    if (!playerPositions[e.uid]) playerPositions[e.uid] = [];
    playerPositions[e.uid].push({ t: e.t, px: e.px, py: e.py, type: e.type });
  }
}

function colorForType(type) {
  return type === "human" ? C.human : type === "agent" ? C.agent : C.bot;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ── Event ticks ───────────────────────────────────────────────────────────────
function buildEventMarkers() {
  const dur = currentMatch.meta.duration;
  const col = { Kill:"#ff9800", BotKill:"#ff9800", Killed:"#f44336",
                KilledByStorm:"#ce93d8", Loot:"#66bb6a" };
  evMarkers.innerHTML = currentMatch.events
    .filter(e => col[e.ev])
    .map(e => {
      const pct = (e.t / dur) * 100;
      return `<div class="ev-tick" style="left:${pct}%;background:${col[e.ev]}"></div>`;
    }).join("");
}

// ── Viewport ──────────────────────────────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
}

function fitViewport() {
  const W = canvas.width, H = canvas.height;
  const s  = Math.max(W / MAP_SIZE, H / MAP_SIZE);
  vp.scale = s;
  vp.ox    = (W - MAP_SIZE * s) / 2;
  vp.oy    = (H - MAP_SIZE * s) / 2;
  updateZoomLabel();
}

function updateZoomLabel() {
  zoomLabel.textContent = Math.round(vp.scale * 100) + "%";
}

function toCanvas(mx, my) {
  return [mx * vp.scale + vp.ox, my * vp.scale + vp.oy];
}

// ── Zoom / Pan ────────────────────────────────────────────────────────────────
function zoomAt(cx, cy, factor) {
  const newScale = Math.max(0.3, Math.min(8, vp.scale * factor));
  const sf = newScale / vp.scale;
  vp.ox = cx - sf * (cx - vp.ox);
  vp.oy = cy - sf * (cy - vp.oy);
  vp.scale = newScale;
  updateZoomLabel();
  draw();
}

canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 0.89);
}, { passive: false });

document.getElementById("btn-zoom-in").addEventListener("click",  () => zoomAt(canvas.width/2, canvas.height/2, 1.3));
document.getElementById("btn-zoom-out").addEventListener("click", () => zoomAt(canvas.width/2, canvas.height/2, 0.77));
document.getElementById("btn-zoom-fit").addEventListener("click", () => { fitViewport(); draw(); });

canvas.addEventListener("mousedown", e => {
  e.preventDefault();
  e.stopPropagation();
  drag = { startX: e.clientX, startY: e.clientY, vpOx: vp.ox, vpOy: vp.oy, moved: false };
  wrap.classList.add("dragging");
});
window.addEventListener("mousemove", e => {
  if (!drag) return;
  const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;
  vp.ox = drag.vpOx + dx;
  vp.oy = drag.vpOy + dy;
  if (!playing) draw();
});
window.addEventListener("mouseup", e => {
  if (drag) {
    e.stopPropagation();
    if (!drag.moved) {
      // It was a tap/click — check for player dot hit
      const rect = canvas.getBoundingClientRect();
      handleCanvasClick(drag.startX - rect.left, drag.startY - rect.top);
    }
  }
  drag = null;
  wrap.classList.remove("dragging");
});
window.addEventListener("resize", () => { if (currentMatch) { resizeCanvas(); fitViewport(); draw(); } });

// ── Storm ─────────────────────────────────────────────────────────────────────
function getStormRadius(t) {
  if (!currentMatch) return STORM_START_R;
  const frac = Math.min(1, t / currentMatch.meta.duration);
  // Ease-in: slow at start, accelerates
  const eased = frac * frac;
  return STORM_START_R - (STORM_START_R - STORM_END_R) * eased;
}

// Seeded pseudo-random for stable bolt positions per frame
function seededRand(seed) {
  const x = Math.sin(seed + 1) * 43758.5453;
  return x - Math.floor(x);
}

function drawStorm(now) {
  if (!togStorm || !togStorm.checked) return;

  const r        = getStormRadius(currentTime);
  const cx       = MAP_CENTER.x;
  const cy       = MAP_CENTER.y;
  const pulse    = Math.sin(now * 0.0025) * 0.5 + 0.5;   // 0-1, ~2.5s period
  const pulse2   = Math.sin(now * 0.004 + 1.2) * 0.5 + 0.5;

  // ── 1. Dark purple storm overlay OUTSIDE safe zone ──
  ctx.save();
  ctx.beginPath();
  ctx.rect(-10, -10, MAP_SIZE + 20, MAP_SIZE + 20);
  ctx.arc(cx, cy, r, 0, Math.PI * 2, true);  // cut out safe circle
  ctx.fillStyle = `rgba(40,0,70,${0.45 + pulse * 0.1})`;
  ctx.fill();

  // ── 2. Swirling storm fog (multiple overlapping radial grads outside) ──
  for (let i = 0; i < 3; i++) {
    const angle  = (now * 0.0004 * (i % 2 === 0 ? 1 : -1)) + (i * Math.PI * 2 / 3);
    const offX   = cx + Math.cos(angle) * (r + 60);
    const offY   = cy + Math.sin(angle) * (r + 60);
    const fogR   = 120 + i * 30;
    const grad   = ctx.createRadialGradient(offX, offY, 0, offX, offY, fogR);
    grad.addColorStop(0,   `rgba(120,20,200,${0.18 + pulse2 * 0.08})`);
    grad.addColorStop(0.5, `rgba(80,10,160,${0.1})`);
    grad.addColorStop(1,   "rgba(40,0,80,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(offX, offY, fogR, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── 3. Glowing storm wall at boundary ──
  const wallW = 28 + pulse * 12;
  const wall  = ctx.createRadialGradient(cx, cy, r - wallW * 0.3, cx, cy, r + wallW);
  wall.addColorStop(0,    "rgba(180,80,255,0)");
  wall.addColorStop(0.35, `rgba(200,100,255,${0.25 + pulse * 0.2})`);
  wall.addColorStop(0.65, `rgba(230,140,255,${0.55 + pulse * 0.25})`);
  wall.addColorStop(0.85, `rgba(255,180,255,${0.3 + pulse2 * 0.2})`);
  wall.addColorStop(1,    "rgba(180,80,255,0)");

  // Full circle gradient (mask clips to ring shape via compositing)
  ctx.fillStyle = wall;
  ctx.beginPath();
  ctx.arc(cx, cy, r + wallW + 5, 0, Math.PI * 2);
  ctx.fill();

  // ── 4. Lightning bolts along storm wall ──
  const boltSeed = Math.floor(now / 120);  // change every 120ms
  for (let b = 0; b < STORM_BOLTS; b++) {
    const phase = seededRand(boltSeed * 31 + b * 7);
    if (phase > 0.35) continue;           // only ~35% of bolts visible at once
    const angle   = seededRand(boltSeed * 17 + b * 13) * Math.PI * 2;
    const startR  = r - 8;
    const sx = cx + Math.cos(angle) * startR;
    const sy = cy + Math.sin(angle) * startR;
    const len = 18 + seededRand(boltSeed * 7 + b) * 22;
    const alpha = 0.6 + phase * 1.2;

    ctx.strokeStyle = `rgba(220,180,255,${Math.min(1, alpha)})`;
    ctx.lineWidth   = 0.8 + seededRand(boltSeed + b * 3) * 1.0;
    ctx.lineCap     = "round";
    ctx.beginPath();

    // Jagged lightning segment
    let lx = sx, ly = sy;
    const segments = 4;
    ctx.moveTo(lx, ly);
    for (let s = 1; s <= segments; s++) {
      const t   = s / segments;
      const nx  = sx + Math.cos(angle) * (-len * t);
      const ny  = sy + Math.sin(angle) * (-len * t);
      const jitter = (seededRand(boltSeed * 100 + b * 50 + s) - 0.5) * 10;
      const perpX  = Math.cos(angle + Math.PI / 2) * jitter;
      const perpY  = Math.sin(angle + Math.PI / 2) * jitter;
      lx = nx + perpX; ly = ny + perpY;
      ctx.lineTo(lx, ly);
    }
    ctx.stroke();

    // Glow at bolt origin
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 8);
    glow.addColorStop(0,   `rgba(255,220,255,${alpha * 0.7})`);
    glow.addColorStop(1,   "rgba(180,80,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fill();
  }

  // ── 5. Inner safe-zone soft edge (subtle vignette) ──
  const innerFade = ctx.createRadialGradient(cx, cy, r * 0.75, cx, cy, r);
  innerFade.addColorStop(0, "rgba(80,0,120,0)");
  innerFade.addColorStop(1, `rgba(80,0,120,${0.08 + pulse * 0.05})`);
  ctx.fillStyle = innerFade;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

// ── Interpolation ─────────────────────────────────────────────────────────────
function interpolatePosition(uid, t) {
  const pts = playerPositions[uid];
  if (!pts || !pts.length) return null;
  if (t <= pts[0].t) return pts[0];
  if (t >= pts[pts.length - 1].t) return pts[pts.length - 1];
  let lo = 0, hi = pts.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = pts[lo], b = pts[hi];
  if (a.t === b.t) return a;
  const frac = (t - a.t) / (b.t - a.t);
  return { px: a.px + (b.px - a.px) * frac, py: a.py + (b.py - a.py) * frac, human: a.human };
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function draw(now) {
  if (!mapImage) return;
  now = now || performance.now();

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.ox, vp.oy);

  // Map background
  ctx.drawImage(mapImage, 0, 0, MAP_SIZE, MAP_SIZE);
  drawInference();

  if (togHeatmap.checked) {
    drawHeatmap();
    drawStorm(now);
    ctx.restore();
    drawEffects(now);
    return;
  }

  drawExtractionZones();
  if (togPaths.checked)  drawPaths();
  if (togEvents.checked) drawEventMarkers();
  drawGhostDots();
  drawLiveDots();
  drawStorm(now);

  ctx.restore();
  drawEffects(now);
}

// ── Extraction zones ──────────────────────────────────────────────────────────
function drawExtractionZones() {
  if (!currentMatch) return;
  const zones = EXTRACTION_ZONES[currentMatch.meta.map];
  if (!zones) return;
  const maxN = Math.max(...zones.map(z => z.n));
  ctx.save();
  for (const z of zones) {
    const alpha = 0.18 + (z.n / maxN) * 0.22;
    const r     = 28 + (z.n / maxN) * 18;
    // Soft green fill
    const grad = ctx.createRadialGradient(z.px, z.py, 0, z.px, z.py, r);
    grad.addColorStop(0,   `rgba(102,187,106,${alpha})`);
    grad.addColorStop(0.5, `rgba(76,175,80,${alpha * 0.5})`);
    grad.addColorStop(1,   "rgba(56,142,60,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(z.px, z.py, r, 0, Math.PI * 2); ctx.fill();
    // Dashed ring
    ctx.strokeStyle = `rgba(102,187,106,${alpha * 2})`;
    ctx.lineWidth   = 1 / vp.scale;
    ctx.setLineDash([4 / vp.scale, 3 / vp.scale]);
    ctx.beginPath(); ctx.arc(z.px, z.py, r * 0.65, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // Label
    ctx.fillStyle   = `rgba(102,187,106,${alpha * 3})`;
    ctx.font        = `${9 / vp.scale}px monospace`;
    ctx.textAlign   = "center";
    ctx.fillText("EXTRACT", z.px, z.py + r * 0.68 + 10 / vp.scale);
  }
  ctx.restore();
}

// ── Paths ──────────────────────────────────────────────────────────────────────
function drawPaths() {
  for (const uid of Object.keys(playerPositions)) {
    const pts  = playerPositions[uid];
    if (!pts || pts.length < 2) continue;
    const type = pts[0].type;                            // "human"|"bot"|"agent"
    if (type === "human" && !togHumans.checked) continue;
    if (type !== "human" && !togBots.checked)  continue;

    const lastPing = pts[pts.length - 1].t;
    const isActive = currentTime - lastPing <= 15;
    const visible  = pts.filter(p => p.t <= currentTime);
    if (visible.length < 2) continue;

    const col = colorForType(type);
    ctx.beginPath();
    ctx.strokeStyle = col;
    ctx.lineWidth   = type === "human" ? (1.8 / vp.scale) : type === "agent" ? (1.4 / vp.scale) : (0.9 / vp.scale);
    ctx.globalAlpha = type === "human" ? 0.85 : type === "agent" ? 0.7 : 0.35;
    ctx.lineJoin    = "round";
    ctx.lineCap     = "round";
    if (!isActive) ctx.globalAlpha *= 0.35;   // dim trail after disconnect
    ctx.moveTo(visible[0].px, visible[0].py);
    for (let i = 1; i < visible.length; i++) ctx.lineTo(visible[i].px, visible[i].py);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ── Event markers ─────────────────────────────────────────────────────────────
function drawEventMarkers() {
  const visible = currentMatch.events.filter(e =>
    e.t <= currentTime &&
    ["Kill","Killed","BotKill","KilledByStorm","Loot"].includes(e.ev) &&
    e.px != null
  );
  const R = 5 / vp.scale;
  for (const e of visible) {
    if (e.type === "human" && !togHumans.checked) continue;
    if (e.type !== "human" && !togBots.checked)  continue;
    ctx.globalAlpha = 0.85;
    // Use midpoint kill coords (kpx/kpy) when available, else killer position
    const mx = (e.ev === "BotKill" && e.kpx != null) ? e.kpx : e.px;
    const my = (e.ev === "BotKill" && e.kpy != null) ? e.kpy : e.py;
    switch (e.ev) {
      case "Kill":      drawPvPKill(mx, my, R * 1.2); break;   // rare — white starburst
      case "BotKill":   drawSkull(mx, my, R); break;            // common bot kill
      case "Killed": case "BotKilled": drawDeathX(e.px, e.py, R, C.death); break;
      case "KilledByStorm": drawDeathX(e.px, e.py, R, C.storm); break;
      case "Loot":      drawLootDiamond(e.px, e.py, R * 0.85); break;
    }
  }
  ctx.globalAlpha = 1;
}

// PvP kill: rare event — distinct white starburst so it stands out from BotKills
function drawPvPKill(x, y, r) {
  ctx.fillStyle   = C.pvp;
  ctx.strokeStyle = "#ff9800";
  ctx.lineWidth   = 1 / vp.scale;
  const spikes = 6;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const ang = (i * Math.PI) / spikes - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.45;
    i === 0 ? ctx.moveTo(x + Math.cos(ang)*rad, y + Math.sin(ang)*rad)
            : ctx.lineTo(x + Math.cos(ang)*rad, y + Math.sin(ang)*rad);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
}

function drawSkull(x, y, r) {
  ctx.fillStyle   = C.kill;
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.lineWidth   = 0.8 / vp.scale;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = "#000";
  ctx.lineWidth   = 1.2 / vp.scale;
  const d = r * 0.5;
  ctx.beginPath(); ctx.moveTo(x-d,y-d); ctx.lineTo(x+d,y+d); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x+d,y-d); ctx.lineTo(x-d,y+d); ctx.stroke();
}

function drawDeathX(x, y, r, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.8 / vp.scale;
  ctx.lineCap     = "round";
  ctx.beginPath(); ctx.moveTo(x-r,y-r); ctx.lineTo(x+r,y+r); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x+r,y-r); ctx.lineTo(x-r,y+r); ctx.stroke();
  ctx.strokeStyle = color + "88";
  ctx.lineWidth   = 0.6 / vp.scale;
  ctx.beginPath(); ctx.arc(x, y, r * 1.3, 0, Math.PI * 2); ctx.stroke();
}

function drawLootDiamond(x, y, r) {
  ctx.fillStyle   = C.loot;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth   = 0.7 / vp.scale;
  ctx.beginPath();
  ctx.moveTo(x,y-r); ctx.lineTo(x+r,y); ctx.lineTo(x,y+r); ctx.lineTo(x-r,y);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.moveTo(x,y-r*0.5); ctx.lineTo(x+r*0.45,y); ctx.lineTo(x,y-r*0.1);
  ctx.closePath(); ctx.fill();
}

// ── Live dots ─────────────────────────────────────────────────────────────────
function drawLiveDots() {
  for (const uid of Object.keys(playerPositions)) {
    const pts  = playerPositions[uid];
    if (!pts || !pts.length) continue;
    const type = pts[0].type;
    if (type === "human" && !togHumans.checked) continue;
    if (type !== "human" && !togBots.checked)  continue;
    if (pts[0].t > currentTime) continue;

    const lastPing = pts[pts.length - 1].t;
    if (currentTime - lastPing > 15) continue;   // ghost dot handles this range

    const pos = interpolatePosition(uid, currentTime);
    if (!pos) continue;
    const col = colorForType(type);
    const r   = (type === "human" ? 5 : type === "agent" ? 4.5 : 3.5) / vp.scale;

    if (type !== "bot") {
      // Human / agent: glowing dot with halo
      const [cr, cg, cb] = type === "human" ? [79,195,247] : [255,213,79];
      const grad = ctx.createRadialGradient(pos.px, pos.py, r, pos.px, pos.py, r * 3.5);
      grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.3)`);
      grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(pos.px, pos.py, r * 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle   = type === "human" ? "#fff" : C.agent;
      ctx.strokeStyle = col;
      ctx.lineWidth   = 1.5 / vp.scale;
      ctx.beginPath(); ctx.arc(pos.px, pos.py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Agent: draw a small diamond overlay to distinguish from human
      if (type === "agent") {
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth   = 0.6 / vp.scale;
        const d = r * 0.55;
        ctx.beginPath();
        ctx.moveTo(pos.px, pos.py - d); ctx.lineTo(pos.px + d, pos.py);
        ctx.lineTo(pos.px, pos.py + d); ctx.lineTo(pos.px - d, pos.py);
        ctx.closePath(); ctx.stroke();
      }
    } else {
      ctx.fillStyle   = C.bot;
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth   = 0.8 / vp.scale;
      ctx.beginPath(); ctx.arc(pos.px, pos.py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

// ── Ghost dots: last-known position for players whose telemetry ended ──────────
function drawGhostDots() {
  for (const uid of Object.keys(playerPositions)) {
    const pts  = playerPositions[uid];
    if (!pts || !pts.length) continue;
    const type = pts[0].type;
    if (type === "human" && !togHumans.checked) continue;
    if (type !== "human" && !togBots.checked)  continue;

    const firstT   = pts[0].t;
    const lastPing = pts[pts.length - 1].t;
    if (firstT > currentTime) continue;         // hasn't entered the match yet
    if (currentTime - lastPing <= 15) continue;  // still active — live dot handles it

    const last = pts[pts.length - 1];
    const r = (type === "bot" ? 3 : 4.5) / vp.scale;

    // Dashed ghost circle
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = colorForType(type);
    ctx.lineWidth   = 1 / vp.scale;
    ctx.setLineDash([3 / vp.scale, 2.5 / vp.scale]);
    ctx.beginPath(); ctx.arc(last.px, last.py, r * 1.6, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    // Small filled centre
    ctx.globalAlpha = 0.2;
    ctx.fillStyle   = colorForType(type);
    ctx.beginPath(); ctx.arc(last.px, last.py, r * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

// ── Player popup ───────────────────────────────────────────────────────────────
function getPlayerStats(uid) {
  const evs    = currentMatch.events.filter(e => e.uid === uid);
  const kills  = evs.filter(e => e.ev === "Kill"  || e.ev === "BotKill").length;
  const deaths = evs.filter(e => ["Killed","BotKilled","KilledByStorm"].includes(e.ev)).length;
  const loot   = evs.filter(e => e.ev === "Loot").length;
  const pts    = playerPositions[uid];
  const survived = pts ? pts[pts.length - 1].t - pts[0].t : 0;
  return { kills, deaths, loot, survived };
}

function handleCanvasClick(screenX, screenY) {
  if (!currentMatch) return;
  const mapX = (screenX - vp.ox) / vp.scale;
  const mapY = (screenY - vp.oy) / vp.scale;
  const HIT_R = 16 / vp.scale;  // 16px on screen

  let best = null, bestDist = Infinity;
  for (const uid of Object.keys(playerPositions)) {
    const pts = playerPositions[uid];
    if (!pts || !pts.length) continue;
    if (pts[0].t > currentTime) continue;

    const lastPing = pts[pts.length - 1].t;
    // Check both live position and ghost (last known)
    const pos = (currentTime - lastPing <= 15)
      ? interpolatePosition(uid, currentTime)
      : pts[pts.length - 1];
    if (!pos) continue;

    const dist = Math.hypot(pos.px - mapX, pos.py - mapY);
    if (dist < HIT_R && dist < bestDist) { bestDist = dist; best = uid; }
  }

  if (best) showPlayerPopup(best, screenX, screenY);
  else hidePlayerPopup();
}

function showPlayerPopup(uid, sx, sy) {
  const pts      = playerPositions[uid];
  const type     = pts[0].type;
  const stats    = getPlayerStats(uid);
  const lastPing = pts[pts.length - 1].t;
  const isActive = currentTime - lastPing <= 15;
  const shortId  = String(uid).length > 20 ? String(uid).slice(0, 13) + "…" : uid;
  const label    = type === "human" ? "&#128100; Human" : type === "agent" ? "&#9888; Test Agent" : "&#129302; Bot";

  playerPopup.innerHTML = `
    <div class="popup-header ${type}">
      ${label}
      <span class="popup-id">${shortId}</span>
    </div>
    <div class="popup-stats">
      <div>Kills <b>${stats.kills}</b></div>
      <div>Deaths <b>${stats.deaths}</b></div>
      <div>Loot <b>${stats.loot}</b></div>
      <div>Survived <b>${fmtTime(stats.survived)}</b></div>
      ${!isActive ? '<div class="popup-ghost">&#9679; No data after ' + fmtTime(lastPing) + '</div>' : ''}
    </div>`;

  // Keep popup inside canvas bounds
  const pw = 165, ph = 100;
  const W = canvas.width, H = canvas.height;
  playerPopup.style.left = (sx + 14 + pw > W ? sx - pw - 10 : sx + 14) + "px";
  playerPopup.style.top  = (sy - 20 + ph > H ? H - ph - 8 : Math.max(8, sy - 20)) + "px";
  playerPopup.classList.remove("hidden");
}

function hidePlayerPopup() {
  playerPopup.classList.add("hidden");
}

// ── Heatmap ───────────────────────────────────────────────────────────────────
function drawHeatmap() {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
  const positions = currentMatch.events.filter(e =>
    (e.ev === "Position" || e.ev === "BotPosition") && e.t <= currentTime && e.px != null
  );
  if (!positions.length) return;
  const GRID = 80, CELL = MAP_SIZE / GRID;
  const grid = new Float32Array(GRID * GRID);
  let maxVal = 0;
  for (const e of positions) {
    if (e.type === "human" && !togHumans.checked) continue;
    if (e.type !== "human" && !togBots.checked)  continue;
    const gx = Math.min(GRID-1, Math.floor(e.px / CELL));
    const gy = Math.min(GRID-1, Math.floor(e.py / CELL));
    const v  = ++grid[gy * GRID + gx];
    if (v > maxVal) maxVal = v;
  }
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const v = grid[gy * GRID + gx];
      if (!v) continue;
      const t = Math.sqrt(v / maxVal);
      const cx2 = (gx + 0.5) * CELL, cy2 = (gy + 0.5) * CELL, r = CELL * 2;
      const g = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, r);
      if (t > 0.6) {
        g.addColorStop(0,    `rgba(255,255,220,${t * 0.95})`);
        g.addColorStop(0.25, `rgba(255,180,0,${t * 0.8})`);
        g.addColorStop(0.6,  `rgba(255,40,0,${t * 0.5})`);
        g.addColorStop(1,    "rgba(200,0,0,0)");
      } else {
        g.addColorStop(0,   `rgba(255,120,0,${t * 0.7})`);
        g.addColorStop(0.5, `rgba(200,30,0,${t * 0.35})`);
        g.addColorStop(1,   "rgba(150,0,0,0)");
      }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// ── Effects ───────────────────────────────────────────────────────────────────
function checkNewEffects() {
  if (!currentMatch) return;
  for (const e of currentMatch.events) {
    if (e.t > currentTime || e.t <= lastEffectTime || e.px == null) continue;
    const key = `${e.uid}|${e.t}|${e.ev}`;
    if (spawnedKeys.has(key)) continue;
    spawnedKeys.add(key);
    const [cx, cy] = toCanvas(e.px, e.py);
    const born = performance.now();
    switch (e.ev) {
      case "Kill": case "BotKill":     effects.push({ type:"kill",  cx, cy, born, dur:900 }); break;
      case "Killed": case "BotKilled": effects.push({ type:"death", cx, cy, born, dur:1100 }); break;
      case "KilledByStorm":            effects.push({ type:"storm_death", cx, cy, born, dur:1400 }); break;
      case "Loot":                     effects.push({ type:"loot",  cx, cy, born, dur:750 }); break;
    }
  }
  lastEffectTime = currentTime;
}

function drawEffects(now) {
  const alive = [];
  for (const ef of effects) {
    const age = (now - ef.born) / ef.dur;
    if (age >= 1) continue;
    alive.push(ef);
    const easeOut = 1 - age;
    const { cx, cy } = ef;
    ctx.save();
    switch (ef.type) {
      case "kill": {
        ctx.strokeStyle = `rgba(255,160,0,${easeOut * 0.9})`;
        ctx.lineWidth   = 3 * easeOut;
        ctx.beginPath(); ctx.arc(cx, cy, age * 28, 0, Math.PI * 2); ctx.stroke();
        if (age > 0.2) {
          ctx.strokeStyle = `rgba(255,220,80,${easeOut * 0.6})`;
          ctx.lineWidth   = 1.5 * easeOut;
          ctx.beginPath(); ctx.arc(cx, cy, (age-0.2)*20, 0, Math.PI * 2); ctx.stroke();
        }
        if (age < 0.25) {
          const fl = (0.25 - age) / 0.25;
          ctx.fillStyle = `rgba(255,230,100,${fl})`;
          ctx.beginPath(); ctx.arc(cx, cy, 10*fl, 0, Math.PI*2); ctx.fill();
        }
        for (let i = 0; i < 6; i++) {
          const ang = (i/6)*Math.PI*2;
          ctx.strokeStyle = `rgba(255,180,50,${easeOut*0.7})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(cx+Math.cos(ang)*5, cy+Math.sin(ang)*5);
          ctx.lineTo(cx+Math.cos(ang)*age*22, cy+Math.sin(ang)*age*22);
          ctx.stroke();
        }
        break;
      }
      case "death": {
        ctx.strokeStyle = `rgba(220,50,50,${easeOut*0.85})`;
        ctx.lineWidth   = 2.5 * easeOut;
        ctx.beginPath(); ctx.arc(cx, cy, age*24, 0, Math.PI*2); ctx.stroke();
        for (let i = 0; i < 8; i++) {
          const ang  = (i/8)*Math.PI*2 + 0.3;
          ctx.fillStyle = `rgba(180,0,0,${easeOut*0.8})`;
          ctx.beginPath(); ctx.arc(cx+Math.cos(ang)*age*18, cy+Math.sin(ang)*age*18, 2.5*easeOut, 0, Math.PI*2); ctx.fill();
        }
        if (age < 0.3) {
          const fl = (0.3-age)/0.3;
          ctx.fillStyle = `rgba(255,100,100,${fl*0.7})`;
          ctx.beginPath(); ctx.arc(cx, cy, 8*fl, 0, Math.PI*2); ctx.fill();
        }
        break;
      }
      case "storm_death": {
        ctx.strokeStyle = `rgba(200,100,255,${easeOut*0.8})`;
        ctx.lineWidth   = 2*easeOut;
        ctx.setLineDash([6,4]);
        ctx.lineDashOffset = -age*30;
        ctx.beginPath(); ctx.arc(cx, cy, age*32, 0, Math.PI*2); ctx.stroke();
        ctx.setLineDash([]);
        if (age < 0.4) {
          const fl = (0.4-age)/0.4;
          ctx.fillStyle = `rgba(200,100,255,${fl*0.5})`;
          ctx.beginPath(); ctx.arc(cx, cy, 10*fl, 0, Math.PI*2); ctx.fill();
        }
        break;
      }
      case "loot": {
        for (let i = 0; i < 8; i++) {
          const ang = (i/8)*Math.PI*2;
          ctx.fillStyle = i%2===0 ? `rgba(100,220,100,${easeOut*0.9})` : `rgba(200,255,100,${easeOut*0.7})`;
          ctx.beginPath();
          ctx.arc(cx+Math.cos(ang)*age*24, cy+Math.sin(ang)*age*24 - age*8, 3*easeOut, 0, Math.PI*2);
          ctx.fill();
        }
        if (age < 0.4) {
          const fl = (0.4-age)/0.4;
          ctx.fillStyle = `rgba(150,255,150,${fl*0.6})`;
          ctx.beginPath(); ctx.arc(cx, cy - age*10, 6*fl, 0, Math.PI*2); ctx.fill();
        }
        break;
      }
    }
    ctx.restore();
  }
  effects.length = 0;
  effects.push(...alive);
}

// ── Playback ──────────────────────────────────────────────────────────────────
btnPlay.addEventListener("click", () => playing ? stopPlayback() : startPlayback());

scrubber.addEventListener("input", () => {
  if (playing) return;     // ignore input events triggered by rafLoop's programmatic scrubber.value set
  currentTime = parseInt(scrubber.value);
  lastEffectTime = currentTime;
  spawnedKeys.clear();
  updateTimeLabel(currentTime);
  draw();
});

function startPlayback() {
  if (!currentMatch) return;
  playing = true;
  btnPlay.innerHTML = "⏸";
  if (currentTime >= currentMatch.meta.duration) { currentTime = 0; spawnedKeys.clear(); lastEffectTime = -1; }
  lastRafTs = null;
  rafId = requestAnimationFrame(rafLoop);
}

function stopPlayback() {
  playing = false;
  btnPlay.innerHTML = "▶";
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

function rafLoop(ts) {
  if (!playing) return;
  try {
    const speed = parseFloat(speedSel.value);
    if (lastRafTs != null) {
      const dt = (ts - lastRafTs) / 1000;
      currentTime = Math.min(currentMatch.meta.duration, currentTime + dt * speed);
    }
    lastRafTs = ts;
    if (currentTime >= currentMatch.meta.duration) {
      currentTime = currentMatch.meta.duration;
      stopPlayback();
    }
    // Use valueAsNumber setter directly to avoid firing the input event
    scrubber.valueAsNumber = Math.round(currentTime);
    updateTimeLabel(currentTime);
    checkNewEffects();
    draw(ts);
  } catch (err) {
    console.error("rafLoop error:", err);
  }
  if (playing) rafId = requestAnimationFrame(rafLoop);
}

// Ambient loop: keeps storm/glow animating even when paused
function startAmbient() {
  if (ambientRafId) return;
  let lastTs = 0;
  function loop(ts) {
    if (!playing && currentMatch && ts - lastTs > 33) {  // ~30fps
      draw(ts);
      lastTs = ts;
    }
    ambientRafId = requestAnimationFrame(loop);
  }
  ambientRafId = requestAnimationFrame(loop);
}

function stopAmbient() {
  if (ambientRafId) { cancelAnimationFrame(ambientRafId); ambientRafId = null; }
}

function updateTimeLabel(t) {
  const dur = currentMatch?.meta.duration || 0;
  timeLabel.textContent = `${fmtTime(t)} / ${fmtTime(dur)}`;
}

// ── Layer toggles ─────────────────────────────────────────────────────────────
[togPaths, togEvents, togHeatmap, togBots, togHumans, togStorm].forEach(el =>
  el.addEventListener("change", draw));
togInfer.addEventListener("change", () => { updateInferBadge(); draw(); });

// ── Inference layer ───────────────────────────────────────────────────────────
async function loadInferenceData(mapName) {
  if (inferenceCache[mapName]) { inferenceData = inferenceCache[mapName]; return; }
  try {
    const res = await fetch(`data/inference/${mapName}.json`);
    if (!res.ok) { inferenceData = null; return; }
    inferenceCache[mapName] = await res.json();
    inferenceData = inferenceCache[mapName];
  } catch { inferenceData = null; }
}

function updateInferBadge() {
  inferBadge.classList.toggle("hidden", !togInfer.checked);
}

function drawInference() {
  if (!inferenceData || !togInfer || !togInfer.checked) return;
  const inf = inferenceData;
  ctx.save();

  // ── 1. Cross-match bot heatmap (cool blue-slate palette, distinct from red heatmap) ──
  const { cells, max: maxH, grid: GRID } = inf.heatmap;
  const CELL = MAP_SIZE / GRID;
  for (const [gx, gy, n] of cells) {
    const t   = Math.sqrt(n / maxH);
    const cx2 = (gx + 0.5) * CELL;
    const cy2 = (gy + 0.5) * CELL;
    const r   = CELL * 2.2;
    const g   = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, r);
    if (t > 0.55) {
      g.addColorStop(0,   `rgba(180,230,255,${t * 0.55})`);
      g.addColorStop(0.3, `rgba(70,150,220,${t * 0.38})`);
      g.addColorStop(0.7, `rgba(20,70,160,${t * 0.18})`);
      g.addColorStop(1,   "rgba(10,40,100,0)");
    } else {
      g.addColorStop(0,   `rgba(50,120,200,${t * 0.4})`);
      g.addColorStop(0.6, `rgba(20,70,160,${t * 0.18})`);
      g.addColorStop(1,   "rgba(10,40,100,0)");
    }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, Math.PI * 2); ctx.fill();
  }

  // ── 2. Patrol route ghost paths (amber dashed) ───────────────────────────────
  ctx.lineJoin  = "round";
  ctx.lineCap   = "round";
  ctx.lineWidth = 1.5 / vp.scale;
  ctx.setLineDash([5 / vp.scale, 4 / vp.scale]);
  for (const route of inf.routes) {
    if (route.length < 2) continue;
    ctx.strokeStyle = "rgba(255,213,79,0.28)";
    ctx.beginPath();
    ctx.moveTo(route[0][0], route[0][1]);
    for (let i = 1; i < route.length; i++) ctx.lineTo(route[i][0], route[i][1]);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // ── 3. Kill uncertainty circles (dotted amber rings at each visible BotKill) ──
  const engageR = inf.engage_px;
  ctx.strokeStyle = "rgba(255,213,79,0.4)";
  ctx.lineWidth   = 0.9 / vp.scale;
  ctx.setLineDash([3 / vp.scale, 3 / vp.scale]);
  for (const e of currentMatch.events) {
    if (e.ev !== "BotKill" || e.t > currentTime) continue;
    const kx = e.kpx ?? e.px;
    const ky = e.kpy ?? e.py;
    if (kx == null) continue;
    ctx.beginPath(); ctx.arc(kx, ky, engageR, 0, Math.PI * 2); ctx.stroke();
    // Small dot at centre to anchor the circle
    ctx.fillStyle = "rgba(255,213,79,0.5)";
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(kx, ky, 2 / vp.scale, 0, Math.PI * 2); ctx.fill();
    ctx.setLineDash([3 / vp.scale, 3 / vp.scale]);
  }
  ctx.setLineDash([]);

  ctx.restore();
}

// ── Legend ────────────────────────────────────────────────────────────────────
function buildLegend() {
  const leg = document.createElement("div");
  leg.id = "legend";
  leg.innerHTML = `
    <h4>Legend</h4>
    <div class="legend-row"><div class="l-icon"><svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="${C.human}" stroke-width="2.5" stroke-linecap="round"/></svg></div>Human path</div>
    <div class="legend-row"><div class="l-icon"><svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="${C.agent}" stroke-width="2" stroke-linecap="round" stroke-dasharray="4,2"/></svg></div>Test agent path</div>
    <div class="legend-row"><div class="l-icon"><svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="${C.bot}" stroke-width="1.5" stroke-linecap="round"/></svg></div>Bot path</div>
    <div class="legend-row"><div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="5" fill="white" stroke="${C.human}" stroke-width="1.5"/><circle cx="9" cy="9" r="8" fill="none" stroke="${C.human}" stroke-width="0.8" opacity="0.4"/></svg></div>Player position</div>
    <div class="legend-row"><div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><polygon points="9,1 10.8,6.5 17,6.5 11.9,10 13.7,15.5 9,12 4.3,15.5 6.1,10 1,6.5 7.2,6.5" fill="${C.pvp}" stroke="#ff9800" stroke-width="0.8"/></svg></div>PvP kill (rare)</div>
    <div class="legend-row"><div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="4.5" fill="${C.kill}"/><line x1="5.5" y1="5.5" x2="12.5" y2="12.5" stroke="#000" stroke-width="1.5" stroke-linecap="round"/><line x1="12.5" y1="5.5" x2="5.5" y2="12.5" stroke="#000" stroke-width="1.5" stroke-linecap="round"/></svg></div>Bot kill</div>
    <div class="legend-row"><div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><line x1="3" y1="3" x2="15" y2="15" stroke="${C.death}" stroke-width="2" stroke-linecap="round"/><line x1="15" y1="3" x2="3" y2="15" stroke="${C.death}" stroke-width="2" stroke-linecap="round"/><circle cx="9" cy="9" r="7" fill="none" stroke="${C.death}" stroke-width="0.8" opacity="0.6"/></svg></div>Death</div>
    <div class="legend-row"><div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><line x1="3" y1="3" x2="15" y2="15" stroke="${C.storm}" stroke-width="2" stroke-linecap="round"/><line x1="15" y1="3" x2="3" y2="15" stroke="${C.storm}" stroke-width="2" stroke-linecap="round"/><circle cx="9" cy="9" r="7" fill="none" stroke="${C.storm}" stroke-width="0.8" opacity="0.6"/></svg></div>Storm death</div>
    <div class="legend-row"><div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><polygon points="9,2 16,9 9,16 2,9" fill="${C.loot}" stroke="rgba(0,0,0,0.5)" stroke-width="0.8"/><polygon points="9,4 13,9 9,10" fill="rgba(255,255,255,0.4)"/></svg></div>Loot</div>
    <div class="legend-row"><div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="rgba(80,0,120,0.5)" stroke="rgba(200,100,255,0.9)" stroke-width="1.5" stroke-dasharray="3,2"/></svg></div>Storm zone</div>
    <div class="legend-row" style="margin-top:6px;padding-top:6px;border-top:1px solid #252530"><div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="rgba(76,175,80,0.25)" stroke="rgba(102,187,106,0.7)" stroke-width="1" stroke-dasharray="3,2"/></svg></div><span style="color:#66bb6a">Extract zone</span></div>
    <div class="legend-row" style="margin-top:2px;padding-top:4px;border-top:1px solid #252530"><div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="rgba(30,80,180,0.35)" stroke="rgba(100,180,255,0.5)" stroke-width="1"/></svg></div><span style="color:#ffd54f">~ Bot density</span></div>
    <div class="legend-row"><div class="l-icon"><svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="rgba(255,213,79,0.5)" stroke-width="1.5" stroke-dasharray="4,3"/></svg></div><span style="color:#ffd54f">~ Patrol routes</span></div>
    <div class="legend-row"><div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="rgba(255,213,79,0.6)" stroke-width="1" stroke-dasharray="3,3"/><circle cx="9" cy="9" r="1.5" fill="rgba(255,213,79,0.7)"/></svg></div><span style="color:#ffd54f">~ Kill range</span></div>
  `;
  wrap.appendChild(leg);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(s) {
  return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
}

init();
