# INSIGHTS.md — LILA BLACK Player Behavior Analysis

*5 days of production telemetry · Feb 10–14, 2026 · 785 matches · 248 unique players*

---

## Insight 1: The Game Has Almost No Real Players — Bots Are the Entire Experience

**What stood out:**
Every match in this dataset is a solo experience. Out of 785 matches, 791 had exactly one human — the rest of the lobby filled entirely with bots. I found only 3 PvP kill events across the entire 5-day window. LILA BLACK is marketed as a PvPvE extraction shooter, but right now it is functionally a PvE game.

**The numbers:**

| Metric | Value |
|---|---|
| Matches with exactly 1 human | 791 / 796 (99.4%) |
| PvP kills across all matches | 3 |
| Unique human players (5 days) | 248 |
| Avg sessions per player | ~3.2 |
| Typical lobby | 1 human + 6–14 bots |

**Why this matters to a Level Designer:**
Every design decision you make right now — chokepoints, sightlines, cover density, engagement corridors — is being tested against bot patrol scripts, not human opponents. A flanking route that feels clever against a bot may be completely irrelevant when real players arrive with unpredictable movement. Your kill and death heatmaps today are a map of *where bots happen to encounter the player*, not a map of *how humans choose to fight*.

**Recommendation:**
Evaluate maps on two separate tracks: (1) *bot encounter quality* — are bot patrol routes, aggression range, and spawn density creating fun, readable fights right now? and (2) *latent PvP layout* — does the map geometry support interesting human vs human gameplay when DAU scales? These are different design problems and should not be collapsed into one heatmap review.

---

## Insight 2: One Map Is Barely Being Played — GrandRift Has Almost No Signal

**What stood out:**
The match distribution across maps is not balanced — it's lopsided. AmbroseValley receives 10× the traffic of GrandRift. This is not a marginal difference; it means GrandRift has almost no meaningful player data.

**The numbers:**

| Map | Matches | Share | Avg Match Duration |
|---|---|---|---|
| AmbroseValley | 563 | 69% | ~680s |
| Lockdown | 164 | 24% | ~590s |
| GrandRift | 58 | 7% | ~490s |

GrandRift also has the shortest average session — players exit faster there than on either other map.

**Why this matters to a Level Designer:**
58 matches is not enough data to draw conclusions about anything — not kill zones, not loot distribution, not traffic patterns. Any design change to GrandRift made on the basis of current heatmaps is a bet, not a data-informed decision. Worse, the shorter average duration hints that something is cutting runs short: punishing early bot encounters, a confusing layout, or simply low player confidence in the map.

The root cause of the imbalance is unknown from telemetry alone — it could be a matchmaking weight, a map quality issue, or a discovery problem in the UI. But it doesn't matter which it is: the map needs traffic before it can be designed with data.

**Recommendation:**
Force-rotate GrandRift for 2 weeks to generate a statistically meaningful sample (target ≥ 200 matches). Do not redesign the map based on current data. After the rotation, compare session length distribution and death cluster location against AmbroseValley to understand whether the underperformance is layout-driven or matchmaking-driven.

---

## Insight 3: Most Players Die Before Experiencing the Core Loop

**What stood out:**
The aggregate BotKill / BotKilled ratio looks acceptable at first glance — humans kill about 3.4 bots for every time a bot kills them. But that headline number hides a split: a minority of long, high-engagement matches is pulling the average up, while the majority of sessions are short and end with little activity.

**The numbers:**

| Signal | Value |
|---|---|
| Total BotKills (human kills bot) | 2,415 |
| Total BotKilled (human killed by bot) | 700 |
| Total Loot events | ~2,800 |
| Ratio BotKill : BotKilled | 3.4 : 1 |
| Matches with <100 total events | majority of 785 |

The loot count (~2,800 across 785 matches) averages to ~3.6 loot actions per match. In an extraction shooter where looting is the purpose, that number is very low. Players who survive long enough to loot aggressively show 15–25 loot events per match. The rest barely loot at all — they die before the loop starts.

**Why this matters to a Level Designer:**
The core loop of an extraction shooter is: *land → survive initial contact → loot → extract*. Players who die in the first 60–90 seconds never reach the loot phase and therefore never experience what the game is actually about. Every player who exits after a short match without looting is a player who did not understand why the game is fun. The heatmap of early deaths (available in Map Analysis → Deaths) is a direct map of where the game is losing players before it hooks them.

**Recommendation:**
Pull up the **Deaths heatmap** in Map Analysis for AmbroseValley and Lockdown. If death clusters are concentrated near spawn zones or within 100m of common spawn points, that is the problem — early bot aggression is too punishing. Consider a soft-aggression window of 60–90 seconds post-spawn where bots have reduced detection range or delayed response, letting new players orient and gather their first loot before full combat pressure begins. Measure success by tracking average loot events per session before and after the change.

---

## Insight 4: We Cannot Measure Whether Players Are Winning — The Telemetry Schema Has a Critical Gap

**What stood out:**
When I tried to calculate the extraction (win) rate, I couldn't. The telemetry has no Extraction event. A player who successfully reaches the exfil point and exits simply... stops sending pings. Their record looks byte-for-byte identical to a client crash.

**A concrete example — match `17aed7ff` (Lockdown, Feb 12):**

| Time | What happened |
|---|---|
| t=0–332s | Player is active, moving, looting, kills a bot at t=146 |
| t=332s | Last position ping — player vanishes |
| t=332–694s | Match continues; 7 bots still active |
| — | No Killed, no BotKilled, no KilledByStorm event for this player |

That pattern — active engagement, successful loot, mid-match disappearance with no death event — is the behavioral signature of a successful extraction. But it is indistinguishable from a disconnect.

**The metrics this breaks:**

- **Extraction rate** — cannot count wins with confidence
- **Loot-to-extract funnel** — cannot tell if players who loot make it out
- **True session length** — a player who wins at t=332 from a 694s match is recorded as a 47%-completion session, not a successful run
- **Difficulty calibration** — any tuning decision based on "death rate" is missing the positive signal entirely

**Recommendation:**
Add an `Extraction` event to the telemetry schema immediately — this is the single highest-leverage instrumentation change available. It needs: player UID, timestamp, match ID, and exit position. This one event unlocks extraction rate by map, by session length, by engagement level, and turns the tool from a death-analysis instrument into a full-funnel product analytics system.

---

## Insight 5: Bots Fight in Squads — But This Is Almost Completely Hidden from Us

**What stood out:**
In the 52 matches where bot telemetry files exist (~7% of all matches), I found that bots don't roam solo — they spawn in coordinated groups. 35% of those matches show clear squad formation at spawn time, almost always in trios (groups of 3). In the best-documented match, there were 5 separate bot squads running simultaneously.

**The numbers:**

| Metric | Value |
|---|---|
| Matches with bot telemetry | 52 of 785 (7%) |
| Matches with detectable bot squads (among those 52) | 18 (35%) |
| Dominant squad size | 3 (trios) |
| Max concurrent bot squads in one match | 5 |
| Matches with bot telemetry missing | 733 (93%) |

**Why this matters:**
If bots are predominantly fighting as coordinated trios, the effective difficulty of any encounter is substantially higher than individual bot stats suggest. A player who dies to a "bot" may be dying to a three-bot crossfire — one suppressing, one flanking — not a lone patrol. The kill heatmap doesn't show you a sniper spot; it may be showing you a fire team's crossfire zone.

This changes how you should read the tool's data today: **every death cluster is a candidate squad engagement point, not an individual bot kill zone.** Cover placement that breaks line-of-sight with one bot may still leave the player exposed to the other two.

**Recommendation:**
Two actions: First, restore full bot telemetry export for all matches (the 93% gap is the single biggest hole in the dataset). Without it, squad patterns, patrol routes, and formation geometry are invisible. Second, use the **Inference layer** in the visualizer (amber overlay, cross-match bot density from the 52 matches that have data) as a working proxy for bot presence today — but treat it as squad density, not individual bot density, when making cover and corridor design decisions.

---

*Data pipeline, coordinate mapping, and squad detection methodology documented in ARCHITECTURE.md.*
