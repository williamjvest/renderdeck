/* renderdeck AE queue snapshot — evaluated by app.scheduleTask every 2 sec. */
(function () {
  var dir = ($.os.toLowerCase().indexOf("win") !== -1)
    ? Folder(Folder.userData.fsName + "/renderdeck")
    : Folder(Folder("~").fsName + "/.local/share/renderdeck");
  if (!dir.exists) { dir.create(); }

  var stateFile = File(dir.fsName + "/ae-queue.json");
  var errorFile = File(dir.fsName + "/ae-startup-error.log");
  var started = $.global.__renderdeckAeStarted || {};
  $.global.__renderdeckAeStarted = started;

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      .replace(/[\r\n\t]/g, " ");
  }

  function mapState(st) {
    if (st === RQItemStatus.QUEUED)       { return "queued"; }
    if (st === RQItemStatus.RENDERING)    { return "rendering"; }
    if (st === RQItemStatus.DONE)         { return "complete"; }
    if (st === RQItemStatus.ERR_STOPPED)  { return "failed"; }
    if (st === RQItemStatus.USER_STOPPED) { return "cancelled"; }
    return null;
  }

  function collect() {
    var rq = app.project.renderQueue, jobs = [], now = (new Date()).getTime();
    for (var i = 1; i <= rq.numItems; i++) {
      var it = rq.item(i), total = null;
      try {
        if (it.status !== RQItemStatus.RENDERING && it.status !== RQItemStatus.DONE) {
          it.logType = RQItemLogType.ERRORS_AND_PER_FRAME_INFO;
        }
        total = Math.round(it.timeSpanDuration / it.comp.frameDuration);
      } catch (ignoreLogError) {}

      var s = mapState(it.status);
      if (s === null) { continue; }

      var id = "rq" + i;
      if (s === "rendering" && !started[id]) { started[id] = now; }
      var elapsed = started[id] ? Math.round((now - started[id]) / 1000) : null;
      if (s !== "rendering" && s !== "queued") { started[id] = null; }

      var name = "item " + i, out = "";
      try { name = it.comp.name; } catch (ignoreNameError) {}
      try { out = it.outputModule(1).file.fsName; } catch (ignoreOutputError) {}

      jobs.push('{"id":"' + esc(id) + '","name":"' + esc(name) +
        '","state":"' + s + '","percent":null,"elapsed_s":' +
        (elapsed === null ? "null" : elapsed) + ',"output":"' + esc(out) +
        '","total_frames":' + (total === null ? "null" : total) +
        ',"error":null}');
    }
    return '{"ts":' + Math.round(now / 1000) + ',"jobs":[' + jobs.join(",") + "]}";
  }

  function writeText(file, text) {
    file.encoding = "UTF-8";
    if (!file.open("w")) { throw new Error("cannot open " + file.fsName); }
    if (!file.write(text)) {
      file.close();
      throw new Error("cannot write " + file.fsName);
    }
    if (!file.close()) { throw new Error("cannot close " + file.fsName); }
  }

  try {
    writeText(stateFile, collect());
    if (errorFile.exists) { errorFile.remove(); }
  } catch (e) {
    try { writeText(errorFile, (new Date()).toString() + " " + e.toString()); }
    catch (ignoreWriteError) {}
  }
})();
