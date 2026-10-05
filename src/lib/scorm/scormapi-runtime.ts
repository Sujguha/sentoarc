// Standard SCORM 1.2 API-discovery pattern: the LMS exposes a window.API
// object somewhere up the parent/opener chain; this walks up to find it.
// Shipped as plain JS inside generated packages (runs in the learner's
// browser inside the LMS, not part of the Worker build).
export const SCORM_API_JS = `(function (window) {
  "use strict";

  function findAPI(win) {
    var attempts = 0;
    while (!win.API && win.parent && win.parent !== win && attempts < 500) {
      attempts++;
      win = win.parent;
    }
    return win.API || null;
  }

  function getAPI() {
    var api = findAPI(window);
    if (!api && window.opener) {
      api = findAPI(window.opener);
    }
    return api;
  }

  var api = null;
  var initialized = false;

  function init() {
    api = getAPI();
    if (!api) {
      console.warn("SCORM API not found - running outside an LMS, or the LMS hasn't exposed window.API.");
      return false;
    }
    var result = api.LMSInitialize("");
    initialized = result === "true" || result === true;
    if (!initialized && api.LMSGetLastError) {
      console.warn("LMSInitialize failed:", api.LMSGetLastError());
    }
    return initialized;
  }

  function markComplete() {
    if (!initialized) return;
    api.LMSSetValue("cmi.core.lesson_status", "completed");
    api.LMSCommit("");
  }

  function finish() {
    if (!initialized) return;
    api.LMSFinish("");
  }

  window.addEventListener("load", init);
  window.addEventListener("beforeunload", finish);

  window.SCORM = { markComplete: markComplete, finish: finish, isActive: function () { return initialized; } };
})(window);
`;
