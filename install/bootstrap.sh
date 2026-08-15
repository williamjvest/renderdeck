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
SUFFIX=""
PBS_TAG="20260807"
PBS_VER="3.12.13"

while [ $# -gt 0 ]; do
  case "$1" in
    --collector) COLLECTOR="$2"; shift 2 ;;
    --token)     TOKEN="$2";     shift 2 ;;
    --machine)   MACHINE="$2";   shift 2 ;;
    --dest)      DEST="$2";      shift 2 ;;   # non-default dest gets its own service label
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$COLLECTOR" ] && [ -n "$TOKEN" ] || { echo "need --collector and --token" >&2; exit 2; }
# A --dest install must not reuse the default service labels, or a test run
# silently repoints the real watchers at the throwaway copy. Learned live.
[ "$DEST" = "$HOME/renderdeck" ] || SUFFIX="-$(basename "$DEST")"

# Do NOT trust `command -v python3` on macOS. /usr/bin/python3 always exists as
# a SHIM: without Xcode command line tools it prints "No developer tools were
# found, requesting install" and pops a GUI dialog. It looks present, resolves
# on PATH, and does nothing. Verified on a Resolve Studio edit bay with no dev
# tools and no Homebrew -- the single most common state for a工作 render machine.
PY=""
if command -v python3 >/dev/null 2>&1 && python3 -c 'import ssl,sqlite3' >/dev/null 2>&1; then
  PY=$(command -v python3)
fi
VENDOR="$HOME/.local/share/renderdeck/python/bin/python3"   # outside $DEST: the fetch wipes $DEST
if [ -z "$PY" ] && [ -x "$VENDOR" ]; then PY="$VENDOR"; fi
if [ -z "$PY" ]; then
  echo "==> no usable python3 — installing a private one (no admin, no Xcode)"
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)  PLAT=aarch64-apple-darwin ;;
    Darwin-x86_64) PLAT=x86_64-apple-darwin ;;
    Linux-x86_64)  PLAT=x86_64-unknown-linux-gnu ;;
    Linux-aarch64) PLAT=aarch64-unknown-linux-gnu ;;
    *) echo "no standalone python for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
  esac
  PBS="https://github.com/astral-sh/python-build-standalone/releases/download/$PBS_TAG"
  TARBALL="cpython-$PBS_VER+$PBS_TAG-$PLAT-install_only_stripped.tar.gz"
  PYROOT="$HOME/.local/share/renderdeck/python"
  STAGE=$(mktemp -d)

  # Download and extract to a staging dir, THEN swap. Removing $PYROOT first
  # meant a network failure mid-download left the machine with no interpreter
  # at all rather than the one it started with.
  curl -fsSL "$PBS/$TARBALL" -o "$STAGE/py.tgz"

  # Verify against the release's published SHA256SUMS. Anything executed by a
  # curl|bash installer has to be checked -- otherwise a compromised mirror or
  # a hijacked connection runs arbitrary code as the user.
  if curl -fsSL "$PBS/SHA256SUMS" -o "$STAGE/sums" 2>/dev/null; then
    want=$(grep " $TARBALL\$" "$STAGE/sums" | awk '{print $1}')
    if [ -n "$want" ]; then
      got=$(shasum -a 256 "$STAGE/py.tgz" 2>/dev/null | awk '{print $1}')
      [ -n "$got" ] || got=$(sha256sum "$STAGE/py.tgz" | awk '{print $1}')
      if [ "$want" != "$got" ]; then
        rm -rf "$STAGE"
        echo "checksum MISMATCH for $TARBALL" >&2
        echo "  expected $want" >&2
        echo "  got      $got" >&2
        exit 1
      fi
      echo "    checksum verified"
    else
      echo "    WARNING: $TARBALL absent from SHA256SUMS — cannot verify" >&2
    fi
  else
    echo "    WARNING: could not fetch SHA256SUMS — python NOT verified" >&2
  fi

  mkdir -p "$STAGE/x"
  tar -xzf "$STAGE/py.tgz" -C "$STAGE/x" --strip-components=1
  [ -x "$STAGE/x/bin/python3" ] || { rm -rf "$STAGE"; echo "bad python tarball" >&2; exit 1; }
  rm -rf "$PYROOT"; mkdir -p "$(dirname "$PYROOT")"; mv "$STAGE/x" "$PYROOT"
  rm -rf "$STAGE"
  PY="$VENDOR"
fi
echo "==> python: $("$PY" -V 2>&1)  ($PY)"

echo "==> fetching renderdeck into $DEST"
# git is NOT assumed. On a fresh Mac without Xcode command line tools, `git`
# is a stub that pops a GUI installer and hangs a piped script forever -- the
# single most likely way this install dies on an edit bay machine. Tarball via
# curl is the default; git is only used when a real one already exists.
if command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1; then
  if [ -d "$DEST/.git" ]; then
    git -C "$DEST" pull --ff-only --quiet
  else
    rm -rf "$DEST"; git clone --depth 1 --quiet "$REPO" "$DEST"
  fi
else
  echo "    (no usable git — downloading tarball)"
  TMP=$(mktemp -d)
  curl -fsSL "$REPO/archive/refs/heads/main.tar.gz" -o "$TMP/rd.tgz"
  mkdir -p "$TMP/x" && tar -xzf "$TMP/rd.tgz" -C "$TMP/x"
  # Prove the archive is what we think before destroying the existing install.
  [ -f "$TMP/x/renderdeck-main/install/setup.py" ] || {
    rm -rf "$TMP"; echo "downloaded archive doesn't look like renderdeck" >&2; exit 1; }
  rm -rf "$DEST"; mkdir -p "$(dirname "$DEST")"
  mv "$TMP/x/renderdeck-main" "$DEST"
  rm -rf "$TMP"
fi
[ -f "$DEST/install/setup.py" ] || { echo "fetch failed: $DEST looks wrong" >&2; exit 1; }

echo "==> writing config"
"$PY" "$DEST/install/setup.py" --collector "$COLLECTOR" --token "$TOKEN" \
  ${MACHINE:+--machine "$MACHINE"}

mkdir -p "$HOME/.local/share/renderdeck"

install_launchd() {
  local name=$1 script=$2 extra=$3
  local plist="$HOME/Library/LaunchAgents/com.renderdeck.$name$SUFFIX.plist"
  "$PY" - "$plist" "$PY" "$DEST/watchers/$script" "$extra" "$HOME" "$name$SUFFIX" <<'PYEOF'
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
  echo "    launchd: com.renderdeck.$name$SUFFIX"
}

install_systemd() {
  local name=$1 script=$2 extra=$3
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/renderdeck-$name$SUFFIX.service" <<UNIT
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
  systemctl --user enable --now "renderdeck-$name$SUFFIX" >/dev/null
  echo "    systemd --user: renderdeck-$name$SUFFIX"
}

# Only install a watcher for a program that is actually here. Tommus reported
# "After Effects: idle" for months' worth of dashboard real estate despite
# having no AE installed — a monitor for absent software is noise that trains
# you to ignore the panel.
have_ae()      { ls -d /Applications/Adobe*After*Effects* >/dev/null 2>&1 || \
                 [ -d "/opt/Adobe" ]; }
have_resolve() { [ -d "/Applications/DaVinci Resolve" ] || [ -d "/opt/resolve" ]; }

echo "==> detecting installed programs"
have_ae      && echo "    After Effects: yes"   || echo "    After Effects: not installed — skipping"
have_resolve && echo "    DaVinci Resolve: yes" || echo "    DaVinci Resolve: not installed — skipping"
if ! have_ae && ! have_resolve; then
  echo "no supported program found; install AE or Resolve first" >&2; exit 1
fi

echo "==> installing services (survive reboot)"
case "$(uname -s)" in
  Darwin)
    have_ae      && install_launchd ae      renderdeck-ae-sequence "--interval 30"
    have_resolve && install_launchd resolve renderdeck-resolve     ""
    if have_ae; then
      for prefs in "$HOME"/Library/Preferences/Adobe/After\ Effects/[0-9]*; do
        [ -d "$prefs" ] || continue
        mkdir -p "$prefs/Scripts/Startup"
        cp "$DEST/watchers/renderdeck-ae-startup.jsx" "$prefs/Scripts/Startup/"
        echo "    AE auto-start: $prefs/Scripts/Startup"
      done
    fi
    ;;
  Linux)
    have_ae      && install_systemd ae      renderdeck-ae-sequence "--interval 30"
    have_resolve && install_systemd resolve renderdeck-resolve     ""
    # user services die at logout unless lingering is enabled
    loginctl enable-linger "$USER" 2>/dev/null || \
      echo "    note: run 'sudo loginctl enable-linger $USER' so it survives logout"
    ;;
  *) echo "unsupported OS: $(uname -s). On Windows use install/bootstrap.ps1." >&2; exit 1 ;;
esac

sleep 6
echo "==> verifying"
"$PY" - "$DEST" <<'PYEOF'
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
