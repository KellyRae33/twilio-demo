// =============================================================================
// routes/promo.js — BEAT 5: Twill launches a promo code with Leo, and the
// launch attracts SMS pumping (toll fraud).
//
//   POST /api/promo/launch   simulate a burst of sign-ups and run each one
//                            through Twill's defences
//
// Every sign-up wants a verification code by SMS. Fraudsters exploit that:
// they make bots request codes to numbers they profit from (premium-rate, or
// whole ranges of numbers on a carrier that pays them per message received).
//
// The defences, cheapest first:
//   1. Duplicate check       one verified number per promo   (our server, free)
//   2. Lookup line type      no VoIP / premium numbers       (LIVE for ≤5, rest simulated)
//   3. Verify Fraud Guard    blocks a prefix under attack    (simulated)
//   4. Send the code         only what survived              (simulated: these are fake numbers)
//
// Nothing here texts a real phone.
// =============================================================================

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const tw = require('../src/twilio');
const sim = require('../src/simulated');
const { entry, toApiShape } = require('../src/panel');

const router = express.Router();
const P = config.promo;

// ---------------------------------------------------------------------------
// Making the fake sign-ups
// ---------------------------------------------------------------------------
const AREA_CODES = ['415', '503', '212', '312', '206', '617', '512', '303', '404', '702'];
const pick = (list) => list[crypto.randomInt(0, list.length)];
const digits = (n) => Array.from({ length: n }, () => crypto.randomInt(0, 10)).join('');
const usNumber = () => `+1${pick(AREA_CODES)}${crypto.randomInt(2, 10)}${digits(6)}`;

// What each kind of sign-up looks like to Lookup.
const LINE_TYPE = { goodMobile: 'mobile', duplicate: 'mobile', voip: 'nonFixedVoip', premium: 'premium', sequentialPumping: 'mobile' };

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Builds the list of sign-ups in arrival order.
function buildSignups() {
  const mix = P.mix;
  const live = P.liveSampleNumbers.slice(0, P.maxLiveLookups).map((phone) => ({ phone, kind: 'liveSample' }));

  const normal = shuffle([
    ...Array.from({ length: mix.goodMobile }, () => ({ phone: usNumber(), kind: 'goodMobile' })),
    ...Array.from({ length: mix.voip }, () => ({ phone: usNumber(), kind: 'voip' })),
    ...Array.from({ length: mix.premium }, () => ({ phone: `+1900${crypto.randomInt(2, 10)}${digits(6)}`, kind: 'premium' })),
  ]);

  // The bot arrives as one burst, walking up a single prefix: +447700900100, …101, …102…
  // (+44 7700 900xxx is a range reserved for fiction, so no real person is involved.)
  const burst = Array.from({ length: mix.sequentialPumping }, (_, i) => ({ phone: `+447700900${100 + i}`, kind: 'sequentialPumping' }));
  normal.splice(Math.floor(normal.length * 0.4), 0, ...burst);

  // Duplicates: someone signs up again with a number that already got the code.
  for (let i = 0; i < mix.duplicate; i++) {
    const at = crypto.randomInt(Math.floor(normal.length * 0.6), normal.length + 1);
    const earlier = normal.slice(0, at).filter((s) => s.kind === 'goodMobile');
    normal.splice(at, 0, { phone: pick(earlier).phone, kind: 'duplicate' });
  }

  // The live samples arrive first, so their real results show up early.
  return [...live, ...normal];
}

// Placeholder cost of texting one number.
function smsCost(phone, lineType) {
  const c = P.placeholderCostPerSmsUSD;
  if (lineType === 'premium') return c.premium;
  return phone.startsWith('+1') ? c.domestic : c.international;
}

const money = (n) => '$' + n.toFixed(2);

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------
router.post('/launch', async (req, res) => {
  const signups = buildSignups();
  const entries = [];
  const lookupMode = tw.modeFor('lookupLineType');

  entries.push(entry({
    title: `Launched promo ${P.code}: ${signups.length} sign-ups in under a minute`,
    mode: 'APP',
    request: { promo: P.code, sign_ups: signups.length },
    response: { checks_in_order: ['1. one verified number per promo', '2. Lookup line type', '3. Verify Fraud Guard', '4. send code'] },
    decision: 'Run every sign-up through the cheapest checks first, so we only pay to text real customers.',
    note: `Also in place: our own rate limit on "send code" (${config.rateLimit.maxSendsPerPhone} per number and ${config.rateLimit.maxSendsPerClient} per client every ${config.rateLimit.windowMinutes} min) and Verify's built-in limits. Bots from one source hit those first; this burst is spread out to show the other layers.`,
  }));

  // 1–2. LIVE Lookup for the capped sample (only if Lookup is set to LIVE).
  const liveTypes = {};
  for (const s of signups.filter((x) => x.kind === 'liveSample')) {
    if (lookupMode.mode !== 'LIVE') break;
    try {
      const result = await tw.client.lookups.v2.phoneNumbers(s.phone).fetch({ fields: 'line_type_intelligence' });
      const response = toApiShape(result);
      const type = (response.line_type_intelligence && response.line_type_intelligence.type) || 'unknown';
      liveTypes[s.phone] = response.valid === false ? 'invalid' : type;
      entries.push(entry({
        title: `Checked line type — live sample ${Object.keys(liveTypes).length} of ${P.maxLiveLookups} max`,
        mode: 'LIVE',
        api: `GET https://lookups.twilio.com/v2/PhoneNumbers/${s.phone}?Fields=line_type_intelligence`,
        request: { PhoneNumber: s.phone, Fields: 'line_type_intelligence' },
        response,
        decision: config.allowedLineTypes.includes(type) ? `"${type}" → allowed.` : `"${type}" → blocked, no SMS.`,
        note: 'Public example number from Twilio\'s docs. Live calls are capped to control cost.',
      }));
    } catch (err) {
      // Keep going; this number will be simulated instead.
      entries.push(entry({
        title: 'Live sample lookup failed, simulated instead',
        mode: 'SIMULATED',
        response: { code: err.code, message: err.message },
        decision: 'Fell back to a simulated result for this number.',
      }));
    }
  }

  // Run the pipeline.
  const redeemed = new Set();
  const prefixCounts = {};
  const results = [];
  const counts = { attempted: signups.length, blockedLineType: 0, blockedFraudGuard: 0, blockedDuplicate: 0, sent: 0 };
  const simulatedTypeCounts = {};
  let spendAvoided = 0;
  let spendSent = 0;

  for (const s of signups) {
    const result = { phone: s.phone, kind: s.kind };
    let lineType;
    if (liveTypes[s.phone]) {
      lineType = liveTypes[s.phone];
      result.lookup = 'LIVE';
    } else {
      // A live sample with no live result (Lookup simulated) is treated as a normal mobile.
      lineType = LINE_TYPE[s.kind] || 'mobile';
      result.lookup = 'SIMULATED';
    }
    const cost = smsCost(s.phone, lineType);
    result.cost = cost;

    if (redeemed.has(s.phone)) {
      result.outcome = 'blocked_duplicate';
      result.detail = 'Number already used this promo';
      counts.blockedDuplicate++;
      spendAvoided += cost;
    } else {
      if (result.lookup === 'SIMULATED') simulatedTypeCounts[lineType] = (simulatedTypeCounts[lineType] || 0) + 1;
      if (!config.allowedLineTypes.includes(lineType)) {
        result.outcome = 'blocked_line_type';
        result.detail = `Line type: ${lineType}`;
        counts.blockedLineType++;
        spendAvoided += cost;
      } else {
        // Fraud Guard watches traffic per prefix and blocks one under attack.
        const prefix = s.phone.slice(0, 10);
        prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
        const isBurst = s.kind === 'sequentialPumping';
        if (isBurst && prefixCounts[prefix] > P.fraudGuardBlocksAfter) {
          result.outcome = 'blocked_fraud_guard';
          result.detail = `Prefix ${prefix} blocked (60410)`;
          counts.blockedFraudGuard++;
          spendAvoided += cost;
        } else {
          result.outcome = 'sent';
          result.detail = `Line type: ${lineType}`;
          counts.sent++;
          spendSent += cost;
          redeemed.add(s.phone);
        }
      }
    }
    results.push(result);
  }

  // 2 (rest). Simulated line type summary.
  const simulatedCount = Object.values(simulatedTypeCounts).reduce((a, b) => a + b, 0);
  entries.push(entry({
    title: `Checked line type for ${lookupMode.mode === 'LIVE' ? 'the other ' : ''}${simulatedCount} numbers`,
    mode: 'SIMULATED',
    api: 'GET https://lookups.twilio.com/v2/PhoneNumbers/{phone}?Fields=line_type_intelligence',
    request: { numbers: simulatedCount },
    response: { line_types_found: simulatedTypeCounts, example_response: sim.lookupLineType('+13125550199', 'nonFixedVoip') },
    decision: `${counts.blockedLineType} blocked as VoIP / premium-rate → no SMS sent to them.`,
    note: lookupMode.mode === 'LIVE'
      ? `Simulated to control cost: only ${Object.keys(liveTypes).length} real lookups (cap: ${P.maxLiveLookups}).`
      : `Lookup is simulated right now (${lookupMode.why}).`,
  }));

  // 3. Fraud Guard.
  const burstPrefix = '+447700900';
  entries.push(entry({
    title: `Verify Fraud Guard blocked the ${burstPrefix} prefix`,
    mode: 'SIMULATED',
    api: 'POST https://verify.twilio.com/v2/Services/{VerifyServiceSid}/Verifications',
    request: { To: `${burstPrefix}1xx`, Channel: 'sms' },
    response: sim.fraudGuardBlocked(),
    decision: `These numbers are real mobiles, so line type can't stop them. After ${P.fraudGuardBlocksAfter} sends, Fraud Guard spotted a burst on one prefix and blocked the next ${counts.blockedFraudGuard}.`,
    note: 'Protection levels: Basic (cautious; mostly North American traffic), Standard (default) or Max (aggressive; for a global presence). For a launch reaching customers worldwide, Standard or Max. Pair it with Geo Permissions (turn off countries Twill doesn\'t serve) and the Safe List for known-good numbers. Fraud Guard needs an upgraded account; it is simulated here.',
  }));

  // SMS Pumping Risk Score example for one international number.
  const exampleIntl = `${burstPrefix}${100 + P.fraudGuardBlocksAfter + 1}`;
  entries.push(entry({
    title: 'SMS Pumping Risk Score on an international number',
    mode: 'SIMULATED',
    api: `GET https://lookups.twilio.com/v2/PhoneNumbers/${exampleIntl}?Fields=sms_pumping_risk`,
    request: { PhoneNumber: exampleIntl, Fields: 'sms_pumping_risk' },
    response: sim.lookupSmsPumpingRisk(exampleIntl, 92),
    decision: 'Score 92/100, carrier risk "high" → would block before sending, even on a channel Fraud Guard doesn\'t cover.',
    note: 'Useful for international numbers. Twilio doesn\'t recommend it for US/Canada, which are rarely targeted.',
  }));

  // 1. Duplicates.
  entries.push(entry({
    title: 'Blocked repeat use of the promo',
    mode: 'APP',
    response: { duplicates_blocked: counts.blockedDuplicate },
    decision: 'One verified number per promo → a number that already got LEOBAKES20 gets no new code.',
  }));

  // 4. Sends.
  entries.push(entry({
    title: `Sent codes to the ${counts.sent} sign-ups that passed`,
    mode: 'SIMULATED',
    response: {
      ...counts,
      placeholder_spend_on_sends: money(spendSent),
      placeholder_spend_avoided: money(spendAvoided),
    },
    decision: `${counts.sent} of ${counts.attempted} got a code. Estimated SMS spend avoided: ${money(spendAvoided)} (placeholder prices).`,
    note: 'Simulated so no generated numbers are texted. Costs are placeholders set in config.js, not Twilio pricing.',
  }));

  // Reassigned Number check before texting the existing list.
  const listSize = P.optedInUsListSize;
  const reassigned = Math.round(listSize * 0.02);
  const noData = Math.round(listSize * 0.015);
  entries.push(entry({
    title: `Before texting the promo to ${listSize.toLocaleString()} opted-in US customers: Reassigned Number check`,
    mode: 'SIMULATED',
    api: 'GET https://lookups.twilio.com/v2/PhoneNumbers/{phone}?Fields=reassigned_number&LastVerifiedDate=YYYYMMDD',
    request: { numbers: listSize, LastVerifiedDate: 'the date each customer opted in' },
    response: {
      results: { no: listSize - reassigned - noData, yes: reassigned, no_data_available: noData },
      example_response: sim.lookupReassignedNumber('+12065550123', '2025-11-28', 'yes'),
    },
    decision: `${reassigned} numbers now belong to someone else → removed. ${noData} with no data → re-confirm consent before texting.`,
    note: 'Texting a reassigned number means texting a stranger who never opted in (a TCPA risk). US only; needs carrier approval.',
  }));

  res.json({
    code: P.code,
    signups: results,
    counts,
    spendAvoided,
    spendSent,
    entries,
  });
});

module.exports = router;
