// =============================================================================
// panel.js — builds the entries shown in the "Behind the scenes" panel.
//
// Every server step returns one or more entries like:
//   {
//     title:    "Checked line type before sending a code",   (plain English)
//     mode:     "LIVE" | "SIMULATED",
//     api:      "GET https://lookups.twilio.com/v2/PhoneNumbers/{n}?Fields=…",
//     request:  { ...trimmed request... },
//     response: { ...JSON response... },
//     decision: "Mobile number → OK to send a code",
//     note:     optional extra explanation
//   }
// =============================================================================

const { parsePhoneNumberFromString } = require('libphonenumber-js');
const config = require('../config');

// "+14155550123" -> "+1415•••0123". Keeps the country/area code and last 4 digits.
function maskPhone(phone) {
  if (!phone || phone.length < 8) return phone;
  return phone.slice(0, 5) + '•••' + phone.slice(-4);
}

// Replace every appearance of the given phone numbers inside any value
// (including deep inside JSON), so real numbers don't appear on the projector.
function maskDeep(value, phones) {
  if (!value) return value;
  // The Account SID isn't a password, but it is half of the login, so don't
  // put it on the projector: "AC1234…" -> "AC…cdef".
  let text = JSON.stringify(value).replace(/AC[0-9a-f]{28}([0-9a-f]{4})/g, 'AC…$1');
  if (!config.maskPhoneNumbersInPanel) return JSON.parse(text);
  for (const phone of phones.filter(Boolean)) {
    const digits = phone.replace(/\D/g, '');
    text = text.split(phone).join(maskPhone(phone));                // +14155550123
    text = text.split(encodeURIComponent(phone)).join(maskPhone(phone)); // %2B14155550123
    text = text.split(digits).join(maskPhone(phone).slice(1));      // 14155550123
    const parsed = parsePhoneNumberFromString(phone);
    if (parsed) {
      const national = parsed.formatNational();                     // (415) 555-0123
      text = text.split(national).join('•••' + national.slice(-4));
    }
  }
  return JSON.parse(text);
}

// Hide secrets (e.g. the TOTP seed) — show only the first 4 characters.
function hideSecret(secret) {
  return secret ? `${secret.slice(0, 4)}…[hidden]` : secret;
}

// Twilio's helper library returns objects with camelCase keys plus internal
// fields. The raw API JSON uses snake_case. Convert so the panel shows exactly
// what the REST API returns, matching Twilio's docs.
function toApiShape(resource) {
  if (resource === null || typeof resource !== 'object') return resource;
  const raw = typeof resource.toJSON === 'function' ? resource.toJSON() : resource;
  if (Array.isArray(raw)) return raw.map(toApiShape);
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    if (key.startsWith('_')) continue; // internal helper-library fields
    const snake = key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
    // Nested objects (e.g. identity_match) can come back camelCase too
    // (summaryScore, errorCode), so convert all the way down.
    out[snake] = toApiShape(val);
  }
  return out;
}

// Build one panel entry, masking any phone numbers we were told about.
function entry({ title, mode, api, request, response, decision, note, phones = [] }) {
  return {
    title,
    mode,
    api: api ? maskDeep(api, phones) : null,
    request: maskDeep(request, phones),
    response: maskDeep(response, phones),
    decision: decision ? maskDeep(decision, phones) : null,
    note: note || null,
    time: new Date().toISOString(),
  };
}

module.exports = { entry, maskPhone, hideSecret, toApiShape };
