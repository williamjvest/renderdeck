from __future__ import annotations

import importlib.machinery
import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path


def load_server():
    path = Path(__file__).parents[1] / "server" / "renderdeck-server"
    loader = importlib.machinery.SourceFileLoader("renderdeck_server_test", str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class ServerHistoryTest(unittest.TestCase):
    def test_history_table_identifies_the_rendering_application(self) -> None:
        server = load_server()
        self.assertIn('>Program</th>', server.PAGE)
        self.assertIn("a==='DaVinci Resolve'?'Resolve'", server.PAGE)
        self.assertIn("a==='After Effects'?'AE'", server.PAGE)
        self.assertIn('${esc(appLabel(r.app))}', server.PAGE)

    def test_report_validation_bounds_untrusted_fields(self) -> None:
        server = load_server()
        machine, app, jobs = server.normalize_report({
            "machine": "Maximus",
            "app": "DaVinci Resolve",
            "jobs": [{"id": "abc", "name": "Client.mov", "state": "rendering",
                      "percent": 42.5, "elapsed_s": 10, "output": "/tmp/Client.mov",
                      "error": None}],
        })
        self.assertEqual((machine, app, jobs[0]["percent"]),
                         ("Maximus", "DaVinci Resolve", 42.5))

        bad_reports = [
            {"machine": "", "app": "Resolve", "jobs": []},
            {"machine": "M", "app": "Resolve", "jobs": "not-a-list"},
            {"machine": "M", "app": "Resolve", "jobs": [
                {"id": "x", "name": "x", "state": "evil", "percent": 10}]},
            {"machine": "M", "app": "Resolve", "jobs": [
                {"id": "x", "name": "x", "state": "rendering",
                 "percent": '\" onmouseover="alert(1)'}]},
            {"machine": "M", "app": "Resolve", "jobs": [
                {"id": "x", "name": "x", "state": "rendering", "percent": 101}]},
            {"machine": "M", "app": "Resolve", "jobs": [
                {"id": "x", "name": "x", "state": "rendering",
                 "elapsed_s": 10 ** 1000}]},
        ]
        for report in bad_reports:
            with self.subTest(report=report), self.assertRaises(ValueError):
                server.normalize_report(report)

    def test_later_report_refreshes_metadata_without_duplicate_or_new_timestamp(self) -> None:
        server = load_server()
        with tempfile.TemporaryDirectory() as tmp:
            server.DB = str(Path(tmp) / "state.db")
            base = {"id": "abc", "state": "complete", "elapsed_s": 5,
                    "output": "/tmp/client.mov", "error": None}
            server.record("Maximus", "DaVinci Resolve", [{**base, "name": "Job 1"}])
            with sqlite3.connect(server.DB) as db:
                first_ts = db.execute("SELECT ts FROM history").fetchone()[0]

            server.record("Maximus", "DaVinci Resolve",
                          [{**base, "name": "client.mov", "elapsed_s": 6}])
            with sqlite3.connect(server.DB) as db:
                rows = db.execute("SELECT name,elapsed_s,ts FROM history").fetchall()

            self.assertEqual(rows, [("client.mov", 6.0, first_ts)])


if __name__ == "__main__":
    unittest.main()
