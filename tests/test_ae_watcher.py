from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock


def load_watcher():
    path = Path(__file__).parents[1] / "watchers" / "renderdeck-ae-sequence"
    loader = importlib.machinery.SourceFileLoader("renderdeck_ae_test", str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class AeWatcherTest(unittest.TestCase):
    def test_startup_schedules_standalone_tick_file(self) -> None:
        root = Path(__file__).parents[1]
        startup = (root / "watchers" / "renderdeck-ae-startup.jsx").read_text()
        self.assertIn("renderdeck-ae-tick.jsx", startup)
        self.assertIn("app.scheduleTask(command, 2000, true)", startup)
        self.assertIn("$.evalFile(new File", startup)
        self.assertNotIn("__renderdeckAeAutoTick()", startup)
        self.assertTrue((root / "watchers" / "renderdeck-ae-tick.jsx").is_file())
        self.assertIn("renderdeck-ae-tick.jsx", (root / "install" / "bootstrap.sh").read_text())
        self.assertIn("renderdeck-ae-tick.jsx", (root / "install" / "bootstrap.ps1").read_text())

    def _queue_file(self, root: str, jobs: list[dict], age: int = 0) -> str:
        path = Path(root) / "ae-queue.json"
        path.write_text(json.dumps({"ts": time.time(), "jobs": jobs}))
        old = time.time() - age
        os.utime(path, (old, old))
        return str(path)

    def test_stale_queued_job_survives_render_block_and_gains_progress(self) -> None:
        watcher = load_watcher()
        raw = {"id": "rq1", "name": "Master", "state": "queued",
               "percent": None, "elapsed_s": None, "output": "/tmp/Master.mov",
               "total_frames": 100, "error": None}
        with tempfile.TemporaryDirectory() as tmp:
            path = self._queue_file(tmp, [raw], age=60)
            with (mock.patch.object(watcher, "PANEL_FILES", [path]),
                  mock.patch.object(watcher, "ae_running", return_value=True),
                  mock.patch.object(watcher, "movie_progress", return_value=42.0)):
                jobs = watcher.panel_jobs()

        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["state"], "rendering")
        self.assertEqual(jobs[0]["percent"], 42.0)

    def test_stale_empty_snapshot_is_not_treated_as_live_publisher(self) -> None:
        watcher = load_watcher()
        with tempfile.TemporaryDirectory() as tmp:
            path = self._queue_file(tmp, [], age=60)
            with (mock.patch.object(watcher, "PANEL_FILES", [path]),
                  mock.patch.object(watcher, "ae_running", return_value=True)):
                self.assertIsNone(watcher.panel_jobs())

    def test_fresh_job_without_output_progress_remains_queued(self) -> None:
        watcher = load_watcher()
        raw = {"id": "rq1", "name": "Master", "state": "queued",
               "percent": None, "elapsed_s": None, "output": "/tmp/Master.mov",
               "total_frames": 100, "error": None}
        with tempfile.TemporaryDirectory() as tmp:
            path = self._queue_file(tmp, [raw])
            with (mock.patch.object(watcher, "PANEL_FILES", [path]),
                  mock.patch.object(watcher, "movie_progress", return_value=None)):
                jobs = watcher.panel_jobs()

        self.assertEqual(jobs[0]["state"], "queued")
        self.assertIsNone(jobs[0]["percent"])


if __name__ == "__main__":
    unittest.main()
