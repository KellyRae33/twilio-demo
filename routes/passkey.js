// =============================================================================
// routes/passkey.js — passkeys, Leo's other choice of second factor.
//
//   POST /api/passkey/register/start   sign-up: options for the browser to
//                                      create a passkey
//   POST /api/passkey/register/finish  sign-up: check and save the new passkey
//   POST /api/passkey/challenge        step-up (Beats 2–4): a fresh challenge
//                                      for the passkey to sign. The signed
//                                      answer goes to that beat's step-up
//                                      endpoint, which checks it.
//
// See src/passkeys.js for how the checks work.
// =============================================================================

const express = require('express');
const { state } = require('../src/state');
const passkeys = require('../src/passkeys');

const router = express.Router();

function reply(res, status, body) {
  res.status(status).json({ entries: [], ...body });
}

router.post('/register/start', (req, res) => {
  if (!state.account.phoneVerified) return reply(res, 400, { error: 'Please verify your phone number first.' });
  const result = passkeys.startRegistration(req);
  reply(res, 200, { options: result.options, entries: result.entries });
});

router.post('/register/finish', (req, res) => {
  const result = passkeys.finishRegistration(req, (req.body || {}).credential);
  if (!result.ok) return reply(res, 400, { error: result.error.customer, entries: result.entries });
  if (!result.verified) return reply(res, 400, { error: "We couldn't save that passkey. Please try again.", entries: result.entries });
  reply(res, 200, { verified: true, entries: result.entries });
});

router.post('/challenge', (req, res) => {
  const result = passkeys.startChallenge(req);
  if (!result.ok) return reply(res, 400, { error: result.error.customer, entries: result.entries });
  reply(res, 200, { options: result.options, entries: result.entries });
});

module.exports = router;
