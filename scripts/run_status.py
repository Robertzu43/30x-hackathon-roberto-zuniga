#!/usr/bin/env python3
"""Deterministic clock and run health for the launcher and orchestrator.

Reads docs/CONTEXT.md (DEADLINE: line), docs/LEDGER.md and the task/* branches, prints:
PHASE, DEADLINE, HOURS_LEFT, HEARTBEAT_DUE, RUN_COMPLETE, UNLEDGERED. Stdlib only.
"""
import re
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

BOGOTA = timezone(timedelta(hours=-5))  # America/Bogota, no DST
DEFAULT_DEADLINE = "2026-10-18T12:00-05:00"  # conservative: noon of upload day
FREEZE_H, SHUTDOWN_H, HEARTBEAT_H = 6, 2, 5


def _iso(value: str) -> datetime:
    d = datetime.fromisoformat(value)
    return (d if d.tzinfo else d.replace(tzinfo=BOGOTA)).astimezone(timezone.utc)


def parse_deadline(context_text: str) -> tuple[datetime, str]:
    m = re.search(r"^DEADLINE:\s*(.+?)\s*$", context_text, re.M)
    try:
        return _iso(m.group(1)), "set"
    except (AttributeError, ValueError):
        return _iso(DEFAULT_DEADLINE), "default"


def last_heartbeat(ledger_text: str) -> datetime | None:
    stamps = re.findall(r"^## Heartbeat (\d{4}-\d{2}-\d{2} \d{2}:\d{2})Z", ledger_text, re.M)
    return datetime.fromisoformat(stamps[-1]).replace(tzinfo=timezone.utc) if stamps else None


def report(now: datetime, context_text: str, ledger_text: str, branches: list[str]) -> dict:
    deadline, source = parse_deadline(context_text)
    left = (deadline - now).total_seconds() / 3600
    phase = "OVER" if left <= 0 else "SHUTDOWN" if left <= SHUTDOWN_H else "FREEZE" if left <= FREEZE_H else "BUILD"
    beat = last_heartbeat(ledger_text)
    return {
        "phase": phase,
        "deadline": deadline,
        "deadline_source": source,
        "hours_left": round(left, 1),
        "heartbeat_due": beat is None or now - beat >= timedelta(hours=HEARTBEAT_H),
        "run_complete": re.search(r"^\W*RUN COMPLETE", ledger_text, re.M) is not None,
        "unledgered": sorted(b for b in set(branches) if not re.search(rf"(?<![\w/.-]){re.escape(b)}(?![\w/-]|\.\w)", ledger_text)),
    }


def _branches() -> list[str]:
    out = subprocess.run(["git", "for-each-ref", "--format=%(refname:short)", "refs/heads/task", "refs/remotes/origin/task"],
                         capture_output=True, text=True).stdout
    return [b.removeprefix("origin/") for b in out.split()]


def main() -> None:
    read = lambda p: Path(p).read_text() if Path(p).exists() else ""
    r = report(datetime.now(timezone.utc), read("docs/CONTEXT.md"), read("docs/LEDGER.md"), _branches())
    yn = lambda b: "yes" if b else "no"
    print(f"PHASE {r['phase']}")
    print(f"DEADLINE {r['deadline']:%Y-%m-%dT%H:%MZ} ({r['deadline_source']})")
    print(f"HOURS_LEFT {r['hours_left']}")
    print(f"HEARTBEAT_DUE {yn(r['heartbeat_due'])}")
    print(f"RUN_COMPLETE {yn(r['run_complete'])}")
    print(f"UNLEDGERED {' '.join(r['unledgered']) or 'none'}")


if __name__ == "__main__":
    main()
