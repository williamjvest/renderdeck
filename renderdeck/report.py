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

from . import __version__ as _VER
from .config import load


_UA = f"renderdeck/{_VER} (+https://github.com/williamjvest/renderdeck)"


def report(app: str, jobs: list[dict], cfg: dict | None = None, timeout: int = 8) -> bool:
    cfg = cfg or load()
    if not cfg.get("collector"):
        return False
    body = json.dumps({"machine": cfg["machine"], "app": app, "jobs": jobs}).encode()
    req = urllib.request.Request(
        cfg["collector"].rstrip("/") + "/api/report",
        data=body, method="POST",
        headers={"Content-Type": "application/json",
                 "User-Agent": _UA,
                 "Authorization": f"Bearer {cfg.get('token','')}"})
    try:
        urllib.request.urlopen(req, timeout=timeout).read()
        return True
    except urllib.error.HTTPError as e:
        # 401/403 is a CREDENTIAL problem, not a reachability one. Reporting it
        # as "unreachable" sends you debugging the network while the real fault
        # is a stale token -- which is exactly what happened chasing a
        # Cloudflare 403.
        if e.code in (401, 403):
            print("renderdeck: collector rejected the token "
                  f"(HTTP {e.code}) - wrong or missing RENDERDECK token", flush=True)
        else:
            print(f"renderdeck: collector returned HTTP {e.code}", flush=True)
        return False
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        print(f"renderdeck: collector unreachable ({e})", flush=True)
        return False
