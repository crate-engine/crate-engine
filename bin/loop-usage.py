#!/usr/bin/env python3
"""Read-only Claude/Pi usage accounting for an explicitly inventoried loop.
Usage: python3 loop-usage.py manifest.json
Manifest: start/end/code_ready ISO times; sessions [{seat,provider,path}];
idle_seats [roles known to have done no model work]. Output is JSON, never a bill.
Exit 1 means incomplete evidence; partial totals remain labelled as partial.
"""
import datetime as dt
import json
import math
import sys
from pathlib import Path

SEATS = {"orchestrator", "coder", "reviewer", "tester", "designer"}
FIELDS = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens")
KEYS = {"claude": ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"),
        "pi": ("input", "output", "cacheRead", "cacheWrite")}


def timestamp(value):
    result = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("timestamps require a timezone")
    return result


def report(manifest):
    start, end = timestamp(manifest["start"]), timestamp(manifest["end"])
    ready = timestamp(manifest["code_ready"])
    if not start <= ready <= end:
        raise ValueError("require start <= code_ready <= end")
    errors, seen_files, records, inventory = [], set(), {}, set()
    file_coverage = []
    idle = set(manifest.get("idle_seats", []))
    if not idle <= SEATS:
        raise ValueError("unknown idle seat")
    for session in manifest["sessions"]:
        seat, provider, path = session["seat"], session["provider"], Path(session["path"]).expanduser().resolve()
        if seat not in SEATS or provider not in KEYS:
            raise ValueError("unknown seat/provider")
        if seat in idle:
            raise ValueError("a seat cannot be idle and have sessions")
        inventory.add(seat)
        if str(path) in seen_files:
            errors.append("duplicate session path: " + str(path))
            continue
        seen_files.add(str(path))
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError as exc:
            errors.append("unreadable session: " + str(exc))
            continue
        coverage = {"seat": seat, "provider": provider, "path": str(path), "assistant_records": 0, "in_window_records": 0}
        file_coverage.append(coverage)
        for number, line in enumerate(lines, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
                message = row.get("message", {})
                if message.get("usage") and ((provider == "pi" and row.get("type") == "assistant") or
                        (provider == "claude" and row.get("type") == "message" and message.get("role") == "assistant")):
                    raise ValueError("provider mismatch")
                assistant = row.get("type") == "assistant" if provider == "claude" else row.get("type") == "message" and message.get("role") == "assistant"
                if not assistant:
                    continue
                coverage["assistant_records"] += 1
                when = timestamp(row["timestamp"])
                if not start <= when <= end:
                    continue
                coverage["in_window_records"] += 1
                usage = message.get("usage")
                if not isinstance(usage, dict):
                    raise ValueError("assistant record missing usage")
                values = [usage.get(key) for key in KEYS[provider]]
                if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in values):
                    raise ValueError("missing or invalid token category")
                request = message.get("id") if provider == "claude" else message.get("responseId") or row.get("id")
                if not request:
                    raise ValueError("missing request identity; cannot deduplicate")
                key = (seat, provider, request)
                phase = "before_code_ready" if when < ready else "verification_and_close"
                if key in records:
                    old = records[key]
                    if old[0] != phase:
                        phase = "crosses_code_ready"
                    # Claude can repeat one message across content blocks. Count
                    # each request once, using the largest recorded category.
                    records[key] = (phase, [max(a, b) for a, b in zip(old[1], values)])
                else:
                    records[key] = (phase, values)
            except (ValueError, TypeError, KeyError, AttributeError) as exc:
                errors.append("%s:%d: %s" % (path, number, exc))
        if coverage["assistant_records"] == 0:
            errors.append("no recognized assistant records: " + str(path))
    observed = {key[0] for key in records}
    for seat in sorted(inventory - observed):
        errors.append("no valid in-window usage for non-idle seat: " + seat)
    missing = SEATS - inventory - idle
    if missing:
        errors.append("seats not inventoried or explicitly idle: " + ", ".join(sorted(missing)))
    def aggregate(items):
        result = {"model_requests": len(items), **{key: 0 for key in FIELDS}}
        for _, values in items:
            for key, value in zip(FIELDS, values):
                result[key] += value
        return result
    by_seat = {}
    for seat in sorted(SEATS):
        rows = [value for key, value in records.items() if key[0] == seat]
        by_seat[seat] = {"declared_idle": seat in idle, **aggregate(rows),
                         "before_code_ready": aggregate([r for r in rows if r[0] == "before_code_ready"]),
                         "crosses_code_ready": aggregate([r for r in rows if r[0] == "crosses_code_ready"])}
    return {"status": "incomplete" if errors else "complete_for_manifest",
            "coverage": "Explicit session inventory only; include discarded/reset sessions. Completeness outside this inventory is not inferred.",
            "units": "provider-reported tokens and distinct model requests; not billed dollars or orchestrator turns",
            "start": manifest["start"], "end": manifest["end"], "wall_seconds": (end-start).total_seconds(),
            "code_ready": manifest["code_ready"], "seats": by_seat,
            "files": file_coverage, "totals": aggregate(list(records.values())), "errors": errors,
            "attribution": "Usage snapshots reported inside the window. Requests spanning CODE_READY are separately grouped; duplicate snapshots count once using maximum categories."}


def main():
    try:
        if len(sys.argv) != 2:
            raise ValueError("usage: loop-usage.py manifest.json")
        result = report(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")))
    except (OSError, ValueError, TypeError, KeyError) as exc:
        result = {"status": "incomplete", "errors": [str(exc)]}
    print(json.dumps(result, indent=2))
    return 1 if result["status"] == "incomplete" else 0


if __name__ == "__main__":
    sys.exit(main())
