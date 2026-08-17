/* Host-side queue snapshot called by the renderdeck CEP panel every 2 sec. */
var renderdeckAeCepStarted = {};

function renderdeckAeCepEsc(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    .replace(/[\r\n\t]/g, " ");
}

function renderdeckAeCepState(st) {
  if (st === RQItemStatus.QUEUED)       { return "queued"; }
  if (st === RQItemStatus.RENDERING)    { return "rendering"; }
  if (st === RQItemStatus.DONE)         { return "complete"; }
  if (st === RQItemStatus.ERR_STOPPED)  { return "failed"; }
  if (st === RQItemStatus.USER_STOPPED) { return "cancelled"; }
  return null;
}

function renderdeckAeCepWrite(file, text) {
  file.encoding = "UTF-8";
  if (!file.open("w")) { throw new Error("cannot open " + file.fsName); }
  if (!file.write(text)) { file.close(); throw new Error("cannot write " + file.fsName); }
  if (!file.close()) { throw new Error("cannot close " + file.fsName); }
}

function renderdeckAeCepTick() {
  try {
    var dir = ($.os.toLowerCase().indexOf("win") !== -1)
      ? Folder(Folder.userData.fsName + "/renderdeck")
      : Folder(Folder("~").fsName + "/.local/share/renderdeck");
    if (!dir.exists) { dir.create(); }
    var jobs = [], rq = app.project.renderQueue, now = (new Date()).getTime();

    for (var i = 1; i <= rq.numItems; i++) {
      var it = rq.item(i), total = null, state = renderdeckAeCepState(it.status);
      if (state === null) { continue; }
      try {
        if (it.status === RQItemStatus.QUEUED) {
          it.logType = RQItemLogType.ERRORS_AND_PER_FRAME_INFO;
        }
        total = Math.round(it.timeSpanDuration / it.comp.frameDuration);
      } catch (ignoreLogError) {}

      var id = "rq" + i;
      if (state === "rendering" && !renderdeckAeCepStarted[id]) {
        renderdeckAeCepStarted[id] = now;
      }
      var elapsed = renderdeckAeCepStarted[id]
        ? Math.round((now - renderdeckAeCepStarted[id]) / 1000) : null;
      if (state !== "rendering" && state !== "queued") { renderdeckAeCepStarted[id] = null; }

      var name = "item " + i, output = "";
      try { name = it.comp.name; } catch (ignoreNameError) {}
      try { output = it.outputModule(1).file.fsName; } catch (ignoreOutputError) {}
      jobs.push('{"id":"' + renderdeckAeCepEsc(id) + '","name":"' +
        renderdeckAeCepEsc(name) + '","state":"' + state +
        '","percent":null,"elapsed_s":' + (elapsed === null ? "null" : elapsed) +
        ',"output":"' + renderdeckAeCepEsc(output) + '","total_frames":' +
        (total === null ? "null" : total) + ',"error":null}');
    }

    var json = '{"ts":' + Math.round(now / 1000) + ',"jobs":[' + jobs.join(",") + ']}';
    renderdeckAeCepWrite(File(dir.fsName + "/ae-queue.json"), json);
    return jobs.length + " queue item(s) published";
  } catch (e) { return "error: " + e.toString(); }
}
