// =============================================================================
// config.js — every number, threshold, cost and default for the demo lives here.
//
// Change values here (not in the code) to tune the story. Restart the server
// (Ctrl+C, then `npm start`) after editing.
// =============================================================================

module.exports = {
  // ---------------------------------------------------------------------------
  // PUBLIC DEMO: every Twilio check is simulated (see src/twilio.js), so these
  // are all false and the presenter controls don't offer LIVE switches.
  // The list still names each check, so the panel can show its mode.
  // ---------------------------------------------------------------------------
  liveByDefault: {
    lookupLineType: false, // Lookup v2 Line Type Intelligence
    identityMatch: false,  // Lookup v2 Identity Match
    verifySms: false,      // Verify: send + check SMS codes
    verifyTotp: false,     // Verify: TOTP factors and challenges
    simSwap: false,        // Lookup v2 SIM Swap
  },

  // Offline mode isn't needed: nothing here ever goes online.
  offlineModeByDefault: false,

  // ---------------------------------------------------------------------------
  // Each visitor gets their own copy of Leo's story, kept in server memory.
  // Copies nobody has used for this long are deleted, and the oldest are
  // dropped if there are more than maxVisitors at once.
  // ---------------------------------------------------------------------------
  visitors: {
    forgetAfterMinutes: 120,
    maxVisitors: 500,
  },

  // ---------------------------------------------------------------------------
  // Beat 1 — Sign-up: which phone line types may receive a verification SMS.
  // Anything NOT in this list is blocked before a code is sent.
  // Possible values from Lookup: mobile, landline, fixedVoip, nonFixedVoip,
  // personal, tollFree, premium, sharedCost, uan, voicemail, pager, unknown.
  // ---------------------------------------------------------------------------
  allowedLineTypes: ['mobile', 'personal', 'fixedVoip'],

  // Plain-English reason shown to the customer for each blocked line type.
  lineTypeMessages: {
    nonFixedVoip: "This looks like an internet-based (VoIP) number. For your security, please use a mobile number.",
    landline: "This looks like a landline, which can't receive text messages. Please use a mobile number.",
    premium: "We can't send codes to premium-rate numbers. Please use a mobile number.",
    tollFree: "We can't send codes to toll-free numbers. Please use a mobile number.",
    sharedCost: "We can't send codes to shared-cost numbers. Please use a mobile number.",
    default: "We couldn't confirm this is a mobile number. Please try a different number.",
  },

  // ---------------------------------------------------------------------------
  // Beat 1 — Identity Match: does the carrier's record for this phone match
  // the name and address Leo typed? Runs AFTER the SMS code is approved, so we
  // only pay for it on people who really hold the phone.
  // It never blocks sign-up (family plans, prepaid and recent moves cause
  // honest mismatches). It sets a trust level the later beats can use.
  // summary_score is 0–100, from first name, last name and address line.
  // ---------------------------------------------------------------------------
  identityMatch: {
    highTrustScore: 80,   // at or above: high trust
    mediumTrustScore: 40, // at or above: medium trust; below: low trust
  },

  // ---------------------------------------------------------------------------
  // Rate limiting on the "send code" endpoint (part of the toll-fraud story).
  // Applied by our own server BEFORE Twilio is ever called.
  // ---------------------------------------------------------------------------
  rateLimit: {
    windowMinutes: 10,
    maxSendsPerPhone: 5,  // per phone number, per window (a full demo run texts your phone 3 times)
    maxSendsPerClient: 10 // per browser/IP address, per window
  },

  // ---------------------------------------------------------------------------
  // Beat 2 — Checkout in the mobile app
  // No trigger fires: the order goes straight through.
  // ANY switched-on trigger fires: the server silently runs a SIM Swap check,
  // then asks Leo for a code before releasing the order:
  //   - SIM stable  → Verify SMS code to his phone
  //   - SIM swapped recently → authenticator app code (never SMS: his texts
  //     may be going to someone else)
  // ---------------------------------------------------------------------------
  checkout: {
    largeOrderThreshold: 500, // order totals above this (in USD) are "high value"
    triggers: {
      largeOrder: true,         // total above largeOrderThreshold
      newDevice: true,          // first order from this device (the Twill app)
      newShippingAddress: true, // shipping somewhere Leo hasn't shipped before
    },
    simSwapWindowHours: 48, // a SIM change within this window counts as "recent"
    // Leo's giveaway order (product id -> quantity). He can change it in the app.
    giveawayOrder: { tin: 6, pan: 4, bag: 10 },
    newAddress: { label: 'Studio', line1: '88 Foundry St, Unit 4', city: 'Portland', state: 'OR', postalCode: '97209' },
  },

  // ---------------------------------------------------------------------------
  // Beat 3 — Contact change (account takeover protection)
  // Leo's new business contact details, used by "Fill Leo's details".
  // ---------------------------------------------------------------------------
  contactChange: {
    newEmail: 'hello@leobakes.studio',
    fallbackNewPhone: '+15035550142', // fictional (555-01xx numbers are reserved for fiction)
  },

  // ---------------------------------------------------------------------------
  // Beat 4 — Loyalty redemption
  // Points are as good as cash, so stolen accounts get drained through rewards.
  // Small redemptions go straight through; big ones need the authenticator code.
  // ---------------------------------------------------------------------------
  loyalty: {
    startingPoints: 48000,        // Leo's balance before any orders in this demo
    stepUpThresholdPoints: 10000, // redemptions ABOVE this need a TOTP step-up
    rewards: [
      { id: 'credit10', name: '$10 store credit', points: 1000, icon: 'whisk' },
      { id: 'bag', name: 'Piping bag set', points: 2000, icon: 'pipingBag' },
      { id: 'pan', name: 'Rotating cake pan', points: 6000, icon: 'cakePan' },
      { id: 'mixer', name: 'Stand mixer', points: 42000, icon: 'standMixer' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Beat 5 — Promo surge
  // "Simulate launch" fires a burst of fake sign-ups at the promo. Each one goes
  // through: duplicate check → Lookup line type → Fraud Guard → send code.
  // PLACEHOLDER COSTS: illustrative only, not Twilio's real prices.
  // ---------------------------------------------------------------------------
  promo: {
    code: 'LEOBAKES20',
    // The mix of fake sign-ups (adds up to the batch size, 80).
    mix: {
      goodMobile: 30,        // real customers on mobiles
      duplicate: 8,          // someone re-using a number that already got the promo
      voip: 14,              // throwaway internet numbers
      premium: 6,            // premium-rate numbers (fraudster earns per text)
      sequentialPumping: 22, // +44 7700 900100, …101, …102: a bot walking one prefix
    },
    // Fraud Guard (simulated) lets the first few through on a new prefix, spots
    // the surge, then blocks the prefix.
    fraudGuardBlocksAfter: 3,
    // Real Lookup calls are capped to control cost. Only these numbers are
    // looked up LIVE (public example numbers from Twilio's docs); everything
    // else is simulated. Add your own up to the cap.
    maxLiveLookups: 5,
    liveSampleNumbers: ['+14159929960', '+15017122661'],
    placeholderCostPerSmsUSD: {
      domestic: 0.05,      // PLACEHOLDER
      international: 0.25, // PLACEHOLDER
      premium: 0.9,        // PLACEHOLDER
    },
    // Reassigned Number check (simulated) on Twill's existing opted-in US list
    // before texting them the promo.
    optedInUsListSize: 1200,
  },

  // ---------------------------------------------------------------------------
  // Leo's default details, so the presenter can pre-fill forms in one click.
  // All made up, including the phone number (nothing is ever texted).
  // ---------------------------------------------------------------------------
  leo: {
    name: 'Leo Marin',
    phone: '+15035550123',
    email: 'leo.marin@example.com',
    username: 'leobakes',
    country: 'US',
    addressLine1: '742 Larkspur Ave',
    city: 'Portland',
    state: 'OR',
    postalCode: '97214',
  },

  // Hide the middle digits of phone numbers in the "Behind the scenes" panel,
  // as a real app would (visitors may type their own number).
  maskPhoneNumbersInPanel: true,
};
