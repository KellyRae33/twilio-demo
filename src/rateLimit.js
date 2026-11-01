// =============================================================================
// rateLimit.js — a simple limit on how often codes can be sent.
//
// Why: SMS pumping (toll fraud) works by bots hammering a "send code" button
// with numbers the fraudster profits from. Limiting sends per phone number and
// per client, on OUR server, stops that before Twilio is even called.
// Verify adds its own limits on top (e.g. max 5 sends per verification).
// =============================================================================

const config = require('../config');
const { state } = require('./state');

// PUBLIC DEMO: each visitor has their own log (state.sendLog), a Map of
// key -> list of timestamps (ms) of recent sends. So one visitor using up the
// limit doesn't block everyone else on Leo's (shared, fictional) number.
function hitsInWindow(key) {
  const recent = state.sendLog;
  const windowMs = config.rateLimit.windowMinutes * 60 * 1000;
  const cutoff = Date.now() - windowMs;
  const hits = (recent.get(key) || []).filter((t) => t > cutoff);
  recent.set(key, hits);
  return hits;
}

// Check (and, if allowed, record) one send attempt.
// Returns { allowed, reason, counts }.
function trySend({ phone, clientId }) {
  const { maxSendsPerPhone, maxSendsPerClient, windowMinutes } = config.rateLimit;
  const phoneHits = hitsInWindow('phone:' + phone);
  const clientHits = hitsInWindow('client:' + clientId);

  const counts = {
    phone: `${phoneHits.length}/${maxSendsPerPhone} code requests for this number in the last ${windowMinutes} min`,
    client: `${clientHits.length}/${maxSendsPerClient} code requests from this client in the last ${windowMinutes} min`,
  };

  if (phoneHits.length >= maxSendsPerPhone) {
    return { allowed: false, reason: 'Too many codes sent to this number', counts };
  }
  if (clientHits.length >= maxSendsPerClient) {
    return { allowed: false, reason: 'Too many codes requested from this client', counts };
  }

  phoneHits.push(Date.now());
  clientHits.push(Date.now());
  return { allowed: true, reason: null, counts };
}

function resetLimits() {
  state.sendLog.clear();
}

module.exports = { trySend, resetLimits };
