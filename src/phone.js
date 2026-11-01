// =============================================================================
// phone.js — turn whatever the customer typed into E.164 format.
//
// E.164 is the international standard Twilio expects: "+", country code,
// number, no spaces. e.g. (415) 555-0123 in the US  ->  +14155550123
// =============================================================================

const { parsePhoneNumberFromString } = require('libphonenumber-js');

// Returns { ok: true, e164 } or { ok: false, message }.
function toE164(input, countryCode) {
  const parsed = parsePhoneNumberFromString(String(input || ''), countryCode || 'US');
  if (!parsed || !parsed.isPossible()) {
    return { ok: false, message: "That phone number doesn't look right. Please check it and try again." };
  }
  return { ok: true, e164: parsed.number };
}

module.exports = { toE164 };
