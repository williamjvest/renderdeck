# Deployment (Toldwell)

Notes for *this* install. The README describes the software; this describes
where it actually runs and what is outstanding on the estate.

## Topology

| Host | Role | Programs monitored | Service |
|---|---|---|---|
| Hostinger VPS | server + dashboard | — | systemd `renderdeck`, `/opt/renderdeck` (git clone) |
| Asmond | Mac | After Effects, DaVinci Resolve | launchd `com.renderdeck.{ae,resolve}` |
| Emmett | Mac (primary edit) | After Effects, DaVinci Resolve | launchd `com.renderdeck.{ae,resolve}` |
| Maximus | Mac / M4 Max (Jon Bouvier) | After Effects, DaVinci Resolve Studio 21.0.4.5 | launchd `com.renderdeck.{ae,resolve}` |
| Rynn | Windows / RTX 5080 | After Effects, DaVinci Resolve (free) | Task Scheduler `Renderdeck{AE,Resolve}` |
| Tommus | Mac / Resolve Studio | DaVinci Resolve only (no AE installed) | launchd `com.renderdeck.resolve` |

- Dashboard: `http://100.69.216.6:8090` — bound `0.0.0.0`, but ufw default-deny
  means only the tailnet and the docker bridge can reach it. Verified: the
  public IP times out.
- Notifications: ntfy topic `renders` on `ntfy.williamvest.com`.
- Monitoring: Gatus endpoints `renderdeck` (health) and `renderdeck watchers`
  (asserts `offline == 0`).
- Token: `vv-vault:RENDER_COLLECTOR_TOKEN`. The VPS unit reads it from root-only
  `/etc/renderdeck.env` (`RENDERDECK_TOKEN=...`); never put the value directly
  in `renderdeck.service`. Rotating it means regenerating that env file and
  updating every machine's config; there is no push mechanism.
- Service account: dedicated unprivileged `renderdeck`; persistent state is
  service-owned at `/var/lib/renderdeck/` and provisioned with mode 0700 by
  systemd `StateDirectory=`. The tracked hardened unit is
  `install/renderdeck.service`.
- Network policy is defense in depth: UFW exposes 8090 only through Tailscale
  and Docker/Gatus, while the systemd unit independently allows only loopback,
  `100.64.0.0/10`, and `172.17.0.0/16`.

## Deploying a change

```bash
# server
vault-ssh hostinger-vps "renderdeck-deploy"        # git pull + restart

# a Mac
vault-ssh <host> "cd ~/renderdeck && curl -fsSL \
  https://github.com/williamjvest/renderdeck/archive/refs/heads/main.tar.gz \
  | tar -xz --strip-components=1 && \
  for L in ae resolve; do launchctl unload ~/Library/LaunchAgents/com.renderdeck.$L.plist 2>/dev/null;
  launchctl load ~/Library/LaunchAgents/com.renderdeck.$L.plist; done"
```

## Outstanding

- [ ] **Validate movie-file progress on a real ProRes render** (see README).
- [x] **AE queue publishing auto-starts with AE** — `renderdeck-ae-startup.jsx`
      is installed in every existing version's user-level `Scripts/Startup`
      folder. The old panel remains only as a manual fallback.
- [ ] Consider per-machine tokens so one leaked config does not mean a full
      estate rotation.

## Where the AE panel lives

Two different paths, both correct — checking only one of them will tell you it
is missing when it is not.

| | |
|---|---|
| macOS (Asmond, Emmett) | `~/Library/Preferences/Adobe/After Effects/<ver>/Scripts/Startup/` — **user-level**, one copy per version dir, no sudo |
| Windows (Rynn) | `%APPDATA%\Adobe\After Effects\<ver>\Scripts\Startup\` — **user-level**, no UAC |

The app-level `/Applications/Adobe After Effects <ver>/Scripts/ScriptUI Panels/`
on a Mac is **not** where these are installed.

## Gotchas specific to this estate

- **History time means terminal-report receipt time.** For a live-monitored job
  this is effectively its finish time, not start time. For a terminal job
  recovered after watcher installation/restart, it is the import time because
  Resolve does not expose that queue entry's original timestamps.
- **AE queue publishing requires "Allow Scripts to Write Files and Access
  Network."** The bootstrap enables `Pref_SCRIPTING_FILE_NETWORK_SECURITY` in
  every installed AE version's preferences; the startup publisher reloads and
  checks it before writing, then verifies every write/close. A script cannot
  reliably grant this permission to itself. AE 26.3 otherwise executes the
  script but leaves zero-byte queue and error files, while the Python watcher
  keeps sending healthy empty heartbeats.
- **AE blocks startup-script timers during a GUI render.** The publisher must
  capture queued-job metadata before the render starts; the Python watcher then
  retains that stale non-empty snapshot and reads per-frame movie logs until AE
  resumes scripting. Never infer the current job from `AfterFX.exe` alone. A
  render already underway before metadata capture is not safely backfillable.
- **Do not rely on AE `scheduleTask` for queue polling.** Current AE releases
  can silently stop it after the first callback. The bootstrap installs the
  unsigned local `renderdeck monitor` CEP panel and enables per-user CEP debug
  mode. Open/dock that panel once; CEP captures queued metadata every two
  seconds, and AE restores an open panel on later launches.
- **macOS process detection uses executable name `Resolve`, not bundle name
  `DaVinci Resolve`.** `pgrep -x` matches the executable basename. Using the
  bundle name produces healthy empty heartbeats while silently skipping every
  queue poll.
- **Rynn's Resolve is the free version** — no scripting API, so its Resolve
  watcher heartbeats but never reports jobs. Tommus is the Studio licence.
- **Windows watcher subprocesses must use `CREATE_NO_WINDOW`.** Rynn's Resolve
  watcher polls `tasklist`; without that creation flag it flashes a terminal
  every idle cycle. The Windows bootstrap also kills matching old `pythonw`
  watchers before restarting them so upgrades cannot accumulate duplicates.
- **Tommus has no Xcode CLT and no Homebrew**, so `/usr/bin/python3` is a stub
  that opens a GUI dialog. It runs renderdeck's vendored interpreter at
  `~/.local/share/renderdeck/python`.
- **Emmett also hosts `tsrelay`** (LaunchAgent `com.vv.tsrelay`), unrelated to
  renderdeck — it forwards the Cutpoint Render Queue Monitor host onto the
  tailnet.
