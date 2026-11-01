// =============================================================================
// routes/contact.js — BEAT 3: Leo changes his email and phone.
//
// Changing contact details is the #1 move in an account takeover: once the
// attacker's phone is on the account, every future code goes to them. So:
//
//   POST /api/contact/start            load Leo's current details
//   POST /api/contact/request          new details in → silent SIM Swap check on
//                                      the CURRENT number → which existing
//                                      factors may be used to prove it's Leo
//   POST /api/contact/send-old-code    SMS to the OLD number (if allowed)
//   POST /api/contact/verify-identity  check the TOTP or old-number SMS code
//   POST /api/contact/send-new-code    Lookup line type → SMS to the NEW number
//   POST /api/contact/confirm-new      check that code → save → notify old
//                                      email and phone
//
// Rule: proof always comes from a factor Leo ALREADY had. Never the new number.
// =============================================================================

const express = require('express');
const config = require('../config');
const { state } = require('../src/state');
const { entry, maskPhone } = require('../src/panel');
const { toE164 } = require('../src/phone');
const { checkLineType, checkSimSwap } = require('../src/lookup');
const verify = require('../src/verify');
const rateLimit = require('../src/rateLimit');
const { ensureLeoAccount } = require('../src/seed');

const router = express.Router();

function reply(res, status, body) {
  res.status(status).json({ entries: [], ...body });
}

// Our own rate limit before any SMS (same rule as sign-up).
function rateLimitEntry(phone, req) {
  const limit = rateLimit.trySend({ phone, clientId: req.ip });
  return {
    allowed: limit.allowed,
    entry: entry({
      title: limit.allowed ? 'Rate limit check passed' : 'Rate limit hit — no code sent',
      mode: 'APP',
      response: limit.counts,
      decision: limit.allowed ? 'Under the limit → continue.' : `${limit.reason} → refuse.`,
      phones: [phone],
    }),
  };
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
router.post('/start', (req, res) => {
  const entries = ensureLeoAccount();
  state.pendingChange = null;
  const a = state.account;
  reply(res, 200, {
    name: a.name,
    email: a.email,
    phoneMasked: maskPhone(a.phone),
    suggested: {
      email: config.contactChange.newEmail,
      phone: config.contactChange.fallbackNewPhone,
    },
    entries,
  });
});

// ---------------------------------------------------------------------------
// Request the change: decide how Leo must prove it's him
// ---------------------------------------------------------------------------
router.post('/request', async (req, res) => {
  ensureLeoAccount();
  const a = state.account;
  const { newEmail, newPhone, country } = req.body || {};

  if (!newEmail || !/^\S+@\S+\.\S+$/.test(newEmail)) return reply(res, 400, { error: 'Please enter a valid email address.' });
  const normalized = toE164(newPhone, country);
  if (!normalized.ok) return reply(res, 400, { error: normalized.message });
  if (normalized.e164 === a.phone) return reply(res, 400, { error: "That's already the number on your account." });

  const entries = [entry({
    title: 'Contact change requested',
    mode: 'APP',
    request: { new_email: newEmail, new_phone: normalized.e164 },
    response: { current_email: a.email, current_phone: a.phone },
    decision: 'High-risk change → nothing is saved until Leo proves it\'s him with a factor he ALREADY has. The new number can\'t be used as proof.',
    note: 'An attacker who has Leo\'s password would add their own phone here. If we accepted a code sent to the new number, we would be verifying the attacker.',
    phones: [normalized.e164, a.phone],
  })];

  // Silent SIM Swap check on the number Leo has now.
  const simSwap = await checkSimSwap(a.phone);
  entries.push(...simSwap.entries);

  // Which existing factors may prove it's Leo?
  const methods = [];
  if (a.totp && a.totp.verified) methods.push('totp');
  if (!simSwap.swappedRecently) methods.push('sms_old');

  entries.push(entry({
    title: 'Chose how Leo can prove it\'s him',
    mode: 'APP',
    response: { allowed_methods: methods },
    decision: simSwap.swappedRecently
      ? 'Recent SIM swap → authenticator app ONLY. A text to the current number could be going to the attacker.'
      : 'SIM looks stable → offer the authenticator app, or a code by SMS to the CURRENT number. Never the new one.',
    phones: [a.phone],
  }));

  if (!methods.length) {
    return reply(res, 403, { error: "We can't verify this change online. Please contact Twill support.", entries });
  }

  state.pendingChange = {
    newEmail,
    newPhone: normalized.e164,
    methods,
    identityVerified: false,
    newPhoneChecked: false,
  };
  reply(res, 200, { methods, phoneMasked: maskPhone(a.phone), entries });
});

// ---------------------------------------------------------------------------
// Prove it's Leo: SMS to the OLD number
// ---------------------------------------------------------------------------
router.post('/send-old-code', async (req, res) => {
  const p = state.pendingChange;
  if (!p || !p.methods.includes('sms_old')) return reply(res, 400, { error: 'Please use your authenticator app.' });
  const phone = state.account.phone;

  const limit = rateLimitEntry(phone, req);
  if (!limit.allowed) return reply(res, 429, { error: 'Too many codes requested. Please wait a few minutes.', entries: [limit.entry] });

  const sent = await verify.sendSmsCode(phone, { title: 'Sent a code to Leo\'s CURRENT number' });
  const entries = [limit.entry, ...sent.entries];
  if (!sent.ok) return reply(res, sent.error.status || 400, { error: sent.error.customer, entries });
  reply(res, 200, { simulatedCode: sent.simulatedCode, entries });
});

// ---------------------------------------------------------------------------
// Check the TOTP code or old-number SMS code
// ---------------------------------------------------------------------------
router.post('/verify-identity', async (req, res) => {
  const p = state.pendingChange;
  if (!p) return reply(res, 400, { error: 'Please start the change again.' });
  const { method } = req.body || {};
  const code = String((req.body || {}).code || '').trim();
  if (!p.methods.includes(method)) return reply(res, 400, { error: 'That verification method isn\'t available.' });
  if (!/^\d{4,10}$/.test(code)) return reply(res, 400, { error: 'Please enter the code.' });

  let result;
  if (method === 'totp') {
    result = await verify.challengeTotp(state.account.verifyIdentity, code,
      'Verified the authenticator code (existing factor)', 'it really is Leo. Allow the contact change to continue.');
  } else {
    result = await verify.checkSmsCode(state.account.phone, code, 'Checked the code sent to the CURRENT number');
  }
  if (!result.ok) return reply(res, result.error.status || 400, { error: result.error.customer, entries: result.entries });
  if (!result.approved) return reply(res, 400, { error: "That code didn't match. Please try again.", entries: result.entries });

  p.identityVerified = true;
  reply(res, 200, { verified: true, newPhoneMasked: maskPhone(p.newPhone), entries: result.entries });
});

// ---------------------------------------------------------------------------
// New number: Lookup line type, then send it a code
// ---------------------------------------------------------------------------
router.post('/send-new-code', async (req, res) => {
  const p = state.pendingChange;
  if (!p || !p.identityVerified) return reply(res, 403, { error: 'Please confirm it\'s you first.' });

  const limit = rateLimitEntry(p.newPhone, req);
  if (!limit.allowed) return reply(res, 429, { error: 'Too many codes requested. Please wait a few minutes.', entries: [limit.entry] });
  const entries = [limit.entry];

  // Same gate as sign-up: risky line types never get a code.
  const lookup = await checkLineType(p.newPhone);
  entries.push(...lookup.entries);
  if (!lookup.allowed) return reply(res, 422, { blocked: true, error: lookup.customerMessage, entries });

  // This proves Leo can receive texts on the new number (it doesn't prove
  // it's Leo; that was the step before).
  const sent = await verify.sendSmsCode(p.newPhone, { title: 'Sent a code to the NEW number', simulateIfTrialBlocked: true });
  entries.push(...sent.entries);
  if (!sent.ok) return reply(res, sent.error.status || 400, { error: sent.error.customer, entries });
  reply(res, 200, { simulatedCode: sent.simulatedCode, entries });
});

// ---------------------------------------------------------------------------
// Confirm the new number, save, and tell the OLD contacts
// ---------------------------------------------------------------------------
router.post('/confirm-new', async (req, res) => {
  const p = state.pendingChange;
  if (!p || !p.identityVerified) return reply(res, 403, { error: 'Please confirm it\'s you first.' });
  const code = String((req.body || {}).code || '').trim();
  if (!/^\d{4,10}$/.test(code)) return reply(res, 400, { error: 'Please enter the code.' });

  const result = await verify.checkSmsCode(p.newPhone, code, 'Checked the code sent to the NEW number');
  if (!result.ok) return reply(res, result.error.status || 400, { error: result.error.customer, entries: result.entries });
  if (!result.approved) return reply(res, 400, { error: "That code didn't match. Please try again.", entries: result.entries });

  // Save, keeping a record of the old details.
  const a = state.account;
  const old = { email: a.email, phone: a.phone };
  a.contactHistory.push({ ...old, changedAt: new Date().toISOString() });
  a.email = p.newEmail;
  a.phone = p.newPhone;
  a.phoneVerified = true;
  state.pendingChange = null;

  const message = 'Your Twill contact details were just changed. If this wasn\'t you, reply HELP or call us right away.';
  const notifications = [
    { channel: 'SMS', to: maskPhone(old.phone), text: message },
    { channel: 'Email', to: old.email, text: `Subject: Your contact details were changed. ${message}` },
  ];

  const entries = [...result.entries, entry({
    title: 'Saved new details and alerted the OLD email and phone',
    mode: 'SIMULATED',
    api: 'POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages  ·  SendGrid Mail Send',
    request: { notifications },
    response: { saved: { email: p.newEmail, phone: p.newPhone }, previous: old },
    decision: 'If this wasn\'t Leo, the real Leo hears about it on the channels he still controls, and can lock the account fast.',
    note: 'Simulated in the demo. In production: an SMS via Programmable Messaging and an email via SendGrid. Next step on the roadmap: verify the new email too (Verify Email channel).',
    phones: [old.phone, p.newPhone],
  })];

  reply(res, 200, { saved: true, email: p.newEmail, phoneMasked: maskPhone(p.newPhone), notifications, entries });
});

module.exports = router;
