(function () {
  "use strict";
  var status = document.getElementById("status");
  var detail = document.getElementById("detail");
  var busy = false;
  var hostLoaded = false;
  var extensionPath = decodeURI(window.__adobe_cep__.getSystemPath("extension"));
  var hostPath = extensionPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + "/host.jsx";
  var loadHost = '$.evalFile(new File("' + hostPath + '")); renderdeckAeCepTick()';

  function tick() {
    if (busy || !window.__adobe_cep__) { return; }
    busy = true;
    var call = hostLoaded ? "renderdeckAeCepTick()" : loadHost;
    window.__adobe_cep__.evalScript(call, function (result) {
      busy = false;
      if (!result || result === "EvalScript error." ||
          result.indexOf("error:") === 0 || result.indexOf("published") === -1) {
        status.textContent = "renderdeck error";
        detail.textContent = result;
        return;
      }
      hostLoaded = true;
      status.textContent = "renderdeck active";
      detail.textContent = result;
    });
  }

  tick();
  window.setInterval(tick, 2000);
})();
