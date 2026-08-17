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
| `watchers/renderdeck-ae-startup.jsx` | AE startup script — automatically publishes the render queue for the watcher |
| `watchers/renderdeck-ae-panel.jsx` | Legacy/manual ScriptUI fallback |
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
AE startup script ──writes──▶ ~/.local/share/renderdeck/ae-queue.json ──read──▶ renderdeck-ae ──POST──▶ server
(runs automatically)                                                               (already running)
```

The startup script does the one thing only AE can do. The watcher, already
running as a service, does the network. If AE is shut, the watcher falls back
to sequence-watching or presence on its own. No panel or per-session arming is
required.

**Progress on After Effects, by output type.** AE exposes no per-item progress
to scripting, so renderdeck derives it from evidence instead:

| Output | Source of truth |
|---|---|
| Image sequence (TIFF/PNG/EXR/DPX) | frames on disk vs expected — exact |
| Movie file (ProRes, H.264, …) | AE's per-frame log, enabled automatically before rendering and parsed for the last frame written |
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

`state` ∈ `queued | rendering | complete | failed | cancelled | stalled`.

AE's GUI Render Queue blocks ExtendScript `scheduleTask` callbacks while a
render owns the main thread. The startup publisher therefore writes **queued**
items, output paths, and expected frame counts before rendering begins. The
out-of-process Python watcher keeps that non-empty snapshot alive while AE is
open and upgrades a movie job to **rendering** when AE's per-frame output log
shows progress. Once AE unblocks, the startup publisher resumes and reports the
terminal state. A render that began before the publisher captured its queued
metadata cannot be reconstructed safely from process state alone.
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

**v0.3.0 — early, but in daily use** across three machines and two programs.

### Known gaps

Software limitations, worst first. None of these are hidden behind an
optimistic README.

| Gap | Detail |
|---|---|
| **Movie-file progress unvalidated** | Image-sequence progress is proven frame-for-frame against a real 13,404-frame render. The ProRes/H.264 path parses AE's per-frame log and is written to the documented format, but **has never parsed a real one** — only a synthetic fixture. First live movie render either confirms it or needs a regex tweak. |
| **Not packaged** | "Companion app" means a Python file plus a JSON config. The installer vendors its own checksum-verified interpreter, so it *is* one command — but it is not a signed, double-clickable `.app`/`.exe`. |
| **One shared bearer token, plain HTTP** | Fine on a tailnet. **Do not expose the server publicly.** No TLS, no per-machine tokens, no rotation mechanism beyond editing the config. |
| **AE reports no percent from the panel alone** | Adobe exposes no per-item progress to scripting. Percent comes from counting frames (sequences) or parsing the log (movies); with neither, the bar is honestly empty. |
| **Resolve requires Studio** | The free version has no scripting API. The watcher degrades to a heartbeat rather than failing, but it cannot see jobs. |
| **Windows installer is less travelled** | `bootstrap.ps1` parses clean against the real Windows PowerShell parser and the Task Scheduler path is in daily use, but the full script has had fewer end-to-end runs than the shell one. |

### Verified

So the above reads as caution, not doubt about the rest:

- Sequence completion, gap detection and stall detection — against a real
  13,404-frame render and a synthetic harness.
- Resolve queue transitions — 6-case harness (baseline, no-change, single fire,
  no duplicate, failure, cancel).
- Multi-program-per-machine, offline detection, history dedupe.
- Checksum rejection of a tampered Python tarball.
- Auth: 200 with a token, 401 without, on every write route.

Resolve history is forward-looking from the watcher, but terminal jobs still
present in the current project's Render Queue are reported to the server on the
first poll (without re-sending completion notifications). Jobs removed from
Resolve before the watcher sees them cannot be reconstructed retroactively.

The time shown in history is the server's **terminal-report receipt time** —
effectively the finish time for a job monitored live. It is not the render's
start time. For an older terminal job recovered from Resolve's current queue,
the time is when renderdeck imported it; Resolve does not expose the original
start or finish timestamp for that completed queue entry.

Current AE releases can silently kill `app.scheduleTask` after its first
callback. Queue capture therefore comes from the bundled **renderdeck monitor**
CEP panel: CEP's browser timer calls a tiny host-side snapshot every two seconds
while AE is idle. Leave the panel docked/open; AE restores open CEP panels on
the next launch. Once rendering starts and AE blocks host scripts, the external
watcher retains the last queued snapshot and reads AE's per-frame log.

History identifies the reporting program as **Resolve** or **AE**. This matters
on machines running both applications and prevents same-named outputs from
looking like duplicate records from one queue.

## Deployment

This repo is the software. For the Toldwell estate — which host runs what,
how to push a change, and what is outstanding — see [DEPLOYMENT.md](DEPLOYMENT.md).

## Credits

Stall detection by percentage plateau, and the dashboard layout, are adapted
from [Fobdor/ResolveRenderMonitor](https://github.com/Fobdor/ResolveRenderMonitor) (MIT).

## License

MIT
