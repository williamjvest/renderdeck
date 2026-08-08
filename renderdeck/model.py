"""
renderdeck.model — the one job shape every watcher emits.

This is the whole point of the project. After Effects and Resolve expose
completely different surfaces (a ScriptUI panel and a frame sequence on disk
vs. a Python render-job API), but downstream nobody should care. Notification,
history and the dashboard are written once against this.

    {id, name, state, percent, elapsed_s, output, error}

state is one of STATES. `percent` may be None when an app genuinely cannot
report it — that is honest, and consumers render a bar with no fill rather than
inventing a number.
"""

from __future__ import annotations

STATES = ("rendering", "complete", "failed", "cancelled", "stalled")
TERMINAL = ("complete", "failed", "cancelled")


def job(id, name, state, percent=None, elapsed_s=None, output=None, error=None) -> dict:
    if state not in STATES:
        raise ValueError(f"unknown state {state!r}; expected one of {STATES}")
    return {
        "id": str(id),
        "name": name or "render",
        "state": state,
        "percent": None if percent is None else float(percent),
        "elapsed_s": None if elapsed_s is None else float(elapsed_s),
        "output": output or "",
        "error": error,
    }
