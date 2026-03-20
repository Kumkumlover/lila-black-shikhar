# ARCHITECTURE — LILA BLACK Player Journey Visualizer

## Overview

A browser-based visualization tool for Level Designers to explore player and bot
behavior across all matches recorded in the LILA BLACK early-access telemetry dataset.
No backend server required at runtime — the pipeline is a one-time offline process that
produces static JSON, served from Vercel as a zero-dependency static site.

---

## System Architecture

```
Raw Data (parquet)          Pipeline (Python)           Frontend (Vanilla JS)
──────────────────         ──────────────────           ─────────────────────
February_10/               export_data.py               index.html
February_11/    ──────►      fixes timestamps   ──────► app.js
February_12/               classifies entities          style.css
February_13/               deduplicates loot
February_14/               maps coordinates             Hosting
  *.nakama-0               resolves kill positions      ─────────────────────
                                │                        Vercel (static)
                                ▼
                           data/
                             index.json          (match browser metadata)
                             matches/<id>.json   (per-match event arrays)
```

---

## Tech Stack Decisions

| Layer | Choice | Rationale |
|---|---|---|
| Data pipeline | Python + PyArrow + Pandas | PyArrow is the only reliable reader for `.nakama-0` Parquet files; Pandas for aggregation |
| Frontend | Vanilla JS + Canvas API | No build toolchain, no dependencies, instant Vercel deploy as a static folder |
| Rendering | HTML5 Canvas (2D) | Handles 1000+ event markers + interpolated paths at 60fps without a rendering library |
| Hosting | Vercel static | Shareable URL in one click from a GitHub repo; `vercel.json` sets cache headers on `/data/` |
| Data format | JSON split by match | Lazy-loaded on demand — the browser only fetches the match the user selects (~15KB avg) |

**Why not React/Vue?** A build step would add friction with no user-facing benefit for a
single-page tool. The Canvas API gives full rendering control for custom heatmaps, storm
animation, and interpolated paths.

**Why not SQLite / DuckDB?** The data is read-only and access pattern is always
"fetch one match at a time" — static JSON files are simpler, faster to deploy, and
require no server.

---

## Data Pipeline (`export_data.py`)

### Input Format

Files are Apache Parquet with a `.nakama-0` extension — Nakama game server storage
objects, shard 0. Each file represents **one player's telemetry for one match**.

Filename anatomy:
```
{user_id}_{match_id}.nakama-0
e7ac0138-4d80-4400-9141-461daa6be8ae_019dbb49-20ac-465f-8c16-7de72a0592fd.nakama-0
└── player UUID ──────────────────┘  └── match UUID ─────────────────────────────┘
```

Parquet schema (8 columns):
```
user_id   string          — player identifier
match_id  string          — session identifier (includes ".nakama-0" suffix in raw data)
map_id    string          — "AmbroseValley" | "GrandRift" | "Lockdown"
x         float           — world position East/West
y         float           — elevation (height above ground)
z         float           — world position North/South
ts        timestamp[ms]   — BUG: stored as seconds, labelled milliseconds (see below)
event     binary          — event type, UTF-8 encoded bytes
```

### Bug 1 — Timestamp Unit Mismatch

**Problem:** The `ts` column is typed as `timestamp[ms]` in the Parquet schema, but the
raw `int64` values are Unix timestamps in **seconds**, not milliseconds. PyArrow reads
the type annotation and interprets the values as milliseconds, producing dates in
January 1970 instead of February 2026. All duration calculations using the parsed
datetime are 1000× too small, making every match appear to be ~0 seconds long.

**Fix:**
```python
df["ts_sec"] = df["ts"].astype("int64")  # extract raw int64 — these are real Unix seconds
```

**Verification:** `pd.to_datetime(df["ts_sec"], unit="s")` correctly returns
`2026-02-10 13:39:28 UTC` style timestamps. Match durations computed as
`int(ts_sec.max() - ts_sec.min())` correctly produce 96–795 second ranges.

### Bug 2 — match_id Contains File Extension

The `match_id` field stored inside each Parquet row includes the `.nakama-0` suffix
from the filename (e.g. `019dbb49-...-7de72a0592fd.nakama-0`). Stripped at export:
```python
match_meta["match_id_clean"] = match_meta["match_id"].str.replace(r"\.nakama-0$", "", regex=True)
```

---

## Entity Classification (4-Way)

The dataset contains four distinct entity types in the final output. The README states
UUID = human, numeric = bot, but two further subcategories emerge from event analysis
and spawn-pattern detection.

### Classification Logic

```python
HUMAN_EV       = {"Position", "Kill", "Killed", "KilledByStorm", "Loot"}
TEST_AGENT_IDS = {"1379", "1402", "1429"}

# Step 1: event-based — any UID that ever emits a human-type event is human-candidate
uid_ev    = df.groupby("user_id")["event"].apply(frozenset)
human_ids = set(uid_ev[uid_ev.apply(lambda s: bool(s & HUMAN_EV))].index)

# Step 2: override known test agents
def entity_type(uid, is_human):
    if str(uid) in TEST_AGENT_IDS:
        return "agent"
    return "human" if is_human else "bot"

# Step 3: per-match squad detection (see Squad Detection section below)
# bots that spawn near the human and are not killed → type reclassified to "squad"
# bots that spawn in pure-bot clusters → keep type "bot", gain sq=N field
```

### Entity Type Reference

| Type | ID Format | Events | Rendering | Evidence |
|---|---|---|---|---|
| `human` | UUID (e.g. `e7ac0138-...`) | Position, Loot, BotKill, BotKilled, Kill, Killed, KilledByStorm | Blue glowing dot | Standard player telemetry |
| `bot` | Numeric (e.g. `1432`) | BotPosition, BotKill, BotKilled | Red solid dot | Pure patrol/combat AI |
| `squad` | Numeric | BotPosition, BotKill, BotKilled | Teal dot with chevron | Bot that spawned within 80px of the human and was not killed — AI companion |
| `agent` | Numeric (`1379`, `1402`, `1429`) | Position, Loot, BotKill | Amber dot | Scripted test tool — numeric ID but emits human-type events; disconnects before match ends; follows loot routes |

**Bot squads (`sq` field):** Bots in pure-bot spawn clusters (size ≥ 2) keep
`type: "bot"` but gain a `sq: N` integer field (N = 1, 2, 3...). They are rendered
as red dots with a white numbered badge to distinguish which squad they belong to.
See Squad Detection for details.

**Why the README classification is incomplete:** Bots `1379`, `1402`, `1429` emit
`Position` and `Loot` events, which are behaviourally human-type actions. A naive
UUID/numeric split would classify them as bots and miss their loot-route behaviour
entirely. Event-based reverse-mapping surfaces the anomaly; cross-referencing with
early-disconnect patterns and repeated appearance across 5 days confirms they are
internal test agents, not player-controlled bots.

---

## Squad Detection

### Algorithm (Spawn-Proximity Model)

Squads are groups of entities that **spawn together at match start**. The key insight
is that squadmates always appear near each other in the first seconds of a match;
this is a more reliable signal than sustained proximity (which produces false positives
for aggressive bots that converge on the player mid-match).

```python
SPAWN_WINDOW_SEC    = 60   # entity's first recorded event must be within 60s of match start
SQUAD_SPAWN_DIST_PX = 80   # max minimap-pixel distance between squadmates at spawn
SQUAD_MIN_SIZE      = 2    # minimum members to qualify as a squad

# Step 1: find spawn position = first recorded (Position|BotPosition) event per entity
# Step 2: keep only entities whose first event falls within SPAWN_WINDOW_SEC
# Step 3: union-find clustering — pair any two candidates within SQUAD_SPAWN_DIST_PX
# Step 4: keep clusters with >= SQUAD_MIN_SIZE members
# Step 5: validate (human+bot clusters only)
#   - bots that the human killed (BotKilled events for their UID) are excluded
#   - remaining bots are companions, not enemies
# Step 6: label
#   - companion cluster → type = "squad" (existing teal rendering)
#   - pure-bot clusters → type = "bot", sq = 1/2/3... (numbered by descending size)
```

### Validation Rules

| Cluster type | Kill check | Rationale |
|---|---|---|
| Human + bots | Yes — remove bots that have a `BotKilled` event | If the human killed the bot, it was an enemy regardless of spawn proximity |
| Pure bot squads | None | Bots do not kill each other by game design — spawn proximity alone is sufficient |

### Dataset Results (785 matches, Feb 10–14 2026)

| Metric | Value |
|---|---|
| Matches with companion bots (type=`squad`) | 7 |
| Matches with enemy bot squads (sq≥1) | 18 |
| Bot squad size (all observed) | Exclusively 2–4, mostly trios (3) |
| Max squads in one match | 5 (AmbroseValley) |

Of the ~52 matches that have any bot telemetry files, 18 (35%) show detectable squad
patterns — suggesting bot squad mechanics are common but invisible in the 93% of
matches where bot telemetry was not exported.

### Limitation

Spawn-proximity is a heuristic. Two enemy bots that happen to have their first recorded
ping near the same spawn cluster may be incorrectly grouped as a squad. The 80px
threshold (~70–90 world units) was chosen to be tight enough to avoid this, but the
first recorded position may be up to 30 seconds of movement away from the true spawn
point if the bot was active before its first GPS ping.

---

## Coordinate Mapping

Game world coordinates (x, z) are mapped to 1024×1024 minimap pixel space.
The Y axis is **flipped** because game world Z increases northward while canvas Y
increases downward.

```python
px = (x - origin_x) / scale * 1024
py = (1 - (z - origin_z) / scale) * 1024   # Y-axis flip
```

### Map Configuration

| Map | Scale (world units) | Origin X | Origin Z |
|---|---|---|---|
| AmbroseValley | 900 | -370 | -473 |
| GrandRift | 581 | -290 | -290 |
| Lockdown | 1000 | -500 | -500 |

**Assumption documented:** These origin and scale values were derived from the
coordinate ranges observed in the dataset (min/max x and z per map) and calibrated
visually against the minimap images. If the game updates map bounds between versions,
these values would need to be recalibrated.

The Y coordinate (elevation) is captured in the raw data but not used in the 2D
minimap projection. Elevation data is available for future 3D or floor-separation
analysis.

---

## Kill Position Resolution

`BotKill` events store the **killer's** position, not the victim's. For level designers
analysing dangerous zones, the victim's death location is more meaningful.

**Resolution:** At export time, for each `BotKill` event, the pipeline finds the bot
with the nearest last-known `BotPosition` ping (within a 50 world-unit radius at the
kill timestamp ±5s). The kill marker is placed at **the victim's last GPS position**.

```python
# Find nearest bot position to the kill event
best_bot = min(bot_positions[b_uid], key=lambda p: abs(p[0] - ts_ev))
if dist(kill_xy, best_bot_xy) < 50:
    kill_victim_px, kill_victim_py = world_to_pixel(best_bot[1], best_bot[2], map_id)
```

**Known limitation:** Bot GPS is sampled every ~5 seconds. The kill marker may be up
to 5 seconds of bot movement away from the true death position.

---

## Loot Deduplication

A single loot chest emits multiple `Loot` events in rapid succession (observed: up to
7 events at identical coordinates within 20 seconds for one chest). Without
deduplication, the heatmap and event markers overcount loot density by 3–7×.

**Fix:** Per-player, per-match — if a `Loot` event occurs within 10 seconds and
3 world units of the previous `Loot` event from the same player, it is dropped.
Only the first interaction with each chest is retained.

---

## Frontend Architecture (`app.js`)

### Data Flow

```
init()
  ├── fetch data/index.json          → allMatches[], renderMatchList()
  └── showHome()                     → build and display analytics dashboard

loadMatch(id)
  └── fetch data/matches/{id}.json   → currentMatch
      ├── hideHome()                  → switch from dashboard to canvas
      ├── buildPlayerPositions()      → playerPositions{uid: [{t,px,py,type,sq}]}
      ├── loadInferenceData(map)      → cross-match bot data (cached per map)
      ├── computeStormCenter()        → estimated safe-zone center from late-game positions
      ├── buildEventMarkers()         → scrubber tick marks
      ├── fitViewport()               → vp.scale, vp.ox, vp.oy
      └── startAmbient()              → ambient RAF for storm animation when paused

enterAnalysisMode(map)
  ├── hideHome()
  └── fetch data/aggregate/{map}.json → aggregateData (movement/kills/deaths/loot/dwell)
```

### Rendering Pipeline (per frame)

```
draw(now)                              — Match playback mode
  ├── ctx.drawImage(mapImage)          — minimap background
  ├── drawInference()                  — cross-match bot heatmap + patrol routes [optional]
  ├── drawHeatmap()                    — per-match position density heatmap [optional]
  ├── drawExtractionZones()            — inferred extraction zones with usage data
  ├── drawPaths()                      — trail lines per player up to currentTime
  ├── drawEventMarkers()               — kill/death/loot icons at event positions
  ├── drawGhostDots()                  — dashed ring at last known position (inactive players)
  ├── drawLiveDots()                   — interpolated current position per active player
  │     • human: blue glowing dot with halo
  │     • bot: red solid dot; if sq≠null, white numbered badge at top-right
  │     • squad (companion): teal dot with shield chevron
  │     • agent: amber dot with diamond overlay
  ├── drawStorm(now)                   — animated phased storm ring with lightning
  └── drawEffects(now)                 — particle FX spawned at event moments

drawAnalysis()                         — Map Analysis mode (aggregate heatmaps)
  ├── ctx.drawImage(mapImage)          — minimap background
  ├── drawHeatLayer("movement")        — blue heatmap, log-scale intensity, hotspot labels
  ├── drawHeatLayer("loot")            — green heatmap with hotspot labels
  ├── dwell layer (custom)             — amber, 60th-percentile floor, top-40% only
  ├── drawHeatLayer("deaths")          — purple/magenta with hotspot labels
  ├── drawHeatLayer("kills")           — yellow/orange fire palette with hotspot labels
  └── extraction zones                 — green circles sized by usage rate (% of survivors)
```

### Home / Analytics Dashboard

On load and when returning from a match, `showHome()` displays a stats dashboard built
from `allMatches[]` (no additional fetches). Rendered once (cached via `dataset.built` flag).

**KPI cards:** Total matches, total playtime, avg duration, total bot kills, survival %.
**Charts (inline SVG):** Outcomes by map (stacked bars), duration histogram (2-min buckets),
matches per day (line), survival rate per day (line).
**Tables:** Bot engagement per map, extraction zone usage (async-loaded from aggregate JSON).

### Map Analysis Mode (`generate_aggregate.py` → `drawAnalysis()`)

Offline Python pipeline (`generate_aggregate.py`) processes all 785 match JSONs per map into
80×80 density grids for movement, kills, deaths, loot, and dwell time. Output:
`data/aggregate/{map}.json`.

**Dwell time computation:** For each human player, sum seconds between consecutive Position
pings per grid cell. Gap capped at 30s to exclude AFK/disconnect. Dwell is distinct from
movement frequency — a cell visited once for 60s has high dwell but low movement count.

**Rendering:** Each heatmap layer uses log-scale intensity
(`Math.pow(Math.log(n+1)/Math.log(max+1), 0.65)`) for visible peaks without washing out
detail. The dwell layer uses a 60th-percentile floor — only the top 40% of cells by dwell
value are rendered, removing ubiquitous transit-corridor noise.

**Hotspot labels:** Top 4 spatially-distinct cells per layer are labelled with `XX%` of total
(diamond pin + dark pill badge). Minimum `3.5 × cell_size` deduplication distance.

### Smooth Position Interpolation

GPS pings arrive every ~5 seconds. Between pings, position is linearly interpolated:

```javascript
function interpolatePosition(uid, t) {
    // Binary search for surrounding pings [lo, hi]
    const frac = (t - pts[lo].t) / (pts[hi].t - pts[lo].t);
    return { px: pts[lo].px + (pts[hi].px - pts[lo].px) * frac, ... };
}
```

### Viewport Model

```javascript
vp = { scale, ox, oy }
// Canvas pixel = map pixel * scale + offset
toCanvas(mx, my) → [mx * vp.scale + vp.ox, my * vp.scale + vp.oy]
```

Pan (drag), zoom (scroll wheel or buttons), and Fit are all transformations of
`vp.scale`, `vp.ox`, `vp.oy`. All draw calls use `ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.ox, vp.oy)` so coordinate math stays in map space.

### Storm Visualisation

The dataset contains no storm boundary coordinates — only `KilledByStorm` death events.
The storm ring is an **estimated** visualisation using a 5-phase model:

```javascript
// Phased: [start_frac, end_frac, r_start, r_end, wait_frac]
STORM_PHASES = [
  [0.00, 0.22, 680, 490, 0.55],  // phase 1 — slow start
  [0.22, 0.47, 490, 300, 0.40],  // phase 2
  [0.47, 0.68, 300, 170, 0.35],  // phase 3
  [0.68, 0.86, 170,  88, 0.30],  // phase 4
  [0.86, 1.00,  88,  42, 0.20],  // phase 5 — rapid final collapse
];
```

**Storm center estimation:** The median position of all alive human players in the final
20% of match duration, with outlier trimming (top/bottom 10% per axis). Falls back to
final 35% or 50% if too few pings, then to map center (512, 512).

**Visual layers:** Dark purple overlay outside safe zone, swirling fog gradients,
glowing wall at boundary, seeded lightning bolts (regenerated per frame), inner vignette.

This remains a visual approximation — see Impossibilities section below.

---

## Output Format

### `data/index.json`
Array of match metadata objects for the browser sidebar:
```json
{
  "id": "d0a38c30-d476-4305-857d-ece9e65f72e6",
  "day": "February_12",
  "map": "Lockdown",
  "duration": 734,
  "total_events": 1216,
  "humans": 1,
  "agents": 0,
  "bots": 14,
  "bot_kills": 6,
  "bot_killed": 11,
  "squad": 1,
  "bot_squads": [[1, 3], [2, 3], [3, 3], [4, 3]],
  "loot": 25,
  "pvp_kills": 0,
  "storm_deaths": 0,
  "outcome": "died"
}
```

| Field | Type | Description |
|---|---|---|
| `squad` | int | Number of companion bots (`type="squad"`) — bots that spawned near the human |
| `bot_squads` | `[[id, size], ...]` | Enemy bot squads: each entry is `[squad_id, member_count]`. Empty array when no squads detected. |

`outcome` values: `"died"` (killed by bot/player/storm), `"survived"` (telemetry ends
without death, last position near extraction zone), `"extracted"` (inferred successful
extraction), `"ragequit"` (short match, no meaningful engagement before disconnect).

### `data/matches/{id}.json`
Full event array for one match, loaded on demand:
```json
{
  "meta": { ...same as index entry... },
  "events": [
    { "uid": "10648aa3-...", "type": "human",  "ev": "Position",    "t": 0,  "px": 157.6, "py": 372.4 },
    { "uid": "1388",         "type": "squad",  "ev": "BotPosition", "t": 2,  "px": 163.1, "py": 370.8 },
    { "uid": "1405",         "type": "bot",    "ev": "BotKill",     "t": 73, "px": 520.1, "py": 388.2,
      "kpx": 498.3, "kpy": 401.1 },
    { "uid": "1392",         "type": "bot",    "ev": "BotPosition", "t": 5,  "px": 620.4, "py": 280.1,
      "sq": 2 }
  ]
}
```

| Field | Present on | Description |
|---|---|---|
| `type` | All events | `"human"` \| `"bot"` \| `"squad"` \| `"agent"` |
| `kpx` / `kpy` | `BotKill` events only | Victim's last known pixel position; absent if no bot could be matched within 50 world units |
| `sq` | Bot squad members only | Integer squad ID (1, 2, 3...) for bots that are part of a named enemy squad. Absent for lone bots and companion bots (which use `type="squad"` instead) |

### `data/aggregate/{map}.json`
Cross-match aggregate heatmaps generated offline by `generate_aggregate.py`:
```json
{
  "map": "AmbroseValley",
  "matches": 563,
  "heatmaps": {
    "movement": { "cells": [[gx, gy, count], ...], "max": 4812, "grid": 80 },
    "kills":    { "cells": [...], "max": 72, "grid": 80 },
    "deaths":   { "cells": [...], "max": 18, "grid": 80 },
    "loot":     { "cells": [...], "max": 96, "grid": 80 },
    "dwell":    { "cells": [[gx, gy, seconds], ...], "max": 1984.0, "grid": 80 }
  },
  "extraction_zones": [
    { "px": 499, "py": 832, "label": "South", "survivors": 41, "total": 563 }
  ]
}
```

Cells use `[grid_x, grid_y, value]` format. Only non-zero cells are stored. Dwell values
are floats (accumulated seconds); all others are integer counts.

### `data/inference/{map}.json`
Cross-match inferred bot positions and patrol routes:
```json
{
  "heatmap": { "cells": [[gx, gy, count], ...], "max": N, "grid": 80 },
  "routes": [[[px, py], [px, py], ...], ...],
  "engage_px": 45
}
```

---

## Major Trade-offs

| Decision | What I chose | What I gave up | Why the trade was worth it |
|---|---|---|---|
| Vanilla JS + Canvas vs React + charting library | Vanilla JS | Component ecosystem, easier data binding | Zero build toolchain, instant Vercel deploy as a folder, full rendering control for interpolated paths and custom heatmaps |
| Static JSON files vs a query database (DuckDB/SQLite) | Static JSON | Ad-hoc queries, server-side filtering | The access pattern is always "one match at a time" — static files are simpler, zero-dependency at runtime, and fit a ~15KB-per-match budget perfectly |
| Offline pre-processing vs in-browser parsing | Offline pipeline | Live data updates | Parquet → JSON conversion in the browser would require a WASM runtime; the data is static anyway, so pre-processing costs nothing at serving time |
| Per-match JSON split vs single large file | Split files | One network round-trip on load | A single 785-match JSON blob would be ~12MB; split files load in ~15KB on demand, keeping the sidebar instant and match loads fast |
| Estimated storm ring vs no storm ring | Show estimate with reliability heuristic | Accuracy | The ring is cosmetically useful even when imprecise; the reliability flag (`isStormReliable()`) auto-hides it when the estimate is demonstrably wrong, avoiding misleading users |
| Spawn-proximity squad detection vs no squad detection | Heuristic detection | Perfect accuracy | 93% of matches have no bot telemetry so perfect detection is impossible; spawn proximity in 80px radius gives useful signal in the 7% of matches that have data, with known false-positive risk documented |

---

## What I'd Do Differently With More Time

**1. Add a proper backend for live data.**
The offline pipeline works for a static dataset but breaks down the moment match data is updated. A lightweight API (FastAPI or a serverless function) querying the parquet files directly would let the tool serve live data without a re-export step.

**2. Build a per-session funnel view.**
The biggest analytical gap right now is the loot → survive → extract funnel. I'd add a session-level breakdown showing where in the core loop each player dropped off — this is the most directly actionable view for a Level Designer tuning difficulty.

**3. Elevation-aware rendering.**
The `y` coordinate exists in the raw data but is discarded in the 2D projection. On maps with vertical structure, fights on different floors overlap on the minimap. A floor-selector or side-elevation view would make kill clusters on multi-storey buildings interpretable.

**4. Proper telemetry schema recommendations.**
Instead of documenting limitations in markdown, I'd write a formal schema proposal: `Extraction` event, `BotSpawn`/`BotDespawn`, loot item identity, and server-authoritative storm geometry. The tool is currently capped by data it doesn't have access to; fixing the telemetry schema unlocks more value than any frontend feature.

**5. Statistical confidence indicators on sparse data.**
GrandRift's heatmaps look visually similar to AmbroseValley's but are based on 58 vs 563 matches. A sample-size badge per cell (e.g. greying out low-confidence cells) would stop a Level Designer from over-indexing on sparse signals.

---

## Deployment

Static site served from Vercel. No server-side logic at runtime.

```
GitHub repo: github.com/Kumkumlover/lila-black-shikhar
Vercel:      auto-deploys on push to main
```

`vercel.json` configures a 1-hour cache on `/data/` responses and passthrough
rewrites so direct URL navigation works correctly.

---

## Known Limitations & Assumptions

| # | Limitation | Impact |
|---|---|---|
| 1 | Bot telemetry missing in 93% of matches | Bot paths only visible when bot files were exported; bot presence inferred from BotKill/BotKilled events in human files |
| 2 | No extraction or respawn events | Cannot distinguish "player extracted" from "player disconnected" — both appear as telemetry ending |
| 3 | Storm boundary is estimated, not actual | Ring position is cosmetic; real zone may differ in shape, centre, and phase timing |
| 4 | Map origin/scale derived from data observation | If map bounds change in a game update, coordinate mapping would silently shift |
| 5 | Kill victim position limited by 5s GPS resolution | BotKill marker may be up to 5s of movement away from true death location |
| 6 | Y (elevation) not used in 2D projection | Players on different floors appear overlapping on the minimap |
| 7 | 3 PvP kills across 785 matches | Human vs human combat data is too sparse for statistical analysis |
| 8 | Dwell time includes movement dwell | A player walking through a cell accumulates dwell even if not lingering; mitigated by 60th-percentile floor in rendering |
| 9 | Extraction zone locations are inferred | No server data for zone positions — derived from clustering last-known positions of surviving players |
| 10 | Outcome classification is heuristic | "extracted" vs "survived" vs "ragequit" are inferred from telemetry patterns, not server events |
| 11 | Squad detection is heuristic and limited to 7% of matches | Bot telemetry is absent in 93% of matches, making spawn-position clustering impossible; squads are undetectable in those matches |
| 12 | Squad spawn proximity may produce false positives | Two enemy bots that happen to have their first ping near the same location may be incorrectly grouped as a squad; mitigated by 80px threshold |

---

## Impossibilities — What This Tool Cannot Do

These are fundamental constraints imposed by the data schema. No amount of engineering
can work around them without additional telemetry from the game server.

### 1. True Extraction Events
**What's missing:** An `Extraction` event type with position, timestamp, and match ID.
**Impact:** The tool cannot definitively tell whether a player successfully extracted or
simply disconnected. Outcome classification (`extracted` / `survived` / `ragequit`) is
a heuristic based on last position proximity to inferred extraction zones, match duration
remaining, and prior engagement. False positives and false negatives are unavoidable.
**What it would unlock:** Accurate extraction funnels, extraction-per-zone rate with
confidence, session completion metrics.

### 2. Actual Storm Zone Geometry
**What's missing:** Server-authoritative storm zone center, radius, and phase timestamps.
**Impact:** The storm visualisation is a cosmetic estimate derived from the median position
of alive players in the late game. The actual storm may be off-center, non-circular, have
different phase timing, or use a rectangular/polygon shape. Storm center is estimated
correctly in ~60% of matches (based on `KilledByStorm` position cross-validation); in the
remaining ~40%, the estimated center may be 50–150px from the true center.
**What it would unlock:** Accurate safe-zone rendering, storm-pressure analysis (how much
time players spend near the wall), phase-by-phase lethality metrics.

### 3. Bot Spawn and Despawn Events
**What's missing:** Events for bot creation, destruction, and respawn with position data.
**Impact:** Bot population over time cannot be tracked. The 93% missing-bot-telemetry
rate means most bot behavior is completely invisible. The inference layer (cross-match bot
density, patrol routes) is a statistical approximation from the ~7% of matches that have
bot files. Actual bot density in any specific match is unknown.
**What it would unlock:** True bot-density heatmaps per match, spawn/despawn timing
analysis, bot-to-player encounter forecasting.

### 4. Loot Item Identity and Value
**What's missing:** The `Loot` event has no item ID, rarity, or value field.
**Impact:** All loot pickups are treated equally. Cannot distinguish a common heal from a
legendary weapon. Loot heatmaps show collection frequency, not economic value. Level
designers cannot evaluate whether high-value loot draws players to intended locations.
**What it would unlock:** Loot-value heatmaps, risk-reward analysis per area, economy
balance metrics.

### 5. Player Intent and Session Context
**What's missing:** Queue type (solo/squad), loadout, player level/rank, pre-match intent.
**Impact:** Cannot segment player behavior by skill, experience, or playstyle. A new
player dying in 30 seconds looks identical to a veteran speedrunning a specific route. All
aggregate statistics average across the entire skill spectrum.
**What it would unlock:** Skill-segmented heatmaps, new-player-experience analysis,
difficulty curve evaluation per map area.

### 6. Real-Time Server State
**What's missing:** Server tick data, network latency, server-side hit registration.
**Impact:** Kill positions are based on client telemetry with 5-second GPS resolution.
The actual server-side kill position may differ due to lag compensation. Deaths that feel
unfair to players (desync kills) cannot be identified from this data.

### 7. Multi-Floor / Elevation Separation
**What's missing:** Floor or zone identifier per position ping. The `y` (elevation) column
exists but map images are 2D.
**Impact:** On maps with vertical layers (buildings, caves, bridges), players on different
floors appear at the same 2D position. Heatmaps and kill locations may show false clusters
where vertically separated encounters overlap on the minimap.
**What it would unlock:** Per-floor heatmaps, vertical engagement analysis, 3D pathing.
