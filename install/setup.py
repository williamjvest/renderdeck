#!/usr/bin/env python3
"""
renderdeck setup — write the config a companion app needs. Interactive or flags.

    python3 install/setup.py --collector http://host:8090 --token TOKEN
    python3 install/setup.py            # prompts

No package manager, no vault, no account. A companion app should install on any
machine that has Python and nothing else.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from renderdeck.config import load, save, config_path            # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--collector")
    ap.add_argument("--token")
    ap.add_argument("--machine")
    ap.add_argument("--ntfy-url")
    ap.add_argument("--ntfy-topic")
    ap.add_argument("--ntfy-user")
    ap.add_argument("--ntfy-password")
    a = ap.parse_args()

    cfg = load()
    cfg["collector"] = a.collector or input(f"Collector URL [{cfg['collector']}]: ").strip() or cfg["collector"]
    cfg["token"] = a.token or input("Shared token: ").strip() or cfg["token"]
    if a.machine:
        cfg["machine"] = a.machine
    if a.ntfy_url or a.ntfy_topic:
        cfg["ntfy"] = {k: v for k, v in {
            "url": a.ntfy_url, "topic": a.ntfy_topic,
            "user": a.ntfy_user, "password": a.ntfy_password}.items() if v}

    p = save(cfg)
    print(f"wrote {p}")
    print(f"  collector : {cfg['collector']}")
    print(f"  machine   : {cfg['machine']}")
    print(f"  token     : {'set' if cfg['token'] else 'MISSING'}")
    print(f"  ntfy      : {cfg['ntfy'].get('topic') or 'not configured (optional)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
