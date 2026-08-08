"""
renderdeck.notify — optional ntfy push, configured per machine.

Optional on purpose: renderdeck is useful with just the dashboard. If no ntfy
block is configured this is a no-op rather than an error.
"""

from __future__ import annotations

import base64
import urllib.error
import urllib.request

from . import __version__ as _VER
from .config import load


_UA = f"renderdeck/{_VER} (+https://github.com/williamjvest/renderdeck)"


def push(title: str, message: str, priority: str = "default",
         tags: str = "", cfg: dict | None = None) -> bool:
    cfg = cfg or load()
    n = cfg.get("ntfy") or {}
    if not n.get("url") or not n.get("topic"):
        return False
    # Cloudflare fingerprints and blocks urllib's default User-Agent
    # ("Python-urllib/3.x") with error 1010 — a 403 that looks exactly like bad
    # credentials but isn't. ntfy behind a Cloudflare tunnel hits this; curl
    # sails through, which is why manual testing hid it. Always send a UA.
    headers = {
        "Title": title,
        "Priority": priority,
        "User-Agent": _UA,
    }
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
    except urllib.error.HTTPError as e:
        # Distinguish credentials from everything else. A Cloudflare-fronted
        # ntfy also answers 403 for a blocked User-Agent, so name that case too
        # rather than letting it masquerade as a bad password.
        if e.code in (401, 403):
            print(f"renderdeck: ntfy rejected the request (HTTP {e.code}) - "
                  "check ntfy user/password/topic, or a proxy blocking the "
                  "User-Agent", flush=True)
        else:
            print(f"renderdeck: ntfy returned HTTP {e.code}", flush=True)
        return False
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        print(f"renderdeck: ntfy push failed ({e})", flush=True)
        return False
