/*
  Render Notify.jsx — After Effects ScriptUI panel.

  Why a panel and not a Post-Render Action: AE's built-in post-render actions
  are limited to Import / Import & Replace Usage / Set Proxy. There is no
  "run a command" option, so the only supported way to fire an external
  notification from a GUI render is a resident script that watches the queue.

  Install: drop in
    C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\ScriptUI Panels\
  then Window > Render Notify.jsx. Dock it once; it re-arms itself after every
  render, so this is a one-time action per AE session.

  Requires "Allow Scripts to Write Files and Access Network" in
  Preferences > Scripting & Expressions (the panel tells you if it's off).
*/

(function (thisObj) {

  var POLL_MS = 2000;

  /* Cross-platform: Rynn runs the PowerShell notifier, the Macs run the bash
     one. $.os is "Windows..." or "Macintosh...". Keeping one .jsx for both
     means a fix to the queue logic lands everywhere at once. */
  var IS_WIN  = ($.os.toLowerCase().indexOf("win") !== -1);
  var NOTIFY  = IS_WIN
    ? "C:\\Users\\toldwell\\bin\\notify-ntfy.ps1"
    : "~/Projects/vv-opencode/bin/render-notify/notify-ntfy";

  var state = { armed: false, wasRendering: false, startedAt: null, ui: null };

  function log(msg) {
    if (state.ui && state.ui.status) state.ui.status.text = msg;
  }

  function shellQuote(s) {
    return "'" + String(s).replace(/'/g, "''") + "'";
  }

  function push(title, body, priority, tags) {
    var cmd;
    if (IS_WIN) {
      cmd = 'cmd.exe /c powershell -NoProfile -ExecutionPolicy Bypass -File "' + NOTIFY + '"'
          + ' -Title '    + shellQuote(title)
          + ' -Message '  + shellQuote(body)
          + ' -Priority ' + shellQuote(priority || "default")
          + ' -Tags '     + shellQuote(tags || "");
    } else {
      cmd = '/bin/sh -c ' + shellQuote(
              shellQuote(NOTIFY.replace(/^~/, '$HOME')) + ' ' + shellQuote(title)
              + ' ' + shellQuote(body) + ' ' + shellQuote(priority || "default")
              + ' ' + shellQuote(tags || ""));
    }
    try {
      system.callSystem(cmd);
    } catch (e) {
      log("push failed: " + e.toString());
    }
  }

  function elapsed() {
    if (!state.startedAt) return "unknown";
    var s = Math.round((new Date().getTime() - state.startedAt) / 1000);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return (h ? h + "h " : "") + (m ? m + "m " : "") + (s % 60) + "s";
  }

  /* Summarize the queue AFTER rendering stops. AE leaves each item's status
     behind, which is how we tell a clean finish from a failure or a manual
     stop -- rendering==false alone can't distinguish them. */
  function summarize() {
    var rq = app.project.renderQueue, done = 0, failed = 0, stopped = 0, last = null;
    for (var i = 1; i <= rq.numItems; i++) {
      var it = rq.item(i);
      if (it.status === RQItemStatus.DONE)             { done++;    last = it; }
      else if (it.status === RQItemStatus.ERR_STOPPED) { failed++;  last = it; }
      else if (it.status === RQItemStatus.USER_STOPPED){ stopped++; last = it; }
    }
    var out = "";
    try { out = last ? last.outputModule(1).file.fsName : ""; } catch (e) {}
    return { done: done, failed: failed, stopped: stopped, output: out };
  }

  function tick() {
    if (!state.armed) return;
    try {
      var rendering = app.project.renderQueue.rendering;

      if (rendering && !state.wasRendering) {
        state.startedAt = new Date().getTime();
        log("rendering...");
      }

      if (!rendering && state.wasRendering) {
        var s = summarize();
        var t = elapsed();
        var proj = app.project.file ? app.project.file.name : "untitled";

        if (s.failed > 0) {
          push("AE FAILED - " + proj,
               s.failed + " item(s) errored after " + t + "\n" + s.output,
               "high", "rotating_light");
          log("failed - notified");
        } else if (s.stopped > 0 && s.done === 0) {
          log("stopped by user - no notification");
        } else {
          push("AE done - " + proj,
               s.done + " item(s) in " + t + (s.output ? "\n" + s.output : ""),
               "default", "white_check_mark");
          log("done - notified");
        }
        state.startedAt = null;
      }

      state.wasRendering = rendering;
    } catch (e) {
      log("error: " + e.toString());
    }
    app.scheduleTask("__renderNotifyTick()", POLL_MS, false);
  }

  /* scheduleTask evaluates a STRING in the global scope, so the callback has
     to be reachable from there -- a closure reference would not resolve. */
  $.global.__renderNotifyTick = tick;

  function build(thisObj) {
    var pal = (thisObj instanceof Panel) ? thisObj
            : new Window("palette", "Render Notify", undefined, {resizeable: true});

    pal.orientation = "column";
    pal.alignChildren = ["fill", "top"];
    pal.spacing = 8;
    pal.margins = 12;

    var btn    = pal.add("button", undefined, "Arm");
    var test   = pal.add("button", undefined, "Send test push");
    var status = pal.add("statictext", undefined, "idle", {truncate: "middle"});
    status.characters = 30;

    state.ui = { status: status };

    if (!app.preferences.getPrefAsLong("Main Pref Section",
          "Pref_SCRIPTING_FILE_NETWORK_SECURITY")) {
      status.text = "Enable scripting network access in Prefs";
    }

    btn.onClick = function () {
      state.armed = !state.armed;
      btn.text = state.armed ? "Disarm" : "Arm";
      if (state.armed) {
        state.wasRendering = app.project.renderQueue.rendering;
        log("armed - watching queue");
        app.scheduleTask("__renderNotifyTick()", POLL_MS, false);
      } else {
        log("idle");
      }
    };

    test.onClick = function () {
      push("AE test - " + (app.project.file ? app.project.file.name : "untitled"),
           "Render Notify panel is wired up correctly.", "default", "wrench");
      log("test sent");
    };

    if (pal instanceof Window) { pal.center(); pal.show(); }
    else { pal.layout.layout(true); }
    return pal;
  }

  build(thisObj);

})(this);
