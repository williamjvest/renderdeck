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
| `watchers/renderdeck-ae-panel.jsx` | AE ScriptUI panel — publishes the render queue for the AE watcher to report |
| `install/setup.py` | writes the config |
| `install/bootstrap.sh` | one-command install (macOS/Linux) |
| `install/migrate-snapshot-pk.py` | one-time DB migration for pre-v0.2 servers |

## How the After Effects side fits together

AE's Post-Render Action can only Import / Import & Replace Usage / Set Proxy —
there is no "run a command" — so a resident panel is the only supported way to
observe a GUI render. But ExtendScript has no HTTP client worth trusting and
`system.callSystem()` **blocks the AE UI**, so a panel that phoned home on a
timer would stutter the app you're trying to watch.

So the work is split:

```
 AE panel  ──writes──▶  ~/.local/share/renderdeck/ae-queue.json  ──read──▶  renderdeck-ae  ──POST──▶  server
 (reads the queue)                                                          (already running)
```

The panel does the one thing only it can do. The watcher, already running as a
service, does the network. Panel closed or AE shut and the watcher falls back to
sequence-watching or presence on its own.

**Progress on After Effects, by output type.** AE exposes no per-item progress
to scripting, so renderdeck derives it from evidence instead:

| Output | Source of truth |
|---|---|
| Image sequence (TIFF/PNG/EXR/DPX) | frames on disk vs expected — exact |
| Movie file (ProRes, H.264, …) | AE's per-frame log, parsed for the last frame written |
| Neither available | `null` — an empty bar, never a guessed one |

A `.mov` is one growing file with no frames to count, so the movie path relies
on `logType = ERRORS_AND_PER_FRAME_INFO`. **The panel sets that automatically**
on every queued item, so you don't have to remember to enable it — it just has
to be set before the item starts, since AE rejects settings changes on an
in-flight render.

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

# each render machine — macOS / Linux
curl -fsSL https://raw.githubusercontent.com/williamjvest/renderdeck/main/install/bootstrap.sh \
  | bash -s -- --collector http://SERVER:8090 --token TOKEN

# each render machine — Windows (PowerShell)
.\install\bootstrap.ps1 -Collector http://SERVER:8090 -Token TOKEN
python3 watchers/renderdeck-resolve                 # Resolve
python3 watchers/renderdeck-ae-sequence --dir /out/seq --expect 13404 --fps 24
```

Resolve additionally needs **Preferences → System → General → External scripting
using = Local**.

## Server endpoints

| | |
|---|---|
| `POST /api/report` | a watcher publishes its jobs (Bearer token) |
| `POST /api/forget/<machine>` | drop a machine that will never report again (Bearer token) |
| `GET /api/state` | combined JSON |
| `GET /healthz` | liveness |
| `GET /` | dashboard |

## Notifications

Optional. Configure an [ntfy](https://ntfy.sh) topic in the config and watchers
push completion, failure and stall alerts to your phone. Leave it out and you
still get the dashboard.

## Status

**v0.2.0 — early but in daily use**, across four machines and two programs.

Known gaps, stated plainly:

- Not packaged as signed binaries yet. "Companion app" today means a Python
  file and a config; the installer vendors its own interpreter so that is a
  one-command install, but it is not a double-clickable `.app`/`.exe`.
- **Movie-file progress is unvalidated against a real AE log.** Sequence
  progress is proven frame-for-frame; the ProRes/H.264 path is written against
  AE's documented per-frame log format but has not yet parsed a real one.
- No auth beyond a single shared bearer token, over plain HTTP. **Run it on a
  private network.** If you must expose it, put it behind a TLS reverse proxy,
  rotate the token, and consider per-machine tokens — none of which this
  implements today.

## Credits

Stall detection by percentage plateau, and the dashboard layout, are adapted
from [Fobdor/ResolveRenderMonitor](https://github.com/Fobdor/ResolveRenderMonitor) (MIT).

## License

MIT
