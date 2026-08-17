/*
  renderdeck — automatic After Effects queue publisher

  Install in Scripts/Startup. After Effects runs this once at launch. Keep the
  callback and every helper at true top-level scope: scheduleTask evaluates its
  command later in AE's shared global scripting environment, not the IIFE scope
  used by earlier versions of this publisher.
*/

var RENDERDECK_AE_VERSION = 5;
var renderdeckAeStarted = {};
var renderdeckAeTaskId = null;

function renderdeckAeEsc(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    .replace(/[\r\n\t]/g, " ");
}

function renderdeckAeMapState(st) {
  if (st === RQItemStatus.QUEUED)       { return "queued"; }
  if (st === RQItemStatus.RENDERING)    { return "rendering"; }
  if (st === RQItemStatus.DONE)         { return "complete"; }
  if (st === RQItemStatus.ERR_STOPPED)  { return "failed"; }
  if (st === RQItemStatus.USER_STOPPED) { return "cancelled"; }
  return null;
}

function renderdeckAePaths() {
  var dir = ($.os.toLowerCase().indexOf("win") !== -1)
    ? Folder(Folder.userData.fsName + "/renderdeck")
    : Folder(Folder("~").fsName + "/.local/share/renderdeck");
  if (!dir.exists) { dir.create(); }
  return {
    state: File(dir.fsName + "/ae-queue.json"),
    error: File(dir.fsName + "/ae-startup-error.log")
  };
}

function renderdeckAeCollect() {
  var rq = app.project.renderQueue, jobs = [], now = (new Date()).getTime();
  for (var i = 1; i <= rq.numItems; i++) {
    var it = rq.item(i), total = null;
    try {
      if (it.status !== RQItemStatus.RENDERING && it.status !== RQItemStatus.DONE) {
        it.logType = RQItemLogType.ERRORS_AND_PER_FRAME_INFO;
      }
      total = Math.round(it.timeSpanDuration / it.comp.frameDuration);
    } catch (ignoreLogError) {}

    var s = renderdeckAeMapState(it.status);
    if (s === null) { continue; }

    var id = "rq" + i;
    if (s === "rendering" && !renderdeckAeStarted[id]) {
      renderdeckAeStarted[id] = now;
    }
    var elapsed = renderdeckAeStarted[id]
      ? Math.round((now - renderdeckAeStarted[id]) / 1000) : null;
    if (s !== "rendering" && s !== "queued") { renderdeckAeStarted[id] = null; }

    var name = "item " + i, out = "";
    try { name = it.comp.name; } catch (ignoreNameError) {}
    try { out = it.outputModule(1).file.fsName; } catch (ignoreOutputError) {}

    jobs.push('{"id":"' + renderdeckAeEsc(id) + '","name":"' +
      renderdeckAeEsc(name) + '","state":"' + s +
      '","percent":null,"elapsed_s":' +
      (elapsed === null ? "null" : elapsed) + ',"output":"' +
      renderdeckAeEsc(out) + '","total_frames":' +
      (total === null ? "null" : total) + ',"error":null}');
  }
  return '{"ts":' + Math.round(now / 1000) + ',"jobs":[' + jobs.join(",") + ']}';
}

function renderdeckAeWriteText(file, text) {
  file.encoding = "UTF-8";
  if (!file.open("w")) { throw new Error("cannot open " + file.fsName); }
  if (!file.write(text)) {
    file.close();
    throw new Error("cannot write " + file.fsName);
  }
  if (!file.close()) { throw new Error("cannot close " + file.fsName); }
}

function renderdeckAeTick() {
  var paths = renderdeckAePaths();
  try {
    renderdeckAeWriteText(paths.state, renderdeckAeCollect());
    if (paths.error.exists) { paths.error.remove(); }
  } catch (e) {
    try {
      renderdeckAeWriteText(paths.error, (new Date()).toString() + " " + e.toString());
    } catch (ignoreWriteError) {}
  }
  renderdeckAeTaskId = app.scheduleTask("renderdeckAeTick()", 2000, false);
}

try {
  app.preferences.reload();
  if (app.preferences.getPrefAsLong(
      "Main Pref Section", "Pref_SCRIPTING_FILE_NETWORK_SECURITY") === 1) {
    renderdeckAeTick();
  }
} catch (renderdeckAePreferenceError) {}
