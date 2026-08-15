/*
  renderdeck — After Effects render queue panel

  Install: drop in a ScriptUI Panels folder --
    mac : ~/Library/Preferences/Adobe/After Effects/<ver>/Scripts/ScriptUI Panels/
    win : ...\After Effects <ver>\Support Files\Scripts\ScriptUI Panels\
  then Window > renderdeck-ae-panel.jsx. Dock it once per AE session.

  WHY A PANEL AT ALL. After Effects' built-in Post-Render Action can only
  Import / Import & Replace Usage / Set Proxy -- there is no "run a command".
  A resident script polling app.project.renderQueue is the only supported way
  to observe a GUI render.

  WHY IT DOESN'T TALK TO THE NETWORK. ExtendScript has no HTTP client worth
  trusting, and system.callSystem() BLOCKS the AE UI for the duration of the
  call. Firing one on a timer during a render would stutter the app you are
  trying to watch. So the panel does the one thing it is uniquely able to do --
  read the queue -- and writes it to a file. The renderdeck-ae watcher, which
  is already running as a service on every machine, picks the file up and does
  the reporting. Panel closed or AE shut: the watcher falls back to presence
  mode on its own.

  ON PERCENT. After Effects exposes no per-item progress through scripting --
  no percent, no current frame. What it DOES expose is `RQItem.logType`, and
  with ERRORS_AND_PER_FRAME_INFO it writes a per-frame log beside the output.
  The panel turns that on automatically and publishes the total frame count
  (timeSpanDuration / frameDuration), so the watcher can parse the log and
  produce a real bar for ProRes/H.264 movie output -- not just image sequences,
  which it can already count on disk.

  Percent is still reported as null by the panel itself: it publishes the
  INPUTS (total frames, log path) and lets the watcher compute progress from
  evidence. A bar faked from elapsed time drifts from reality.
*/

(function (thisObj) {

  var POLL_MS = 2000;
  var STATE_FILE = (function () {
    var win = ($.os.toLowerCase().indexOf("win") !== -1);
    var home = win ? Folder.userData.parent.fsName + "/" + Folder.current.name
                   : Folder("~").fsName;
    var dir = win ? Folder(Folder.userData.fsName + "/renderdeck")
                  : Folder(Folder("~").fsName + "/.local/share/renderdeck");
    if (!dir.exists) { dir.create(); }
    return File(dir.fsName + "/ae-queue.json");
  })();

  var state = { armed: false, ui: null, started: {} };

  function log(m) { if (state.ui && state.ui.status) state.ui.status.text = m; }

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      .replace(/[\r\n\t]/g, " ");
  }

  /* AE's RQItemStatus -> renderdeck's shared job model states. */
  function mapState(st) {
    if (st === RQItemStatus.RENDERING)    return "rendering";
    if (st === RQItemStatus.DONE)         return "complete";
    if (st === RQItemStatus.ERR_STOPPED)  return "failed";
    if (st === RQItemStatus.USER_STOPPED) return "cancelled";
    return null;                       // QUEUED / UNQUEUED / NEEDS_OUTPUT: not a job yet
  }

  function collect() {
    var rq = app.project.renderQueue, jobs = [], now = (new Date()).getTime();

    for (var i = 1; i <= rq.numItems; i++) {
      var it = rq.item(i);

      /* Set logging while the item is still queued. Previously this lived
         below the early continue, so queued items were skipped and movie
         renders started without the per-frame log needed for progress. */
      var total = null;
      try {
        if (it.status !== RQItemStatus.RENDERING && it.status !== RQItemStatus.DONE) {
          it.logType = RQItemLogType.ERRORS_AND_PER_FRAME_INFO;
        }
        total = Math.round(it.timeSpanDuration / it.comp.frameDuration);
      } catch (e) { total = null; }

      var s = mapState(it.status);
      if (s === null) { continue; }

      var id = "rq" + i;
      if (s === "rendering") {
        if (!state.started[id]) { state.started[id] = now; }
      }
      var elapsed = state.started[id] ? Math.round((now - state.started[id]) / 1000) : null;
      if (s !== "rendering") { state.started[id] = null; }

      var name = "", out = "";
      try { name = it.comp.name; } catch (e) { name = "item " + i; }
      try { out = it.outputModule(1).file.fsName; } catch (e) { out = ""; }

      /* Ask AE to write a per-frame log next to the output. This is the ONLY
         progress signal available for a movie-file render -- a .mov has no
         frames on disk to count. Set once, before it starts rendering; AE
         rejects settings changes on an in-flight item. */
      jobs.push('{"id":"' + esc(id) + '","name":"' + esc(name) + '","state":"' + s +
                '","percent":null,"elapsed_s":' + (elapsed === null ? "null" : elapsed) +
                ',"output":"' + esc(out) + '","total_frames":' +
                (total === null ? "null" : total) + ',"error":null}');
    }

    return '{"ts":' + Math.round(now / 1000) + ',"jobs":[' + jobs.join(",") + ']}';
  }

  function tick() {
    if (!state.armed) { return; }
    try {
      var json = collect();
      STATE_FILE.encoding = "UTF-8";
      if (STATE_FILE.open("w")) {
        STATE_FILE.write(json);
        STATE_FILE.close();
      }
      var n = json.split('"id"').length - 1;
      log(n ? n + " job(s) published" : "queue idle");
    } catch (e) {
      log("error: " + e.toString());
    }
    app.scheduleTask("__renderdeckAeTick()", POLL_MS, false);
  }

  /* scheduleTask evaluates a STRING in the global scope, so the callback has to
     be reachable from there -- a closure reference would not resolve. */
  $.global.__renderdeckAeTick = tick;

  function build(thisObj) {
    var pal = (thisObj instanceof Panel) ? thisObj
            : new Window("palette", "renderdeck", undefined, { resizeable: true });
    pal.orientation = "column";
    pal.alignChildren = ["fill", "top"];
    pal.spacing = 8;
    pal.margins = 12;

    var btn = pal.add("button", undefined, "Arm");
    var status = pal.add("statictext", undefined, "idle", { truncate: "middle" });
    status.characters = 30;
    var path = pal.add("statictext", undefined, STATE_FILE.fsName, { truncate: "middle" });
    path.characters = 30;
    path.enabled = false;

    state.ui = { status: status };

    btn.onClick = function () {
      state.armed = !state.armed;
      btn.text = state.armed ? "Disarm" : "Arm";
      if (state.armed) {
        log("armed - publishing queue");
        app.scheduleTask("__renderdeckAeTick()", POLL_MS, false);
      } else {
        try { if (STATE_FILE.exists) { STATE_FILE.remove(); } } catch (e) {}
        log("idle");
      }
    };

    if (pal instanceof Window) { pal.center(); pal.show(); }
    else { pal.layout.layout(true); }
    return pal;
  }

  build(thisObj);

})(this);
