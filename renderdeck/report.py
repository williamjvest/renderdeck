"""
renderdeck.report — push the common model to the collector.

Best-effort by design. A collector outage must never take down a watcher or
suppress a local notification; the render is the thing that matters, the
dashboard is a convenience.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from .config import load


def report(app: str, jobs: list[dict], cfg: dict | None = None, timeout: int = 8) -> bool:
    cfg = cfg or load()
    if not cfg.get("collector"):
        return False
    body = json.dumps({"machine": cfg["machine"], "app": app, "jobs": jobs}).encode()
    req = urllib.request.Request(
        cfg["collector"].rstrip("/") + "/api/report",
        data=body, method="POST",
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {cfg.get('token','')}"})
    try:
        urllib.request.urlopen(req, timeout=timeout).read()
        return True
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        print(f"renderdeck: collector unreachable ({e})", flush=True)
        return False
