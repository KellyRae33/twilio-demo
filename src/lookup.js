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

const LTI_API = 'GET https://lookups.twilio.com/v2/PhoneNumbers/{phone}?Fields={fields}';

// Run Line Type Intelligence on a phone number and decide if it may get a code.
// With withPumpingRisk, the SAME request also asks for the SMS Pumping Risk
// Score (Fields=line_type_intelligence,sms_pumping_risk): one call, two answers.
// Returns { allowed, type, customerMessage, entries: [panel entries] }.
async function checkLineType(phone, { withPumpingRisk = false } = {}) {
  let { mode, why } = tw.modeFor('lookupLineType');
  let response;
  let note = why;
  const wanted = withPumpingRisk ? 'line_type_intelligence,sms_pumping_risk' : 'line_type_intelligence';
  let fields = wanted;

  // Presenter scenario "use a VoIP number" (etc.) forces a simulated result.
  const override = state.settings.scenarios.lineTypeOverride;
  if (override && override !== 'none') {
    mode = 'SIMULATED';
    note = `Scenario switch: pretending this is a "${override}" number`;
  }

  if (mode === 'LIVE') {
    // This is the real API call — one line with the Twilio helper library.
    // If the account can't use SMS Pumping Risk, try again with line type only,
    // so sign-up never breaks over the extra package.
    const attempts = withPumpingRisk ? [wanted, 'line_type_intelligence'] : [wanted];
    let firstErr = null;
    let lastErr = null;
    for (const f of attempts) {
      try {
        const result = await tw.client.lookups.v2.phoneNumbers(phone).fetch({ fields: f });
        response = toApiShape(result);
        fields = f;
        lastErr = null;
        break;
      } catch (err) {
        firstErr = firstErr || err;
        lastErr = err;
        if (tw.isNetworkError(err)) break;
      }
    }
    if (lastErr && tw.isNetworkError(lastErr)) {
      // Wi-Fi trouble: keep the demo moving with a simulated answer.
      mode = 'SIMULATED';
      note = `Couldn't reach Twilio (${lastErr.code || lastErr.message}); fell back to simulated`;
    } else if (lastErr) {
      const fe = friendlyError(lastErr);
      return {
        allowed: false,
        type: null,
        error: fe,
        customerMessage: fe.customer,
        entries: [entry({
          title: 'Line type check failed',
          mode: 'LIVE',
          api: LTI_API.replace('{phone}', phone).replace('{fields}', fields),
          request: { PhoneNumber: phone, Fields: fields },
          response: { code: lastErr.code, message: lastErr.message, status: lastErr.status, more_info: lastErr.moreInfo },
          decision: 'Stopped: no code sent.',
          note: fe.presenter,
          phones: [phone],
        })],
      };
    } else if (fields !== wanted) {
      note = `SMS Pumping Risk wasn't available on this account (error ${firstErr.code}), so only the line type was checked.`;
    }
  }

  if (mode === 'SIMULATED') {
    const forced = override && override !== 'none';
    response = sim.lookupLineType(phone, forced ? override : 'mobile');
    // In a scenario, treat the number as valid so the line type is the story.
    if (forced) response.valid = true;
    // Premium-rate numbers are the classic pumping target, so they score high.
    if (withPumpingRisk) response.sms_pumping_risk = sim.lookupSmsPumpingRisk(phone, override === 'premium' ? 93 : 3).sms_pumping_risk;
  }

  const lti = response.line_type_intelligence || {};
  const type = lti.type || 'unknown';
  const lineTypeOk = response.valid !== false && config.allowedLineTypes.includes(type);

  // SMS Pumping Risk (only present if we asked for it and it came back).
  const spr = response.sms_pumping_risk;
  const { blockScore } = config.smsPumpingRisk;
  let pumping = null;
  if (spr && !spr.error_code && typeof spr.sms_pumping_risk_score === 'number') {
    const score = spr.sms_pumping_risk_score;
    pumping = { score, category: spr.carrier_risk_category, blocked: Boolean(spr.number_blocked) || score >= blockScore };
  }
  const allowed = lineTypeOk && !(pumping && pumping.blocked);

  // Remember the result: the "send code" step refuses numbers that didn't pass.
  state.lookups[phone] = { allowed, type, checkedAt: new Date().toISOString() };

  const customerMessage = allowed
    ? null
    : response.valid === false
      ? "That phone number doesn't look valid. Please check it and try again."
      : !lineTypeOk
        ? config.lineTypeMessages[type] || config.lineTypeMessages.default
        : config.lineTypeMessages.pumpingRisk;

  let decision = lineTypeOk
    ? `Line type "${type}" (${lti.carrier_name || 'unknown carrier'}) is allowed.`
    : `Line type "${type}" is not allowed → blocked.`;
  if (pumping) {
    decision += pumping.blocked
      ? ` SMS Pumping Risk ${pumping.score}/100 ("${pumping.category}"${spr.number_blocked ? ', currently blocked by Fraud Guard' : ''}) → blocked.`
      : ` SMS Pumping Risk ${pumping.score}/100 ("${pumping.category}") is below ${blockScore} → fine.`;
  } else if (spr && spr.error_code) {
    decision += ` SMS Pumping Risk returned error ${spr.error_code} → ignored.`;
  }
  decision += allowed ? ' → OK to send a code.' : ' No SMS sent, no cost incurred.';

  if (withPumpingRisk && spr) {
    const extra = "SMS Pumping Risk came back in the same request as the line type: one call, no extra round trip (each data package is billed). Twilio built it for international pumping; US numbers like Leo's rarely score high.";
    note = note ? `${note}. ${extra}` : extra;
  }

  return {
    allowed,
    type,
    customerMessage,
    entries: [entry({
      title: withPumpingRisk ? 'Checked line type and SMS pumping risk before sending a code' : 'Checked line type before sending a code',
      mode,
      api: LTI_API.replace('{phone}', phone).replace('{fields}', fields),
      request: { PhoneNumber: phone, Fields: fields },
      response,
      decision,
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

// -----------------------------------------------------------------------------
// Reassigned Number: does Leo's number still belong to Leo?
// US carriers recycle disconnected numbers. If Leo dropped his number and it
// went to someone else, a code texted to it reaches a stranger. We ask the
// FCC's reassigned-numbers data whether the number changed owners since
// LastVerifiedDate (the day Leo proved he held it, at sign-up).
//
// US only. Needs carrier approval, so SIMULATED by default; if switched to LIVE
// and anything goes wrong, we fall back to simulated so checkout never stalls.
// Returns { reassigned, answer, entries }.
// -----------------------------------------------------------------------------
const RN_API = 'GET https://lookups.twilio.com/v2/PhoneNumbers/{phone}?Fields=reassigned_number&LastVerifiedDate={date}';

async function checkReassignedNumber(phone, verifiedAt) {
  let { mode, why } = tw.modeFor('reassignedNumber');
  let note = why;
  let response;
  const scenario = state.settings.scenarios.reassignedNumber;
  // The API wants the date as YYYYMMDD.
  const lastVerifiedDate = new Date(verifiedAt || Date.now()).toISOString().slice(0, 10).replace(/-/g, '');

  if (!phone.startsWith('+1')) {
    return {
      reassigned: false,
      answer: 'not_checked',
      entries: [entry({
        title: 'Skipped the Reassigned Number check',
        mode: 'APP',
        decision: 'Not a US number → Reassigned Number doesn\'t apply (it uses US FCC data).',
        phones: [phone],
      })],
    };
  }

  if (scenario) {
    mode = 'SIMULATED';
    note = 'Scenario switch: pretending this number now belongs to someone else';
  }

  if (mode === 'LIVE') {
    try {
      const result = await tw.client.lookups.v2.phoneNumbers(phone).fetch({ fields: 'reassigned_number', lastVerifiedDate });
      response = toApiShape(result);
      const rn = response.reassigned_number;
      if (!rn || rn.error_code || !rn.is_number_reassigned) {
        mode = 'SIMULATED';
        note = `Live Reassigned Number returned no data (${rn && rn.error_code ? 'error ' + rn.error_code : 'no access yet'}); fell back to simulated`;
      }
    } catch (err) {
      mode = 'SIMULATED';
      note = `Live Reassigned Number failed (${err.code || err.message}); fell back to simulated`;
    }
  }

  if (mode === 'SIMULATED') {
    const shownDate = `${lastVerifiedDate.slice(0, 4)}-${lastVerifiedDate.slice(4, 6)}-${lastVerifiedDate.slice(6)}`;
    response = sim.lookupReassignedNumber(phone, shownDate, scenario ? 'yes' : 'no');
  }

  const answer = response.reassigned_number.is_number_reassigned;
  const reassigned = answer === 'yes';

  return {
    reassigned,
    answer,
    entries: [entry({
      title: 'Checked that Leo\'s number hasn\'t changed owners',
      mode,
      api: RN_API.replace('{phone}', phone).replace('{date}', lastVerifiedDate),
      request: { PhoneNumber: phone, Fields: 'reassigned_number', LastVerifiedDate: lastVerifiedDate },
      response,
      decision: reassigned
        ? 'is_number_reassigned "yes" → this number belongs to someone else now. Don\'t text it a code.'
        : answer === 'no'
          ? 'is_number_reassigned "no" → still Leo\'s number since he verified it. Safe to text.'
          : `is_number_reassigned "${answer}" → no data; carry on, but don't rely on this number alone for big changes.`,
      note: note || 'Leo is back months after sign-up. US only; uses the FCC reassigned-numbers database (updated monthly). Needs carrier approval.',
      phones: [phone],
    })],
  };
}

// -----------------------------------------------------------------------------
// Line Status: is this number switched on and connected right now?
// Skips disconnected numbers (inactive) and phones that are off or out of
// coverage (unreachable) before we pay to text them a code.
//
// Public beta; coverage varies by network. SIMULATED by default. If LIVE and
// Twilio can't say (error or "unknown"), we don't block.
// Returns { status, blocked, customerMessage, entries }.
// -----------------------------------------------------------------------------
const LS_API = 'GET https://lookups.twilio.com/v2/PhoneNumbers/{phone}?Fields=line_status';

const LINE_STATUS_MESSAGES = {
  inactive: "This number doesn't seem to be in service. Please check it and try again.",
  unreachable: "We couldn't reach this phone just now. Please make sure it's switched on and has signal, then try again.",
};

async function checkLineStatus(phone) {
  let { mode, why } = tw.modeFor('lineStatus');
  let note = why;
  let response;
  const override = state.settings.scenarios.lineStatusOverride;

  if (override && override !== 'none') {
    mode = 'SIMULATED';
    note = `Scenario switch: pretending this number is "${override}"`;
  }

  if (mode === 'LIVE') {
    try {
      const result = await tw.client.lookups.v2.phoneNumbers(phone).fetch({ fields: 'line_status' });
      response = toApiShape(result);
    } catch (err) {
      mode = 'SIMULATED';
      note = `Live Line Status failed (${err.code || err.message}); fell back to simulated`;
    }
  }

  if (mode === 'SIMULATED') {
    response = sim.lookupLineStatus(phone, override && override !== 'none' ? override : 'reachable');
  }

  const ls = response.line_status || {};
  const status = String(ls.status || 'unknown').toLowerCase();
  const blocked = !ls.error_code && config.contactChange.blockedLineStatuses.includes(status);

  return {
    status,
    blocked,
    customerMessage: blocked ? LINE_STATUS_MESSAGES[status] || LINE_STATUS_MESSAGES.inactive : null,
    entries: [entry({
      title: 'Checked the new number is switched on (Line Status)',
      mode,
      api: LS_API.replace('{phone}', phone),
      request: { PhoneNumber: phone, Fields: 'line_status' },
      response,
      decision: ls.error_code
        ? `No status (error ${ls.error_code}) → not blocked; coverage varies by network.`
        : blocked
          ? `Status "${status}" → a code would never arrive. Blocked before paying to send it.`
          : `Status "${status}" → OK to send a code.`,
      note: note || 'Public beta; coverage varies by network, so "unknown" never blocks.',
      phones: [phone],
    })],
  };
}

module.exports = { checkLineType, checkIdentityMatch, checkSimSwap, checkReassignedNumber, checkLineStatus };
