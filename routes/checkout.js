// =============================================================================
// routes/checkout.js — BEAT 2: a few months later, Leo places a big giveaway
// order in the Twill mobile app.
//
//   POST /api/checkout/start    load Leo's account + the app's starting order
//   POST /api/checkout/place    price the order → risk signals. No signals:
//                               approve. Any signal: silent SIM Swap check,
//                               then a step-up code:
//                                 SIM stable  → Verify SMS code to Leo's phone
//                                 SIM swapped → authenticator app (never SMS)
//   POST /api/checkout/resend   send a fresh SMS code
//   POST /api/checkout/step-up  check the code → complete the order
//
// The key idea: everyday orders go straight through. Risky ones get one quick
// check, and the channel depends on whether Leo's phone number can be trusted.
// =============================================================================

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { state } = require('../src/state');
const { entry } = require('../src/panel');
const { PRODUCTS, priceOrder } = require('../src/catalog');
const { checkSimSwap } = require('../src/lookup');
const verify = require('../src/verify');
const rateLimit = require('../src/rateLimit');
const { ensureLeoAccount } = require('../src/seed');

const router = express.Router();

function reply(res, status, body) {
  res.status(status).json({ entries: [], ...body });
}

// The two places Leo can ship to in the app.
function shippingOptions() {
  const home = state.account.address;
  const studio = config.checkout.newAddress;
  return {
    home: { label: 'Home', line1: home.line1, city: home.city, state: home.state, postalCode: home.postalCode },
    new: {
      label: studio.label, line1: studio.line1, city: studio.city, state: studio.state, postalCode: studio.postalCode,
      isNew: !state.account.knownAddresses.includes(studio.line1),
    },
  };
}

// ---------------------------------------------------------------------------
// The risk rules. Each signal is checked only if switched on in config.js.
// ---------------------------------------------------------------------------
function riskSignals({ total, deviceId, address }) {
  const { largeOrderThreshold, triggers } = config.checkout;
  const a = state.account;
  return [
    {
      name: 'Large order',
      enabled: triggers.largeOrder,
      fired: total > largeOrderThreshold,
      detail: `$${total} vs $${largeOrderThreshold} threshold`,
    },
    {
      name: 'New device',
      enabled: triggers.newDevice,
      fired: !a.knownDevices.includes(deviceId),
      detail: a.knownDevices.includes(deviceId) ? 'Leo has ordered from this device before' : 'first order from the Twill app on this phone',
    },
    {
      name: 'New shipping address',
      enabled: triggers.newShippingAddress,
      fired: !a.knownAddresses.includes(address.line1),
      detail: a.knownAddresses.includes(address.line1) ? 'Leo has shipped here before' : `never shipped to "${address.label}" before`,
    },
  ];
}

// Save a finished order and remember the device and address as trusted.
function completeOrder(order) {
  const a = state.account;
  const placed = {
    id: 'TW-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
    ...order,
    pointsEarned: Math.round(order.total * 10),
    placedAt: new Date().toISOString(),
  };
  a.orders.push(placed);
  a.points += placed.pointsEarned; // spendable in Beat 4
  if (!a.knownDevices.includes(order.deviceId)) a.knownDevices.push(order.deviceId);
  if (!a.knownAddresses.includes(order.address.line1)) a.knownAddresses.push(order.address.line1);
  state.pendingOrder = null;
  return placed;
}

// ---------------------------------------------------------------------------
// Start: make sure Leo's account exists, then send the app what it needs.
// ---------------------------------------------------------------------------
router.post('/start', (req, res) => {
  const entries = ensureLeoAccount();
  reply(res, 200, {
    firstName: state.account.name.split(' ')[0],
    products: PRODUCTS,
    giveawayOrder: config.checkout.giveawayOrder,
    shipping: shippingOptions(),
    entries,
  });
});

// ---------------------------------------------------------------------------
// Place the order
// ---------------------------------------------------------------------------
router.post('/place', async (req, res) => {
  ensureLeoAccount();
  const { items, shipTo, deviceId } = req.body || {};
  const { lines, total } = priceOrder(items); // priced on the server, never trusted from the app
  if (!lines.length) return reply(res, 400, { error: 'Your bag is empty.' });

  const address = shippingOptions()[shipTo === 'new' ? 'new' : 'home'];
  // In a real app the device ID comes from the app's secure device binding.
  const order = { lines, total, address, deviceId: String(deviceId || 'unknown-device') };
  const entries = [];

  // 1. Check the risk signals (our own rules, no Twilio call).
  const signals = riskSignals(order);
  const fired = signals.filter((s) => s.enabled && s.fired);
  entries.push(entry({
    title: 'Checked the order against risk rules',
    mode: 'APP',
    request: { total: `$${total}`, items: lines.map((l) => `${l.qty} × ${l.name}`), ship_to: address.label, device: order.deviceId },
    response: Object.fromEntries(signals.map((s) => [s.name, s.enabled ? `${s.fired ? 'YES' : 'no'} (${s.detail})` : 'rule switched off'])),
    decision: fired.length
      ? `${fired.map((s) => s.name).join(' + ')} → run a silent SIM Swap check, then confirm with a code.`
      : 'No risk signals → approve with no extra checks.',
    note: 'Rules and thresholds live in config.js (checkout).',
  }));

  if (!fired.length) {
    const placed = completeOrder(order);
    return reply(res, 200, { status: 'complete', order: placed, entries });
  }

  // 2. Silent SIM Swap check. Leo just sees "Placing your order…".
  const simSwap = await checkSimSwap(state.account.phone);
  entries.push(...simSwap.entries);

  // 3. Decide the step-up channel. The SIM Swap result says whether Leo's phone
  //    number can be trusted to receive a code.
  const trust = state.account.trust || { level: 'unknown' };
  state.pendingOrder = { ...order, method: simSwap.swappedRecently ? 'totp' : 'sms' };

  if (simSwap.swappedRecently) {
    entries.push(entry({
      title: 'Step-up required: authenticator app, not SMS',
      mode: 'APP',
      decision: 'Recent SIM swap → hold the order and ask for a code from Leo\'s authenticator app.',
      note: "Why not an SMS code? After a SIM swap, Leo's texts may be going to the attacker's phone, so an SMS code would prove nothing. The authenticator app lives on Leo's device and doesn't depend on the phone number.",
    }));
    return reply(res, 200, { status: 'step_up', method: 'totp', total, entries });
  }

  entries.push(entry({
    title: 'Step-up required: SMS code to Leo\'s phone',
    mode: 'APP',
    decision: `SIM looks stable (sign-up trust: ${trust.level}) → his number is safe to use. Hold the order and text him a one-time code.`,
    note: 'One quick check on a risky order. If the SIM had been swapped recently, this would switch to the authenticator app instead.',
  }));

  const sent = await sendOrderCode(req);
  entries.push(...sent.entries);
  if (!sent.ok) return reply(res, sent.status, { error: sent.error, entries });
  reply(res, 200, { status: 'step_up', method: 'sms', phoneEnding: state.account.phone.slice(-4), simulatedCode: sent.simulatedCode, total, entries });
});

// Rate limit, then send a Verify SMS code to Leo's phone on file.
async function sendOrderCode(req) {
  const phone = state.account.phone;
  const limit = rateLimit.trySend({ phone, clientId: req.ip });
  const limitEntry = entry({
    title: limit.allowed ? 'Rate limit check passed' : 'Rate limit hit — no code sent',
    mode: 'APP',
    response: limit.counts,
    decision: limit.allowed ? 'Under the limit → continue.' : `${limit.reason} → refuse.`,
    phones: [phone],
  });
  if (!limit.allowed) return { ok: false, status: 429, error: 'Too many codes requested. Please wait a few minutes.', entries: [limitEntry] };

  const sent = await verify.sendSmsCode(phone, { title: 'Sent an order confirmation code by SMS' });
  if (!sent.ok) return { ok: false, status: sent.error.status || 400, error: sent.error.customer, entries: [limitEntry, ...sent.entries] };
  return { ok: true, simulatedCode: sent.simulatedCode, entries: [limitEntry, ...sent.entries] };
}

// ---------------------------------------------------------------------------
// Resend the SMS code
// ---------------------------------------------------------------------------
router.post('/resend', async (req, res) => {
  const pending = state.pendingOrder;
  if (!pending || pending.method !== 'sms') return reply(res, 400, { error: 'There is no order waiting for a text code.' });
  const sent = await sendOrderCode(req);
  if (!sent.ok) return reply(res, sent.status, { error: sent.error, entries: sent.entries });
  reply(res, 200, { simulatedCode: sent.simulatedCode, entries: sent.entries });
});

// ---------------------------------------------------------------------------
// Step-up: check the SMS or authenticator code, then complete the held order
// ---------------------------------------------------------------------------
router.post('/step-up', async (req, res) => {
  const pending = state.pendingOrder;
  const code = String((req.body || {}).code || '').trim();
  if (!pending) return reply(res, 400, { error: 'There is no order waiting. Please place it again.' });
  if (!/^\d{6}$/.test(code)) return reply(res, 400, { error: 'Enter the 6-digit code.' });

  let result;
  if (pending.method === 'sms') {
    result = await verify.checkSmsCode(state.account.phone, code, 'Checked the order confirmation code');
  } else {
    result = await verify.challengeTotp(
      state.account.verifyIdentity,
      code,
      'Verified the authenticator code (step-up)',
      'it really is Leo. Release the order.'
    );
  }
  if (!result.ok) return reply(res, result.error.status || 400, { error: result.error.customer, entries: result.entries });
  if (!result.approved) {
    const hint = pending.method === 'sms' ? 'Please check the text and try again.' : 'Codes change every 30 seconds — try the current one.';
    return reply(res, 400, { error: `That code didn't match. ${hint}`, entries: result.entries });
  }

  const { method, ...order } = pending;
  const placed = completeOrder(order);
  reply(res, 200, { status: 'complete', order: placed, entries: result.entries });
});

module.exports = router;
