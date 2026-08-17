(function () {
  "use strict";
  var status = document.getElementById("status");
  var detail = document.getElementById("detail");
  var busy = false;
  var extensionPath = decodeURI(window.__adobe_cep__.getSystemPath("extension"));
  var hostPath = extensionPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + "/host.jsx";
  var hostCall = '$.evalFile(new File("' + hostPath + '")); renderdeckAeCepTick()';

  function tick() {
    if (busy || !window.__adobe_cep__) { return; }
    busy = true;
    window.__adobe_cep__.evalScript(hostCall, function (result) {
      busy = false;
      if (!result || result === "EvalScript error." ||
          result.indexOf("error:") === 0 || result.indexOf("published") === -1) {
        status.textContent = "renderdeck error";
        detail.textContent = result;
        return;
      }
      status.textContent = "renderdeck active";
      detail.textContent = result;
    });
  }

  tick();
  window.setInterval(tick, 2000);
})();
