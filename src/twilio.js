// =============================================================================
// twilio.js — PUBLIC DEMO version: never calls Twilio.
//
// This copy of the demo is meant to be hosted on the internet for anyone to
// try. It has no Twilio credentials and builds no Twilio client, so every
// check returns a realistic simulated response shaped like the real API.
// (The presenter's own copy, run on a laptop, makes the real calls.)
// =============================================================================

const WHY = 'Public demo: every Twilio step is simulated, no real API calls';

// Every check is SIMULATED, always. The panel shows the reason.
function modeFor() {
  return { mode: 'SIMULATED', why: WHY };
}

module.exports = {
  client: null,
  hasCredentials: false,
  hasVerifyService: false,
  modeFor,
  verifyService() {
    throw new Error('The public demo never calls Twilio');
  },
  isNetworkError: () => false,
  verifyServiceSid: null,
};
