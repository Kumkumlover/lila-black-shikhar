# LILA BLACK — Player Journey Visualizer

A browser-based tool for Level Designers to explore player and bot behavior across 785 matches of LILA BLACK (Feb 10–14, 2026). Watch matches play back on the minimap, see kill/death/loot heatmaps, and analyze cross-match traffic patterns — all from a static site with no backend.

**Live tool:** [lila-black-shikhar.vercel.app](https://lila-black-shikhar.vercel.app)

---

## Running Locally

No environment variables or accounts required.

```bash
# 1. Clone the repo
git clone https://github.com/Kumkumlover/lila-black-shikhar.git
cd lila-black-shikhar

# 2. Serve the viz/ directory with any static server
cd viz
python -m http.server 8080

# 3. Open in browser
# http://localhost:8080
```

> Opening `index.html` directly as a `file://` URL will not work — the browser blocks
> `fetch()` calls to local files. Use a local server as shown above.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Data pipeline | Python + PyArrow + Pandas |
| Frontend | Vanilla JS + HTML5 Canvas (no framework, no build step) |
| Hosting | Vercel (static site, auto-deploy on push to `main`) |
| Data format | Pre-processed JSON split by match, lazy-loaded on demand |

---

## Repo Structure

```
viz/                    ← Static site root (what Vercel serves)
├── index.html          ← App shell
├── app.js              ← All frontend logic (~2100 lines)
├── style.css           ← All styles
├── vercel.json         ← Cache + routing config
├── maps/               ← Minimap images (1024×1024px)
├── data/
│   ├── index.json      ← Metadata for all 785 matches
│   ├── matches/        ← Per-match event arrays (~15KB each)
│   ├── aggregate/      ← Cross-match heatmaps per map
│   └── inference/      ← Cross-match bot position data per map
├── ARCHITECTURE.md     ← Tech decisions, data flow, trade-offs
├── INSIGHTS.md         ← 5 product insights from the telemetry
├── HOW_TO_USE.md       ← Full feature guide and deployment steps
├── test.html           ← Browser test suite
└── run_tests.py        ← CLI test suite (272 checks, 0 failures)

player_data/player_data/    ← Data pipeline scripts
├── export_data.py          ← Parquet → match JSON + inference JSON
└── generate_aggregate.py   ← Match JSONs → aggregate heatmap JSON
```

---

## Re-running the Data Pipeline

Only needed if the raw parquet data changes.

```bash
pip install pyarrow pandas

cd player_data/player_data
python export_data.py          # writes data/matches/ + data/inference/
python generate_aggregate.py   # writes data/aggregate/

cp -r data/* ../../viz/data/   # copy to frontend
```

---

## Running Tests

```bash
cd viz
python run_tests.py
# Results: 272 passed | 0 failed | 2 warnings
```

---

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — Tech stack, data flow, coordinate mapping, trade-offs, what I'd do differently
- [INSIGHTS.md](INSIGHTS.md) — 5 product insights with Level Designer recommendations
- [HOW_TO_USE.md](HOW_TO_USE.md) — Full feature walkthrough for every toggle, mode, and control
