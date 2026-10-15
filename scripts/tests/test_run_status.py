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
