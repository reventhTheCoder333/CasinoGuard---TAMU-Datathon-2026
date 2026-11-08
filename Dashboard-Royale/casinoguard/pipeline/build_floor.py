"""Build public/data/floor.json for the 3D Casino Explorer.

Reads the challenge floor tables as they are; nothing is estimated:
  floor_locations  zones, banks, slots, entrances, outlets with x/y in metres
  floor_walkways   walkable links between zone hubs
  placements       which machine stands in which slot, and when

The floor is shown as it stood at the end of the analysis period
(placements with no end date). The dataset has a single gaming floor.

Run from the repository root (stdlib only, no pandas needed):
    python3 Dashboard-Royale/casinoguard/pipeline/build_floor.py
"""

import csv
import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "2_machine_decision"
OUT = ROOT / "casinoguard" / "public" / "data" / "floor.json"


def read(name):
    plain = DATA / f"{name}.csv"
    if plain.exists():
        return list(csv.DictReader(plain.open()))
    with gzip.open(DATA / f"{name}.csv.gz", "rt") as handle:
        return list(csv.DictReader(handle))


def num(value):
    return float(value) if value not in ("", None) else None


def build():
    locations = read("floor_locations")
    walkways = read("floor_walkways")
    placements = read("placements")

    by_type = {}
    for row in locations:
        by_type.setdefault(row["node_type"], []).append(row)

    zone_names = {z["zone_id"]: z["name"] for z in by_type["zone"]}

    current = [p for p in placements if not p["effective_to_utc"]]
    history = {}
    for p in sorted(placements, key=lambda p: p["effective_from_utc"]):
        history.setdefault(p["machine_id"], []).append({
            "location_id": p["location_id"],
            "config_id": p["config_id"],
            "from_utc": p["effective_from_utc"],
            "to_utc": p["effective_to_utc"] or None,
        })

    slot_ids = {s["location_id"] for s in by_type["slot"]}
    occupied = [p["location_id"] for p in current]
    assert len(occupied) == len(set(occupied)), "two machines placed in one slot"
    assert set(occupied) <= slot_ids, "placement refers to an unknown slot"

    return {
        "as_of": "end of analysis period (open-ended placements)",
        "floors": [{"floor_id": "MAIN", "name": "Main gaming floor"}],
        "units": "metres",
        "zones": [
            {"zone_id": z["zone_id"], "name": z["name"], "x": num(z["x_m"]), "y": num(z["y_m"])}
            for z in by_type["zone"]
        ],
        "banks": [
            {"bank_id": b["bank_id"], "zone_id": b["zone_id"], "x": num(b["x_m"]), "y": num(b["y_m"]),
             "capacity": int(b["capacity"]) if b["capacity"] else None}
            for b in by_type["bank"]
        ],
        "slots": [
            {"location_id": s["location_id"], "zone_id": s["zone_id"], "bank_id": s["bank_id"],
             "x": num(s["x_m"]), "y": num(s["y_m"])}
            for s in by_type["slot"]
        ],
        "entrances": [
            {"location_id": e["location_id"], "zone_id": e["zone_id"], "name": e["name"],
             "x": num(e["x_m"]), "y": num(e["y_m"])}
            for e in by_type.get("entrance", [])
        ],
        "outlets": [
            {"location_id": o["location_id"], "zone_id": o["zone_id"], "name": o["name"],
             "x": num(o["x_m"]), "y": num(o["y_m"]), "capacity": int(o["capacity"]) if o["capacity"] else None}
            for o in by_type.get("outlet", [])
        ],
        "walkways": [
            {"walkway_id": w["walkway_id"], "zone_a": w["zone_a"], "zone_b": w["zone_b"],
             "length_m": num(w["length_m"]), "closed_from_utc": w["closed_from_utc"] or None,
             "closed_to_utc": w["closed_to_utc"] or None, "closure_reason": w["closure_reason"] or None}
            for w in walkways
        ],
        "placements": [
            {"machine_id": p["machine_id"], "location_id": p["location_id"], "config_id": p["config_id"],
             "from_utc": p["effective_from_utc"]}
            for p in current
        ],
        "placement_history": {m: h for m, h in history.items() if len(h) > 1},
        "zone_names": zone_names,
    }


if __name__ == "__main__":
    floor = build()
    OUT.write_text(json.dumps(floor, separators=(",", ":")) + "\n")
    print(f"wrote {OUT} — {len(floor['slots'])} slots, {len(floor['placements'])} placed machines, "
          f"{len(floor['banks'])} banks, {len(floor['zones'])} zones")
