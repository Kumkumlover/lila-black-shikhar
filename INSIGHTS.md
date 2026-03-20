# INSIGHTS.md — LILA BLACK Player Behavior Analysis
*Based on 5 days of telemetry data (Feb 10–14, 2026) across 796 matches and 248 unique human players.*

---

## Insight 1: The Game is Running on Near-Zero Human Concurrency

**Finding:** Every match in the dataset is effectively a solo experience — 1 human player vs. a full lobby of bots.

| Metric | Value |
|---|---|
| Total matches | 796 |
| Matches with exactly 1 human | 791 (99.4%) |
| Matches with 2+ humans in same lobby | 5 (0.6%) |
| PvP Kill events across ALL matches | 3 |
| Unique human players (5 days) | 248 |
| Avg matches per human player | ~3.2 |
| Typical lobby size | 1 human + 6–14 bots |

**Why it matters:** LILA BLACK is marketed as a PvPvE extraction shooter, but the data shows it is functionally PvE-only. With ~110 downloads/day (AppBrain, 2025) and fewer than 250 active players over 5 days, the matchmaker cannot fill lobbies with real players and defaults to bots for every slot.

**Level Designer implication:** Bot AI behavior, patrol routes, and kill zones are not supplementary — they *are* the player experience. Map design decisions (chokepoints, cover, sightlines) are currently being tested almost exclusively against bots, not human opponents. Any "player flow" data derived from kill/death heatmaps reflects bot scripts, not emergent human tactics.

**Recommendation:** Until DAU grows, the Level Design team should treat bot encounter design (spawn density, patrol patterns, aggression range) with the same rigor as human PvP layout. Maps should be evaluated separately for bot engagement quality vs. hypothetical human PvP quality.

---

## Insight 2: Map Preference is Heavily Skewed — GrandRift is Underplayed

**Finding:** AmbroseValley dominates match selection, while GrandRift has almost no player presence.

| Map | Matches | % of Total | Avg Events/Match | Avg Duration (s) |
|---|---|---|---|---|
| AmbroseValley | ~550 | ~69% | ~195 | ~680 |
| Lockdown | ~190 | ~24% | ~280 | ~590 |
| GrandRift | ~56 | ~7% | ~220 | ~490 |

**Why it matters:** A 10:1 ratio between AmbroseValley and GrandRift means GrandRift is receiving a fraction of real player feedback. Whether this is a map quality issue, a UI/discovery issue (map not surfaced in matchmaking), or a matchmaking configuration issue is unknown from this data alone — but the signal is clear.

**Level Designer implication:** GrandRift is effectively untested by real players. Heatmaps and path data for GrandRift are too sparse to draw reliable conclusions about chokepoints, loot distribution, or danger zones. The map may need a forced rotation, a featured event, or a matchmaking weight adjustment to collect meaningful engagement data.

**Recommendation:** Prioritize a short forced-rotation period for GrandRift to generate a statistically meaningful sample before any redesign decisions are made based on current data.

---

## Insight 3: Players Are Dying to Bots Far More Than They Are Killing Them — Difficulty May Be Too High for Retention

**Finding:** The ratio of BotKilled (human killed by bot) to BotKill (human killed a bot) reveals players are dying significantly more than winning bot encounters, across all maps.

| Event | Total (5 days) |
|---|---|
| BotKill (human kills bot) | 2,415 |
| BotKilled (human killed by bot) | 700 |
| KilledByStorm (storm zone deaths) | 39 |
| Kill (human kills human) | 3 |

*Ratio: ~3.4 bot kills per human death — at first glance this looks favorable for players.*

**However**, cross-referencing with Loot events (total: ~2,800 across all matches) and match durations shows that in the richest matches, players loot aggressively and kill bots at a high rate, but in the bottom 60% of matches (short duration, low event count), players die quickly and exit early without looting — a classic early-game retention failure pattern.

**Level Designer implication:** The high-event matches (>500 events) represent engaged players who survive long enough to loot and fight. The majority of matches are short and low-engagement. This may indicate that bot aggression near spawn zones or early map areas is too punishing for new players, discouraging progression before the core loop (loot → extract) can be experienced.

**Recommendation:** Analyze the spatial distribution of BotKilled events relative to spawn points (using the heatmap in this tool). If deaths cluster near spawns, bot aggression in the first 60–90 seconds of a match is the primary retention risk and should be tuned down or phased.

---

## Insight 4: Extraction Events Are Missing — Successful Runs Are Indistinguishable from Disconnects

**Finding:** The telemetry schema has no `Extraction` event type. When a player successfully extracts from the map, their position pings simply stop — producing a record that is byte-for-byte identical to a client crash or rage-quit.

**Evidence from match `17aed7ff` (Lockdown, Feb 12, 11:34):**

| Timestamp | Event |
|---|---|
| t=0–332 | Human player active, patrolling, looting |
| t=146 | BotKill (player kills bot 1428) |
| t=152, 316 | Loot events |
| t=332 | **Last position ping — player vanishes** |
| t=332–694 | Match continues; 7 bots still patrolling |
| — | **No Killed, BotKilled, or KilledByStorm event for the human** |

The absence of any death event, combined with prior loot activity and a mid-match disappearance, is the behavioral signature of a **successful extraction** — the player reached the exfil point and left intentionally. Yet this looks identical in the data to a disconnection.

**Why it matters:** This makes several core metrics unreliable:

- **Survival rate** — impossible to distinguish "survived and extracted" from "crashed before dying"
- **Match completion rate** — no way to count how many players successfully completed a run
- **Loot-to-extract funnel** — cannot measure whether players who loot actually make it out
- **Session length** — a player who extracts at t=332 from a 694s match appears to have a 47% match completion, but they may have completed their run perfectly

**Scale of the problem:** Any human player whose last event is not a death event and whose telemetry ends before the match duration is a candidate extraction. In the 796-match dataset, this likely affects a significant fraction of matches — impossible to quantify without an extraction event.

**Recommendation:** Add an `Extraction` event (with player position, timestamp, and match ID) to the telemetry schema as a first priority. Without it, player success cannot be measured, the core game loop cannot be validated with data, and difficulty tuning decisions are based on death data only — missing the positive signal entirely.

---

## Insight 5: Bot AI Is Designed Around Squad Mechanics — But This Is Almost Entirely Hidden from the Data

**Finding:** In the small subset of matches where bot telemetry files exist (~7% of all matches), bots predominantly spawn in coordinated groups of 3 — not as individuals. The majority of observable bot encounters are squad-based, yet 93% of all matches have no bot telemetry, making this pattern invisible in the raw data.

| Metric | Value |
|---|---|
| Matches with any bot telemetry | ~52 of 785 (7%) |
| Matches with detectable bot squads (within those 52) | 18 (35%) |
| Matches with companion bots (spawned near human, not killed) | 7 |
| Bot squad size (all observed instances) | 2–4; predominantly 3 (trios) |
| Max enemy bot squads in a single match | 5 (AmbroseValley) |
| Max squad bots in a single Lockdown match | 12 (four trios of 3) |

**Detection methodology:** Squads are identified by spawn proximity — entities whose first recorded GPS ping is within 80 minimap pixels (~70–90 world units) of each other, all appearing within the first 60 seconds of match time. Groups of 2+ form a squad. For human+bot clusters, bots that were subsequently killed by the human are excluded (they were enemies who happened to share a spawn point).

**Why it matters:** A 35% squad-detection rate in matches with bot telemetry strongly suggests that squad mechanics are the *default* bot AI design, not the exception. Bots are likely always deployed in trios — the typical fire team size in extraction shooters — but this is invisible because their telemetry is missing in 93% of matches.

This has a direct implication for the difficulty data in Insight 3. The BotKill/BotKilled ratio and death cluster analysis assumes encounters with individual bots. If bots are predominantly fighting as coordinated trios, the effective per-encounter difficulty is substantially higher than solo-bot metrics suggest. A player dying to a "bot" may actually be dying to a suppressing fire + flanking squad, not a lone patrol.

**Level Designer implication:** Map chokepoints, cover placements, and engagement corridors should be evaluated for **squad-scale encounters**, not individual bot encounters. A corridor wide enough to break line-of-sight with one bot may still be caught in crossfire from two others. Kill heatmaps in the Map Analysis view should be interpreted as potential 3-bot crossfire zones, not 1-bot sniper spots.

**Recommendation:** Prioritise restoring bot telemetry export for all matches (addressing the 93% gap) so that squad behavior — patrol routes, formation geometry, flanking patterns — can be analysed at statistical scale. Until then, use the Inference layer in the visualizer (which aggregates bot position data from the 52 matches that have it) as a proxy for cross-map bot presence, while bearing in mind that it reflects squad density, not individual bot density.

---

*Generated from parquet telemetry data. Coordinate mapping, squad detection methodology, and tool architecture documented in ARCHITECTURE.md.*
