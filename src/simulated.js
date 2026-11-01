// =============================================================================
// simulated.js — realistic fake Twilio responses.
//
// Used when a check is set to SIMULATED (or Offline mode is on). Each function
// returns JSON in the same shape as the real API, copied from Twilio's docs,
// so the panel looks the same either way. Nothing here calls the internet.
// =============================================================================

const crypto = require('crypto');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

const ACCOUNT_SID = 'AC' + 'x'.repeat(32);
const SERVICE_SID = 'VA' + 'x'.repeat(32); // placeholder: the public demo has no Verify Service

// A random Twilio-style ID, e.g. sid('VE') -> "VE3f9a…" (34 characters).
function sid(prefix) {
  return prefix + crypto.randomBytes(16).toString('hex');
}

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// Example carriers for each line type, so the fake data reads naturally.
const CARRIERS = {
  mobile: { carrier_name: 'T-Mobile USA, Inc.', mobile_country_code: '310', mobile_network_code: '260' },
  nonFixedVoip: { carrier_name: 'Bandwidth/13 - Bandwidth.com - SVR', mobile_country_code: '313', mobile_network_code: '981' },
  fixedVoip: { carrier_name: 'Comcast IP Phone, LLC', mobile_country_code: null, mobile_network_code: null },
  landline: { carrier_name: 'AT&T Corp.', mobile_country_code: null, mobile_network_code: null },
  premium: { carrier_name: 'Premium Rate Services Ltd', mobile_country_code: null, mobile_network_code: null },
};

// The basic Lookup v2 fields every response contains.
function lookupBase(phone) {
  const parsed = parsePhoneNumberFromString(phone);
  return {
    calling_country_code: parsed ? parsed.countryCallingCode : null,
    country_code: parsed ? parsed.country || null : null,
    phone_number: phone,
    national_format: parsed ? parsed.formatNational() : null,
    valid: parsed ? parsed.isValid() : false,
    validation_errors: null,
    caller_name: null,
    sim_swap: null,
    call_forwarding: null,
    line_status: null,
    line_type_intelligence: null,
    identity_match: null,
    reassigned_number: null,
    sms_pumping_risk: null,
    phone_number_quality_score: null,
    pre_fill: null,
    url: `https://lookups.twilio.com/v2/PhoneNumbers/${phone}`,
  };
}

// GET /v2/PhoneNumbers/{phone}?Fields=line_type_intelligence
function lookupLineType(phone, type = 'mobile') {
  return {
    ...lookupBase(phone),
    line_type_intelligence: {
      error_code: null,
      ...(CARRIERS[type] || { carrier_name: null, mobile_country_code: null, mobile_network_code: null }),
      type,
    },
  };
}

// GET /v2/PhoneNumbers/{phone}?Fields=identity_match&FirstName=…&LastName=…&AddressLine1=…
// level: 'strong' | 'partial' | 'noMatch'. Scores follow Twilio's documented
// table (all three of first/last/address positive = 100, names only = 40, none = 0).
const IDENTITY_RESULTS = {
  strong: {
    first_name_match: 'exact_match', last_name_match: 'exact_match', address_lines_match: 'high_partial_match',
    city_match: 'exact_match', state_match: 'exact_match', postal_code_match: 'exact_match',
    address_country_match: 'exact_match', summary_score: 100,
  },
  partial: {
    first_name_match: 'high_partial_match', last_name_match: 'exact_match', address_lines_match: 'no_match',
    city_match: 'no_match', state_match: 'exact_match', postal_code_match: 'no_match',
    address_country_match: 'exact_match', summary_score: 40,
  },
  noMatch: {
    first_name_match: 'no_match', last_name_match: 'no_match', address_lines_match: 'no_match',
    city_match: 'no_match', state_match: 'no_match', postal_code_match: 'no_match',
    address_country_match: 'exact_match', summary_score: 0,
  },
};

function lookupIdentityMatch(phone, level = 'strong') {
  return {
    ...lookupBase(phone),
    identity_match: {
      ...IDENTITY_RESULTS[level],
      national_id_match: null, // only returned to customers who completed Twilio KYC
      date_of_birth_match: 'no_data_available',
      error_code: null,
      error_message: null,
    },
  };
}

// GET /v2/PhoneNumbers/{phone}?Fields=sms_pumping_risk   (Beat 5)
function lookupSmsPumpingRisk(phone, score) {
  return {
    ...lookupBase(phone),
    sms_pumping_risk: {
      carrier_risk_category: score >= 75 ? 'high' : score >= 50 ? 'moderate' : score >= 25 ? 'mild' : 'low',
      number_blocked: score >= 90,
      number_blocked_date: null,
      number_blocked_last_3_months: score >= 90,
      sms_pumping_risk_score: score,
      error_code: null,
    },
  };
}

// GET /v2/PhoneNumbers/{phone}?Fields=line_status   (Beats 3 and 5; public beta)
// status: 'active' | 'reachable' | 'unreachable' | 'inactive' | 'unknown'
function lookupLineStatus(phone, status = 'reachable') {
  return {
    ...lookupBase(phone),
    line_status: { status, error_code: null },
  };
}

// GET /v2/PhoneNumbers/{phone}?Fields=reassigned_number&LastVerifiedDate=YYYYMMDD   (Beats 2 and 5)
// answer: 'yes' | 'no' | 'no_data_available'
function lookupReassignedNumber(phone, lastVerifiedDate, answer) {
  return {
    ...lookupBase(phone),
    reassigned_number: {
      last_verified_date: lastVerifiedDate, // e.g. "2025-11-28"
      is_number_reassigned: answer,
      error_code: null,
    },
  };
}

// The error Verify returns when Fraud Guard blocks a send.   (Beat 5)
function fraudGuardBlocked() {
  return {
    code: 60410,
    message: 'Verification delivery attempt blocked',
    more_info: 'https://www.twilio.com/docs/errors/60410',
  };
}

// GET /v2/PhoneNumbers/{phone}?Fields=sim_swap   (used in Stage 2)
function lookupSimSwap(phone, swappedRecently, windowHours = 48) {
  const swapDate = swappedRecently
    ? new Date(Date.now() - 6 * 3600 * 1000) // 6 hours ago
    : new Date(Date.now() - 400 * 24 * 3600 * 1000); // over a year ago
  return {
    ...lookupBase(phone),
    sim_swap: {
      last_sim_swap: {
        last_sim_swap_date: swapDate.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        swapped_period: `PT${windowHours}H`,
        swapped_in_period: Boolean(swappedRecently),
      },
      carrier_name: CARRIERS.mobile.carrier_name,
      mobile_country_code: CARRIERS.mobile.mobile_country_code,
      mobile_network_code: CARRIERS.mobile.mobile_network_code,
      error_code: null,
    },
  };
}

// POST /v2/Services/{ServiceSid}/Verifications
function verificationCreate(phone) {
  const verificationSid = sid('VE');
  return {
    sid: verificationSid,
    service_sid: SERVICE_SID,
    account_sid: ACCOUNT_SID,
    to: phone,
    channel: 'sms',
    status: 'pending',
    valid: false,
    date_created: now(),
    date_updated: now(),
    lookup: {},
    amount: null,
    payee: null,
    send_code_attempts: [{ attempt_sid: sid('VL'), channel: 'SMS', time: now() }],
    sna: null,
    url: `https://verify.twilio.com/v2/Services/${SERVICE_SID}/Verifications/${verificationSid}`,
  };
}

// POST /v2/Services/{ServiceSid}/VerificationCheck
function verificationCheck(phone, approved) {
  return {
    sid: sid('VE'),
    service_sid: SERVICE_SID,
    account_sid: ACCOUNT_SID,
    to: phone,
    channel: 'sms',
    status: approved ? 'approved' : 'pending',
    valid: approved,
    amount: null,
    payee: null,
    sna_attempts_error_codes: [],
    date_created: now(),
    date_updated: now(),
  };
}

// POST /v2/Services/{ServiceSid}/Entities/{Identity}/Factors  (factor_type=totp)
function factorCreate(identity, secret, bindingUri, friendlyName) {
  const factorSid = sid('YF');
  return {
    sid: factorSid,
    account_sid: ACCOUNT_SID,
    service_sid: SERVICE_SID,
    entity_sid: sid('YE'),
    identity,
    binding: { secret, uri: bindingUri },
    options: null,
    date_created: now(),
    date_updated: now(),
    friendly_name: friendlyName,
    status: 'unverified',
    factor_type: 'totp',
    config: { alg: 'sha1', skew: 1, code_length: 6, time_step: 30 },
    metadata: null,
    url: `https://verify.twilio.com/v2/Services/${SERVICE_SID}/Entities/${identity}/Factors/${factorSid}`,
  };
}

// POST /v2/Services/{ServiceSid}/Entities/{Identity}/Factors/{FactorSid}  (AuthPayload=code)
function factorVerify(identity, factorSid, verified, friendlyName) {
  return {
    sid: factorSid,
    account_sid: ACCOUNT_SID,
    service_sid: SERVICE_SID,
    entity_sid: sid('YE'),
    identity,
    date_created: now(),
    date_updated: now(),
    friendly_name: friendlyName,
    status: verified ? 'verified' : 'unverified',
    factor_type: 'totp',
    config: { alg: 'sha1', skew: 1, code_length: 6, time_step: 30 },
    metadata: null,
    url: `https://verify.twilio.com/v2/Services/${SERVICE_SID}/Entities/${identity}/Factors/${factorSid}`,
  };
}

// POST /v2/Services/{ServiceSid}/Entities/{Identity}/Challenges  (used in Stages 2–4)
function challengeCreate(identity, factorSid, approved, message) {
  const challengeSid = sid('YC');
  return {
    sid: challengeSid,
    account_sid: ACCOUNT_SID,
    service_sid: SERVICE_SID,
    entity_sid: sid('YE'),
    identity,
    factor_sid: factorSid,
    date_created: now(),
    date_updated: now(),
    date_responded: now(),
    expiration_date: new Date(Date.now() + 5 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    status: approved ? 'approved' : 'pending',
    responded_reason: 'none',
    details: { message: message || null, date: now(), fields: [] },
    hidden_details: null,
    metadata: null,
    factor_type: 'totp',
    url: `https://verify.twilio.com/v2/Services/${SERVICE_SID}/Entities/${identity}/Challenges/${challengeSid}`,
  };
}

// -----------------------------------------------------------------------------
// Verify Passkeys (all under /v2/Services/{ServiceSid}/Passkeys/...)
// `options` is what the browser hands to navigator.credentials.create()/get().
// -----------------------------------------------------------------------------

// POST /Passkeys/Factors
function passkeyFactorCreate(identity, factorSid, relyingParty, options) {
  return {
    sid: factorSid,
    account_sid: ACCOUNT_SID,
    service_sid: SERVICE_SID,
    entity_sid: sid('YE'),
    identity,
    binding: null,
    options,
    status: 'unverified',
    factor_type: 'passkeys',
    friendly_name: 'Twill account',
    config: {
      relying_party: relyingParty,
      authenticator_attachment: 'any',
      discoverable_credentials: 'preferred',
      user_verification: 'preferred',
    },
    metadata: null,
    date_created: now(),
    date_updated: now(),
    url: `https://verify.twilio.com/v2/Services/${SERVICE_SID}/Passkeys/Factors/${factorSid}`,
  };
}

// POST /Passkeys/VerifyFactor
function passkeyFactorVerify(identity, factorSid, relyingParty, verified) {
  return {
    sid: factorSid,
    account_sid: ACCOUNT_SID,
    service_sid: SERVICE_SID,
    entity_sid: sid('YE'),
    identity,
    status: verified ? 'verified' : 'unverified',
    factor_type: 'passkeys',
    friendly_name: 'Twill account',
    config: { relying_party: relyingParty },
    metadata: null,
    date_created: now(),
    date_updated: now(),
    url: `https://verify.twilio.com/v2/Services/${SERVICE_SID}/Passkeys/Factors/${factorSid}`,
  };
}

// POST /Passkeys/Challenges (status "pending", with options) and
// POST /Passkeys/ApproveChallenge (status "approved" or "denied")
function passkeyChallenge(identity, factorSid, status, options = null) {
  const challengeSid = sid('YC');
  return {
    sid: challengeSid,
    account_sid: ACCOUNT_SID,
    service_sid: SERVICE_SID,
    entity_sid: sid('YE'),
    identity,
    factor_sid: factorSid,
    factor_type: 'passkeys',
    status,
    responded_reason: 'none',
    options,
    details: null,
    hidden_details: null,
    metadata: null,
    date_created: now(),
    date_updated: now(),
    date_responded: status === 'pending' ? null : now(),
    expiration_date: new Date(Date.now() + 5 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    url: `https://verify.twilio.com/v2/Services/${SERVICE_SID}/Passkeys/Challenges/${challengeSid}`,
  };
}

module.exports = {
  lookupLineType,
  lookupIdentityMatch,
  lookupSimSwap,
  lookupSmsPumpingRisk,
  lookupReassignedNumber,
  lookupLineStatus,
  fraudGuardBlocked,
  verificationCreate,
  verificationCheck,
  factorCreate,
  factorVerify,
  challengeCreate,
  passkeyFactorCreate,
  passkeyFactorVerify,
  passkeyChallenge,
};
