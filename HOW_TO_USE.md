# LILA BLACK — Player Journey Visualizer: How to Use

*A reference guide for Level Designers, covering every feature, its limitations, and how to deploy and test the tool.*

---

## Table of Contents

1. [What This Tool Does](#1-what-this-tool-does)
2. [Opening the Tool](#2-opening-the-tool)
3. [The Match Browser (Sidebar)](#3-the-match-browser-sidebar)
4. [Match Playback](#4-match-playback)
5. [Overlay Toggles](#5-overlay-toggles)
6. [Player Dot & Popup](#6-player-dot--popup)
7. [Timeline & Event Markers](#7-timeline--event-markers)
8. [Map Analysis Mode (Cross-Match Heatmaps)](#8-map-analysis-mode-cross-match-heatmaps)
9. [Analytics Dashboard (Home View)](#9-analytics-dashboard-home-view)
10. [Running the Data Pipeline](#10-running-the-data-pipeline)
11. [Deploying to Vercel](#11-deploying-to-vercel)
12. [Running the Test Suite](#12-running-the-test-suite)
13. [Known Limitations & Impossibilities](#13-known-limitations--impossibilities)

---

## 1. What This Tool Does

The Player Journey Visualizer is a **browser-based, zero-dependency** tool for exploring
LILA BLACK player and bot behavior across 785 matches recorded Feb 10–14 2026.

It lets you:
- Watch any match play back in real time on the minimap
- See where kills, deaths, and loot events happened
- Identify companion bots and numbered enemy bot squads
- View cross-match movement, kill, death, loot, and dwell heatmaps
- Check extraction zone usage rates per map
- Browse aggregate stats on a dashboard

There is **no server at runtime** — everything is pre-processed into static JSON files
and served as a static site (locally or via Vercel).

---

## 2. Opening the Tool

### Locally (recommended for development)

From the `viz/` directory, run any static HTTP server:

```bash
# Python (built-in, no install)
python -m http.server 8080

# Then open:
# http://localhost:8080
```

> You must use a server — opening `index.html` directly as a `file://` URL will fail
> due to browser CORS restrictions on `fetch()` calls.

### From Vercel (production)

The site auto-deploys on push to `main` on GitHub:
```
https://github.com/Kumkumlover/lila-black-shikhar
```
Vercel picks up the `viz/` directory as the root of the static site via `vercel.json`.

---

## 3. The Match Browser (Sidebar)

The left sidebar lists all 785 matches. Each entry shows:

| Element | Meaning |
|---|---|
| Map tag (AV / GR / LK) | AmbroseValley / GrandRift / Lockdown |
| Match ID (first 8 chars) | Unique identifier |
| `Sq×N` red badge | N numbered enemy bot squads detected in this match |
| `cmp` teal badge | At least one companion bot (spawned near the human) |
| Outcome badge | Extracted / Survived / Died / Rage-quit? |
| Orange left border | Suspicious match (0 kills, >3 bot deaths) |
| `⚠` amber icon | Contains test agent(s) |
| `B:` bot count | Breakdown: `14 lone`, `+2c` companion, `+3s1` squad 1 |

### Filters

| Filter | Options |
|---|---|
| Map | All / AmbroseValley / GrandRift / Lockdown |
| Day | All / Feb 10–14 |
| Sort | Most events / Longest / Shortest / Most kills / Most deaths |
| Outcome | All / Died / Survived / Extracted / Rage-quit? |

**Click any match** to load it. Use the **← →** arrows at the top of the sidebar to step
through the filtered list without returning to the sidebar.

---

## 4. Match Playback

### Controls

| Control | Action |
|---|---|
| **Play / Pause** button | Toggle real-time playback |
| **Scrubber** (timeline slider) | Drag to any point in the match |
| **Speed** selector | 0.5× / 1× / 2× / 5× playback speed |
| **Scroll wheel** on canvas | Zoom in / out |
| **Click + drag** on canvas | Pan the map |
| **Zoom In / Out** buttons | Fixed-step zoom |
| **Fit** button | Reset zoom to fit the full map in view |

### Info Bar

The bar across the top of the canvas shows:
- Map, date, match ID
- Duration, total events
- Human / agent / bot counts with squad breakdown
- Player kills (human BotKill events only), bot deaths, loot count
- Outcome

### What You See on the Map

| Symbol | What it is |
|---|---|
| Blue glowing dot | Human player (live interpolated position) |
| Red solid dot | Enemy bot |
| Red dot + white numbered badge | Enemy bot, member of squad N |
| Teal dot with chevron | Companion bot (spawned near human, not killed) |
| Amber dot with diamond | Test agent (internal scripted tool) |
| Dashed ring | Last known position of an entity no longer sending pings |
| Orange upward triangle | BotKill — human player killed a bot |
| Red skull | Player death (Killed event) |
| Red/orange X | Bot death (BotKilled event) |
| Purple swirl | KilledByStorm event |
| Yellow diamond | Loot pickup |
| White starburst | PvP kill (rare — only 3 in the entire dataset) |
| Green pulsing ring | Inferred extraction point (shown after telemetry ends on extracted matches) |
| Purple gradient overlay | Estimated storm safe zone |

### Limitation — Bot Telemetry

Only ~7% of matches have bot position files. In the other 93%, bots are invisible — you
see only the BotKill/BotKilled events in the human's file. When a match has `bots=0`,
the tool automatically enables the **inference layer** (amber circles) to show cross-match
bot presence estimates.

---

## 5. Overlay Toggles

All toggles are in the topbar above the canvas.

### Match Playback Toggles

| Toggle | Default | What it shows |
|---|---|---|
| **Paths** | ON | Fading trail lines behind each entity |
| **Events** | ON | Kill / death / loot icons at their positions |
| **Heatmap** | OFF | Per-match position density heatmap (blue blobs) |
| **Bots** | ON | Bot dots (all types) |
| **Humans** | ON | Human and agent dots |
| **Storm** | Auto | Estimated storm ring overlay |
| **Infer** | Auto | Cross-match bot inference layer (amber) |
| **Routes** | OFF | Inferred patrol routes from cross-match data |

**Storm toggle default logic:** When a match has no storm deaths and the human's
late-game position is consistently outside the estimated ring, the toggle defaults to OFF
(the estimate is demonstrably wrong). If storm deaths exist, the toggle defaults to ON.

**Infer toggle default logic:** Automatically enabled when a match has `bots=0`
(no bot telemetry files) but has recorded bot kills — inference is the only way to
estimate where bots were.

### Important: Analysis Mode Toggles are Separate

The **Map Analysis** button opens a separate analysis mode with its own toggle bar
(Movement, Kills, Deaths, Loot, Dwell, Extraction). These toggles do **not** affect
match playback — they only control what is shown in analysis mode. Returning to a
match automatically exits analysis mode and resets the canvas.

---

## 6. Player Dot & Popup

**Click any dot on the map** to open its popup. The popup shows:

| Field | Description |
|---|---|
| Header label | Human / Test Agent / Companion Bot / Bot [Sq N] |
| Entity ID (short) | First 13 characters of the UID |
| Kills | Number of kill events from this entity |
| Deaths | Number of death events for this entity |
| Loot | Number of loot events |
| Survived | Time elapsed when the entity was last seen |
| "No data after X:XX" | Entity went silent before the match ended |

**Companion Bot** headers appear in teal. **Bot squad members** show a red pill badge
with `SqN`. **Human** and **Agent** headers match their dot colors.

Click anywhere on the canvas (away from dots) to dismiss the popup.

---

## 7. Timeline & Event Markers

The timeline at the bottom shows the match scrubber and colored event ticks:

| Color | Event type |
|---|---|
| Orange | BotKill (player killed a bot) |
| Red | BotKilled (a bot died) |
| Dark red | Killed (player death) |
| Purple | KilledByStorm |
| Green | Loot |
| White | Kill (PvP) |

**Click any tick** to jump to that moment in the match.

---

## 8. Map Analysis Mode (Cross-Match Heatmaps)

Click **Map Analysis** in the topbar to enter analysis mode for the currently displayed
map. This shows aggregate data across all matches on that map.

### Heatmap Layers

| Layer | What it measures | Palette |
|---|---|---|
| **Movement** | How frequently humans passed through each area | Blue → bright cyan |
| **Kills** | Where humans killed bots | Orange → yellow fire |
| **Deaths** | Where humans died | Purple → magenta |
| **Loot** | Where humans looted | Dark green → bright green |
| **Dwell** | Where humans spent the most time | Amber → bright orange |
| **Extraction** | Extraction zone usage rates | Green circles (size = rate) |

You can enable multiple layers simultaneously.

### How Intensity Works

Intensity uses a **super-linear log scale** (`Math.pow(log_ratio, 2.5)`):
- Cells with low counts collapse toward invisible — background noise is cut at 12% threshold
- Only the top ~35% of cells by count are visible
- True hotspots dominate clearly

This means **absence of color is meaningful** — areas with light activity are intentionally
hidden. If you expect activity in a region that looks empty, the traffic there is below
the noise floor.

### Hotspot Labels

Each active layer shows the top 4 spatially distinct cells labelled with `XX%` of total
(diamond pin + dark badge). Labels represent percentage of all events of that type that
occurred in that cell cluster. Cells must be at least ~3.5 cell widths apart to get
separate labels (prevents multiple labels on adjacent cells of the same hotspot).

### Extraction Zone Circles

Green circles on the map represent inferred extraction zones. Circle size = percentage of
survivors who extracted there. The label shows `X% (N survivors)`. These are derived
from clustering last-known positions of surviving players — see limitations.

### Limitation — GrandRift Data is Sparse

GrandRift has only 58 matches (7% of total vs 69% for AmbroseValley). Heatmaps for
GrandRift are statistically thin and should not be used as the sole basis for redesign
decisions. The data may not represent how players would actually use the map at scale.

---

## 9. Analytics Dashboard (Home View)

Click the **LILA BLACK** title in the topbar (or press the home button) to return to
the dashboard. It shows:

| Section | Content |
|---|---|
| KPI cards | Total matches, total playtime, avg duration, total bot kills, survival rate |
| Outcome chart | Stacked bar: Died / Survived / Extracted per map |
| Duration histogram | Match count per 2-minute bucket |
| Matches per day | Line chart (Feb 10–14) |
| Survival rate per day | Line chart with trend |
| Bot engagement table | Bot kills, deaths, kill ratio per map |
| Extraction zones table | Per-zone usage rates (loaded from aggregate JSON) |

The dashboard is built entirely from the in-memory match index — no additional network
requests except for the extraction zone table (which loads aggregate JSON on demand).

---

## 10. Running the Data Pipeline

The pipeline is only needed if you have updated the raw parquet files or changed the
export logic. It produces the `data/` directory that the frontend reads.

### Requirements

```bash
pip install pyarrow pandas
```

### Pipeline Scripts

| Script | Location | What it does |
|---|---|---|
| `export_data.py` | `player_data/player_data/` | Main pipeline: reads parquet → writes `data/index.json` + `data/matches/*.json` + `data/inference/*.json` |
| `generate_aggregate.py` | `player_data/player_data/` | Reads match JSONs → writes `data/aggregate/*.json` (run after export_data.py) |

### Running

```bash
cd player_data/player_data

# Step 1: export match data, inference data
python export_data.py

# Step 2: build aggregate heatmaps
python generate_aggregate.py

# Step 3: copy to viz directory
cp -r data/* ../../viz/data/
```

Expected output from `export_data.py`:
```
Loading parquet files...
  Loaded 1,234,567 rows across 1,021 matches
  Real matches to export: 785
Done. 785 match files written to data/matches/
Index: data/index.json (785 entries)
Outcomes: {'died': 430, 'unknown': 16, 'extracted': 9, 'survived': 330}
Building inference data...
  AmbroseValley: 1802 heatmap cells, 268 patrol routes, from 33/563 matches
  GrandRift: 841 heatmap cells, 52 patrol routes, from 6/58 matches
  Lockdown: 1219 heatmap cells, 124 patrol routes, from 13/164 matches
```

### What the Pipeline Fixes

The raw parquet data has two known bugs that the pipeline corrects automatically:

1. **Timestamp mismatch** — `ts` column is typed as milliseconds but stored as Unix
   seconds. The pipeline extracts the raw `int64` value and interprets it correctly.

2. **match_id suffix** — The `match_id` field inside each parquet row includes the
   `.nakama-0` file extension. The pipeline strips it before writing JSON.

---

## 11. Deploying to Vercel

### One-Time Setup

1. Push the `viz/` directory contents to GitHub (already configured at
   `github.com/Kumkumlover/lila-black-shikhar`)
2. Connect the repo to Vercel — it will auto-detect the static site
3. Set the **root directory** to `viz/` in Vercel project settings

### Deploying Updates

Any push to `main` triggers an automatic Vercel deployment. After running the pipeline:

```bash
cd viz

# Verify tests pass before deploying
python run_tests.py

# Commit and push
git add data/ app.js style.css index.html
git commit -m "Update telemetry data and viz"
git push origin main
```

Vercel will deploy within ~30 seconds. The `vercel.json` sets a 1-hour cache on
`/data/` responses — new data will be live immediately for first-time visitors;
returning visitors may see old data for up to 1 hour.

### Directory Structure

```
viz/
├── index.html          # Shell HTML, all UI elements
├── app.js              # All JS (~2100 lines, no dependencies)
├── style.css           # All styles
├── vercel.json         # Cache + routing config
├── maps/               # Minimap images (1024×1024px each)
│   ├── AmbroseValley_Minimap.png
│   ├── GrandRift_Minimap.png
│   └── Lockdown_Minimap.jpg
├── data/
│   ├── index.json              # 785 match metadata entries
│   ├── matches/                # 785 × per-match JSON files
│   ├── aggregate/              # 3 × cross-match heatmaps
│   └── inference/              # 3 × cross-match bot data
├── test.html           # Browser-based test suite
└── run_tests.py        # CLI test suite (same tests, runs without a browser)
```

---

## 12. Running the Test Suite

There are two equivalent test suites — one browser-based, one CLI.

### CLI Tests (recommended)

From the `viz/` directory:

```bash
python run_tests.py
```

Expected output when everything is healthy:
```
== 1. Index Data Integrity ==
  [PASS] index.json loaded - 785 matches
  ...
== 13. Edge Cases & Anomalies ==
  [WARN] 16 matches with 0 humans (agent-only)
  [WARN] 17 suspicious (0 kills, >3 deaths)
  ...
==================================================
Results: 272 passed | 0 failed | 2 warnings | 272 total
ALL TESTS PASSED
```

Warnings are expected and informational — they do not indicate failures.

### Browser Tests

Serve the `viz/` directory and open:
```
http://localhost:8080/test.html
```

Results appear with color-coded pass/fail/warn/info rows.

### What the Tests Check

| Section | Coverage |
|---|---|
| 1. Index Data Integrity | All required fields present, valid maps/days/outcomes, no duplicates |
| 2. Squad Index Fields | `squad` ≥ 0, `bot_squads` valid pairs, no negative lone bots, sequential IDs |
| 3. Match Data Validation | Valid event types, valid entity types, timestamps in range |
| 4. Squad Event Deep Validation | Companions have no `sq` field, bot squad sizes match metadata, companion count matches `meta.squad` |
| 5. BotKill Fallback | `bots=0` matches have BotKill events with renderable coords, no BotKilled events |
| 6. Aggregate Data | All 5 heatmap layers present per map, valid cells, grid=80 |
| 7. Inference Data | Heatmap cells, patrol routes, engage_px valid per map |
| 8. Map Images | 1024×1024px images load correctly for all 3 maps |
| 9. App.js Feature Presence | All key features, squad system, BotKill fallback, storm toggle, analysis mode cleanup, heatmap intensity |
| 10. CSS Checks | `.popup-header.squad` and `outcome-badge` present |
| 11. HTML Structure | All required UI element IDs present, legend references squad types |
| 12. Cross-Data Consistency | Aggregate match counts match index, squad fields consistent between index and match files |
| 13. Match Metadata vs Event Counts | BotKill/Loot/total_events counts match between index and event array |
| 14. Spawn Proximity Validation | Squad members' spawn positions within 120px of each other |
| 15. Storm Reliability Edge Cases | Matches with storm deaths have KilledByStorm events |
| 16. Edge Cases & Anomalies | No 0-event matches, no impossible bot counts, squad size distribution |

---

## 13. Known Limitations & Impossibilities

### Data Limitations (Pipeline)

| # | Limitation | Impact on Analysis |
|---|---|---|
| 1 | **Bot telemetry missing in 93% of matches** | Bot paths only visible in ~52 matches. Use the inference layer (amber) as a cross-match approximation for the rest. |
| 2 | **No Extraction event** | Cannot distinguish "player extracted" from "player disconnected" — outcome is a heuristic. Match marked `extracted` or `survived` may actually be a crash. |
| 3 | **Storm ring is estimated** | Ring position and timing are cosmetic approximations (~60% accuracy based on storm death cross-validation). Do not use for safe-zone analysis. |
| 4 | **Kill position is approximate** | BotKill markers may be up to 5 seconds of bot movement from the true death location (GPS updates every ~5s). |
| 5 | **Loot events are deduplicated** | One chest triggers 3–7 events; only the first is kept. Loot counts in the UI reflect unique chest interactions, not total loot events. |
| 6 | **No elevation (Y axis)** | Players on different floors of a building appear at the same 2D position. Heatmap clusters may be false overlaps. |
| 7 | **PvP data is near-zero** | Only 3 PvP kills in 785 matches. The game is functionally PvE-only at current DAU. Human-vs-human analysis is not meaningful. |
| 8 | **Outcome classification is heuristic** | `extracted` / `survived` / `ragequit` are inferred from telemetry patterns — no server event confirms them. |

### Squad Detection Limitations

| # | Limitation | Impact |
|---|---|---|
| 9 | **Squads only detectable in 7% of matches** | Bot telemetry is absent in 93% of matches, making spawn-proximity clustering impossible. Squad data is only available for the ~52 matches with bot files. |
| 10 | **Spawn position may have lag** | A bot active before its first GPS ping may appear up to 30 seconds of movement from its true spawn. The 80px threshold mitigates this but does not eliminate it. |
| 11 | **Companion detection may miss kills** | A bot is classified as companion only if it was NOT killed by the human. If a human kills a companion mid-match, the bot is retroactively excluded from the squad (correct behavior) but this cannot catch edge cases where the kill event was not recorded. |

### Frontend Limitations

| # | Limitation | Impact |
|---|---|---|
| 12 | **GrandRift heatmaps are sparse** | Only 58 matches (vs 563 for AmbroseValley). Analysis mode heatmaps for GrandRift should not drive redesign decisions without more data. |
| 13 | **Extraction zone positions are inferred** | No server data for zone positions — derived by clustering last-known positions of surviving players. The positions shown are approximations. |
| 14 | **No skill or rank segmentation** | All player data is aggregated equally. A new player dying in 30s looks identical to a veteran speedrunner in the aggregate heatmaps. |
| 15 | **Loot item identity unknown** | The `Loot` event has no item type or rarity. All loot is treated as equal — cannot distinguish healing items from weapons. |

### What Can Never Be Fixed Without New Telemetry

The following require server-side changes before they can work in this tool:

- **True extraction events** — need an `Extraction` event type with position + timestamp
- **Actual storm boundary** — need server-authoritative zone center, radius, and phase data
- **Bot spawn/despawn tracking** — need `BotSpawn` / `BotDespawn` events to track population
- **Loot item identity** — need item ID / rarity in the `Loot` event payload
- **Player skill/rank** — need profile metadata joined to match sessions
- **Multi-floor separation** — need a floor or zone ID per position ping

---

*Pipeline, frontend, and test suite architecture documented in detail in [ARCHITECTURE.md](ARCHITECTURE.md).*
*Dataset insights and Level Design recommendations in [INSIGHTS.md](../player_data/INSIGHTS.md).*
