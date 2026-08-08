# Deployment (Toldwell)

Notes for *this* install. The README describes the software; this describes
where it actually runs and what is outstanding on the estate.

## Topology

| Host | Role | Programs monitored | Service |
|---|---|---|---|
| Hostinger VPS | server + dashboard | — | systemd `renderdeck`, `/opt/renderdeck` (git clone) |
| Asmond | Mac | After Effects, DaVinci Resolve | launchd `com.renderdeck.{ae,resolve}` |
| Emmett | Mac (primary edit) | After Effects, DaVinci Resolve | launchd `com.renderdeck.{ae,resolve}` |
| Rynn | Windows / RTX 5080 | After Effects, DaVinci Resolve (free) | Task Scheduler `Renderdeck{AE,Resolve}` |
| Tommus | Mac / Resolve Studio | DaVinci Resolve only (no AE installed) | launchd `com.renderdeck.resolve` |

- Dashboard: `http://100.69.216.6:8090` — bound `0.0.0.0`, but ufw default-deny
  means only the tailnet and the docker bridge can reach it. Verified: the
  public IP times out.
- Notifications: ntfy topic `renders` on `ntfy.williamvest.com`.
- Monitoring: Gatus endpoints `renderdeck` (health) and `renderdeck watchers`
  (asserts `offline == 0`).
- Token: `vv-vault:RENDER_COLLECTOR_TOKEN`. Rotating it means updating the
  systemd unit **and** every machine's config; there is no push mechanism.

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
- [ ] **The AE ScriptUI panel is installed nowhere.** `watchers/renderdeck-ae-panel.jsx`
      ships in the repo but is not in any machine's `Scripts/ScriptUI Panels/`,
      so no Mac publishes its AE queue and movie renders have no log to parse.
      Emmett (AE 2026) is the one that matters.
- [ ] Consider per-machine tokens so one leaked config does not mean a full
      estate rotation.

## Gotchas specific to this estate

- **Rynn's Resolve is the free version** — no scripting API, so its Resolve
  watcher heartbeats but never reports jobs. Tommus is the Studio licence.
- **Tommus has no Xcode CLT and no Homebrew**, so `/usr/bin/python3` is a stub
  that opens a GUI dialog. It runs renderdeck's vendored interpreter at
  `~/.local/share/renderdeck/python`.
- **Emmett also hosts `tsrelay`** (LaunchAgent `com.vv.tsrelay`), unrelated to
  renderdeck — it forwards the Cutpoint Render Queue Monitor host onto the
  tailnet.
