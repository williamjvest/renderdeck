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
