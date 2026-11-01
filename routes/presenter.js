// =============================================================================
// routes/presenter.js — behind-the-curtain controls for the presenter.
//
//   GET  /api/status          what's configured (never the secret values)
//   POST /api/settings        flip LIVE/SIMULATED, Offline mode, scenarios
//   POST /api/reset           start the story over
//   GET  /api/presenter/totp  current code of a SIMULATED authenticator
// =============================================================================

const express = require('express');
const config = require('../config');
const { state, reset } = require('../src/state');
const tw = require('../src/twilio');
const rateLimit = require('../src/rateLimit');
const verify = require('../src/verify');

const router = express.Router();

// Everything the browser needs to draw the presenter panel. Note: this says
// WHETHER credentials exist, never what they are.
function status() {
  return {
    hasCredentials: tw.hasCredentials,
    hasVerifyService: tw.hasVerifyService,
    settings: state.settings,
    // Resolved mode for each check right now (after Offline mode etc.)
    modes: Object.fromEntries(
      Object.keys(state.settings.live).map((check) => [check, tw.modeFor(check)])
    ),
    account: {
      created: state.account.created,
      phoneVerified: state.account.phoneVerified,
      trust: state.account.trust,
      totpVerified: Boolean(state.account.totp && state.account.totp.verified),
    },
    leo: config.leo,
  };
}

router.get('/status', (req, res) => res.json(status()));

router.post('/settings', (req, res) => {
  const { offline, live, scenarios } = req.body || {};
  if (typeof offline === 'boolean') state.settings.offline = offline;
  if (live) {
    for (const [check, value] of Object.entries(live)) {
      if (check in state.settings.live) state.settings.live[check] = Boolean(value);
    }
  }
  if (scenarios) {
    for (const [name, value] of Object.entries(scenarios)) {
      if (name in state.settings.scenarios) state.settings.scenarios[name] = value;
    }
  }
  res.json(status());
});

router.post('/reset', (req, res) => {
  reset({ resetSettings: Boolean((req.body || {}).resetSettings) });
  rateLimit.resetLimits();
  res.json(status());
});

router.get('/presenter/totp', (req, res) => {
  res.json({ code: verify.simulatedTotpCode() });
});

module.exports = router;
