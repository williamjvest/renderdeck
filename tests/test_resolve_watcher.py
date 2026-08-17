from __future__ import annotations

import importlib.machinery
import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock


def load_watcher():
    path = Path(__file__).parents[1] / "watchers" / "renderdeck-resolve"
    loader = importlib.machinery.SourceFileLoader("renderdeck_resolve_test", str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class ResolveWatcherTest(unittest.TestCase):
    def test_job_name_prefers_output_filename_over_generic_resolve_label(self) -> None:
        watcher = load_watcher()
        job = {
            "RenderJobName": "Job 1",
            "TimelineName": "Main Timeline",
            "OutputFilename": "Client_Master_v7.mov",
        }
        self.assertEqual(watcher.job_name(job), "Client_Master_v7.mov")

    def test_job_name_falls_back_to_timeline_then_render_label(self) -> None:
        watcher = load_watcher()
        self.assertEqual(
            watcher.job_name({"RenderJobName": "Job 1", "TimelineName": "Main"}),
            "Main",
        )
        self.assertEqual(watcher.job_name({"RenderJobName": "Named Job"}), "Named Job")

    def test_macos_uses_executable_name_for_process_probe(self) -> None:
        watcher = load_watcher()
        if sys.platform != "darwin":
            self.skipTest("macOS process-name regression")

        self.assertEqual(watcher.RESOLVE_PROC, "Resolve")
        completed = subprocess.CompletedProcess(["pgrep"], 0, b"", b"")
        with mock.patch.object(watcher.subprocess, "run", return_value=completed) as run:
            self.assertTrue(watcher.resolve_running())
        run.assert_called_once_with(
            ["pgrep", "-x", "Resolve"], capture_output=True, timeout=15
        )


if __name__ == "__main__":
    unittest.main()
