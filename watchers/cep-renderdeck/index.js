(function () {
  "use strict";
  var status = document.getElementById("status");
  var detail = document.getElementById("detail");
  var busy = false;

  function tick() {
    if (busy || !window.__adobe_cep__) { return; }
    busy = true;
    window.__adobe_cep__.evalScript("renderdeckAeCepTick()", function (result) {
      busy = false;
      if (result === "EvalScript error." || result.indexOf("error:") === 0) {
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
