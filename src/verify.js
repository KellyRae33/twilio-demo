// =============================================================================
// verify.js — Twilio Verify: SMS codes and TOTP (authenticator app) factors.
// Passkeys live in passkeys.js; confirmSecondFactor() below uses either.
//
// Each function returns { ok, ...details, entries: [panel entries] } and never
// throws, so the routes stay short.
// =============================================================================

const crypto = require('crypto');
const QRCode = require('qrcode');
const { state } = require('./state');
const tw = require('./twilio');
const sim = require('./simulated');
const totpLocal = require('./totpLocal');
const { entry, toApiShape, hideSecret } = require('./panel');
const { friendlyError } = require('./errors');
const passkeys = require('./passkeys');

const SERVICE = '{VerifyServiceSid}';
const FRIENDLY_NAME = 'Twill account'; // shown in the authenticator app; no personal data

// Panel entry for a Twilio error (when Twilio answered, but with an error).
function errorEntry(title, mode, api, request, err, phones) {
  const fe = friendlyError(err);
  return {
    fe,
    entry: entry({
      title,
      mode,
      api,
      request,
      response: { code: err.code, message: err.message, status: err.status, more_info: err.moreInfo },
      decision: 'Stopped.',
      note: fe.presenter,
      phones,
    }),
  };
}

// Error codes Twilio uses when a trial account texts an unverified number.
const TRIAL_UNVERIFIED_NUMBER = [21608, 14111];

// -----------------------------------------------------------------------------
// SMS: send a code
// Options:
//   title                   panel title (defaults to "Sent a one-time code by SMS")
//   simulateIfTrialBlocked  if a trial account isn't allowed to text this
//                           number, simulate the code instead of failing
//                           (used for Leo's NEW number in Beat 3)
// -----------------------------------------------------------------------------
async function sendSmsCode(phone, { title = 'Sent a one-time code by SMS', simulateIfTrialBlocked = false } = {}) {
  let { mode, why } = tw.modeFor('verifySms');
  const api = `POST https://verify.twilio.com/v2/Services/${SERVICE}/Verifications`;
  const request = { To: phone, Channel: 'sms' };
  let response;
  let note = why;

  if (mode === 'LIVE') {
    try {
      const v = await tw.verifyService().verifications.create({ to: phone, channel: 'sms' });
      response = toApiShape(v);
    } catch (err) {
      if (simulateIfTrialBlocked && TRIAL_UNVERIFIED_NUMBER.includes(err.code)) {
        mode = 'SIMULATED';
        note = `Twilio trial accounts can only text verified numbers (error ${err.code}), so this code is simulated. On an upgraded account it would be a real SMS.`;
      } else if (!tw.isNetworkError(err)) {
        const { fe, entry: e } = errorEntry("Couldn't send the SMS code", 'LIVE', api, request, err, [phone]);
        return { ok: false, error: fe, entries: [e] };
      } else {
        mode = 'SIMULATED';
        note = `Couldn't reach Twilio (${err.code || err.message}); fell back to simulated`;
      }
    }
  }

  let simulatedCode = null;
  if (mode === 'SIMULATED') {
    simulatedCode = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    state.simulatedCodes[phone] = simulatedCode;
    response = sim.verificationCreate(phone);
  }

  return {
    ok: true,
    mode,
    simulatedCode, // only set in SIMULATED mode, so the storefront can show a fake text message
    entries: [entry({
      title,
      mode,
      api,
      request,
      response,
      decision: mode === 'LIVE'
        ? 'Verify generated the code and texted it. Our app never sees or stores the code.'
        : `Simulated SMS. The code is ${simulatedCode} (shown on Leo's phone notification).`,
      note,
      phones: [phone],
    })],
  };
}

// -----------------------------------------------------------------------------
// SMS: check the code Leo typed in
// -----------------------------------------------------------------------------
async function checkSmsCode(phone, code, title = 'Checked the SMS code') {
  let { mode, why } = tw.modeFor('verifySms');
  const api = `POST https://verify.twilio.com/v2/Services/${SERVICE}/VerificationCheck`;
  const request = { To: phone, Code: '••••••' }; // don't put the code on screen
  let response;
  let note = why;

  // If we sent a simulated code to this number, check it the simulated way,
  // even if LIVE was switched on in between.
  if (state.simulatedCodes[phone]) mode = 'SIMULATED';

  if (mode === 'LIVE') {
    try {
      const check = await tw.verifyService().verificationChecks.create({ to: phone, code });
      response = toApiShape(check);
    } catch (err) {
      const { fe, entry: e } = errorEntry('Code check failed', 'LIVE', api, request, err, [phone]);
      return { ok: false, approved: false, error: fe, entries: [e] };
    }
  } else {
    const approved = state.simulatedCodes[phone] === String(code).trim();
    if (approved) delete state.simulatedCodes[phone];
    response = sim.verificationCheck(phone, approved);
  }

  const approved = response.status === 'approved';
  return {
    ok: true,
    approved,
    entries: [entry({
      title,
      mode,
      api,
      request,
      response,
      decision: approved ? 'Status "approved" → phone number verified.' : 'Status not approved → wrong code, ask again.',
      note,
      phones: [phone],
    })],
  };
}

// -----------------------------------------------------------------------------
// TOTP: enroll a new authenticator app (create factor + QR code)
// -----------------------------------------------------------------------------
async function createTotpFactor(identity) {
  let { mode, why } = tw.modeFor('verifyTotp');
  const api = `POST https://verify.twilio.com/v2/Services/${SERVICE}/Entities/${identity}/Factors`;
  const request = { FactorType: 'totp', FriendlyName: FRIENDLY_NAME };
  let response;
  let note = why;
  let secret = null;

  if (mode === 'LIVE') {
    try {
      const f = await tw.verifyService().entities(identity).newFactors.create({
        factorType: 'totp',
        friendlyName: FRIENDLY_NAME,
      });
      response = toApiShape(f);
    } catch (err) {
      if (!tw.isNetworkError(err)) {
        const { fe, entry: e } = errorEntry("Couldn't set up the authenticator", 'LIVE', api, request, err, []);
        return { ok: false, error: fe, entries: [e] };
      }
      mode = 'SIMULATED';
      note = `Couldn't reach Twilio (${err.code || err.message}); fell back to simulated`;
    }
  }

  if (mode === 'SIMULATED') {
    // Make our own secret so a real authenticator app still works offline.
    secret = totpLocal.newSecret();
    const uri = `otpauth://totp/Twill:${encodeURIComponent(FRIENDLY_NAME)}?secret=${secret}&issuer=Twill&algorithm=SHA1&digits=6&period=30`;
    response = sim.factorCreate(identity, secret, uri, FRIENDLY_NAME);
  }

  // Twilio returns the binding URI only once, at creation. We turn it into a QR
  // image for Leo's screen. The secret itself is hidden in the panel.
  const bindingUri = response.binding.uri;
  const qrDataUrl = await QRCode.toDataURL(bindingUri, { margin: 1, width: 220 });

  state.account.totp = { factorSid: response.sid, mode, secret, verified: false };

  const shown = {
    ...response,
    binding: {
      secret: hideSecret(response.binding.secret),
      uri: bindingUri.replace(/secret=[^&]+/, 'secret=' + hideSecret(response.binding.secret)),
    },
  };

  return {
    ok: true,
    mode,
    qrDataUrl,
    entries: [entry({
      title: 'Created a TOTP factor (authenticator app)',
      mode,
      api,
      request,
      response: shown,
      decision: 'Factor status "unverified" → show the QR code; Leo must enter one code to finish setup.',
      note: note || 'Identity is a random ID, not Leo\'s email or phone (Twilio recommends no personal data).',
    })],
  };
}

// -----------------------------------------------------------------------------
// TOTP: confirm enrollment with the first code from the app
// -----------------------------------------------------------------------------
async function verifyTotpFactor(identity, code) {
  const totp = state.account.totp;
  if (!totp) return { ok: false, error: { customer: 'Please start authenticator setup first.' }, entries: [] };

  const mode = totp.mode; // check the same way the factor was created
  const api = `POST https://verify.twilio.com/v2/Services/${SERVICE}/Entities/${identity}/Factors/${totp.factorSid}`;
  const request = { AuthPayload: '••••••' };
  let response;

  if (mode === 'LIVE') {
    try {
      const f = await tw.verifyService().entities(identity).factors(totp.factorSid).update({ authPayload: code });
      response = toApiShape(f);
    } catch (err) {
      const { fe, entry: e } = errorEntry('Authenticator code check failed', 'LIVE', api, request, err, []);
      return { ok: false, error: fe, entries: [e] };
    }
  } else {
    response = sim.factorVerify(identity, totp.factorSid, totpLocal.checkCode(totp.secret, code), FRIENDLY_NAME);
  }

  const verified = response.status === 'verified';
  if (verified) totp.verified = true;

  return {
    ok: true,
    verified,
    entries: [entry({
      title: 'Verified the first authenticator code',
      mode,
      api,
      request,
      response,
      decision: verified
        ? 'Factor status "verified" → Leo now has a second factor that doesn\'t depend on SMS.'
        : 'Factor still "unverified" → wrong code, ask again.',
    })],
  };
}

// -----------------------------------------------------------------------------
// TOTP: step-up challenge. "Prove it's you" with the authenticator app code.
// Used for risky moments (Beats 2–4). Returns { ok, approved, entries }.
// -----------------------------------------------------------------------------
async function challengeTotp(identity, code, title, approvedDecision) {
  const totp = state.account.totp;
  if (!totp || !totp.verified) {
    return { ok: false, error: { customer: 'Please set up your authenticator app first.' }, entries: [] };
  }

  const mode = totp.mode; // challenge the same way the factor was created
  const api = `POST https://verify.twilio.com/v2/Services/${SERVICE}/Entities/${identity}/Challenges`;
  const request = { FactorSid: totp.factorSid, AuthPayload: '••••••' };
  let response;

  if (mode === 'LIVE') {
    try {
      const c = await tw.verifyService().entities(identity).challenges.create({
        factorSid: totp.factorSid,
        authPayload: code,
      });
      response = toApiShape(c);
    } catch (err) {
      const { fe, entry: e } = errorEntry('Authenticator check failed', 'LIVE', api, request, err, []);
      return { ok: false, error: fe, entries: [e] };
    }
  } else {
    response = sim.challengeCreate(identity, totp.factorSid, totpLocal.checkCode(totp.secret, code));
  }

  const approved = response.status === 'approved';
  return {
    ok: true,
    approved,
    entries: [entry({
      title,
      mode,
      api,
      request,
      response,
      decision: approved
        ? `Challenge "approved" → ${approvedDecision}`
        : `Challenge "${response.status}" → wrong code, ask again.`,
    })],
  };
}

// -----------------------------------------------------------------------------
// Step-up with whichever second factor Leo used. The browser sends either
// { passkey: <signed challenge> } or { code: '123456' } from the authenticator.
// label goes in the panel title, e.g. "step-up". Returns { ok, approved, entries }.
// -----------------------------------------------------------------------------
async function confirmSecondFactor(req, body, label, approvedDecision) {
  if (body && body.passkey) {
    return passkeys.approveChallenge(req, body.passkey, `Verified Leo's passkey (${label})`, approvedDecision);
  }
  const code = String((body && body.code) || '').trim();
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: { status: 400, customer: 'Enter the 6-digit code from your authenticator app.' }, entries: [] };
  }
  return challengeTotp(state.account.verifyIdentity, code, `Verified the authenticator code (${label})`, approvedDecision);
}

// For the presenter: the current code of a SIMULATED factor (handy if no phone).
function simulatedTotpCode() {
  const totp = state.account.totp;
  return totp && totp.mode === 'SIMULATED' && totp.secret ? totpLocal.currentCode(totp.secret) : null;
}

module.exports = { sendSmsCode, checkSmsCode, createTotpFactor, verifyTotpFactor, challengeTotp, confirmSecondFactor, simulatedTotpCode };
