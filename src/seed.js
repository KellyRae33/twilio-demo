// =============================================================================
// seed.js — lets the presenter jump straight to any beat.
//
// Beats 2–5 happen "months later" and need Leo's account to exist. If Beat 1
// wasn't completed in this session, we fill in whatever is missing with Leo's
// demo details. Anything filled in here is SIMULATED; nothing calls Twilio.
// If Beat 1 was done live (real authenticator app), that real setup is kept.
// =============================================================================

const crypto = require('crypto');
const config = require('../config');
const { state } = require('./state');
const totpLocal = require('./totpLocal');
const { entry } = require('./panel');

function ensureLeoAccount() {
  const a = state.account;
  const filled = [];

  if (!a.created || !a.phoneVerified) {
    const leo = config.leo;
    Object.assign(a, {
      created: true,
      name: a.name || leo.name,
      email: a.email || leo.email,
      username: a.username || leo.username,
      phone: a.phone || config.leo.phone,
      phoneVerified: true,
      phoneVerifiedAt: a.phoneVerifiedAt || new Date(Date.now() - config.checkout.seededPhoneVerifiedDaysAgo * 86400000).toISOString(),
      address: a.address || { line1: leo.addressLine1, city: leo.city, state: leo.state, postalCode: leo.postalCode, country: leo.country },
      consent: a.consent || { account: true, marketing: true, timestamp: new Date().toISOString(), source: 'demo seed' },
      verifyIdentity: a.verifyIdentity || crypto.randomBytes(16).toString('hex'),
    });
    if (!a.knownAddresses.length) a.knownAddresses = [a.address.line1];
    filled.push('verified account and phone');
  }
  if (!a.trust) {
    a.trust = { level: 'high', score: 100 };
    filled.push('Identity Match trust "high"');
  }
  // A second factor, unless Leo already set one up (authenticator or passkey).
  if ((!a.totp || !a.totp.verified) && !(a.passkey && a.passkey.verified)) {
    // An authenticator factor created on our side, with no QR scan. The
    // presenter drawer shows its current 6-digit code.
    a.totp = { factorSid: 'YF' + crypto.randomBytes(16).toString('hex'), mode: 'SIMULATED', secret: totpLocal.newSecret(), verified: true };
    filled.push('authenticator app (simulated; current code is in Demo controls)');
  }

  if (!filled.length) return [];
  return [entry({
    title: "Loaded Leo's existing account (demo shortcut)",
    mode: 'SIMULATED',
    request: null,
    response: null,
    decision: `Beat 1 wasn't completed in this session, so these were filled in: ${filled.join('; ')}.`,
  })];
}

module.exports = { ensureLeoAccount };
