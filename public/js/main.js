// =============================================================================
// main.js — starts the demo once every script has loaded.
// =============================================================================

(async function () {
  await Twill.presenter.refresh(); // load settings (and show the Offline pill if on)
  Twill.journey.go('signup');      // begin at Beat 1
})();
