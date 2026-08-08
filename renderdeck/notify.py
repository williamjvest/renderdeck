"""
renderdeck.notify — optional ntfy push, configured per machine.

Optional on purpose: renderdeck is useful with just the dashboard. If no ntfy
block is configured this is a no-op rather than an error.
"""

from __future__ import annotations

import base64
import urllib.error
import urllib.request

from .config import load


def push(title: str, message: str, priority: str = "default",
         tags: str = "", cfg: dict | None = None) -> bool:
    cfg = cfg or load()
    n = cfg.get("ntfy") or {}
    if not n.get("url") or not n.get("topic"):
        return False
    headers = {"Title": title, "Priority": priority}
    if tags:
        headers["Tags"] = tags
    if n.get("user"):
        cred = f"{n['user']}:{n.get('password','')}".encode()
        headers["Authorization"] = "Basic " + base64.b64encode(cred).decode()
    req = urllib.request.Request(
        f"{n['url'].rstrip('/')}/{n['topic']}",
        data=message.encode(), method="POST", headers=headers)
    try:
        urllib.request.urlopen(req, timeout=15).read()
        return True
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        print(f"renderdeck: ntfy push failed ({e})", flush=True)
        return False
