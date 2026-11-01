// =============================================================================
// routes/signup.js — BEAT 1: Leo creates his account.
//
// Order of operations (each step is one endpoint the browser calls):
//   1. POST /api/signup/account      save profile + consent (with timestamp)
//   2. POST /api/signup/send-code    rate limit → Lookup line type + SMS pumping risk → Verify SMS
//   3. POST /api/signup/check-code   Verify check → Lookup Identity Match
//   4. POST /api/signup/totp/start   create TOTP factor → QR code
//   5. POST /api/signup/totp/verify  confirm first TOTP code
// =============================================================================

const express = require('express');
const crypto = require('crypto');
const { state } = require('../src/state');
const { entry } = require('../src/panel');
const { toE164 } = require('../src/phone');
const { checkLineType, checkIdentityMatch } = require('../src/lookup');
const verify = require('../src/verify');
const rateLimit = require('../src/rateLimit');
const config = require('../config');

const router = express.Router();

// Exact consent wording, saved alongside the timestamp as evidence.
const CONSENT_TEXT = {
  account: 'I agree to receive account and security messages (such as verification codes) from Twill by SMS.',
  marketing: 'I agree to receive marketing messages and offers from Twill by SMS. Message and data rates may apply. Reply STOP to opt out.',
};

// Small helper: send JSON with panel entries in a consistent shape.
function reply(res, status, body) {
  res.status(status).json({ entries: [], ...body });
}

// ---------------------------------------------------------------------------
// 1. Save the account and consent
// ---------------------------------------------------------------------------
router.post('/account', (req, res) => {
  const {
    name, email, username, password, country, phone, consentAccount, consentMarketing,
    addressLine1, city, region, postalCode,
  } = req.body || {};

  if (!name || !email || !username || !password || !phone || !addressLine1 || !city || !postalCode) {
    return reply(res, 400, { error: 'Please fill in every field.' });
  }
  if (!consentAccount) {
    return reply(res, 400, { error: 'Please agree to account messages so we can send your verification code.' });
  }
  const normalized = toE164(phone, country);
  if (!normalized.ok) return reply(res, 400, { error: normalized.message });

  // Never store a plain password. (A real app would use bcrypt/argon2.)
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = salt + ':' + crypto.scryptSync(password, salt, 32).toString('hex');

  const consent = {
    account: Boolean(consentAccount),
    marketing: Boolean(consentMarketing),
    timestamp: new Date().toISOString(),
    source: 'web sign-up form',
    text: {
      account: CONSENT_TEXT.account,
      marketing: consentMarketing ? CONSENT_TEXT.marketing : null,
    },
  };

  Object.assign(state.account, {
    created: true,
    name,
    email,
    username,
    passwordHash,
    phone: normalized.e164,
    phoneVerified: false,
    // Shipping address. Also used by Identity Match after the phone is verified.
    address: { line1: addressLine1, city, state: region || '', postalCode, country: country || 'US' },
    knownAddresses: [addressLine1],
    trust: null,
    consent,
    // A random ID for Twilio Verify, so no personal data is sent as the identity.
    verifyIdentity: state.account.verifyIdentity || crypto.randomBytes(16).toString('hex'),
  });

  reply(res, 200, {
    phone: normalized.e164,
    entries: [entry({
      title: 'Saved account and consent with a timestamp',
      mode: 'APP',
      api: null,
      request: { name, email, username, phone: normalized.e164, password: '••••••••' },
      response: { consent },
      decision: `Phone normalized to E.164 (${normalized.e164}). Consent recorded — proof of opt-in for account${consent.marketing ? ' and marketing' : ''} messages.`,
      phones: [normalized.e164],
    })],
  });
});

// ---------------------------------------------------------------------------
// 2. Send the SMS code — but only after the rate limit and line type check pass
// ---------------------------------------------------------------------------
router.post('/send-code', async (req, res) => {
  const phone = state.account.phone;
  if (!phone) return reply(res, 400, { error: 'Please create your account first.' });
  const entries = [];

  // 2a. Our own rate limit (before Twilio is called at all).
  const limit = rateLimit.trySend({ phone, clientId: req.ip });
  entries.push(entry({
    title: limit.allowed ? 'Rate limit check passed' : 'Rate limit hit — no code sent',
    mode: 'APP',
    request: { endpoint: 'POST /api/signup/send-code' },
    response: limit.counts,
    decision: limit.allowed
      ? 'Under the limit → continue.'
      : `${limit.reason} → refuse. Bots hammering "send code" is how SMS pumping starts.`,
    note: `Limits (config.js): ${config.rateLimit.maxSendsPerPhone} per number and ${config.rateLimit.maxSendsPerClient} per client every ${config.rateLimit.windowMinutes} min.`,
    phones: [phone],
  }));
  if (!limit.allowed) {
    return reply(res, 429, { error: "You've requested several codes. Please wait a few minutes and try again.", entries });
  }

  // 2b. Lookup Line Type Intelligence (+ SMS Pumping Risk in the same request).
  // Risky line types and high-risk numbers never get an SMS.
  const lookup = await checkLineType(phone, { withPumpingRisk: config.smsPumpingRisk.checkAtSignup });
  entries.push(...lookup.entries);
  if (!lookup.allowed) {
    return reply(res, 422, { blocked: true, lineType: lookup.type, error: lookup.customerMessage, entries });
  }

  // 2c. Verify sends the code.
  const sent = await verify.sendSmsCode(phone);
  entries.push(...sent.entries);
  if (!sent.ok) return reply(res, sent.error.status || 400, { error: sent.error.customer, entries });

  reply(res, 200, { sent: true, mode: sent.mode, simulatedCode: sent.simulatedCode, entries });
});

// ---------------------------------------------------------------------------
// 3. Check the SMS code
// ---------------------------------------------------------------------------
router.post('/check-code', async (req, res) => {
  const phone = state.account.phone;
  const code = String((req.body || {}).code || '').trim();
  if (!phone) return reply(res, 400, { error: 'Please create your account first.' });
  if (!/^\d{4,10}$/.test(code)) return reply(res, 400, { error: 'Please enter the code from your text message.' });

  const result = await verify.checkSmsCode(phone, code);
  if (!result.ok) return reply(res, result.error.status || 400, { error: result.error.customer, entries: result.entries });
  if (!result.approved) return reply(res, 400, { error: "That code didn't match. Please try again.", entries: result.entries });

  state.account.phoneVerified = true;
  state.account.phoneVerifiedAt = new Date().toISOString(); // Reassigned Number checks use this later

  // Now that we know Leo holds this phone, ask: do the carrier's records for
  // this number match the name and address he gave us? This sets a trust
  // level; it never blocks sign-up, and Leo sees nothing.
  const identity = await checkIdentityMatch(phone, state.account);
  state.account.trust = identity.trust;

  reply(res, 200, { approved: true, entries: [...result.entries, ...identity.entries] });
});

// ---------------------------------------------------------------------------
// 4. Start TOTP enrollment (QR code)
// ---------------------------------------------------------------------------
router.post('/totp/start', async (req, res) => {
  if (!state.account.phoneVerified) return reply(res, 400, { error: 'Please verify your phone number first.' });
  const result = await verify.createTotpFactor(state.account.verifyIdentity);
  if (!result.ok) return reply(res, result.error.status || 400, { error: result.error.customer, entries: result.entries });
  reply(res, 200, { qrDataUrl: result.qrDataUrl, mode: result.mode, entries: result.entries });
});

// ---------------------------------------------------------------------------
// 5. Confirm TOTP enrollment with the first code
// ---------------------------------------------------------------------------
router.post('/totp/verify', async (req, res) => {
  const code = String((req.body || {}).code || '').trim();
  if (!/^\d{6}$/.test(code)) return reply(res, 400, { error: 'Please enter the 6-digit code from your authenticator app.' });

  const result = await verify.verifyTotpFactor(state.account.verifyIdentity, code);
  if (!result.ok) return reply(res, result.error.status || 400, { error: result.error.customer, entries: result.entries });
  if (!result.verified) return reply(res, 400, { error: "That code didn't match. Codes change every 30 seconds — try the current one.", entries: result.entries });
  reply(res, 200, { verified: true, entries: result.entries });
});

module.exports = router;
