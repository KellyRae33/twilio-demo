// =============================================================================
// routes/loyalty.js — BEAT 4: Leo cashes in his reward points.
//
//   POST /api/loyalty/start    balance + rewards catalog
//   POST /api/loyalty/redeem   small → approve; big → hold and ask for TOTP
//   POST /api/loyalty/step-up  Verify TOTP challenge → complete the redemption
//
// Points behave like cash, so taken-over accounts get drained through rewards.
// The rule is simple and lives in config.js: above the threshold, prove it's you.
// =============================================================================

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { state } = require('../src/state');
const { entry } = require('../src/panel');
const verify = require('../src/verify');
const { ensureLeoAccount } = require('../src/seed');

const router = express.Router();

function reply(res, status, body) {
  res.status(status).json({ entries: [], ...body });
}

const fmt = (n) => n.toLocaleString('en-US');

function completeRedemption(reward) {
  const a = state.account;
  a.points -= reward.points;
  const done = {
    id: 'RW-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
    reward: reward.name,
    points: reward.points,
    balance: a.points,
    redeemedAt: new Date().toISOString(),
  };
  a.redemptions.push(done);
  state.pendingRedemption = null;
  return done;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
router.post('/start', (req, res) => {
  const entries = ensureLeoAccount();
  reply(res, 200, {
    firstName: state.account.name.split(' ')[0],
    points: state.account.points,
    threshold: config.loyalty.stepUpThresholdPoints,
    rewards: config.loyalty.rewards,
    entries,
  });
});

// ---------------------------------------------------------------------------
// Redeem
// ---------------------------------------------------------------------------
router.post('/redeem', (req, res) => {
  ensureLeoAccount();
  const a = state.account;
  // Look the reward up on the server: the app can't choose its own price.
  const reward = config.loyalty.rewards.find((r) => r.id === (req.body || {}).rewardId);
  if (!reward) return reply(res, 400, { error: 'That reward is no longer available.' });
  if (reward.points > a.points) return reply(res, 400, { error: "You don't have enough points for that reward yet." });

  const threshold = config.loyalty.stepUpThresholdPoints;
  const needsStepUp = reward.points > threshold;

  const checked = entry({
    title: 'Checked the redemption against the step-up threshold',
    mode: 'APP',
    request: { reward: reward.name, points: reward.points },
    response: { balance: a.points, threshold, above_threshold: needsStepUp },
    decision: needsStepUp
      ? `${fmt(reward.points)} points > ${fmt(threshold)} → hold it and ask for the authenticator code.`
      : `${fmt(reward.points)} points ≤ ${fmt(threshold)} → approve straight away, no prompt.`,
    note: needsStepUp
      ? 'Points are as good as cash, and draining them is a common payoff of account takeover. A code from the authenticator Leo set up at sign-up proves it\'s him, at the moment it matters.'
      : 'Small, everyday redemptions stay frictionless. Threshold is in config.js (loyalty).',
  });

  if (!needsStepUp) {
    const done = completeRedemption(reward);
    return reply(res, 200, { status: 'complete', redemption: done, entries: [checked] });
  }

  state.pendingRedemption = reward;
  reply(res, 200, { status: 'step_up', reward, entries: [checked] });
});

// ---------------------------------------------------------------------------
// Step-up for big redemptions
// ---------------------------------------------------------------------------
router.post('/step-up', async (req, res) => {
  const reward = state.pendingRedemption;
  const code = String((req.body || {}).code || '').trim();
  if (!reward) return reply(res, 400, { error: 'There is no redemption waiting. Please choose your reward again.' });
  if (!/^\d{6}$/.test(code)) return reply(res, 400, { error: 'Enter the 6-digit code from your authenticator app.' });

  const result = await verify.challengeTotp(
    state.account.verifyIdentity,
    code,
    'Verified the authenticator code (step-up)',
    `it really is Leo. Release ${fmt(reward.points)} points for the ${reward.name}.`
  );
  if (!result.ok) return reply(res, result.error.status || 400, { error: result.error.customer, entries: result.entries });
  if (!result.approved) return reply(res, 400, { error: "That code didn't match. Codes change every 30 seconds — try the current one.", entries: result.entries });

  const done = completeRedemption(reward);
  const roadmap = entry({
    title: 'Next step: phishing-resistant step-up',
    mode: 'APP',
    decision: `Redemption ${done.id} complete. New balance: ${fmt(done.balance)} points.`,
    note: 'A TOTP code can still be phished (a fake site asks Leo to type it in). Roadmap: Verify Passkeys (bound to twill.com, so a look-alike site gets nothing) or Verify Push / Silent Device Approval (Leo taps "Approve" in the Twill app, which shows exactly what he\'s approving).',
  });
  reply(res, 200, { status: 'complete', redemption: done, entries: [...result.entries, roadmap] });
});

module.exports = router;
