// =============================================================================
// state.js — the demo's "database".
//
// Everything is kept in memory on the server. PUBLIC DEMO: each visitor (each
// browser) gets their own copy of Leo's story, so people trying the demo at
// the same time don't change each other's screens.
// Restarting the server, or pressing "Reset demo", wipes it clean.
// A real app would use a database here.
//
// How each request finds "its" visitor: a cookie holds a random visitor ID,
// and Node's AsyncLocalStorage remembers which visitor the current request
// belongs to. The rest of the code just uses `state` as before.
// =============================================================================

const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const config = require('../config');

// Presenter settings: which checks are LIVE vs SIMULATED, plus scenario switches.
function defaultSettings() {
  return {
    offline: config.offlineModeByDefault,
    live: { ...config.liveByDefault },
    scenarios: {
      // Beat 1: force the Lookup result to a risky line type (simulated).
      // 'none' means "use whatever Lookup really says".
      lineTypeOverride: 'none', // 'none' | 'nonFixedVoip' | 'premium' | 'landline'
      // Beat 1: force the Identity Match result (simulated).
      // Useful because Leo's made-up name won't match your real phone's records.
      identityOverride: 'none', // 'none' | 'strong' | 'partial' | 'noMatch'
      // Beats 2–3: pretend Leo's SIM card was swapped recently.
      recentSimSwap: false,
    },
  };
}

// Leo's account record, filled in during Beat 1.
function emptyAccount() {
  return {
    created: false,
    name: null,
    email: null,
    username: null,
    passwordHash: null, // we never keep the plain password
    phone: null,        // E.164, e.g. +14155550123
    phoneVerified: false,
    address: null,      // { line1, city, state, postalCode, country }
    trust: null,        // Identity Match result: { level: 'high'|'medium'|'low'|'unknown', score }
    consent: null,      // { account, marketing, timestamp, text }
    // Verify "Entity" identity: a random ID, not personal data (Twilio's advice).
    verifyIdentity: null,
    totp: null,         // { factorSid, mode, secret (simulated only), verified }
    // Beat 2: devices and shipping addresses Leo has used before. Anything not
    // on these lists is "new" and counts as a risk signal at checkout.
    knownDevices: ['web'],
    knownAddresses: [], // address lines, e.g. '742 Larkspur Ave'
    orders: [],         // completed orders
    contactHistory: [], // Beat 3: previous email/phone, with when they changed
    points: config.loyalty.startingPoints, // Beat 4: rewards balance
    redemptions: [],    // Beat 4: completed redemptions
  };
}

// One visitor's copy of the demo.
function newVisitorState() {
  return {
    settings: defaultSettings(),
    account: emptyAccount(),
    // Results of Lookup checks, keyed by phone number. The "send code" endpoint
    // refuses to send unless this number passed the line-type check.
    lookups: {},
    // Simulated SMS codes, keyed by phone number (only used in SIMULATED mode).
    simulatedCodes: {},
    // An order waiting for Leo's step-up code (Beat 2).
    pendingOrder: null,
    // A contact-details change in progress (Beat 3).
    pendingChange: null,
    // A big redemption waiting for Leo's step-up code (Beat 4).
    pendingRedemption: null,
    // Recent "send code" requests, for this visitor's rate limit (rateLimit.js).
    sendLog: new Map(),
  };
}

// ---- One copy per visitor --------------------------------------------------

const COOKIE = 'twill_visitor';
const visitors = new Map(); // visitor ID -> { data, lastSeen }
const currentVisitor = new AsyncLocalStorage();
const fallback = newVisitorState(); // only used outside a request (never in practice)

function visitorData() {
  return currentVisitor.getStore() || fallback;
}

// `state` looks like a plain object, but every read and write goes to the
// current visitor's copy.
const state = new Proxy({}, {
  get: (_, key) => visitorData()[key],
  set: (_, key, value) => { visitorData()[key] = value; return true; },
  has: (_, key) => key in visitorData(),
  ownKeys: () => Reflect.ownKeys(visitorData()),
  getOwnPropertyDescriptor: (_, key) => Object.getOwnPropertyDescriptor(visitorData(), key),
});

// Express middleware: find (or create) this browser's visitor, then handle
// the request "inside" that visitor.
function perVisitor(req, res, next) {
  const match = /(?:^|;\s*)twill_visitor=([a-f0-9]{32})/.exec(req.headers.cookie || '');
  let id = match && match[1];
  if (!id || !visitors.has(id)) {
    id = crypto.randomBytes(16).toString('hex');
    visitors.set(id, { data: newVisitorState(), lastSeen: Date.now() });
    res.setHeader('Set-Cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.visitors.forgetAfterMinutes * 60}`);
    forgetOldVisitors();
  }
  const visitor = visitors.get(id);
  visitor.lastSeen = Date.now();
  currentVisitor.run(visitor.data, next);
}

// Delete idle visitors, and the oldest ones if there are too many.
function forgetOldVisitors() {
  const cutoff = Date.now() - config.visitors.forgetAfterMinutes * 60 * 1000;
  for (const [id, v] of visitors) if (v.lastSeen < cutoff) visitors.delete(id);
  while (visitors.size > config.visitors.maxVisitors) {
    visitors.delete(visitors.keys().next().value); // Maps keep insertion order: oldest first
  }
}
setInterval(forgetOldVisitors, 10 * 60 * 1000).unref();

// "Reset demo" clears Leo's journey but keeps the presenter's LIVE/SIMULATED
// and Offline choices, unless resetSettings is true.
function reset({ resetSettings = false } = {}) {
  if (resetSettings) state.settings = defaultSettings();
  state.account = emptyAccount();
  state.lookups = {};
  state.simulatedCodes = {};
  state.pendingOrder = null;
  state.pendingChange = null;
  state.pendingRedemption = null;
}

module.exports = { state, reset, perVisitor };
