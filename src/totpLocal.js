// =============================================================================
// totpLocal.js — a tiny TOTP (authenticator app code) calculator.
//
// Only used in SIMULATED mode, so that a real authenticator app (Google
// Authenticator, Authy, 1Password…) still works when Twilio is offline.
// In LIVE mode Twilio Verify generates the secret and checks the codes.
//
// TOTP in one sentence: the app and the server share a secret; every 30 seconds
// both turn (secret + current time) into a 6-digit code, and the codes match.
// (Standard: RFC 6238.)
// =============================================================================

const crypto = require('crypto');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// A new random secret, written in Base32 (the format authenticator apps expect).
function newSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32ToBytes(secret) {
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) {
    bits += BASE32.indexOf(ch).toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

// The 6-digit code for a given 30-second time step.
function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32ToBytes(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const number = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(number).padStart(6, '0');
}

function currentCode(secret) {
  return codeAt(secret, Math.floor(Date.now() / 1000 / 30));
}

// Accept the current code, or the one just before/after (clock drift), like
// Verify's default "skew" of 1.
function checkCode(secret, code) {
  const step = Math.floor(Date.now() / 1000 / 30);
  return [step - 1, step, step + 1].some((s) => codeAt(secret, s) === String(code).trim());
}

module.exports = { newSecret, currentCode, checkCode };
