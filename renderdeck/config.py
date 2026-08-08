"""
renderdeck.config — where a companion app finds its settings.

Deliberately a plain file, not a secret manager. Renderdeck has to install on a
colourist's Windows box or a freelancer's laptop with nothing but Python; a
dependency on someone's private vault would make it undeployable. The install
script seeds this file, and after that nothing else is required.

Search order:
    $RENDERDECK_CONFIG
    ~/.config/renderdeck/config.json      (mac / linux)
    %APPDATA%\\renderdeck\\config.json      (windows)

Fields:
    collector   base URL of the renderdeck server
    token       shared bearer secret
    machine     display name (defaults to hostname)
    ntfy        optional {url, topic, user, password} for push notifications
"""

from __future__ import annotations

import json
import os
import socket
from pathlib import Path

DEFAULTS = {
    "collector": "http://127.0.0.1:8090",
    "token": "",
    "machine": "",
    "ntfy": {},
}


def config_path() -> Path:
    env = os.environ.get("RENDERDECK_CONFIG")
    if env:
        return Path(env)
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData/Roaming"))
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "renderdeck" / "config.json"


def load() -> dict:
    cfg = dict(DEFAULTS)
    p = config_path()
    if p.exists():
        try:
            cfg.update(json.loads(p.read_text()))
        except (OSError, ValueError) as e:
            print(f"renderdeck: bad config at {p}: {e}", flush=True)
    # Environment always wins, so a service manager can override without
    # rewriting the file.
    for k in ("collector", "token", "machine"):
        v = os.environ.get(f"RENDERDECK_{k.upper()}")
        if v:
            cfg[k] = v
    if not cfg["machine"]:
        cfg["machine"] = socket.gethostname().split(".")[0]
    return cfg


def save(cfg: dict) -> Path:
    p = config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(cfg, indent=2))
    try:
        p.chmod(0o600)          # it holds a bearer token
    except OSError:
        pass                    # windows ACLs don't map; NTFS default is fine
    return p
