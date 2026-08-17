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
