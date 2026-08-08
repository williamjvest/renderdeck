# renderdeck

One dashboard for every render queue on every machine.

After Effects and DaVinci Resolve both refuse to tell you when a render
finishes. AE's post-render actions can only Import / Import & Replace Usage /
Set Proxy — there is no "run a command". Resolve has no hook at all. So every
shop ends up with a per-app, per-platform commercial tool, or nothing.

renderdeck is the missing layer: small **companion apps** on each machine that
speak one job model to one server.

```
 ┌─ Mac: Resolve ──┐
 ┌─ Mac: AE panel ─┤   HTTPS POST      ┌──────────────┐
 ┌─ PC:  AE seq ───┼──────────────────▶│ renderdeck   │──▶ dashboard
 └─ PC:  Resolve ──┘   common model    │   server     │──▶ history
                                       └──────────────┘
```

**No agents, no daemons you have to babysit, no accounts.** A companion app is a
single Python file with a JSON config next to it. If a machine can run Python
and reach the server, it can report.

## Why push, not poll

The server never reaches into your machines. Render boxes sleep, roam between
networks, and sit behind NAT — a polling collector is wrong half the time and
needs credentials for every host. Companion apps push, so the server only needs
to be reachable, and a machine that stops reporting shows as **offline** rather
than quietly vanishing.

That distinction is the whole design principle. See below.

## The rule

> **A render's status comes from its OUTPUT, never from its process.**

"The app is still running" and "nothing has been written recently" cannot
distinguish a finished render from a hung one — a finished render looks exactly
like a stalled one from the outside. renderdeck's watchers only ever report from
evidence: a frame count against an expected total, or the app's own job status.
Where a watcher genuinely cannot know, it says so instead of guessing.

## Components

| | |
|---|---|
| `server/renderdeck-server` | collector + dashboard. stdlib only, SQLite. |
| `watchers/renderdeck-resolve` | DaVinci Resolve render queue, per job |
| `watchers/renderdeck-ae-sequence` | AE image-sequence renders: progress, completion, stalls, **missing frames** |
| `watchers/renderdeck-ae-panel.jsx` | AE ScriptUI panel for GUI renders (Win + mac) |
| `install/setup.py` | writes the config |

## Job model

Every watcher emits exactly this, so notification, history and UI are written once:

```json
{"id": "...", "name": "...", "state": "rendering",
 "percent": 42.5, "elapsed_s": 900, "output": "/path", "error": null}
```

`state` ∈ `rendering | complete | failed | cancelled | stalled`.
`percent` may be `null` when an app cannot honestly report it.

## Quick start

```bash
# server (anywhere the machines can reach)
RENDERDECK_TOKEN=$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))') \
  server/renderdeck-server --bind 0.0.0.0 --port 8090

# each render machine
python3 install/setup.py --collector http://SERVER:8090 --token TOKEN
python3 watchers/renderdeck-resolve                 # Resolve
python3 watchers/renderdeck-ae-sequence --dir /out/seq --expect 13404 --fps 24
```

Resolve additionally needs **Preferences → System → General → External scripting
using = Local**.

## Notifications

Optional. Configure an [ntfy](https://ntfy.sh) topic in the config and watchers
push completion, failure and stall alerts to your phone. Leave it out and you
still get the dashboard.

## Status

**v0.1.0 — early.** Running across three machines. Not yet packaged as signed
binaries; that's next.

## Credits

Stall detection by percentage plateau, and the dashboard layout, are adapted
from [Fobdor/ResolveRenderMonitor](https://github.com/Fobdor/ResolveRenderMonitor) (MIT).

## License

MIT
