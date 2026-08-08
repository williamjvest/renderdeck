#!/usr/bin/env bash
# renderdeck bootstrap — install the companion apps on a macOS or Linux machine.
#
#   curl -fsSL https://raw.githubusercontent.com/williamjvest/renderdeck/main/install/bootstrap.sh \
#     | bash -s -- --collector http://HOST:8090 --token TOKEN
#
# Idempotent: safe to re-run to upgrade. Installs to ~/renderdeck, writes the
# config, and registers per-program services so the watchers come back after a
# reboot (launchd on macOS, systemd --user on Linux).

set -euo pipefail

COLLECTOR=""; TOKEN=""; MACHINE=""; REPO="https://github.com/williamjvest/renderdeck"
DEST="$HOME/renderdeck"

while [ $# -gt 0 ]; do
  case "$1" in
    --collector) COLLECTOR="$2"; shift 2 ;;
    --token)     TOKEN="$2";     shift 2 ;;
    --machine)   MACHINE="$2";   shift 2 ;;
    --dest)      DEST="$2";      shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$COLLECTOR" ] && [ -n "$TOKEN" ] || { echo "need --collector and --token" >&2; exit 2; }

command -v python3 >/dev/null || { echo "python3 not found" >&2; exit 1; }
echo "==> python: $(python3 -V 2>&1)"

echo "==> fetching renderdeck into $DEST"
if [ -d "$DEST/.git" ]; then
  git -C "$DEST" pull --ff-only --quiet
else
  rm -rf "$DEST"
  git clone --depth 1 --quiet "$REPO" "$DEST"
fi

echo "==> writing config"
python3 "$DEST/install/setup.py" --collector "$COLLECTOR" --token "$TOKEN" \
  ${MACHINE:+--machine "$MACHINE"}

PY=$(command -v python3)
mkdir -p "$HOME/.local/share/renderdeck"

install_launchd() {
  local name=$1 script=$2 extra=$3
  local plist="$HOME/Library/LaunchAgents/com.renderdeck.$name.plist"
  python3 - "$plist" "$PY" "$DEST/watchers/$script" "$extra" "$HOME" "$name" <<'PYEOF'
import plistlib, sys
plist, py, script, extra, home, name = sys.argv[1:7]
args = [py, script] + ([a for a in extra.split() if a])
plistlib.dump({
    "Label": f"com.renderdeck.{name}",
    "ProgramArguments": args,
    "RunAtLoad": True, "KeepAlive": True, "ThrottleInterval": 30,
    "StandardOutPath": f"{home}/.local/share/renderdeck/{name}.log",
    "StandardErrorPath": f"{home}/.local/share/renderdeck/{name}.log",
    "ProcessType": "Background",
}, open(plist, "wb"))
PYEOF
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load "$plist"
  echo "    launchd: com.renderdeck.$name"
}

install_systemd() {
  local name=$1 script=$2 extra=$3
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/renderdeck-$name.service" <<UNIT
[Unit]
Description=renderdeck $name watcher
[Service]
ExecStart=$PY $DEST/watchers/$script $extra
Restart=always
RestartSec=30
[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now "renderdeck-$name" >/dev/null
  echo "    systemd --user: renderdeck-$name"
}

echo "==> installing services (survive reboot)"
case "$(uname -s)" in
  Darwin)
    install_launchd ae      renderdeck-ae-sequence "--interval 30"
    install_launchd resolve renderdeck-resolve     ""
    ;;
  Linux)
    install_systemd ae      renderdeck-ae-sequence "--interval 30"
    install_systemd resolve renderdeck-resolve     ""
    # user services die at logout unless lingering is enabled
    loginctl enable-linger "$USER" 2>/dev/null || \
      echo "    note: run 'sudo loginctl enable-linger $USER' so it survives logout"
    ;;
  *) echo "unsupported OS: $(uname -s). Use install/bootstrap.ps1 on Windows." >&2; exit 1 ;;
esac

sleep 6
echo "==> verifying"
python3 - "$DEST" <<'PYEOF'
import sys, urllib.request, json
sys.path.insert(0, sys.argv[1])
from renderdeck.config import load
c = load()
print(f"    machine   : {c['machine']}")
print(f"    collector : {c['collector']}")
try:
    d = json.load(urllib.request.urlopen(c["collector"].rstrip("/") + "/api/state", timeout=8))
    mine = [m for m in d["machines"] if m["machine"] == c["machine"]]
    if mine:
        for m in mine:
            print(f"    reporting : {m['app']}  (age {m['age_s']}s)")
    else:
        print("    reporting : NOT YET VISIBLE — give it 30s, then re-check the dashboard")
except Exception as e:
    print(f"    collector unreachable: {e}")
PYEOF
echo "==> done"
