// =============================================================================
// errors.js — turns Twilio error codes into friendly messages.
//
// `customer` is what Leo sees on the storefront.
// `presenter` is the plain-English explanation shown in the panel.
// Codes from https://www.twilio.com/docs/api/errors
// =============================================================================

const KNOWN = {
  10002: {
    customer: "We couldn't complete that check right now.",
    presenter: 'Trial account (10002): this feature is only available on upgraded accounts. Upgrade, or use the presenter scenario switch to simulate the result.',
  },
  20003: {
    customer: "We couldn't send your code right now. Please try again shortly.",
    presenter: 'Twilio rejected the credentials (20003). Check TWILIO_ACCOUNT_SID and the auth token / API key in .env.',
  },
  20404: {
    customer: 'That code has expired. Please request a new one.',
    presenter: 'Verification not found (20404): it expired (10 min), was already approved, or hit max attempts.',
  },
  21211: {
    customer: "That phone number doesn't look right. Please check it and try again.",
    presenter: 'Invalid "To" phone number (21211).',
  },
  21608: {
    customer: "We couldn't send a code to that number.",
    presenter: 'Trial account (21608): Twilio trial accounts can only text verified recipients. Your Twilio sign-up number is verified automatically; other numbers need adding as verified recipients, or an upgraded account.',
  },
  60200: {
    customer: "That phone number doesn't look right. Please check it and try again.",
    presenter: 'Verify rejected a parameter (60200) — usually a malformed phone number.',
  },
  60202: {
    customer: 'Too many incorrect codes. Please request a new code.',
    presenter: 'Max check attempts reached (60202). Verify locks a verification after 5 wrong codes.',
  },
  60203: {
    customer: "You've requested several codes. Please wait a few minutes and try again.",
    presenter: 'Max send attempts reached (60203). Verify allows 5 sends per verification lifecycle — a built-in toll-fraud guard.',
  },
  60205: {
    customer: "That number can't receive text messages. Please use a mobile number.",
    presenter: 'SMS is not supported by landline numbers (60205).',
  },
  60310: {
    customer: 'Too many incorrect codes. Please wait and try again.',
    presenter: 'TOTP factor verification attempts reached (60310). Max 5 wrong codes per factor.',
  },
  60318: {
    customer: 'Please finish setting up your authenticator app first.',
    presenter: 'Factor is unverified (60318): a TOTP factor must be verified before it can be challenged.',
  },
  60410: {
    customer: "We couldn't send a code to that number. Please try another way to verify.",
    presenter: 'Blocked by Verify Fraud Guard (60410): suspected SMS pumping on this number prefix. Temporary 12-hour block.',
  },
  60605: {
    customer: "We can't send codes to that country yet.",
    presenter: 'Blocked by Verify Geo Permissions (60605): this destination country is turned off for the Verify Service.',
  },
  60606: {
    customer: "We couldn't check that number right now. Please try again.",
    presenter: 'Lookup package not enabled (60606) on this account.',
  },
  60624: {
    customer: "You've requested several codes. Please wait a few minutes and try again.",
    presenter: 'Trial account rate limit (60624): Verify limits how many verifications a trial account can start. Wait, or upgrade the account.',
  },
  60601: {
    customer: "We couldn't check that number right now. Please try again.",
    presenter: 'Lookup needs special approval for this number (60601) — e.g. Canadian numbers need NPAC access.',
  },
};

// Convert any thrown error into { customer, presenter, code, status }.
function friendlyError(err) {
  const code = err && err.code;
  const known = KNOWN[code];
  if (known) return { ...known, code, status: err.status || 400 };
  return {
    customer: 'Something went wrong on our side. Please try again.',
    presenter: `Twilio error ${code || ''}: ${err && err.message ? err.message : 'unknown error'}`.trim(),
    code: code || null,
    status: (err && err.status) || 500,
  };
}

module.exports = { friendlyError };
