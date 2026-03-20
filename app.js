/* ══ LILA BLACK — Player Journey Visualizer ══ */

const MAP_IMAGES = {
  AmbroseValley: "maps/AmbroseValley_Minimap.png",
  GrandRift:     "maps/GrandRift_Minimap.png",
  Lockdown:      "maps/Lockdown_Minimap.jpg",
};

const MAP_SIZE = 1024;
const MAP_CENTER = { x: 512, y: 512 };

// Storm: phased model — each phase has a wait period then a shrink period,
// matching how BR/extraction games actually implement their safe zones.
// [start_frac, end_frac, r_start, r_end, wait_frac]
const STORM_PHASES = [
  [0.00, 0.22, 680, 490, 0.55],  // phase 1 — slow start
  [0.22, 0.47, 490, 300, 0.40],  // phase 2
  [0.47, 0.68, 300, 170, 0.35],  // phase 3
  [0.68, 0.86, 170,  88, 0.30],  // phase 4
  [0.86, 1.00,  88,  42, 0.20],  // phase 5 — rapid final collapse
];

const C = {
  human:  "#4fc3f7", humanDim: "rgba(79,195,247,0.35)",
  bot:    "#ef5350", botDim:   "rgba(239,83,80,0.25)",
  squad:  "#26c6da",                                     // teal — AI squad companion bot
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
let playing        = false;
let userScrubbing  = false;   // true while user has pointer down on the scrubber
let rafId        = null;
let ambientRafId = null;   // low-fps loop for storm/glow animation when paused
let lastRafTs    = null;
let currentTime  = 0;

let vp   = { scale: 1, ox: 0, oy: 0 };
let drag = null;

let playerPositions  = {};  // uid → [{t,px,py,type}] sorted by t
let effects          = [];
let lastEffectTime   = -1;
const spawnedKeys    = new Set();
let extractionPoint  = null;  // {t,px,py} — synthesized from last human ping when outcome=extracted

let botDeathMap    = new Map();  // uid → {t, px, py} for inferred bot kills

let inferenceData  = null;  // loaded per-map, cross-match bot data
const inferenceCache = {};  // mapName → parsed JSON (session cache)

let stormCenter = { x: 512, y: 512 };  // estimated per match from late-game positions

let analysisMode    = false;
let aggregateData   = null;   // loaded per-map
const aggregateCache = {};    // mapName → parsed JSON

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
const togRoutes  = document.getElementById("toggle-routes");
const inferWrap  = document.getElementById("infer-toggle-wrap");
const inferBadge = document.getElementById("infer-badge");

const filterMap     = document.getElementById("filter-map");
const filterDay     = document.getElementById("filter-day");
const filterSort    = document.getElementById("filter-sort");
const filterOutcome = document.getElementById("filter-outcome");
const speedSel      = document.getElementById("playback-speed");
const btnPrev       = document.getElementById("btn-prev");
const btnNext       = document.getElementById("btn-next");
const playerPopup   = document.getElementById("player-popup");
const btnAnalysis   = document.getElementById("btn-analysis");
const analysisControls = document.getElementById("analysis-controls");
const analysisTitle    = document.getElementById("analysis-title");
const btnExitAnalysis  = document.getElementById("btn-exit-analysis");
const evTooltip        = document.getElementById("ev-tooltip");

const atogMovement = document.getElementById("atog-movement");
const atogKills    = document.getElementById("atog-kills");
const atogDeaths   = document.getElementById("atog-deaths");
const atogLoot     = document.getElementById("atog-loot");
const atogDwell    = document.getElementById("atog-dwell");
const atogExtract  = document.getElementById("atog-extract");
const homeView     = document.getElementById("home-view");

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const res = await fetch("data/index.json");
  allMatches = await res.json();
  renderMatchList();
  buildLegend();
  [filterMap, filterDay, filterSort, filterOutcome].forEach(el =>
    el.addEventListener("change", renderMatchList));
  showHome();
}

// ── Match list ────────────────────────────────────────────────────────────────
function renderMatchList() {
  const mapF     = filterMap.value;
  const dayF     = filterDay.value;
  const sortF    = filterSort.value;
  const outcomeF = filterOutcome.value;
  filteredMatches = allMatches
    .filter(m => (!mapF || m.map === mapF) && (!dayF || m.day === dayF)
                 && (!outcomeF || m.outcome === outcomeF))
    .sort((a, b) => b[sortF] - a[sortF]);
  const list = filteredMatches;

  updateNavButtons();
  matchCount.textContent = `(${list.length})`;
  matchList.innerHTML = list.map(m => {
    const dur = fmtTime(m.duration);
    const day = m.day.replace("February_", "Feb ");
    // Suspicious: died to bots >> bot kills (ratio > 2.5)
    const suspicious    = m.bot_kills === 0 && m.bot_killed > 3;
    const hasAgent      = m.agents > 0;
    const agentBadge    = hasAgent ? ` <span style="color:${C.agent};font-size:9px">&#9888;</span>` : "";
    const bsSq          = m.bot_squads || [];
    const botSquadTotal = bsSq.reduce((s, g) => s + g[1], 0);
    const loneBots      = m.bots - (m.squad || 0) - botSquadTotal;
    const sqBadge       = bsSq.length > 0
      ? ` <span style="color:#ef9a9a;font-size:9px;font-weight:700;letter-spacing:0.3px">Sq×${bsSq.length}</span>` : "";
    const cmpBadge      = m.squad > 0
      ? ` <span style="color:${C.squad};font-size:9px;font-weight:700">cmp</span>` : "";
    const OUTCOME_LABEL = { extracted:"Extracted", survived:"Survived", died:"Died", ragequit:"Rage-quit?", unknown:"" };
    const oc      = m.outcome || "unknown";
    const ocBadge = oc !== "unknown"
      ? ` <span class="outcome-badge outcome-${oc}">${OUTCOME_LABEL[oc]}</span>` : "";
    // Compact bot count: lone + companion superscript + squad badges
    const botMeta = loneBots > 0 || (!m.squad && !bsSq.length)
      ? `B:<b>${loneBots}</b>${m.squad ? `<span style="color:${C.squad}">+${m.squad}c</span>` : ""}${bsSq.map(([id,n])=>`<span style="color:#ef9a9a">+${n}s${id}</span>`).join("")}`
      : `B:${m.squad ? `<span style="color:${C.squad}">${m.squad}c</span>` : ""}${bsSq.map(([id,n])=>`<span style="color:#ef9a9a">${n}s${id}</span>`).join(" ")}`;
    return `<li data-id="${m.id}" ${suspicious ? 'style="border-left-color:#ff9800"' : ''}>
      <div class="match-title">
        <span class="match-map-tag tag-${m.map}">${shortMap(m.map)}</span>
        ${m.id.slice(0, 8)}${suspicious ? ' <span style="color:#ff9800;font-size:9px">&#9888;</span>' : ""}${agentBadge}${sqBadge}${cmpBadge}
        ${ocBadge}
      </div>
      <div class="match-meta">
        ${day} · ${dur} · <b>${m.total_events}</b> ev · H:<b>${m.humans}</b>${m.agents > 0 ? ` A:<b style="color:${C.agent}">${m.agents}</b>` : ""} ${botMeta}
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
  hideHome();
  // If coming from Map Analysis mode, tear it down so match playback renders correctly
  if (analysisMode) {
    analysisMode = false;
    btnAnalysis.classList.remove("active");
    analysisControls.classList.add("hidden");
  }
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
  inferBotKillTargets();
  computeStormCenter();
  detectExtractionPoint();

  // Storm toggle: default OFF when the estimated ring is demonstrably wrong
  // (human survives well outside the safe zone with no storm deaths).
  togStorm.checked = isStormReliable();

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
    (() => {
      const bsSq2      = m.bot_squads || [];
      const bsTotal    = bsSq2.reduce((s,g)=>s+g[1],0);
      const loneB      = m.bots - (m.squad||0) - bsTotal;
      const parts      = [];
      if (loneB > 0)  parts.push(`<b>${loneB}</b> lone`);
      if (m.squad)    parts.push(`<span style="color:${C.squad}">${m.squad} companion</span>`);
      bsSq2.forEach(([id,n]) => parts.push(`<span style="color:#ef9a9a">Sq${id}:${n}</span>`));
      const breakdown  = parts.length ? ` (${parts.join(" · ")})` : "";
      return `Bots: <b>${m.bots}</b>${breakdown}<span class="stat-sep">|</span>`;
    })() +
    `Player kills: <b>${currentMatch.events.filter(e => e.ev === "BotKill" && e.type === "human").length}</b><span class="stat-sep">|</span>` +
    `Bot deaths: <b>${m.bot_killed}</b><span class="stat-sep">|</span>` +
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
    playerPositions[e.uid].push({ t: e.t, px: e.px, py: e.py, type: e.type, sq: e.sq ?? null });
  }
}

// Populate botDeathMap from BotKilled events recorded in bot files.
// BotKilled (type="bot") = a bot was killed — uid IS the dead bot, px/py IS its death position.
// No inference needed: the bot's own file records exactly where and when it died.
function inferBotKillTargets() {
  botDeathMap.clear();
  // BotKilled on bot files = enemy bot died. Squad bots never get BotKilled events.
  for (const ev of currentMatch.events) {
    if (ev.ev !== "BotKilled" || ev.type !== "bot") continue;
    botDeathMap.set(ev.uid, { t: ev.t, px: ev.px, py: ev.py });
  }
}

function colorForType(type) {
  if (type === "human") return C.human;
  if (type === "agent") return C.agent;
  if (type === "squad") return C.squad;
  return C.bot;
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
  const col   = { Kill:"#ff9800", BotKill:"#ff9800", BotKilled:"#ff9800",
                  Killed:"#f44336", KilledByStorm:"#ce93d8", Loot:"#66bb6a" };
  const label = { Kill:"PvP Kill", BotKill:"Bot Kill", BotKilled:"Bot Died",
                  Killed:"Player Died", KilledByStorm:"Storm Death", Loot:"Loot" };
  evMarkers.innerHTML = currentMatch.events
    .filter(e => col[e.ev])
    .map(e => {
      const pct = (e.t / dur) * 100;
      const tip = `${label[e.ev]} — ${fmtTime(e.t)}`;
      return `<div class="ev-tick" style="left:${pct}%;background:${col[e.ev]}" data-tip="${tip}"></div>`;
    }).join("");

  // Tooltip on hover
  evMarkers.querySelectorAll(".ev-tick").forEach(tick => {
    tick.addEventListener("mouseenter", () => {
      evTooltip.textContent = tick.dataset.tip;
      evTooltip.classList.remove("hidden");
    });
    tick.addEventListener("mousemove", e => {
      evTooltip.style.left = (e.clientX + 12) + "px";
      evTooltip.style.top  = (e.clientY - 28) + "px";
    });
    tick.addEventListener("mouseleave", () => evTooltip.classList.add("hidden"));
    // Click to scrub to that time
    tick.addEventListener("click", e => {
      e.stopPropagation();
      const t = parseFloat(tick.style.left) / 100 * dur;
      currentTime = Math.round(t);
      scrubber.valueAsNumber = currentTime;
      updateTimeLabel(currentTime);
      lastEffectTime = currentTime;
      spawnedKeys.clear();
      draw();
    });
  });
}

// ── Viewport ──────────────────────────────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
}

function fitViewport() {
  const W = canvas.width, H = canvas.height;
  const s  = Math.min(W / MAP_SIZE, H / MAP_SIZE);
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

// Estimate safe-zone center from match data:
// - Players alive in late game (t > 50% of duration) must be inside the ring.
// - Their median position is a good proxy for ring center.
// - Players who died to storm are excluded (they were outside).
function computeStormCenter() {
  if (!currentMatch) { stormCenter = { ...MAP_CENTER }; return; }
  const dur = currentMatch.meta.duration;
  const stormKilled = new Set(
    currentMatch.events.filter(e => e.ev === "KilledByStorm").map(e => e.uid)
  );

  // Use the final 20% of match time — ring is at its smallest, so all alive
  // players MUST be inside it. Their mean position ≈ ring center.
  // Fall back to final 35% if too few pings in the last 20%.
  for (const cutoff of [0.80, 0.65, 0.50]) {
    const late = currentMatch.events.filter(e =>
      e.ev === "Position" && e.t > dur * cutoff && e.px != null && !stormKilled.has(e.uid)
    );
    if (late.length < 5) continue;
    // Trim outliers: remove top/bottom 10% on each axis before averaging
    const xs = late.map(p => p.px).sort((a, b) => a - b);
    const ys = late.map(p => p.py).sort((a, b) => a - b);
    const trim = Math.max(1, Math.floor(xs.length * 0.10));
    const txs  = xs.slice(trim, xs.length - trim);
    const tys  = ys.slice(trim, ys.length - trim);
    const mx   = txs.reduce((s, v) => s + v, 0) / txs.length;
    const my   = tys.reduce((s, v) => s + v, 0) / tys.length;
    stormCenter = {
      x: Math.max(80, Math.min(944, mx)),
      y: Math.max(80, Math.min(944, my)),
    };
    return;
  }
  stormCenter = { ...MAP_CENTER };
}

// Returns true when the storm ring estimate is trustworthy enough to show by default.
// Heuristic: if the human player's late-game positions are consistently OUTSIDE
// the estimated safe zone yet no storm deaths occurred, the ring center is wrong.
// Storm deaths are ground truth — if any exist, the estimate is good enough.
function isStormReliable() {
  if ((currentMatch.meta.storm_deaths || 0) > 0) return true;

  const dur     = currentMatch.meta.duration;
  const humanUid = Object.keys(playerPositions).find(
    uid => playerPositions[uid][0]?.type === "human"
  );
  if (!humanUid) return false;

  const pts      = playerPositions[humanUid];
  const latePts  = pts.filter(p => p.t >= dur * 0.70);
  if (latePts.length < 3) return false;

  // Storm radius at 85% of match (well into late game)
  const stormR = getStormRadius(dur * 0.85);

  const outsideCount = latePts.filter(p =>
    Math.hypot(p.px - stormCenter.x, p.py - stormCenter.y) > stormR
  ).length;

  // If >40% of late pings are outside the estimated safe zone, the estimate is off
  return (outsideCount / latePts.length) < 0.4;
}

// Detect the extraction moment for matches with outcome=extracted.
// No Extraction event exists in the telemetry — the human's last Position ping is
// the best proxy for when/where they stepped into the extraction zone.
function detectExtractionPoint() {
  extractionPoint = null;
  if (currentMatch?.meta?.outcome !== "extracted") return;
  let last = null;
  for (const uid of Object.keys(playerPositions)) {
    const pts = playerPositions[uid];
    if (!pts?.length || pts[0].type !== "human") continue;
    const pt = pts[pts.length - 1];
    if (!last || pt.t > last.t) last = pt;
  }
  if (last) extractionPoint = { t: last.t, px: last.px, py: last.py };
}

// Phased ring radius: wait → shrink → wait → shrink pattern (matches real BR/extraction games)
function getStormRadius(t) {
  if (!currentMatch) return STORM_PHASES[0][2];
  const frac = Math.min(1, t / currentMatch.meta.duration);
  for (const [pStart, pEnd, rStart, rEnd, waitFrac] of STORM_PHASES) {
    if (frac <= pEnd) {
      const phFrac = (frac - pStart) / (pEnd - pStart);
      if (phFrac <= waitFrac) return rStart;
      const shrinkFrac = (phFrac - waitFrac) / (1 - waitFrac);
      return rStart - (rStart - rEnd) * (shrinkFrac * shrinkFrac);  // ease-in
    }
  }
  return STORM_PHASES[STORM_PHASES.length - 1][3];
}

// Seeded pseudo-random for stable bolt positions per frame
function seededRand(seed) {
  const x = Math.sin(seed + 1) * 43758.5453;
  return x - Math.floor(x);
}

function drawStorm(now) {
  if (!togStorm || !togStorm.checked) return;

  const r        = getStormRadius(currentTime);
  const cx       = stormCenter.x;
  const cy       = stormCenter.y;
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
  if (analysisMode) { drawAnalysis(); return; }   // analysis mode takes over canvas
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
  drawExtractionMarker(now);
  if (togPaths.checked)  drawPaths();
  if (togEvents.checked) drawEventMarkers();
  drawGhostDots();
  drawLiveDots();
  drawStorm(now);

  ctx.restore();
  drawEffects(now);
}

// Persistent pulsing marker shown after the player extracts (for the rest of the match)
function drawExtractionMarker(now) {
  if (!extractionPoint || currentTime < extractionPoint.t) return;
  const { px, py } = extractionPoint;
  const pulse = Math.sin(now * 0.003) * 0.5 + 0.5;  // 0–1, ~2s period
  ctx.save();
  // Soft glow
  const grad = ctx.createRadialGradient(px, py, 0, px, py, 34 + pulse * 10);
  grad.addColorStop(0,   `rgba(0,255,180,${0.25 + pulse * 0.15})`);
  grad.addColorStop(0.6, `rgba(0,200,130,${0.1  + pulse * 0.06})`);
  grad.addColorStop(1,   "rgba(0,180,100,0)");
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(px, py, 44 + pulse * 10, 0, Math.PI * 2); ctx.fill();
  // Dashed ring
  ctx.strokeStyle = `rgba(0,230,160,${0.55 + pulse * 0.35})`;
  ctx.lineWidth   = 1.5 / vp.scale;
  ctx.setLineDash([4 / vp.scale, 3 / vp.scale]);
  ctx.beginPath(); ctx.arc(px, py, 20 / vp.scale, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  // Label
  ctx.fillStyle = `rgba(0,230,160,${0.7 + pulse * 0.3})`;
  ctx.font      = `bold ${8 / vp.scale}px monospace`;
  ctx.textAlign = "center";
  ctx.fillText("EXTRACTED", px, py + 28 / vp.scale);
  ctx.restore();
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

    // Cap dead bots' paths at their kill time
    const death   = botDeathMap.get(uid);
    const capTime = (death && currentTime > death.t) ? death.t : currentTime;

    const lastPing = pts[pts.length - 1].t;
    const isActive = capTime - lastPing <= 15;
    const visible  = pts.filter(p => p.t <= capTime);
    if (visible.length < 2) continue;

    const col = colorForType(type);
    ctx.beginPath();
    ctx.strokeStyle = col;
    ctx.lineWidth   = type === "human" ? (1.8 / vp.scale) : type === "agent" ? (1.4 / vp.scale)
                    : type === "squad" ? (1.2 / vp.scale) : (0.9 / vp.scale);
    ctx.globalAlpha = type === "human" ? 0.85 : type === "agent" ? 0.7
                    : type === "squad" ? 0.6 : 0.35;
    ctx.setLineDash(type === "squad" ? [6 / vp.scale, 4 / vp.scale] : []);
    ctx.lineJoin    = "round";
    ctx.lineCap     = "round";
    if (!isActive) ctx.globalAlpha *= 0.35;   // dim trail after disconnect
    ctx.moveTo(visible[0].px, visible[0].py);
    for (let i = 1; i < visible.length; i++) ctx.lineTo(visible[i].px, visible[i].py);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}

// ── Event markers ─────────────────────────────────────────────────────────────
function drawEventMarkers() {
  const visible = currentMatch.events.filter(e =>
    e.t <= currentTime &&
    ["Kill","Killed","BotKilled","BotKill","KilledByStorm","Loot"].includes(e.ev) &&
    e.px != null
  );
  const R = 5 / vp.scale;
  for (const e of visible) {
    if (e.type === "human" && !togHumans.checked) continue;
    if (e.type !== "human" && !togBots.checked)  continue;
    ctx.globalAlpha = 0.85;
    switch (e.ev) {
      case "Kill":     drawPvPKill(e.px, e.py, R * 1.2); break;   // rare white starburst
      case "BotKill":
        // When bot telemetry files exist, skip here — BotKilled (victim record) is authoritative.
        // When no bot telemetry (bots === 0), there are no BotKilled events, so draw the marker
        // here instead, using inferred victim position (kpx/kpy) if available, else killer's position.
        if (currentMatch.meta.bots === 0) {
          const mx = e.kpx ?? e.px, my = e.kpy ?? e.py;
          if (mx != null) drawBotKillMark(mx, my, R);
        }
        break;
      case "BotKilled":
        // BotKilled is ALWAYS a bot dying (logged on the victim bot's file, type="bot").
        // The marker appears at the bot's exact death position.
        drawBotKillMark(e.px, e.py, R);
        break;
      case "Killed":          drawPlayerDeath(e.px, e.py, R); break;  // red skull — PvP death
      case "KilledByStorm":   drawDeathX(e.px, e.py, R, C.storm); break;
      case "Loot":            drawLootDiamond(e.px, e.py, R * 0.85); break;
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

// BotKill: orange upward triangle — "you scored a kill on a bot"
function drawBotKillMark(x, y, r) {
  ctx.fillStyle   = C.kill;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth   = 0.8 / vp.scale;
  ctx.beginPath();
  ctx.moveTo(x,           y - r);
  ctx.lineTo(x + r * 0.87, y + r * 0.5);
  ctx.lineTo(x - r * 0.87, y + r * 0.5);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
}

// Player death (Killed — PvP): red skull — unmistakable death marker
function drawPlayerDeath(x, y, r) {
  const cy = y - r * 0.05;
  // Cranium (filled half-circle + flat jaw)
  ctx.fillStyle   = C.death;
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.lineWidth   = 0.8 / vp.scale;
  ctx.beginPath();
  ctx.arc(x, cy, r * 0.78, Math.PI, 0, false);
  ctx.lineTo(x + r * 0.78, cy + r * 0.55);
  ctx.lineTo(x - r * 0.78, cy + r * 0.55);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Eye sockets
  ctx.fillStyle = "rgba(0,0,0,0.82)";
  ctx.beginPath(); ctx.arc(x - r * 0.29, cy - r * 0.04, r * 0.21, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + r * 0.29, cy - r * 0.04, r * 0.21, 0, Math.PI * 2); ctx.fill();
  // Nasal gap
  ctx.beginPath(); ctx.arc(x, cy + r * 0.25, r * 0.13, 0, Math.PI * 2); ctx.fill();
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

    const death = botDeathMap.get(uid);
    if (death && currentTime > death.t) continue;   // bot has been killed — don't render

    const lastPing = pts[pts.length - 1].t;
    if (currentTime - lastPing > 15) continue;   // ghost dot handles this range

    const pos = interpolatePosition(uid, currentTime);
    if (!pos) continue;
    const col = colorForType(type);
    const r = (type === "human" ? 7 : type === "agent" ? 6 : 5) / vp.scale;

    if (type === "bot") {
      // Enemy bot: solid red dot; bot squad members also get a numbered badge
      ctx.fillStyle   = C.bot;
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth   = 0.8 / vp.scale;
      ctx.beginPath(); ctx.arc(pos.px, pos.py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
      const sqNum = pts[0].sq;
      if (sqNum != null) {
        // Small white badge at top-right of dot with squad number.
        // All sizes in minimap-pixel space (divided by vp.scale → fixed screen-pixel size).
        const br = 4   / vp.scale;   // badge radius: 4 screen px
        const bx = pos.px + 6 / vp.scale;
        const by = pos.py - 6 / vp.scale;
        ctx.globalAlpha  = 0.95;
        ctx.fillStyle    = "#fff";
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle        = "#b71c1c";
        ctx.font             = `bold ${7 / vp.scale}px sans-serif`;
        ctx.textAlign        = "center";
        ctx.textBaseline     = "middle";
        ctx.fillText(String(sqNum), bx, by);
        ctx.globalAlpha = 1;
      }
    } else if (type === "squad") {
      // Squad companion bot: teal dot with shield outline (friendly marker)
      ctx.fillStyle   = C.squad;
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth   = 0.8 / vp.scale;
      ctx.beginPath(); ctx.arc(pos.px, pos.py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Small shield chevron on top to mark as friendly
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth   = 0.9 / vp.scale;
      ctx.beginPath();
      ctx.moveTo(pos.px - r * 0.45, pos.py - r * 0.15);
      ctx.lineTo(pos.px,            pos.py - r * 0.6);
      ctx.lineTo(pos.px + r * 0.45, pos.py - r * 0.15);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
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
      // Agent: small diamond overlay
      if (type === "agent") {
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth   = 0.6 / vp.scale;
        const d = r * 0.55;
        ctx.beginPath();
        ctx.moveTo(pos.px, pos.py - d); ctx.lineTo(pos.px + d, pos.py);
        ctx.lineTo(pos.px, pos.py + d); ctx.lineTo(pos.px - d, pos.py);
        ctx.closePath(); ctx.stroke();
      }
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
    const death = botDeathMap.get(uid);
    if (death && currentTime > death.t) continue;  // killed bot — no ghost, marker shows it

    const last = pts[pts.length - 1];
    const r = (type === "bot" ? 5 : type === "squad" ? 5 : 6.5) / vp.scale;

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
  const sq       = pts[0].sq;
  const label    = type === "human"  ? "&#128100; Human"
    : type === "agent"  ? "&#9888; Test Agent"
    : type === "squad"  ? "&#129302; Companion Bot"
    : sq != null ? `&#129302; Bot <span style="background:#fff;color:#b71c1c;font-size:9px;font-weight:800;padding:1px 4px;border-radius:3px;vertical-align:middle">Sq${sq}</span>`
    : "&#129302; Bot";

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
      case "Kill":                      effects.push({ type:"kill",  cx, cy, born, dur:900 }); break;
      case "BotKill":                   break;  // skip — BotKilled fires the effect at the dead bot
      case "BotKilled":                  effects.push({ type:"kill",  cx, cy, born, dur:900 }); break;
      case "Killed":                     effects.push({ type:"death", cx, cy, born, dur:1100 }); break;
      case "KilledByStorm":            effects.push({ type:"storm_death", cx, cy, born, dur:1400 }); break;
      case "Loot":                     effects.push({ type:"loot",  cx, cy, born, dur:750 }); break;
    }
  }
  lastEffectTime = currentTime;

  // Synthesized extraction effect — fires at the moment the human's telemetry ends
  if (extractionPoint) {
    const key = `extract|${extractionPoint.t}`;
    if (!spawnedKeys.has(key) && currentTime >= extractionPoint.t) {
      spawnedKeys.add(key);
      const [cx, cy] = toCanvas(extractionPoint.px, extractionPoint.py);
      effects.push({ type: "extraction", cx, cy, born: performance.now(), dur: 2800 });
    }
  }
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
      case "extraction": {
        // 1. Ground flash burst (fades in first 25% of animation)
        if (age < 0.25) {
          const fl  = (0.25 - age) / 0.25;
          const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 55 * fl);
          grd.addColorStop(0,   `rgba(200,255,230,${fl * 0.9})`);
          grd.addColorStop(0.4, `rgba(0,230,150,${fl * 0.6})`);
          grd.addColorStop(1,   "rgba(0,180,100,0)");
          ctx.fillStyle = grd;
          ctx.beginPath(); ctx.arc(cx, cy, 55 * fl, 0, Math.PI * 2); ctx.fill();
        }
        // 2. Vertical beam of light
        const bEase  = age < 0.35 ? (age / 0.35) : easeOut;
        const bH     = 180 * bEase;
        const bAlpha = bEase * 0.9;
        const bGrad  = ctx.createLinearGradient(cx, cy, cx, cy - bH);
        bGrad.addColorStop(0,    `rgba(0,255,180,${bAlpha})`);
        bGrad.addColorStop(0.45, `rgba(80,255,200,${bAlpha * 0.55})`);
        bGrad.addColorStop(1,    `rgba(0,255,160,0)`);
        const bw = 16 * bEase;
        ctx.fillStyle = bGrad;
        ctx.fillRect(cx - bw / 2, cy - bH, bw, bH);
        // Bright core line
        ctx.strokeStyle = `rgba(230,255,245,${bAlpha * 0.9})`;
        ctx.lineWidth   = 2.5 * bEase;
        ctx.lineCap     = "round";
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - bH); ctx.stroke();
        // 3. Expanding concentric rings
        for (let i = 0; i < 3; i++) {
          const rAge  = Math.max(0, age - i * 0.1);
          const rFade = Math.max(0, 1 - rAge * 1.5);
          if (rFade <= 0) continue;
          ctx.strokeStyle = `rgba(0,230,160,${rFade * 0.8})`;
          ctx.lineWidth   = 3 * rFade;
          ctx.beginPath(); ctx.arc(cx, cy, rAge * 90, 0, Math.PI * 2); ctx.stroke();
        }
        // 4. Rising particles
        for (let i = 0; i < 12; i++) {
          const pOff = ((i / 12) + age * 1.4) % 1;
          const pX   = cx + Math.sin(i * 2.1 + age * 10) * (16 - pOff * 12);
          const pY   = cy - pOff * 170;
          ctx.fillStyle = `rgba(180,255,220,${(1 - pOff) * bAlpha})`;
          ctx.beginPath(); ctx.arc(pX, pY, 3 * (1 - pOff * 0.5), 0, Math.PI * 2); ctx.fill();
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

scrubber.addEventListener("pointerdown", () => { userScrubbing = true; });
window.addEventListener("pointerup",    () => { userScrubbing = false; });

scrubber.addEventListener("input", () => {
  // Ignore programmatic updates from rafLoop (scrubber.valueAsNumber = ...)
  // but allow user drags even while playing.
  if (playing && !userScrubbing) return;
  currentTime = parseFloat(scrubber.value);
  lastEffectTime = currentTime;
  spawnedKeys.clear();
  updateTimeLabel(currentTime);
  if (!playing) draw();
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
togRoutes.addEventListener("change", draw);

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

  // ── 2. Patrol route ghost paths (amber dashed, toggle-gated) ────────────────
  if (togRoutes && togRoutes.checked) {
    // High-confidence filter: keep only longer routes (≥8 waypoints),
    // then spatially deduplicate (skip if start within 50px of a kept route).
    const MIN_WP  = 8;
    const DEDUP_R = 50;
    const kept = [];
    const sorted = [...inf.routes].sort((a, b) => b.length - a.length);
    for (const route of sorted) {
      if (route.length < MIN_WP) break;  // sorted desc, no point continuing
      const [rx, ry] = route[0];
      const dupe = kept.some(k => Math.hypot(k[0][0] - rx, k[0][1] - ry) < DEDUP_R);
      if (!dupe) kept.push(route);
      if (kept.length >= 22) break;  // cap at 22 routes max
    }
    ctx.lineJoin  = "round";
    ctx.lineCap   = "round";
    ctx.lineWidth = 1.5 / vp.scale;
    ctx.setLineDash([5 / vp.scale, 4 / vp.scale]);
    for (const route of kept) {
      ctx.strokeStyle = "rgba(255,213,79,0.32)";
      ctx.beginPath();
      ctx.moveTo(route[0][0], route[0][1]);
      for (let i = 1; i < route.length; i++) ctx.lineTo(route[i][0], route[i][1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

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

// ── Home / Dashboard ─────────────────────────────────────────────────────────
function showHome() {
  if (!allMatches.length) return;
  stopPlayback();
  hidePlayerPopup();
  emptyState.classList.add("hidden");
  topbar.classList.add("hidden");
  timeline.classList.add("hidden");
  analysisControls.classList.add("hidden");
  wrap.style.display = "none";
  homeView.classList.remove("hidden");
  if (!homeView.dataset.built) buildHomeView();
}

function hideHome() {
  homeView.classList.add("hidden");
  wrap.style.display = "";
}

function buildHomeView() {
  homeView.dataset.built = "1";
  const M  = allMatches;
  const N  = M.length;
  const totalSecs     = M.reduce((s, m) => s + m.duration, 0);
  const totalBotKills = M.reduce((s, m) => s + m.bot_kills, 0);
  const diedCount     = M.filter(m => m.outcome === "died").length;
  const survPct       = Math.round((N - diedCount) / N * 100);

  const MAPS = ["AmbroseValley", "GrandRift", "Lockdown"];
  const ML   = { AmbroseValley: "Ambrose Valley", GrandRift: "Grand Rift", Lockdown: "Lockdown" };
  const DAYS = ["February_10","February_11","February_12","February_13","February_14"];
  const DL   = ["Feb 10","Feb 11","Feb 12","Feb 13","Feb 14"];

  // Per-map stats
  const mapStats = {};
  for (const mp of MAPS) {
    const ms = M.filter(m => m.map === mp);
    const n  = ms.length || 1;
    mapStats[mp] = {
      count:     ms.length,
      died:      ms.filter(m => m.outcome === "died").length,
      survived:  ms.filter(m => m.outcome === "survived").length,
      extracted: ms.filter(m => m.outcome === "extracted").length,
      ragequit:  ms.filter(m => m.outcome === "ragequit").length,
      avgDur:    ms.reduce((s,m) => s + m.duration, 0) / n,
      avgBotKills: ms.reduce((s,m) => s + m.bot_kills, 0) / n,
      zeroPct:   ms.filter(m => m.bot_kills === 0).length / n * 100,
    };
  }

  // Duration histogram (2-min bins: 0–2, 2–4, … 12–14, 14+)
  const binCount = 8;
  const bins = new Array(binCount).fill(0);
  const binL  = ["0–2","2–4","4–6","6–8","8–10","10–12","12–14","14+"];
  for (const m of M) bins[Math.min(binCount - 1, Math.floor(m.duration / 120))]++;

  // Per-day stats
  const dayStats = DAYS.map(d => {
    const ms = M.filter(m => m.day === d);
    const n  = ms.length || 1;
    return { count: ms.length, survPct: Math.round(ms.filter(m => m.outcome !== "died").length / n * 100) };
  });

  // ── SVG helpers ──────────────────────────────────────────────────────────
  const GP = { t: 14, r: 8, b: 24, l: 10 };  // chart padding

  function svgBars(vals, labels, color, W, H) {
    const max = Math.max(...vals, 1);
    const aw  = W - GP.l - GP.r;
    const ah  = H - GP.t - GP.b;
    const bw  = aw / vals.length * 0.62;
    const gap = aw / vals.length;
    let s = `<svg width="${W}" height="${H}" style="display:block;overflow:visible">`;
    vals.forEach((v, i) => {
      const bh = (v / max) * ah;
      const x  = GP.l + i * gap + (gap - bw) / 2;
      const y  = GP.t + ah - bh;
      s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(bh, 1).toFixed(1)}" fill="${color}" rx="2"/>`;
      s += `<text x="${(x+bw/2).toFixed(1)}" y="${(H-GP.b+14).toFixed(1)}" text-anchor="middle" fill="#555" font-size="8" font-family="monospace">${labels[i]}</text>`;
      if (v > 0) s += `<text x="${(x+bw/2).toFixed(1)}" y="${(y-3).toFixed(1)}" text-anchor="middle" fill="#999" font-size="8" font-family="monospace">${v}</text>`;
    });
    s += `</svg>`;
    return s;
  }

  function svgLine(vals, labels, color, W, H, suffix = "") {
    const max  = Math.max(...vals, 1);
    const aw   = W - GP.l - GP.r;
    const ah   = H - GP.t - GP.b;
    const step = aw / Math.max(vals.length - 1, 1);
    const pts  = vals.map((v, i) => {
      const x = GP.l + i * step;
      const y = GP.t + ah * (1 - v / max);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    let s = `<svg width="${W}" height="${H}" style="display:block;overflow:visible">`;
    s += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>`;
    vals.forEach((v, i) => {
      const x = GP.l + i * step;
      const y = GP.t + ah * (1 - v / max);
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${color}"/>`;
      s += `<text x="${x.toFixed(1)}" y="${(H-GP.b+14).toFixed(1)}" text-anchor="middle" fill="#555" font-size="8" font-family="monospace">${labels[i]}</text>`;
      s += `<text x="${x.toFixed(1)}" y="${(y-6).toFixed(1)}" text-anchor="middle" fill="#ccc" font-size="9" font-family="monospace">${v}${suffix}</text>`;
    });
    s += `</svg>`;
    return s;
  }

  function svgStackedHBars(rows, W) {
    const COLORS = { died:"#ef5350", survived:"#66bb6a", extracted:"#26c6da", ragequit:"#ffa726" };
    const CATS   = ["died","survived","extracted","ragequit"];
    const maxV   = Math.max(...rows.map(r => r.count));
    const labelW = 44;
    const avail  = W - labelW - 36;
    const rh     = 26;
    const gap    = 10;
    let s = `<svg width="${W}" height="${rows.length * (rh + gap) - gap + 4}" style="display:block">`;
    rows.forEach((row, i) => {
      const y = i * (rh + gap);
      s += `<rect x="${labelW}" y="${y}" width="${avail}" height="${rh}" fill="rgba(255,255,255,0.03)" rx="3"/>`;
      let x = labelW;
      for (const cat of CATS) {
        const bw = (row[cat] / maxV) * avail;
        if (bw < 0.5) continue;
        s += `<rect x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${rh}" fill="${COLORS[cat]}" rx="2"/>`;
        if (bw > 20) s += `<text x="${(x+bw/2).toFixed(1)}" y="${(y+rh/2+4).toFixed(1)}" text-anchor="middle" fill="rgba(0,0,0,0.75)" font-size="9" font-weight="bold" font-family="monospace">${row[cat]}</text>`;
        x += bw;
      }
      s += `<text x="${(labelW-5).toFixed(1)}" y="${(y+rh/2+4).toFixed(1)}" text-anchor="end" fill="#bbb" font-size="11" font-family="monospace">${row.label}</text>`;
      s += `<text x="${(labelW+avail+4).toFixed(1)}" y="${(y+rh/2+4).toFixed(1)}" fill="#555" font-size="9" font-family="monospace">${row.count}</text>`;
    });
    s += `</svg>`;
    return s;
  }

  function kpi(val, lbl, note = "", tip = "") {
    return `<div class="kpi-card"${tip ? ` title="${tip}"` : ""}><div class="kpi-val">${val}</div><div class="kpi-lbl">${lbl}</div>${note ? `<div class="kpi-note">${note}</div>` : ""}</div>`;
  }

  // Build chart data
  const outcomeRows  = MAPS.map(mp => ({ label: shortMap(mp), count: mapStats[mp].count, ...mapStats[mp] }));
  const outcomeSVG   = svgStackedHBars(outcomeRows, 400);
  const durationSVG  = svgBars(bins, binL, "#7e57c2", 400, 130);
  const dayCountSVG  = svgLine(dayStats.map(d => d.count),   DL, "#42a5f5", 370, 120);
  const daySurvSVG   = svgLine(dayStats.map(d => d.survPct), DL, "#66bb6a", 370, 120, "%");

  const botRows = MAPS.map(mp => {
    const s    = mapStats[mp];
    const zpct = s.zeroPct.toFixed(0);
    const col  = parseFloat(zpct) > 60 ? "#ef5350" : parseFloat(zpct) > 30 ? "#ffa726" : "#66bb6a";
    return `<tr>
      <td><span class="match-map-tag tag-${mp}">${shortMap(mp)}</span>&nbsp;${ML[mp]}</td>
      <td class="hv-num">${s.count}</td>
      <td class="hv-num">${s.avgBotKills.toFixed(1)}</td>
      <td class="hv-num">${fmtTime(Math.round(s.avgDur))}</td>
      <td class="hv-num" style="color:${col}">${zpct}%</td>
    </tr>`;
  }).join("");

  homeView.innerHTML = `
    <div class="hv-header">
      <h2 class="hv-title">Match Analytics</h2>
      <p class="hv-sub">${N} matches &nbsp;·&nbsp; Feb 10–14 &nbsp;·&nbsp; Ambrose Valley · Grand Rift · Lockdown</p>
    </div>

    <div class="kpi-strip">
      ${kpi(N, "Total Matches", "", "Total number of recorded matches across all maps and days")}
      ${kpi(fmtHours(totalSecs), "Total Playtime", "", "Sum of all match durations — total player-hours in the dataset")}
      ${kpi(fmtTime(Math.round(totalSecs / N)), "Avg Duration", "", "Average match length. Short matches often indicate early deaths; long matches indicate survival or extraction")}
      ${kpi(totalBotKills.toLocaleString(), "Total Bot Kills", "", "Total bot kills across all matches. Low average per match may indicate bots are avoiding players or are too easy to avoid")}
      ${kpi(survPct + "%", "Not Died", "survived · extracted · ragequit", "% of matches that did not end in the player's death — includes survived, extracted, and rage-quit sessions")}
    </div>

    <div class="hv-grid">
      <div class="hv-card" title="How matches ended on each map — bars show count of Died / Survived / Extracted / Rage-quit. A high Died bar means the map is punishing; high Extracted suggests accessible extraction">
        <h4 class="hv-card-title">Outcomes by Map</h4>
        <div class="hv-legend">
          <span class="hv-dot" style="background:#ef5350"></span>Died &nbsp;
          <span class="hv-dot" style="background:#66bb6a"></span>Survived &nbsp;
          <span class="hv-dot" style="background:#26c6da"></span>Extracted &nbsp;
          <span class="hv-dot" style="background:#ffa726"></span>Rage-quit
        </div>
        ${outcomeSVG}
      </div>

      <div class="hv-card" title="How long matches last — grouped into 2-minute buckets. Peaks reveal typical match pacing. A skew toward short matches suggests early-death problems; toward long suggests the map rewards survival">
        <h4 class="hv-card-title">Duration Distribution</h4>
        <p class="hv-note">Bucket size: 2 min</p>
        ${durationSVG}
      </div>

      <div class="hv-card" title="Number of matches recorded each day (Feb 10–14). Volume differences may indicate test sessions or data gaps">
        <h4 class="hv-card-title">Matches per Day</h4>
        ${dayCountSVG}
      </div>

      <div class="hv-card" title="% of matches per day that did not end in the player's death (survived + extracted + ragequit). Drops may indicate a harder day of play or specific map rotations">
        <h4 class="hv-card-title">Survival Rate per Day</h4>
        <p class="hv-note">% of matches that did not end in death</p>
        ${daySurvSVG}
      </div>

      <div class="hv-card hv-wide" title="How players interact with bots per map. '% Avoided Bots' is the share of matches where the player recorded zero bot kills — high avoidance suggests bots are placed in areas players skip">
        <h4 class="hv-card-title">Bot Engagement by Map</h4>
        <table class="hv-table">
          <thead><tr><th>Map</th><th style="text-align:right">Matches</th><th style="text-align:right">Avg Bot Kills/Match</th><th style="text-align:right">Avg Duration</th><th style="text-align:right">% Avoided Bots</th></tr></thead>
          <tbody>${botRows}</tbody>
        </table>
      </div>
    </div>

    <div id="hv-extract-section">
      <div class="hv-card hv-wide">
        <h4 class="hv-card-title">Extraction Zone Usage &nbsp;<span class="hv-note" style="font-weight:normal;text-transform:none">loading…</span></h4>
      </div>
    </div>
  `;

  fetchExtractionStats();
}

async function fetchExtractionStats() {
  const section = document.getElementById("hv-extract-section");
  if (!section) return;
  const MAPS = ["AmbroseValley", "GrandRift", "Lockdown"];
  const ML   = { AmbroseValley: "Ambrose Valley", GrandRift: "Grand Rift", Lockdown: "Lockdown" };
  const allZones = [];
  for (const mp of MAPS) {
    const staleExt = aggregateCache[mp] && !aggregateCache[mp].heatmaps?.dwell;
    if (!aggregateCache[mp] || staleExt) {
      try {
        const r = await fetch(`data/aggregate/${mp}.json?v=2`);
        if (r.ok) aggregateCache[mp] = await r.json();
      } catch {}
    }
    if (aggregateCache[mp]) {
      for (const z of aggregateCache[mp].extraction_zones) {
        const rate = z.total > 0 ? z.survivors / z.total : 0;
        allZones.push({ mapKey: mp, map: ML[mp], label: z.label, rate, survivors: z.survivors, total: z.total });
      }
    }
  }
  allZones.sort((a, b) => b.rate - a.rate);

  function rc(r) { return r > 0.4 ? "#66bb6a" : r > 0.2 ? "#ffa726" : "#ef5350"; }
  const rows = allZones.map(z => {
    const pct = Math.round(z.rate * 100);
    const c   = rc(z.rate);
    return `<tr>
      <td><span class="match-map-tag tag-${z.mapKey}">${shortMap(z.mapKey)}</span>&nbsp;${z.map}</td>
      <td>${z.label}</td>
      <td style="color:${c};font-weight:700;font-family:monospace">${pct}%</td>
      <td class="hv-num">${z.survivors}</td>
      <td class="hv-num">${z.total}</td>
      <td style="min-width:100px"><div class="hv-rate-bar"><div style="width:${pct}%;background:${c}"></div></div></td>
    </tr>`;
  }).join("");

  section.innerHTML = `
    <div class="hv-card hv-wide">
      <h4 class="hv-card-title">Extraction Zone Usage</h4>
      <p class="hv-note">% of players in a match who survived and whose last position was near each zone — ranked by usage rate</p>
      <table class="hv-table">
        <thead><tr><th>Map</th><th>Zone</th><th>Usage Rate</th><th style="text-align:right">Extracted</th><th style="text-align:right">Total Players</th><th>Bar</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function fmtHours(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

// ── Legend ────────────────────────────────────────────────────────────────────
function buildLegend() {
  const leg = document.createElement("div");
  leg.id = "legend";
  leg.innerHTML = `
    <h4>Legend</h4>

    <div class="legend-row">
      <div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18">
        <circle cx="9" cy="9" r="7.5" fill="rgba(79,195,247,0.18)" stroke="${C.human}" stroke-width="0.7" opacity="0.5"/>
        <circle cx="9" cy="9" r="5" fill="white" stroke="${C.human}" stroke-width="1.5"/>
      </svg></div>Human player
    </div>
    <div class="legend-row">
      <div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18">
        <circle cx="9" cy="9" r="5" fill="${C.bot}" stroke="rgba(0,0,0,0.5)" stroke-width="0.8" opacity="0.8"/>
      </svg></div>Enemy bot
    </div>
    <div class="legend-row">
      <div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18">
        <circle cx="9" cy="9" r="5" fill="${C.squad}" stroke="rgba(0,0,0,0.5)" stroke-width="0.8"/>
        <polyline points="6.8,9.2 9,6.5 11.2,9.2" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg></div><span style="color:${C.squad}">Companion bot</span> (spawned with player)
    </div>
    <div class="legend-row">
      <div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18">
        <circle cx="9" cy="9" r="5" fill="${C.bot}" stroke="rgba(0,0,0,0.5)" stroke-width="0.8" opacity="0.8"/>
        <circle cx="13.5" cy="4.5" r="3.5" fill="#fff" stroke="none"/>
        <text x="13.5" y="5.1" text-anchor="middle" dominant-baseline="middle" font-size="4.5" font-weight="bold" fill="#b71c1c">1</text>
      </svg></div><span style="color:#ef9a9a">Bot squad</span> (numbered badge per squad)
    </div>
    <div class="legend-row">
      <div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18">
        <circle cx="9" cy="9" r="5" fill="${C.agent}" stroke="rgba(0,0,0,0.5)" stroke-width="0.8"/>
        <polygon points="9,4.5 13.5,9 9,13.5 4.5,9" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="0.8"/>
      </svg></div><span style="color:${C.agent}">Test agent</span>
    </div>

    <div class="legend-row" style="margin-top:6px;padding-top:6px;border-top:1px solid #252530">
      <div class="l-icon"><svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="${C.human}" stroke-width="2.5" stroke-linecap="round"/></svg></div>Human path
    </div>
    <div class="legend-row">
      <div class="l-icon"><svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="${C.agent}" stroke-width="2" stroke-linecap="round" stroke-dasharray="4,2"/></svg></div>Agent path
    </div>
    <div class="legend-row">
      <div class="l-icon"><svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="${C.bot}" stroke-width="1.5" stroke-linecap="round"/></svg></div>Bot path
    </div>

    <div class="legend-row" style="margin-top:6px;padding-top:6px;border-top:1px solid #252530">
      <div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><polygon points="9,1 10.8,6.5 17,6.5 11.9,10 13.7,15.5 9,12 4.3,15.5 6.1,10 1,6.5 7.2,6.5" fill="${C.pvp}" stroke="#ff9800" stroke-width="0.8"/></svg></div>PvP kill (rare)
    </div>
    <div class="legend-row">
      <div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><polygon points="9,2 16,16 2,16" fill="${C.kill}" stroke="rgba(0,0,0,0.6)" stroke-width="0.8"/></svg></div><span style="color:${C.kill}">Bot killed</span> (shown at bot's position)
    </div>
    <div class="legend-row">
      <div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><path d="M9,3 A5.5,5.5 0 0,1 14.5,8.5 L13.5,12.5 L4.5,12.5 L3.5,8.5 A5.5,5.5 0 0,1 9,3 Z" fill="${C.death}" stroke="rgba(0,0,0,0.7)" stroke-width="0.8"/><circle cx="6.8" cy="8.8" r="1.5" fill="rgba(0,0,0,0.82)"/><circle cx="11.2" cy="8.8" r="1.5" fill="rgba(0,0,0,0.82)"/><circle cx="9" cy="11" r="0.95" fill="rgba(0,0,0,0.75)"/></svg></div><span style="color:${C.death}">Player died</span> (killed by bot or player)
    </div>
    <div class="legend-row">
      <div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><line x1="3" y1="3" x2="15" y2="15" stroke="${C.storm}" stroke-width="2" stroke-linecap="round"/><line x1="15" y1="3" x2="3" y2="15" stroke="${C.storm}" stroke-width="2" stroke-linecap="round"/><circle cx="9" cy="9" r="7" fill="none" stroke="${C.storm}" stroke-width="0.8" opacity="0.6"/></svg></div>Storm death
    </div>
    <div class="legend-row">
      <div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><polygon points="9,2 16,9 9,16 2,9" fill="${C.loot}" stroke="rgba(0,0,0,0.5)" stroke-width="0.8"/><polygon points="9,4 13,9 9,10" fill="rgba(255,255,255,0.4)"/></svg></div>Loot
    </div>
    <div class="legend-row">
      <div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="rgba(80,0,120,0.5)" stroke="rgba(200,100,255,0.9)" stroke-width="1.5" stroke-dasharray="3,2"/></svg></div>Storm zone
    </div>

    <div class="legend-row" style="margin-top:6px;padding-top:6px;border-top:1px solid #252530">
      <div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="rgba(76,175,80,0.25)" stroke="rgba(102,187,106,0.7)" stroke-width="1" stroke-dasharray="3,2"/></svg></div><span style="color:#66bb6a">Extract zone</span>
    </div>
    <div class="legend-row">
      <div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="rgba(0,255,180,0.15)" stroke="rgba(0,230,160,0.8)" stroke-width="1" stroke-dasharray="3,2"/><text x="9" y="12" text-anchor="middle" font-size="6" fill="rgba(0,230,160,0.9)" font-family="monospace" font-weight="bold">EX</text></svg></div><span style="color:#00e6a0">Extracted (player)</span>
    </div>
    <div class="legend-row" style="margin-top:6px;padding-top:6px;border-top:1px solid #252530">
      <div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="rgba(30,80,180,0.35)" stroke="rgba(100,180,255,0.5)" stroke-width="1"/></svg></div><span style="color:#ffd54f">~ Bot density</span>
    </div>
    <div class="legend-row">
      <div class="l-icon"><svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="rgba(255,213,79,0.5)" stroke-width="1.5" stroke-dasharray="4,3"/></svg></div><span style="color:#ffd54f">~ Patrol routes</span>
    </div>
    <div class="legend-row">
      <div class="l-icon"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="rgba(255,213,79,0.6)" stroke-width="1" stroke-dasharray="3,3"/><circle cx="9" cy="9" r="1.5" fill="rgba(255,213,79,0.7)"/></svg></div><span style="color:#ffd54f">~ Kill range</span>
    </div>
  `;
  wrap.appendChild(leg);
}

// ── Map Analysis mode ─────────────────────────────────────────────────────────
btnAnalysis.addEventListener("click", () => enterAnalysisMode());
btnExitAnalysis.addEventListener("click", () => exitAnalysisMode());
[atogMovement, atogKills, atogDeaths, atogLoot, atogDwell, atogExtract].forEach(t =>
  t.addEventListener("change", drawAnalysis));
document.getElementById("analysis-map-sel").addEventListener("change", e => {
  enterAnalysisMode(e.target.value);
});

async function enterAnalysisMode(mapName) {
  if (!mapName) {
    // Default: use map filter, then current match map, then AV
    const sel = document.getElementById("analysis-map-sel");
    mapName = filterMap.value || (currentMatch ? currentMatch.meta.map : "AmbroseValley");
    sel.value = mapName;
  }
  analysisMode = true;
  btnAnalysis.classList.add("active");
  stopPlayback();
  hideHome();

  // Load map image for this specific map
  mapImage = await loadImage(MAP_IMAGES[mapName]);

  // Load aggregate data — bypass cache if stale (missing dwell key from old build)
  const stale = aggregateCache[mapName] && !aggregateCache[mapName].heatmaps?.dwell;
  if (!aggregateCache[mapName] || stale) {
    const res = await fetch(`data/aggregate/${mapName}.json?v=2`);
    aggregateCache[mapName] = await res.json();
  }
  aggregateData = aggregateCache[mapName];

  emptyState.classList.add("hidden");
  topbar.classList.add("hidden");
  timeline.classList.add("hidden");
  analysisControls.classList.remove("hidden");
  const label = mapName.replace("AmbroseValley","Ambrose Valley").replace("GrandRift","Grand Rift");
  analysisTitle.textContent = `${label} · ${aggregateData.matches} matches`;

  resizeCanvas();
  fitViewport();
  drawAnalysis();
}

function exitAnalysisMode() {
  analysisMode = false;
  btnAnalysis.classList.remove("active");
  analysisControls.classList.add("hidden");
  if (currentMatch) {
    topbar.classList.remove("hidden");
    timeline.classList.remove("hidden");
    draw();
  } else {
    showHome();
  }
}

function drawAnalysis() {
  if (!analysisMode || !aggregateData || !mapImage) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.ox, vp.oy);
  ctx.drawImage(mapImage, 0, 0, MAP_SIZE, MAP_SIZE);
  // Dark base overlay so heat colours pop
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

  const hm = aggregateData.heatmaps;
  const GRID_A = hm.movement.grid;
  const CELL_A = MAP_SIZE / GRID_A;
  const DEDUP_R = CELL_A * 3.5;  // min distance between labeled hotspots

  // Super-linear intensity: low counts collapse toward zero, real hotspots dominate.
  // Power 2.5 vs the old 0.65: a cell at 20% of max goes from t=0.46 → t=0.05,
  // while a cell at 80% of max goes from t=0.87 → t=0.65. Hotspots stay bright;
  // background noise is suppressed rather than boosted.
  function intensity(n, maxV) {
    if (maxV <= 1) return n > 0 ? 1 : 0;
    return Math.pow(Math.log(n + 1) / Math.log(maxV + 1), 2.5);
  }

  // Draw heat layer and return top-4 spatially distinct hotspots
  function drawHeatLayer(layer, paletteFn) {
    const { cells, max: maxV } = hm[layer];
    const sorted = [...cells].sort((a, b) => b[2] - a[2]);
    for (const [gx, gy, n] of sorted) {
      const t = intensity(n, maxV);
      if (t < 0.12) continue;   // cut background noise — only top ~35% of cells visible
      const cx2 = (gx + 0.5) * CELL_A;
      const cy2 = (gy + 0.5) * CELL_A;
      const r   = CELL_A * (0.55 + t * 2.2);  // narrow base keeps cold cells tight; hotspots bloom
      const g   = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, r);
      paletteFn(g, t);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, Math.PI * 2); ctx.fill();
    }
    // Collect top-4 spatially distinct hotspots
    const total = cells.reduce((s, c) => s + c[2], 0);
    const hotspots = [];
    for (const [gx, gy, n] of sorted) {
      const cx = (gx + 0.5) * CELL_A;
      const cy = (gy + 0.5) * CELL_A;
      if (hotspots.some(h => Math.hypot(h.cx - cx, h.cy - cy) < DEDUP_R)) continue;
      hotspots.push({ cx, cy, pct: Math.round(n / total * 100) });
      if (hotspots.length >= 4) break;
    }
    return hotspots;
  }

  // Draw percentage badges at hotspot locations
  function drawHotspotLabels(hotspots, color) {
    ctx.font = `bold ${8.5 / vp.scale}px monospace`;
    ctx.textAlign = "center";
    for (const h of hotspots) {
      if (h.pct < 3) continue;  // skip trivial percentages
      const d = 4.5 / vp.scale;
      // Diamond pin
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(h.cx, h.cy - d);
      ctx.lineTo(h.cx + d, h.cy);
      ctx.lineTo(h.cx, h.cy + d);
      ctx.lineTo(h.cx - d, h.cy);
      ctx.closePath();
      ctx.fill();
      // Dark pill behind text for legibility
      const label = `${h.pct}%`;
      const tw = ctx.measureText(label).width;
      const py = h.cy - d - 14 / vp.scale;
      ctx.fillStyle = "rgba(0,0,0,0.62)";
      ctx.fillRect(h.cx - tw / 2 - 3 / vp.scale, py, tw + 6 / vp.scale, 11 / vp.scale);
      ctx.fillStyle = color;
      ctx.fillText(label, h.cx, py + 9 / vp.scale);
    }
  }

  if (atogMovement.checked) {
    const hs = drawHeatLayer("movement", (g, t) => {
      g.addColorStop(0,   `rgba(79,195,247,${t * 0.80})`);   // was 0.55 — hotspots now fully saturate
      g.addColorStop(0.4, `rgba(30,100,180,${t * 0.45})`);   // was 0.30
      g.addColorStop(1,   "rgba(10,40,100,0)");
    });
    drawHotspotLabels(hs, "rgba(130,210,255,0.95)");
  }
  if (atogLoot.checked) {
    const hs = drawHeatLayer("loot", (g, t) => {
      g.addColorStop(0,   `rgba(100,220,120,${t * 0.7})`);
      g.addColorStop(0.4, `rgba(30,130,60,${t * 0.35})`);
      g.addColorStop(1,   "rgba(0,60,20,0)");
    });
    drawHotspotLabels(hs, "rgba(140,240,160,0.95)");
  }
  if (atogDwell && atogDwell.checked && hm.dwell) {
    // Dwell time: custom rendering with percentile floor.
    // ALL cells accumulate some dwell (players move through everywhere),
    // so we skip the bottom 60% and only show the top 40% — the areas
    // where players genuinely lingered vs just transited.
    const { cells, max: maxV } = hm.dwell;
    const sorted = [...cells].sort((a, b) => b[2] - a[2]);  // desc
    // 60th-percentile floor: value at 40% from the top of sorted-desc array
    const floorIdx = Math.floor(sorted.length * 0.40);
    const floor    = sorted[floorIdx]?.[2] ?? 0;
    const range    = Math.max(maxV - floor, 1);
    const total    = cells.reduce((s, c) => s + c[2], 0);
    const hotspots = [];
    for (const [gx, gy, n] of sorted) {
      if (n <= floor) break;  // sorted desc — everything from here has n ≤ floor
      const t   = Math.pow((n - floor) / range, 0.55);  // linear-ish above floor
      const cx2 = (gx + 0.5) * CELL_A;
      const cy2 = (gy + 0.5) * CELL_A;
      const r   = CELL_A * (0.85 + t * 1.7);
      const g2  = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, r);
      g2.addColorStop(0,   `rgba(255,171,64,${t * 0.9})`);
      g2.addColorStop(0.4, `rgba(230,100,0,${t * 0.55})`);
      g2.addColorStop(1,   "rgba(120,40,0,0)");
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, Math.PI * 2); ctx.fill();
      if (hotspots.length < 4 && !hotspots.some(h => Math.hypot(h.cx - cx2, h.cy - cy2) < DEDUP_R)) {
        hotspots.push({ cx: cx2, cy: cy2, pct: Math.round(n / total * 100) });
      }
    }
    drawHotspotLabels(hotspots, "rgba(255,200,100,0.95)");
  }
  if (atogDeaths.checked) {
    // Purple-magenta palette — clearly distinct from kills (yellow-orange)
    const hs = drawHeatLayer("deaths", (g, t) => {
      g.addColorStop(0,   `rgba(235,60,235,${t * 0.92})`);   // was 0.85
      g.addColorStop(0.3, `rgba(175,0,210,${t * 0.60})`);    // was 0.52
      g.addColorStop(1,   "rgba(80,0,110,0)");
    });
    drawHotspotLabels(hs, "rgba(255,130,255,0.95)");
  }
  if (atogKills.checked) {
    // Yellow → orange → red fire palette
    const hs = drawHeatLayer("kills", (g, t) => {
      g.addColorStop(0,   `rgba(255,220,80,${t * 0.92})`);   // was 0.85
      g.addColorStop(0.3, `rgba(255,140,0,${t * 0.65})`);    // was 0.55
      g.addColorStop(0.7, `rgba(200,50,0,${t * 0.30})`);     // was 0.25
      g.addColorStop(1,   "rgba(100,0,0,0)");
    });
    drawHotspotLabels(hs, "rgba(255,240,100,0.95)");
  }

  // Extraction zones with usage rate
  if (atogExtract.checked) {
    for (const z of aggregateData.extraction_zones) {
      const rate = z.total > 0 ? z.survivors / z.total : 0;
      const r    = 28 + rate * 22;
      const grad = ctx.createRadialGradient(z.px, z.py, 0, z.px, z.py, r);
      grad.addColorStop(0,   `rgba(102,187,106,${0.2 + rate * 0.3})`);
      grad.addColorStop(0.5, `rgba(76,175,80,${0.12 + rate * 0.15})`);
      grad.addColorStop(1,   "rgba(56,142,60,0)");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(z.px, z.py, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(102,187,106,${0.5 + rate * 0.4})`;
      ctx.lineWidth   = 1.2 / vp.scale;
      ctx.setLineDash([4 / vp.scale, 3 / vp.scale]);
      ctx.beginPath(); ctx.arc(z.px, z.py, r * 0.65, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(102,187,106,${0.7 + rate * 0.3})`;
      ctx.font      = `bold ${9 / vp.scale}px monospace`;
      ctx.textAlign = "center";
      const pct = Math.round(rate * 100);
      ctx.fillText(`${z.label} ${pct}%`, z.px, z.py + r * 0.68 + 11 / vp.scale);
    }
  }

  ctx.restore();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(s) {
  return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
}

init();
