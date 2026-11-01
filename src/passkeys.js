// =============================================================================
// passkeys.js — Verify Passkeys: a passkey as Leo's second factor.
//
// A passkey is a key pair made by Leo's device (Face ID, fingerprint, Windows
// Hello, or his phone). The private key never leaves the device; Twill keeps
// the public key. To prove it's him, the device signs a one-time challenge.
// Passkeys are phishing-resistant: the browser only uses them on the real
// site, so a look-alike site gets nothing to replay.
//
// SIMULATED, with a REAL passkey: this public demo never calls Twilio. So
// this server does what Verify Passkeys would: it makes the challenge and
// checks the signature itself. The browser's passkey prompt is real; the
// Verify API responses in the panel are simulated, in the documented shape.
//
// Each function returns { ok, ..., entries } and never throws.
// =============================================================================

const crypto = require('crypto');
const { state } = require('./state');
const sim = require('./simulated');
const { entry } = require('./panel');

const MODE = 'SIMULATED';
const WHY = 'Public demo: the passkey prompt and the signature check are real (done by this server); the Verify Passkeys API responses are simulated.';
const API = 'POST https://verify.twilio.com/v2/Services/{VerifyServiceSid}/Passkeys';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (text) => Buffer.from(String(text || ''), 'base64url');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest();

// The "relying party" is the website the passkey belongs to: this one.
function relyingParty(req) {
  return { id: req.hostname, name: 'Twill', origins: [`${req.protocol}://${req.get('host')}`] };
}

// Which second factors Leo has, so a step-up screen can offer the right ones.
function factorsFor(account) {
  return {
    passkey: Boolean(account.passkey && account.passkey.verified),
    totp: Boolean(account.totp && account.totp.verified),
  };
}

// The browser wraps every passkey response in "client data": what it was
// asked to do, the challenge, and which site asked. Check all three.
function checkClientData(clientDataJSON, expectedType, expectedChallenge, req) {
  let data;
  try {
    data = JSON.parse(fromB64url(clientDataJSON).toString('utf8'));
  } catch {
    return 'unreadable client data';
  }
  if (data.type !== expectedType) return `wrong ceremony (${data.type})`;
  if (data.challenge !== expectedChallenge) return 'challenge did not match';
  let origin;
  try {
    origin = new URL(data.origin);
  } catch {
    return 'unreadable origin';
  }
  if (origin.host !== req.get('host')) return `signed for a different site (${origin.host})`;
  return null; // all good
}

// What the panel shows of a credential: the shape, without the long values.
const shortened = (text) => (text ? String(text).slice(0, 12) + '…' : text);
function shownCredential(cred) {
  const r = cred.response || {};
  return {
    id: shortened(cred.id),
    rawId: shortened(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment,
    response: Object.fromEntries(
      Object.entries(r)
        .filter(([key]) => !['publicKey', 'publicKeyAlgorithm'].includes(key))
        .map(([key, value]) => [key, Array.isArray(value) ? value : shortened(value)])
    ),
  };
}

// -----------------------------------------------------------------------------
// Sign-up, step 1: create the passkey factor and the options for the browser
// -----------------------------------------------------------------------------
function startRegistration(req) {
  const a = state.account;
  const rp = relyingParty(req);
  const factorSid = 'YF' + crypto.randomBytes(16).toString('hex');
  const challenge = b64url(crypto.randomBytes(32));

  // These options go to navigator.credentials.create() in the browser.
  const publicKey = {
    rp: { id: rp.id, name: rp.name },
    user: { id: b64url(Buffer.from(a.verifyIdentity, 'hex')), name: a.username || 'leo', displayName: a.name || 'Leo' },
    challenge,
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], // ES256, RS256
    timeout: 300000,
    attestation: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  };
  state.pendingPasskey = { type: 'webauthn.create', challenge, factorSid, rp };

  return {
    ok: true,
    options: publicKey,
    entries: [entry({
      title: 'Created a passkey factor',
      mode: MODE,
      api: `${API}/Factors`,
      request: {
        friendly_name: 'Twill account',
        identity: a.verifyIdentity,
        config: { relying_party: rp, authenticator_attachment: 'any', discoverable_credentials: 'preferred', user_verification: 'preferred' },
      },
      response: sim.passkeyFactorCreate(a.verifyIdentity, factorSid, rp, { publicKey }),
      decision: 'Factor "unverified" → hand the options to the browser, which asks Leo to create a passkey (Face ID, fingerprint, Windows Hello or his phone).',
      note: WHY,
    })],
  };
}

// -----------------------------------------------------------------------------
// Sign-up, step 2: the browser made a passkey. Check it and save the public key.
// -----------------------------------------------------------------------------
function finishRegistration(req, cred) {
  const a = state.account;
  const p = state.pendingPasskey;
  if (!p || p.type !== 'webauthn.create') return { ok: false, error: { customer: 'Please start passkey setup again.' }, entries: [] };
  state.pendingPasskey = null; // a challenge is used once

  const r = (cred && cred.response) || {};
  let problem = checkClientData(r.clientDataJSON, 'webauthn.create', p.challenge, req);
  if (!problem && !r.publicKey) problem = "the browser didn't return a public key";
  if (!problem) {
    try {
      crypto.createPublicKey({ key: fromB64url(r.publicKey), format: 'der', type: 'spki' });
    } catch {
      problem = 'public key unreadable';
    }
  }
  const verified = !problem;
  if (verified) {
    a.passkey = { factorSid: p.factorSid, credentialId: cred.id, publicKey: r.publicKey, alg: r.publicKeyAlgorithm, verified: true };
  }

  return {
    ok: true,
    verified,
    entries: [entry({
      title: verified ? 'Verified the new passkey' : 'Passkey setup failed',
      mode: MODE,
      api: `${API}/VerifyFactor`,
      request: shownCredential(cred || {}),
      response: sim.passkeyFactorVerify(a.verifyIdentity, p.factorSid, p.rp, verified),
      decision: verified
        ? 'Factor "verified" → Leo now approves risky actions with a passkey. Nothing to type, nothing to phish: it only works on Twill\'s real site.'
        : `Factor still "unverified" (${problem}) → ask Leo to try again.`,
      note: 'Checked here: the challenge matches, the browser says this site asked, and the device returned a public key. Twill stores only the public key.',
    })],
  };
}

// -----------------------------------------------------------------------------
// Step-up, step 1: a fresh challenge for Leo's passkey to sign
// -----------------------------------------------------------------------------
function startChallenge(req) {
  const a = state.account;
  if (!factorsFor(a).passkey) return { ok: false, error: { customer: "You haven't set up a passkey yet." }, entries: [] };
  const rp = relyingParty(req);
  const challenge = b64url(crypto.randomBytes(32));

  // These options go to navigator.credentials.get() in the browser.
  const publicKey = {
    challenge,
    rpId: rp.id,
    allowCredentials: [{ type: 'public-key', id: a.passkey.credentialId }],
    userVerification: 'preferred',
    timeout: 300000,
  };
  state.pendingPasskey = { type: 'webauthn.get', challenge, rpId: rp.id };

  return {
    ok: true,
    options: publicKey,
    entries: [entry({
      title: 'Created a passkey challenge',
      mode: MODE,
      api: `${API}/Challenges`,
      request: { identity: a.verifyIdentity, factor_sid: a.passkey.factorSid },
      response: sim.passkeyChallenge(a.verifyIdentity, a.passkey.factorSid, 'pending', { publicKey }),
      decision: 'Challenge "pending" → the browser asks Leo\'s device to sign it.',
      note: WHY,
    })],
  };
}

// -----------------------------------------------------------------------------
// Step-up, step 2: check the signature. Returns { ok, approved, entries }.
// -----------------------------------------------------------------------------
function approveChallenge(req, cred, title, approvedDecision) {
  const a = state.account;
  const p = state.pendingPasskey;
  if (!p || p.type !== 'webauthn.get') return { ok: false, error: { customer: 'Please try your passkey again.' }, entries: [] };
  state.pendingPasskey = null; // a challenge is used once
  if (!factorsFor(a).passkey) return { ok: false, error: { customer: "You haven't set up a passkey yet." }, entries: [] };

  const r = (cred && cred.response) || {};
  let problem = cred && cred.id === a.passkey.credentialId ? null : 'a different passkey';
  if (!problem) problem = checkClientData(r.clientDataJSON, 'webauthn.get', p.challenge, req);

  if (!problem) {
    // authenticatorData starts with a hash of the site's name, then flags.
    const authData = fromB64url(r.authenticatorData);
    if (authData.length < 37 || !authData.subarray(0, 32).equals(sha256(p.rpId))) problem = 'signed for a different site';
    else if (!(authData[32] & 0x01)) problem = 'no user presence';
    else {
      // The device signed (authenticatorData + hash of clientDataJSON) with
      // its private key. Check it with the public key saved at sign-up.
      const signed = Buffer.concat([authData, sha256(fromB64url(r.clientDataJSON))]);
      const key = crypto.createPublicKey({ key: fromB64url(a.passkey.publicKey), format: 'der', type: 'spki' });
      const hash = a.passkey.alg === -8 ? null : 'sha256'; // -8 is Ed25519
      let valid = false;
      try {
        valid = crypto.verify(hash, signed, key, fromB64url(r.signature));
      } catch {
        valid = false;
      }
      if (!valid) problem = 'signature did not match';
    }
  }
  const approved = !problem;

  return {
    ok: true,
    approved,
    entries: [entry({
      title,
      mode: MODE,
      api: `${API}/ApproveChallenge`,
      request: shownCredential(cred || {}),
      response: sim.passkeyChallenge(a.verifyIdentity, a.passkey.factorSid, approved ? 'approved' : 'denied'),
      decision: approved ? `Challenge "approved" → ${approvedDecision}` : `Challenge "denied" (${problem}) → ask again.`,
      note: 'Checked here: right passkey, right challenge, right site, and a valid signature from the public key saved at sign-up.',
    })],
  };
}

module.exports = { factorsFor, startRegistration, finishRegistration, startChallenge, approveChallenge };
