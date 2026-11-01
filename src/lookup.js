// =============================================================================
// lookup.js — Twilio Lookup v2 checks.
//
// Line Type Intelligence tells us what kind of phone line a number is
// (mobile, landline, VoIP, premium-rate…) BEFORE we spend money texting it.
// =============================================================================

const config = require('../config');
const { state } = require('./state');
const tw = require('./twilio');
const sim = require('./simulated');
const { entry, toApiShape } = require('./panel');
const { friendlyError } = require('./errors');

const LTI_API = 'GET https://lookups.twilio.com/v2/PhoneNumbers/{phone}?Fields=line_type_intelligence';

// Run Line Type Intelligence on a phone number and decide if it may get a code.
// Returns { allowed, type, customerMessage, entries: [panel entries] }.
async function checkLineType(phone) {
  let { mode, why } = tw.modeFor('lookupLineType');
  let response;
  let note = why;

  // Presenter scenario "use a VoIP number" (etc.) forces a simulated result.
  const override = state.settings.scenarios.lineTypeOverride;
  if (override && override !== 'none') {
    mode = 'SIMULATED';
    note = `Scenario switch: pretending this is a "${override}" number`;
  }

  if (mode === 'LIVE') {
    try {
      // This is the real API call — one line with the Twilio helper library.
      const result = await tw.client.lookups.v2
        .phoneNumbers(phone)
        .fetch({ fields: 'line_type_intelligence' });
      response = toApiShape(result);
    } catch (err) {
      if (tw.isNetworkError(err)) {
        // Wi-Fi trouble: keep the demo moving with a simulated answer.
        mode = 'SIMULATED';
        note = `Couldn't reach Twilio (${err.code || err.message}); fell back to simulated`;
      } else {
        const fe = friendlyError(err);
        return {
          allowed: false,
          type: null,
          error: fe,
          customerMessage: fe.customer,
          entries: [entry({
            title: 'Line type check failed',
            mode: 'LIVE',
            api: LTI_API.replace('{phone}', phone),
            request: { PhoneNumber: phone, Fields: 'line_type_intelligence' },
            response: { code: err.code, message: err.message, status: err.status, more_info: err.moreInfo },
            decision: 'Stopped: no code sent.',
            note: fe.presenter,
            phones: [phone],
          })],
        };
      }
    }
  }

  if (mode === 'SIMULATED') {
    const forced = override && override !== 'none';
    response = sim.lookupLineType(phone, forced ? override : 'mobile');
    // In a scenario, treat the number as valid so the line type is the story.
    if (forced) response.valid = true;
  }

  const lti = response.line_type_intelligence || {};
  const type = lti.type || 'unknown';
  const allowed = response.valid !== false && config.allowedLineTypes.includes(type);

  // Remember the result: the "send code" step refuses numbers that didn't pass.
  state.lookups[phone] = { allowed, type, checkedAt: new Date().toISOString() };

  const customerMessage = allowed
    ? null
    : response.valid === false
      ? "That phone number doesn't look valid. Please check it and try again."
      : config.lineTypeMessages[type] || config.lineTypeMessages.default;

  return {
    allowed,
    type,
    customerMessage,
    entries: [entry({
      title: 'Checked line type before sending a code',
      mode,
      api: LTI_API.replace('{phone}', phone),
      request: { PhoneNumber: phone, Fields: 'line_type_intelligence' },
      response,
      decision: allowed
        ? `Line type "${type}" (${lti.carrier_name || 'unknown carrier'}) is allowed → OK to send a code.`
        : `Line type "${type}" is not allowed → blocked. No SMS sent, no cost incurred.`,
      note,
      phones: [phone],
    })],
  };
}

// -----------------------------------------------------------------------------
// Identity Match: does the mobile carrier's record for this phone number match
// the name and address the customer gave us?
// Returns { trust: { level, score }, entries }. Never blocks sign-up; it sets a
// trust level that later beats (checkout, loyalty) can use.
// -----------------------------------------------------------------------------
const IDM_API = 'GET https://lookups.twilio.com/v2/PhoneNumbers/{phone}?Fields=identity_match&FirstName=…&LastName=…&AddressLine1=…';

// "742 Larkspur Ave" -> "742 L•••", "97214" -> "972••" so a real address
// isn't on the projector.
const partlyHidden = (text, keep = 5) => (text ? String(text).slice(0, keep) + '•••' : text);

async function checkIdentityMatch(phone, person) {
  let { mode, why } = tw.modeFor('identityMatch');
  let note = why;
  let response;

  // Split "Leo Marin" into first and last name. Everything before the last
  // space is the first name.
  const parts = person.name.trim().split(/\s+/);
  const lastName = parts.length > 1 ? parts.pop() : '';
  const firstName = parts.join(' ');

  // The parameters Twilio compares against carrier records.
  const params = {
    fields: 'identity_match',
    firstName,
    lastName,
    addressLine1: person.address.line1,
    city: person.address.city,
    state: person.address.state,
    postalCode: person.address.postalCode,
    addressCountryCode: person.address.country,
  };
  const shownRequest = {
    PhoneNumber: phone,
    Fields: 'identity_match',
    FirstName: firstName,
    LastName: lastName,
    AddressLine1: partlyHidden(params.addressLine1),
    City: params.city,
    State: params.state,
    PostalCode: partlyHidden(params.postalCode, 3),
    AddressCountryCode: params.addressCountryCode,
  };

  const override = state.settings.scenarios.identityOverride;
  if (override && override !== 'none') {
    mode = 'SIMULATED';
    note = `Scenario switch: pretending the result is a "${override}" match`;
  }

  if (mode === 'LIVE') {
    try {
      const result = await tw.client.lookups.v2.phoneNumbers(phone).fetch(params);
      response = toApiShape(result);
    } catch (err) {
      if (tw.isNetworkError(err)) {
        mode = 'SIMULATED';
        note = `Couldn't reach Twilio (${err.code || err.message}); fell back to simulated`;
      } else {
        // The check couldn't run. Don't punish the customer: carry on with an
        // "unknown" trust level, and say why in the panel.
        const fe = friendlyError(err);
        return {
          trust: { level: 'unknown', score: null },
          entries: [entry({
            title: 'Identity check could not run',
            mode: 'LIVE',
            api: IDM_API.replace('{phone}', phone),
            request: shownRequest,
            response: { code: err.code, message: err.message, status: err.status, more_info: err.moreInfo },
            decision: 'Trust level "unknown" → sign-up continues; later high-risk actions will ask for a second factor.',
            note: fe.presenter,
            phones: [phone],
          })],
        };
      }
    }
  }

  if (mode === 'SIMULATED') {
    response = sim.lookupIdentityMatch(phone, override && override !== 'none' ? override : 'strong');
  }

  const idm = response.identity_match || {};
  const score = typeof idm.summary_score === 'number' ? idm.summary_score : null;
  const { highTrustScore, mediumTrustScore } = config.identityMatch;

  let level;
  let decision;
  if (idm.error_code || score === null) {
    // Twilio can answer 200 OK but put an error inside identity_match
    // (e.g. 10002 on trial accounts). Explain it in plain English.
    level = 'unknown';
    decision = `No score returned${idm.error_code ? ` (error ${idm.error_code})` : ''} → trust "unknown". Sign-up continues; high-risk actions will need a second factor.`;
    if (idm.error_code) note = friendlyError({ code: idm.error_code, message: idm.error_message || 'no message' }).presenter;
  } else if (score >= highTrustScore) {
    level = 'high';
    decision = `Score ${score} ≥ ${highTrustScore} → HIGH trust: the carrier's records for this phone match Leo's name and address.`;
  } else if (score >= mediumTrustScore) {
    level = 'medium';
    decision = `Score ${score} → MEDIUM trust: partial match. Sign-up continues; risky orders will get a step-up check.`;
  } else {
    level = 'low';
    decision = `Score ${score} < ${mediumTrustScore} → LOW trust: no match. Not blocked (family plans and recent moves cause honest mismatches), but flagged for step-up and lower limits.`;
  }

  // Never echo the full address back on screen, even if Twilio's response
  // includes the request values in its URL.
  const shownResponse = { ...response, url: String(response.url || '').split('?')[0] };

  return {
    trust: { level, score },
    entries: [entry({
      title: 'Checked the phone\'s carrier records against Leo\'s name and address',
      mode,
      api: IDM_API.replace('{phone}', phone),
      request: shownRequest,
      response: shownResponse,
      decision,
      note: note || 'Run after the SMS code is approved, so we only pay for people who really hold this phone.',
      phones: [phone],
    })],
  };
}

// -----------------------------------------------------------------------------
// SIM Swap: has the SIM card behind this number changed recently?
// A recent swap is the classic sign of account takeover: the attacker talks
// the carrier into moving Leo's number to their SIM, then receives his texts.
//
// SIMULATED by default (private beta, needs carrier approval). If switched to
// LIVE and anything goes wrong, we fall back to simulated so checkout never stalls.
// Returns { swappedRecently, entries }.
// -----------------------------------------------------------------------------
const SIM_API = 'GET https://lookups.twilio.com/v2/PhoneNumbers/{phone}?Fields=sim_swap';

async function checkSimSwap(phone) {
  let { mode, why } = tw.modeFor('simSwap');
  let note = why;
  let response;
  const windowHours = config.checkout.simSwapWindowHours;
  const scenarioSwap = state.settings.scenarios.recentSimSwap;

  if (scenarioSwap) {
    mode = 'SIMULATED';
    note = `Scenario switch: pretending the SIM was swapped in the last ${windowHours} hours`;
  }

  if (mode === 'LIVE') {
    try {
      const result = await tw.client.lookups.v2.phoneNumbers(phone).fetch({ fields: 'sim_swap' });
      response = toApiShape(result);
      const simData = response.sim_swap;
      if (!simData || simData.error_code || !simData.last_sim_swap) {
        // No usable answer (no access yet, or carrier not covered).
        mode = 'SIMULATED';
        note = `Live SIM Swap returned no data (${simData && simData.error_code ? 'error ' + simData.error_code : 'no access or not covered'}); fell back to simulated`;
      }
    } catch (err) {
      mode = 'SIMULATED';
      note = `Live SIM Swap failed (${err.code || err.message}); fell back to simulated`;
    }
  }

  if (mode === 'SIMULATED') response = sim.lookupSimSwap(phone, scenarioSwap, windowHours);

  const last = response.sim_swap.last_sim_swap;
  const swappedRecently = Boolean(last.swapped_in_period);
  // Twilio writes the window as an ISO 8601 duration: "PT48H" = 48 hours.
  const hours = (String(last.swapped_period).match(/PT(\d+)H/) || [])[1];
  const window = hours ? `the last ${hours} hours` : last.swapped_period;

  return {
    swappedRecently,
    entries: [entry({
      title: 'Silently checked for a recent SIM swap',
      mode,
      api: SIM_API.replace('{phone}', phone),
      request: { PhoneNumber: phone, Fields: 'sim_swap' },
      response,
      decision: swappedRecently
        ? `SIM changed within ${window} → possible account takeover. Don't trust SMS for this order.`
        : `No SIM change within ${window} → the phone looks like it's still in Leo's hands.`,
      note: note || 'Runs in the background; Leo sees nothing. SIM Swap is in private beta and needs carrier approval.',
      phones: [phone],
    })],
  };
}

module.exports = { checkLineType, checkIdentityMatch, checkSimSwap };
