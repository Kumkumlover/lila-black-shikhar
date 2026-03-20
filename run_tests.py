"""LILA BLACK — Test Suite (CLI runner)
Mirrors test.html logic but runs headlessly from the command line.
"""
import json, os, sys, re, random

os.chdir(os.path.dirname(os.path.abspath(__file__)))

passC = failC = warnC = 0

def emit(cls, msg):
    global passC, failC, warnC
    prefix = {"pass": "  [PASS]", "fail": "  [FAIL]", "warn": "  [WARN]", "info": "  [INFO]"}
    print(f"{prefix[cls]} {msg}")
    if cls == "pass": passC += 1
    elif cls == "fail": failC += 1
    elif cls == "warn": warnC += 1

def assert_t(cond, pass_msg, fail_msg):
    emit("pass" if cond else "fail", pass_msg if cond else fail_msg)


# ═══════════════════════════════════════════════════════════════
# 1. INDEX DATA INTEGRITY
# ═══════════════════════════════════════════════════════════════
print("\n== 1. Index Data Integrity ==")
index = json.load(open("data/index.json"))
emit("pass", f"index.json loaded - {len(index)} matches")
assert_t(len(index) > 0, f"{len(index)} matches present", "No matches")
assert_t(isinstance(index, list), "index.json is an array", "NOT an array")

REQ = ["id","day","map","duration","total_events","humans","agents","bots",
       "bot_kills","bot_killed","loot","pvp_kills","storm_deaths","outcome"]
first = index[0]
for f in REQ:
    assert_t(f in first, f"Field '{f}' present", f"MISSING '{f}'")

MAPS = {"AmbroseValley", "GrandRift", "Lockdown"}
DAYS = {"February_10", "February_11", "February_12", "February_13", "February_14"}
OUTCOMES = {"died", "survived", "extracted", "ragequit", "unknown"}
badMap = badDay = badDur = badOutcome = dupeId = 0
ids_seen = set()
for m in index:
    if m["map"] not in MAPS: badMap += 1
    if m["day"] not in DAYS: badDay += 1
    if m["duration"] <= 0 or m["duration"] > 3600: badDur += 1
    if (m.get("outcome") or "unknown") not in OUTCOMES: badOutcome += 1
    if m["id"] in ids_seen: dupeId += 1
    ids_seen.add(m["id"])
assert_t(badMap == 0, "All maps valid", f"{badMap} bad maps")
assert_t(badDay == 0, "All days valid", f"{badDay} bad days")
assert_t(badDur == 0, "All durations valid", f"{badDur} out-of-range")
assert_t(badOutcome == 0, "All outcomes valid", f"{badOutcome} bad outcomes")
assert_t(dupeId == 0, "No duplicate IDs", f"{dupeId} duplicates")


# ═══════════════════════════════════════════════════════════════
# 2. SQUAD INDEX FIELDS
# ═══════════════════════════════════════════════════════════════
print("\n== 2. Squad Index Fields ==")
badSqVal = badBsFormat = negLone = badSqIds = 0
totalComp = totalBsMatches = 0

for m in index:
    sq = m.get("squad", 0)
    bs = m.get("bot_squads", [])
    if sq < 0 or not isinstance(sq, int): badSqVal += 1
    if sq > 0: totalComp += 1
    for entry in bs:
        if not isinstance(entry, list) or len(entry) != 2:
            badBsFormat += 1
            continue
        eid, esz = entry
        if not isinstance(eid, int) or eid < 1: badBsFormat += 1
        if not isinstance(esz, int) or esz < 2: badBsFormat += 1
    if len(bs) > 0: totalBsMatches += 1
    bsTotal = sum(g[1] for g in bs)
    lone = m["bots"] - sq - bsTotal
    if lone < 0: negLone += 1
    if len(bs) > 0:
        expected_ids = list(range(1, len(bs) + 1))
        actual_ids = [g[0] for g in bs]
        if actual_ids != expected_ids: badSqIds += 1

assert_t(badSqVal == 0, "All squad values non-negative int", f"{badSqVal} invalid")
assert_t(badBsFormat == 0, "All bot_squads valid [id,size]", f"{badBsFormat} malformed")
assert_t(negLone == 0, "No negative lone bots", f"{negLone} negative")
assert_t(badSqIds == 0, "Bot squad IDs sequential from 1", f"{badSqIds} non-sequential")
emit("info", f"{totalComp} matches with companion bots")
emit("info", f"{totalBsMatches} matches with bot squads")

squadNoBots = [m for m in index
               if (m.get("squad", 0) > 0 or len(m.get("bot_squads", [])) > 0) and m["bots"] == 0]
assert_t(len(squadNoBots) == 0, "Squads only with bot telemetry", f"{len(squadNoBots)} squads w/o bots")


# ═══════════════════════════════════════════════════════════════
# 3. MATCH DATA SAMPLE
# ═══════════════════════════════════════════════════════════════
print("\n== 3. Match Data Validation (10 matches) ==")
VALID_EVS = {"Position", "BotPosition", "Kill", "Killed", "BotKill", "BotKilled", "KilledByStorm", "Loot"}
VALID_TYPES = {"human", "bot", "agent", "squad"}

for meta in index[:10]:
    fp = f"data/matches/{meta['id']}.json"
    match = json.load(open(fp))
    sid = meta["id"][:8]
    assert_t("meta" in match and "events" in match, f"{sid}: has meta+events", f"{sid}: missing")
    assert_t(match["meta"]["id"] == meta["id"], f"{sid}: id matches", f"{sid}: MISMATCH")
    badEv = missCoord = badTime = badType = 0
    for e in match["events"]:
        if e["ev"] not in VALID_EVS: badEv += 1
        if e["ev"] == "Position" and (e.get("px") is None or e.get("py") is None): missCoord += 1
        if e["t"] < 0 or e["t"] > match["meta"]["duration"] + 10: badTime += 1
        if e.get("type") and e["type"] not in VALID_TYPES: badType += 1
    assert_t(badEv == 0, f"{sid}: all event types valid", f"{sid}: {badEv} unknown")
    assert_t(badType == 0, f"{sid}: all entity types valid", f"{sid}: {badType} unknown types")
    assert_t(badTime == 0, f"{sid}: timestamps ok", f"{sid}: {badTime} out-of-range")


# ═══════════════════════════════════════════════════════════════
# 4. SQUAD EVENT DEEP VALIDATION
# ═══════════════════════════════════════════════════════════════
print("\n== 4. Squad Event Deep Validation ==")
squadMatches = [m for m in index if m.get("squad", 0) > 0 or len(m.get("bot_squads", [])) > 0][:5]
emit("info", f"Validating {len(squadMatches)} matches with squad data")

for meta in squadMatches:
    match = json.load(open(f"data/matches/{meta['id']}.json"))
    sid = meta["id"][:8]

    # Companion without sq
    compWithSq = [e for e in match["events"] if e.get("type") == "squad" and e.get("sq") is not None]
    assert_t(len(compWithSq) == 0, f"{sid}: companions have no sq", f"{sid}: {len(compWithSq)} companions with sq")

    # Bot squad IDs valid
    bsEvs = [e for e in match["events"] if e.get("type") == "bot" and e.get("sq") is not None]
    expIds = set(g[0] for g in meta.get("bot_squads", []))
    actIds = set(e["sq"] for e in bsEvs)
    badId = len(actIds - expIds)
    assert_t(badId == 0, f"{sid}: sq values match metadata", f"{sid}: {badId} invalid sq ids")

    # Consistent sq per uid
    uid_sq = {}
    inconsist = 0
    for e in bsEvs:
        if e["uid"] not in uid_sq:
            uid_sq[e["uid"]] = e["sq"]
        elif uid_sq[e["uid"]] != e["sq"]:
            inconsist += 1
    assert_t(inconsist == 0, f"{sid}: consistent sq per uid", f"{sid}: {inconsist} inconsistent")

    # Size match
    sqCounts = {}
    for uid, sq in uid_sq.items():
        sqCounts[sq] = sqCounts.get(sq, 0) + 1
    for sqId, size in meta.get("bot_squads", []):
        actual = sqCounts.get(sqId, 0)
        assert_t(actual == size,
                 f"{sid}: Sq{sqId} has {actual} bots (={size})",
                 f"{sid}: Sq{sqId} has {actual} bots (expected {size})")

    # Companion count
    compUids = set(e["uid"] for e in match["events"] if e.get("type") == "squad")
    assert_t(len(compUids) == meta.get("squad", 0),
             f"{sid}: {len(compUids)} companion UIDs = meta.squad",
             f"{sid}: {len(compUids)} != meta.squad={meta.get('squad', 0)}")


# ═══════════════════════════════════════════════════════════════
# 5. BOTKILL FALLBACK (bots=0 matches)
# ═══════════════════════════════════════════════════════════════
print("\n== 5. BotKill Fallback (bots=0 matches) ==")
noTel = [m for m in index if m["bots"] == 0 and m["bot_kills"] > 0][:5]
emit("info", f"{len([m for m in index if m['bots'] == 0])} total bots=0 matches")
emit("info", f"{len(noTel)} of those have bot_kills>0")

for meta in noTel:
    match = json.load(open(f"data/matches/{meta['id']}.json"))
    sid = meta["id"][:8]
    bk = [e for e in match["events"] if e["ev"] == "BotKill"]
    bkd = [e for e in match["events"] if e["ev"] == "BotKilled"]
    assert_t(len(bk) > 0, f"{sid}: {len(bk)} BotKill events", f"{sid}: no BotKill events")
    assert_t(len(bkd) == 0, f"{sid}: no BotKilled (expected w/ bots=0)", f"{sid}: {len(bkd)} BotKilled despite bots=0")
    renderable = sum(1 for e in bk if (e.get("kpx") or e.get("px")) is not None)
    assert_t(renderable == len(bk), f"{sid}: all {renderable} BotKills have coords",
             f"{sid}: {renderable}/{len(bk)} have coords")


# ═══════════════════════════════════════════════════════════════
# 6. AGGREGATE DATA
# ═══════════════════════════════════════════════════════════════
print("\n== 6. Aggregate Data ==")
for mp in ["AmbroseValley", "GrandRift", "Lockdown"]:
    agg = json.load(open(f"data/aggregate/{mp}.json"))
    assert_t(agg["map"] == mp, f"{mp}: map correct", f"{mp}: wrong map")
    assert_t(agg["matches"] > 0, f"{mp}: {agg['matches']} matches", f"{mp}: 0")
    for layer in ["movement", "kills", "deaths", "loot", "dwell"]:
        hm = agg.get("heatmaps", {}).get(layer)
        assert_t(hm is not None, f"{mp}.{layer}: present", f"{mp}.{layer}: MISSING")
        if hm:
            assert_t(len(hm["cells"]) > 0, f"{mp}.{layer}: {len(hm['cells'])} cells",
                     f"{mp}.{layer}: empty")
            assert_t(hm["grid"] == 80, f"{mp}.{layer}: grid=80", f"{mp}.{layer}: grid={hm['grid']}")
    ezones = agg.get("extraction_zones", [])
    assert_t(len(ezones) > 0, f"{mp}: {len(ezones)} extraction zones", f"{mp}: no zones")


# ═══════════════════════════════════════════════════════════════
# 7. INFERENCE DATA
# ═══════════════════════════════════════════════════════════════
print("\n== 7. Inference Data ==")
for mp in ["AmbroseValley", "GrandRift", "Lockdown"]:
    inf = json.load(open(f"data/inference/{mp}.json"))
    assert_t(len(inf.get("heatmap", {}).get("cells", [])) > 0, f"{mp}: heatmap cells", f"{mp}: no cells")
    assert_t(len(inf.get("routes", [])) > 0, f"{mp}: patrol routes", f"{mp}: no routes")
    assert_t(isinstance(inf.get("engage_px"), (float, int)), f"{mp}: engage_px ok", f"{mp}: bad engage_px")


# ═══════════════════════════════════════════════════════════════
# 8. APP.JS FEATURE CHECKS
# ═══════════════════════════════════════════════════════════════
print("\n== 8. App.js Feature Checks ==")
appSrc = open("app.js", encoding="utf-8").read()
emit("pass", f"app.js: {len(appSrc)} chars")

checks = [
    ("Squad sq field storage", "sq: e.sq"),
    ("Squad badge render", "fillText(String(sqNum)"),
    ("Squad type handling", 'type === "squad"'),
    ("Companion Bot popup", "Companion Bot"),
    ("bot_squads in info", "bot_squads"),
    ("BotKill fallback bots===0", "meta.bots === 0"),
    ("BotKill kpx fallback", "e.kpx ?? e.px"),
    ("isStormReliable function", "function isStormReliable"),
    ("Storm toggle auto-set", "togStorm.checked = isStormReliable()"),
    ("analysisMode cleanup", 'analysisControls.classList.add("hidden")'),
    ("Heatmap intensity 2.5", ", 2.5)"),
    ("Noise floor 0.12", "0.12"),
    ("Match loading", "async function loadMatch"),
    ("Match list rendering", "function renderMatchList"),
    ("Storm visualization", "function drawStorm"),
    ("Heatmap rendering", "function drawHeatmap"),
    ("Event marker drawing", "function drawEventMarkers"),
    ("Live dot rendering", "function drawLiveDots"),
    ("Ghost dot rendering", "function drawGhostDots"),
    ("Player popup", "function showPlayerPopup"),
    ("Inference layer", "function drawInference"),
    ("Map Analysis mode", "function enterAnalysisMode"),
    ("Analysis drawing", "function drawAnalysis"),
    ("Storm center estimation", "function computeStormCenter"),
    ("Phased storm model", "STORM_PHASES"),
]
for name, sig in checks:
    assert_t(sig in appSrc, f"{name}: present", f"{name}: MISSING")

# Regex: analysisMode cleared early in loadMatch
assert_t(bool(re.search(r"async function loadMatch[\s\S]{0,300}if \(analysisMode\)", appSrc)),
         "loadMatch clears analysisMode near top", "MISSING analysisMode cleanup position")

# Storm reliability 40% threshold
assert_t(bool(re.search(r"outsideCount\s*/\s*latePts\.length.*0\.4", appSrc)),
         "Storm reliability uses 40% threshold", "MISSING 40% outside threshold")


# ═══════════════════════════════════════════════════════════════
# 9. CSS CHECKS
# ═══════════════════════════════════════════════════════════════
print("\n== 9. CSS Checks ==")
cssSrc = open("style.css", encoding="utf-8").read()
assert_t("popup-header.squad" in cssSrc, ".popup-header.squad present", "MISSING")
assert_t("outcome-badge" in cssSrc, "outcome-badge present", "MISSING")


# ═══════════════════════════════════════════════════════════════
# 10. CROSS-DATA CONSISTENCY
# ═══════════════════════════════════════════════════════════════
print("\n== 10. Cross-Data Consistency ==")
for mp in ["AmbroseValley", "GrandRift", "Lockdown"]:
    agg = json.load(open(f"data/aggregate/{mp}.json"))
    idxC = len([m for m in index if m["map"] == mp])
    assert_t(agg["matches"] == idxC,
             f"{mp}: agg.matches ({agg['matches']}) = index ({idxC})",
             f"{mp}: MISMATCH {agg['matches']} vs {idxC}")

# Meta consistency for squad matches
for meta in squadMatches[:3]:
    match = json.load(open(f"data/matches/{meta['id']}.json"))
    assert_t(match["meta"].get("squad") == meta.get("squad"),
             f"{meta['id'][:8]}: meta.squad consistent",
             f"{meta['id'][:8]}: squad MISMATCH")
    assert_t(match["meta"].get("bot_squads") == meta.get("bot_squads"),
             f"{meta['id'][:8]}: meta.bot_squads consistent",
             f"{meta['id'][:8]}: bot_squads MISMATCH")


# ═══════════════════════════════════════════════════════════════
# 11. MATCH METADATA VS EVENT COUNTS
# ═══════════════════════════════════════════════════════════════
print("\n== 11. Match Metadata vs Event Counts ==")
random.seed(42)
deepSample = random.sample(index, min(5, len(index)))

for meta in deepSample:
    match = json.load(open(f"data/matches/{meta['id']}.json"))
    sid = meta["id"][:8]
    hBotKills = sum(1 for e in match["events"] if e["ev"] == "BotKill" and e.get("type") == "human")
    assert_t(hBotKills == meta["bot_kills"],
             f"{sid}: BotKill({hBotKills})=meta({meta['bot_kills']})",
             f"{sid}: BotKill({hBotKills})!=meta({meta['bot_kills']})")
    hLoot = sum(1 for e in match["events"] if e["ev"] == "Loot" and e.get("type") == "human")
    assert_t(hLoot == meta["loot"],
             f"{sid}: Loot({hLoot})=meta({meta['loot']})",
             f"{sid}: Loot({hLoot})!=meta({meta['loot']})")
    assert_t(len(match["events"]) == meta["total_events"],
             f"{sid}: events({len(match['events'])})=meta({meta['total_events']})",
             f"{sid}: events MISMATCH")
    # Events sorted by timestamp
    sorted_ok = all(match["events"][i]["t"] <= match["events"][i+1]["t"]
                     for i in range(len(match["events"]) - 1))
    assert_t(sorted_ok, f"{sid}: events sorted by time", f"{sid}: NOT sorted")


# ═══════════════════════════════════════════════════════════════
# 12. SPAWN PROXIMITY VALIDATION
# ═══════════════════════════════════════════════════════════════
print("\n== 12. Spawn Proximity Validation ==")
import math
SPAWN_DIST_PX = 80
SPAWN_WINDOW_SEC = 60

for meta in squadMatches[:3]:
    match = json.load(open(f"data/matches/{meta['id']}.json"))
    sid = meta["id"][:8]

    # Get first position per entity within spawn window
    spawnPos = {}
    for e in match["events"]:
        if e["ev"] not in ("Position", "BotPosition"): continue
        if e["t"] > SPAWN_WINDOW_SEC: continue
        if e.get("px") is None: continue
        if e["uid"] not in spawnPos:
            spawnPos[e["uid"]] = {"px": e["px"], "py": e["py"], "t": e["t"],
                                   "type": e.get("type"), "sq": e.get("sq")}

    # For each bot squad, verify members spawned close together
    for sqId, size in meta.get("bot_squads", []):
        sqMembers = [(uid, p) for uid, p in spawnPos.items() if p["sq"] == sqId]
        if len(sqMembers) < 2:
            emit("warn", f"{sid} Sq{sqId}: only {len(sqMembers)} spawn positions (expected {size})")
            continue
        maxDist = 0
        for i in range(len(sqMembers)):
            for j in range(i + 1, len(sqMembers)):
                a, b = sqMembers[i][1], sqMembers[j][1]
                d = math.hypot(a["px"] - b["px"], a["py"] - b["py"])
                if d > maxDist: maxDist = d
        tolerance = SPAWN_DIST_PX * 1.5
        assert_t(maxDist <= tolerance,
                 f"{sid} Sq{sqId}: max spawn dist {maxDist:.1f}px (within {tolerance}px)",
                 f"{sid} Sq{sqId}: max spawn dist {maxDist:.1f}px EXCEEDS {tolerance}px")


# ═══════════════════════════════════════════════════════════════
# 13. EDGE CASES & ANOMALIES
# ═══════════════════════════════════════════════════════════════
print("\n== 13. Edge Cases & Anomalies ==")
noHuman = [m for m in index if m["humans"] == 0]
emit("warn" if noHuman else "info", f"{len(noHuman)} matches with 0 humans")
noEvents = [m for m in index if m["total_events"] == 0]
assert_t(len(noEvents) == 0, "No 0-event matches", f"{len(noEvents)} 0-event matches")
veryShort = [m for m in index if m["duration"] < 30]
emit("warn" if veryShort else "info", f"{len(veryShort)} matches <30s")
susp = [m for m in index if m["bot_kills"] == 0 and m["bot_killed"] > 3]
emit("warn" if susp else "info", f"{len(susp)} suspicious (0 kills, >3 deaths)")
compExceedsBots = [m for m in index if m.get("squad", 0) > m["bots"]]
assert_t(len(compExceedsBots) == 0, "No companion > bots", f"{len(compExceedsBots)} impossible")

# Squad size distribution
sqSizeDist = {}
for m in index:
    for _, size in m.get("bot_squads", []):
        sqSizeDist[size] = sqSizeDist.get(size, 0) + 1
for sz in sorted(sqSizeDist.keys()):
    emit("info", f"Bot squads size {sz}: {sqSizeDist[sz]} occurrences")

largeSq = [m for m in index if any(s > 6 for _, s in m.get("bot_squads", []))]
emit("warn" if largeSq else "info", f"{len(largeSq)} matches with large squads (>6)")


# ═══════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════
print(f"\n{'=' * 50}")
total = passC + failC
print(f"Results: {passC} passed | {failC} failed | {warnC} warnings | {total} total")
if failC > 0:
    print("SOME TESTS FAILED")
    sys.exit(1)
else:
    print("ALL TESTS PASSED")
