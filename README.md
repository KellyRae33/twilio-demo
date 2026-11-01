# Twill: Trust & Identity customer journey demo (public version)

A demo storefront for **Twill**, a fictional global kitchenware retailer. It follows **Leo**, an aspiring baking influencer, through five moments where trust and identity matter. On the right, a **Behind the scenes** panel shows every step: the Twilio API involved, the request, the JSON response, and the decision the app made.

**This public copy never calls Twilio.** It has no credentials, and every Twilio step returns a **SIMULATED** response in the same JSON shape the real API returns. Verification codes appear on screen instead of being texted. Steps tagged **APP** are the demo's own server logic. (The presenter runs a separate copy that makes real Lookup and Verify calls.)

> Built with AI-assisted development (Claude Code).

## Try it

1. Click **Fill Leo's details** in the demo controls (gear icon, top right, or the **`** key), or type your own details. Any phone number works; nothing is sent.
2. Walk through the five beats in the progress bar: **Sign-up → Checkout → Contact change → Loyalty → Promo surge**. You can jump to any beat; Leo's account is filled in for you.
3. In Beat 1, choose a **passkey** (your browser's real passkey prompt: Windows Hello, Face ID, Touch ID, a fingerprint or your phone; this server checks the signature) or an authenticator app. You can scan the QR code with a real authenticator app (Google Authenticator, Authy, 1Password…). It works, because simulated TOTP uses the same standard (RFC 6238). Or use the code shown in the demo controls.
4. Try the **scenarios** in the demo controls: a VoIP or premium-rate number at sign-up, a partial or no Identity Match, a recent SIM swap or a reassigned number at checkout, or an inactive new number in Beat 3.

Each browser gets its own copy of the story, so several people can try it at once. Copies are forgotten after 2 hours idle, and when the server restarts.

| Beat | What it shows |
|---|---|
| 1. Sign-up | One Lookup request (line type + SMS Pumping Risk) blocks VoIP, premium and high-risk numbers before any SMS; Verify SMS; Lookup Identity Match sets a trust level; Leo chooses a passkey (Verify Passkeys) or an authenticator app (Verify TOTP) |
| 2. Checkout | Risk rules (large order, new device, new address); silent SIM Swap and Reassigned Number checks; then a Verify SMS code, or the passkey/authenticator after a SIM swap or a reassigned number |
| 3. Contact change | Proof from an existing factor only (passkey, authenticator, or SMS to the current number); SIM Swap; Lookup line type + Line Status + Verify on the new number; alerts to the old contacts |
| 4. Loyalty | Small redemptions go straight through; big ones need the passkey or a TOTP step-up |
| 5. Promo surge | Duplicate check, Lookup line type, Line Status, Fraud Guard prefix block, and the SMS spend avoided (placeholder costs) |

## Run it locally

You need Node.js 18 or newer. No `.env` or Twilio account is needed.

```bash
npm install
npm start
```

Open http://localhost:3000.

## Publish it (Render)

1. Push this folder to a GitHub repository (public or private).
2. On [render.com](https://render.com), choose **New → Blueprint** and pick the repository. `render.yaml` sets everything up: a free Node web service that runs `npm install` and `npm start`. (Or choose **New → Web Service** with those two commands.)
3. Share the `…onrender.com` link. No environment variables or secrets are needed.

The free plan sleeps after about 15 minutes without visitors; the next visit takes up to a minute to wake it. Open the link yourself shortly before sharing it.

## Configuration

Thresholds, placeholder costs, allowed line types, rate limits and how long visitor copies are kept live in **`config.js`**.

## File map

```
twill-demo-public/
├── server.js              Starts Express, serves the storefront, mounts API routes
├── config.js              Every threshold, cost and default
├── routes/
│   ├── signup.js          Beat 1 endpoints
│   ├── passkey.js         Passkey set-up and step-up prompts (Beats 1–4)
│   ├── checkout.js        Beat 2 endpoints and risk rules
│   ├── contact.js         Beat 3 endpoints
│   ├── loyalty.js         Beat 4 endpoints
│   ├── promo.js           Beat 5: fake sign-up burst and defences
│   └── presenter.js       Status, scenario settings, reset
├── src/
│   ├── twilio.js          Always SIMULATED in this copy (no Twilio client)
│   ├── lookup.js          Lookup v2: Line Type (+ SMS Pumping Risk), Identity Match, SIM Swap, Reassigned Number, Line Status
│   ├── catalog.js         Products and server-side pricing
│   ├── seed.js            Fills in Leo's account when jumping ahead
│   ├── verify.js          Verify SMS send/check, TOTP factor create/verify, TOTP challenges
│   ├── passkeys.js        Verify Passkeys (simulated API, real browser passkey + signature check)
│   ├── simulated.js       Fake responses in Twilio's exact JSON shapes
│   ├── totpLocal.js       Offline TOTP math (for simulated mode)
│   ├── rateLimit.js       Our own send-code rate limit
│   ├── errors.js          Twilio error codes → friendly messages
│   ├── panel.js           Builds panel entries, masks phone numbers and secrets
│   ├── phone.js           E.164 normalization
│   └── state.js           In-memory "database", one copy per visitor
└── public/
    ├── index.html         Layout: journey bar, stage, panel, demo controls drawer
    ├── css/styles.css
    └── js/
        ├── api.js         Browser → our server (never → Twilio)
        ├── passkey.js     Browser side of passkeys (navigator.credentials)
        ├── panel.js       Draws the Behind-the-scenes log
        ├── journey.js     Progress bar and beat navigation
        ├── presenter.js   Demo controls drawer
        ├── ui.js          Shared storefront pieces (frames, SMS toast)
        └── beats/         One file per beat
```

## How it works (one paragraph, describing the live version)

The storefront in the browser never talks to Twilio. It calls our small Node.js/Express server, which holds the Twilio credentials and makes every API call with Twilio's official Node helper library. When Leo signs up, the server first applies its own rate limit, then calls **Lookup v2 Line Type Intelligence** to learn whether the number is a real mobile line, with the **SMS Pumping Risk Score** in the same request. VoIP, premium-rate, landline and other risky types, and high-risk numbers, are blocked before any SMS is sent, so they cost nothing. Only then does **Verify** send and check the SMS code. Once the code is approved, **Lookup Identity Match** compares the carrier's records for that phone with the name and address Leo entered, and the result sets a trust level (high, medium or low) without ever blocking sign-up. Leo then chooses a second factor that doesn't depend on the phone network: a **passkey** (Verify Passkeys; the browser's real passkey prompt, with this server checking the signature because the API part is simulated) or an authenticator app (**Verify TOTP**). Later beats use whichever he chose for step-up checks. Each step returns two things: a result for the storefront, and a panel entry that shows the API call, the response JSON, and the decision in plain English. At checkout in the mobile app, the server prices the order itself and checks simple risk rules (large total, new device, new shipping address). If none fire, the order goes straight through. If any fire, it silently runs **SIM Swap** and **Reassigned Number** checks and then holds the order for a code. Normally that's a **Verify SMS** code to his phone. If the SIM changed recently, or the number now belongs to someone else, it asks for his passkey or authenticator instead, because the text could reach an attacker or a stranger. When Leo changes his email and phone, nothing is saved until he proves it's him with a factor he **already** had: an authenticator code, or an SMS to his **current** number. The current number is offered only if a silent SIM Swap check is clean, and the new number is never accepted as proof. The new number then goes through the same line-type check as sign-up, plus **Line Status** (no code to a disconnected or switched-off number), and SMS verification, and alerts go to his old email and phone. When Leo redeems reward points, small redemptions go straight through, while anything above a configurable threshold needs his passkey or a **Verify TOTP challenge**, because points are as good as cash. The panel notes that the passkey makes this step-up phishing-resistant. Finally, a promo launch attracts a burst of fake sign-ups, including a bot walking one international number range (SMS pumping). Each sign-up goes through a free duplicate check, then Lookup line type (live for a capped sample of at most 5, simulated for the rest), then Line Status, then a simulated Verify Fraud Guard prefix block, and only survivors get a (simulated) code. A dashboard counts what each layer blocked and the estimated SMS spend avoided, using placeholder costs. A per-check switch chooses between the real API and a simulated response in the same JSON shape, which keeps the demo working without Wi-Fi.
