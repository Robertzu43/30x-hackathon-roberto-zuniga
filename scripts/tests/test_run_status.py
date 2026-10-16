import sys, unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from run_status import parse_deadline, report  # noqa: E402

Z = lambda s: datetime.fromisoformat(s).astimezone(timezone.utc)
CTX = "DEADLINE: 2026-10-18T18:00-05:00\n"  # = 23:00Z


class RunStatus(unittest.TestCase):
    def test_phases(self):
        for now, phase in [("2026-10-16T12:00Z", "BUILD"), ("2026-10-18T18:00Z", "FREEZE"),
                           ("2026-10-18T21:30Z", "SHUTDOWN"), ("2026-10-18T23:01Z", "OVER")]:
            self.assertEqual(report(Z(now), CTX, "", [])["phase"], phase, now)

    def test_default_deadline(self):
        self.assertEqual(parse_deadline("Exact hour: <Roberto fills at kickoff>"), (Z("2026-10-18T17:00Z"), "default"))
        self.assertEqual(parse_deadline("DEADLINE: <Roberto fills at kickoff>")[1], "default")

    def test_typo_deadline_is_flagged_invalid(self):
        self.assertEqual(parse_deadline("DEADLINE: 2026-10-18 18:00 COT"), (Z("2026-10-18T17:00Z"), "invalid"))

    def test_cli_works_from_any_directory(self):
        import os, subprocess, tempfile
        script = Path(__file__).resolve().parents[1] / "run_status.py"
        with tempfile.TemporaryDirectory() as d:
            subprocess.run(["git", "init", "-q", d], check=True)
            os.makedirs(f"{d}/docs/sub")
            Path(f"{d}/docs/CONTEXT.md").write_text("DEADLINE: 2030-01-01T00:00-05:00\n")
            Path(f"{d}/docs/LEDGER.md").write_text("")
            out = subprocess.run(["python3", str(script)], cwd=f"{d}/docs/sub", capture_output=True, text=True).stdout
        self.assertIn("DEADLINE 2030-01-01T05:00Z (set)", out)

    def test_previous_runs_ledger_is_ignored(self):
        ctx = CTX + "RUN: r2\n"
        old = "## Heartbeat 2026-10-16 10:00Z\nRUN COMPLETE 2026-10-16T09:00Z\n"
        r = report(Z("2026-10-16T11:00Z"), ctx, old + "## Run r2 started 2026-10-16T10:30Z\n", [])
        self.assertFalse(r["run_complete"])
        self.assertTrue(r["heartbeat_due"])
        r = report(Z("2026-10-16T11:00Z"), ctx, old, [])  # marker not written yet: nothing of r2 has happened
        self.assertFalse(r["run_complete"])

    def test_cli_scopes_branches_to_this_run(self):
        import subprocess, tempfile
        script = Path(__file__).resolve().parents[1] / "run_status.py"
        with tempfile.TemporaryDirectory() as d:
            g = lambda *a: subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", *a], cwd=d, check=True, capture_output=True)
            g("init", "-q"); Path(f"{d}/docs").mkdir()
            Path(f"{d}/docs/CONTEXT.md").write_text("RUN: r1\n"); Path(f"{d}/docs/LEDGER.md").write_text("")
            g("add", "-A"); g("commit", "-qm", "x"); g("branch", "r1/task/1-a"); g("branch", "task/9-old"); g("branch", "r0/task/1-z")
            out = subprocess.run(["python3", str(script)], cwd=d, capture_output=True, text=True).stdout
        self.assertIn("UNLEDGERED r1/task/1-a\n", out)
        self.assertIn("RUN r1", out)

    def test_naive_deadline_is_bogota(self):
        self.assertEqual(parse_deadline("DEADLINE: 2026-10-18 18:00"), (Z("2026-10-18T23:00Z"), "set"))

    def test_heartbeat_due(self):
        led = "## Heartbeat 2026-10-16 10:00Z\nx\n"
        self.assertTrue(report(Z("2026-10-16T10:00Z"), CTX, "", [])["heartbeat_due"])
        self.assertFalse(report(Z("2026-10-16T14:59Z"), CTX, led, [])["heartbeat_due"])
        self.assertTrue(report(Z("2026-10-16T15:00Z"), CTX, led, [])["heartbeat_due"])

    def test_run_complete(self):
        self.assertTrue(report(Z("2026-10-16T10:00Z"), CTX, "a\nRUN COMPLETE 2026-10-18\n", [])["run_complete"])
        self.assertFalse(report(Z("2026-10-16T10:00Z"), CTX, "not RUN COMPLETE yet\n", [])["run_complete"])
        self.assertTrue(report(Z("2026-10-16T10:00Z"), CTX, "- RUN COMPLETE 2026-10-18T22:40Z\n", [])["run_complete"])

    def test_unledgered(self):
        r = report(Z("2026-10-16T10:00Z"), CTX, "task/01-schema done", ["task/02-api", "task/01-schema"])
        self.assertEqual(r["unledgered"], ["task/02-api"])

    def test_unledgered_needs_whole_branch_name(self):
        r = report(Z("2026-10-16T10:00Z"), CTX, "task/10-api done", ["task/1", "task/10-api"])
        self.assertEqual(r["unledgered"], ["task/1"])

    def test_unledgered_accepts_sentence_punctuation(self):
        r = report(Z("2026-10-16T10:00Z"), CTX, "Merged task/03-ui. Next: task/04-qa, then done", ["task/03-ui", "task/04-qa", "task/1.2"])
        self.assertEqual(r["unledgered"], ["task/1.2"])


if __name__ == "__main__":
    unittest.main()
