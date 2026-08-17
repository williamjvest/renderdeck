/*
  renderdeck — automatic After Effects queue publisher bootstrap

  AE runs this once at launch. Scheduled callbacks execute in a detached JSVM,
  where closure/global-function references proved unreliable on AE 26.3. The
  callback therefore evaluates a standalone tick file by absolute path.
*/

(function () {
  var VERSION = 4;

  try {
    app.preferences.reload();
    if (app.preferences.getPrefAsLong(
        "Main Pref Section", "Pref_SCRIPTING_FILE_NETWORK_SECURITY") !== 1) {
      return;
    }
  } catch (preferenceError) { return; }

  var tickFile = File(File($.fileName).parent.fsName + "/renderdeck-ae-tick.jsx");
  if (!tickFile.exists) { return; }

  function quoteForJs(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  /* Replace an older generation cleanly if this bootstrap is run manually. */
  try {
    if ($.global.__renderdeckAeTaskId) {
      app.cancelTask($.global.__renderdeckAeTaskId);
    }
  } catch (ignoreCancelError) {}

  $.evalFile(tickFile);
  var command = '$.evalFile(new File("' + quoteForJs(tickFile.fsName) + '"))';
  $.global.__renderdeckAeTaskId = app.scheduleTask(command, 2000, true);
  $.global.__renderdeckAeAutoVersion = VERSION;
})();
