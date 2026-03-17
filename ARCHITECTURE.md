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

## Entity Classification (3-Way)

The dataset contains three distinct entity types. The README states UUID = human,
numeric = bot, but reverse-mapping by event type reveals a third category.

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
```

### Entity Type Reference

| Type | ID Format | Events | Evidence |
|---|---|---|---|
| `human` | UUID (e.g. `e7ac0138-...`) | Position, Loot, BotKill, BotKilled, Kill, Killed, KilledByStorm | Standard player telemetry |
| `bot` | Numeric (e.g. `1432`) | BotPosition, BotKill, BotKilled | Pure patrol/combat AI |
| `agent` | Numeric (`1379`, `1402`, `1429`) | Position, Loot, BotKill | Scripted test tool — numeric ID but emits human-type events; disconnects before match ends; follows loot routes; appears across multiple days as a persistent entity |

**Why the README classification is incomplete:** Bots `1379`, `1402`, `1429` emit
`Position` and `Loot` events, which are behaviourally human-type actions. A naive
UUID/numeric split would classify them as bots and miss their loot-route behaviour
entirely. Event-based reverse-mapping surfaces the anomaly; cross-referencing with
early-disconnect patterns and repeated appearance across 5 days confirms they are
internal test agents, not player-controlled bots.

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
  └── fetch data/index.json          → allMatches[], renderMatchList()

loadMatch(id)
  └── fetch data/matches/{id}.json   → currentMatch
      buildPlayerPositions()          → playerPositions{uid: [{t,px,py,type}]}
      buildEventMarkers()             → scrubber tick marks
      fitViewport()                   → vp.scale, vp.ox, vp.oy
      startAmbient()                  → ambient RAF for storm animation when paused
```

### Rendering Pipeline (per frame)

```
draw(now)
  ├── ctx.drawImage(mapImage)         — minimap background
  ├── drawHeatmap()                   — grid-based density heatmap [optional layer]
  ├── drawPaths()                     — trail lines per player up to currentTime
  ├── drawEventMarkers()              — kill/death/loot icons at event positions
  ├── drawGhostDots()                 — dashed ring at last known position (inactive players)
  ├── drawLiveDots()                  — interpolated current position per active player
  ├── drawStorm(now)                  — animated storm ring (estimated from match duration)
  └── drawEffects(now)                — particle FX spawned at event moments
```

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
The storm ring is an **estimated** visualisation:

```javascript
// Safe zone radius: eased shrink from STORM_START_R (650) to STORM_END_R (80)
// over match duration. Ease-in curve: r = start - (start - end) * frac²
```

This is a visual approximation. The actual storm in-game may use off-centre circles,
rectangular zones, or multi-phase timing. The `KilledByStorm` event positions (39 total
across 796 matches) indicate players were at the storm boundary at those coordinates
and timestamps — usable as ground-truth calibration points if storm zone data becomes
available.

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
  "loot": 25,
  "pvp_kills": 0,
  "storm_deaths": 0
}
```

### `data/matches/{id}.json`
Full event array for one match, loaded on demand:
```json
{
  "meta": { ...same as index entry... },
  "events": [
    { "uid": "10648aa3-...", "type": "human", "ev": "Position", "t": 0, "px": 157.6, "py": 372.4 },
    { "uid": "1405",         "type": "bot",   "ev": "BotKill",  "t": 73, "px": 520.1, "py": 388.2,
      "kpx": 498.3, "kpy": 401.1 }
  ]
}
```

`kpx`/`kpy` — victim's last known pixel position, present only on `BotKill` events
where a victim bot could be matched within 50 world units.

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
| 7 | 3 PvP kills across 796 matches | Human vs human combat data is too sparse for statistical analysis |
