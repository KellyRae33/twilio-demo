// =============================================================================
// beats/signup.js — BEAT 1: Leo discovers Twill and creates an account.
//
// Screens, in order:
//   shop     → Leo adds bakeware to his cart and clicks Checkout
//   account  → sign-up form with consent checkboxes
//   code     → enter the SMS code (only sent if Lookup says the number is OK).
//              Once approved, the server also runs Identity Match (invisible to Leo).
//   totpIntro, totpScan → enroll an authenticator app as a second factor
//   done     → account ready, order placed
//
// All Twilio calls happen on the server (routes/signup.js).
// =============================================================================

(function () {
  const { ui } = Twill;

  const PRODUCTS = [
    { id: 'tin', name: '12-cup cupcake tin', price: 34, icon: 'cupcakeTin' },
    { id: 'pan', name: 'Rotating cake pan', price: 59, icon: 'cakePan' },
    { id: 'bag', name: 'Piping bag set', price: 18, icon: 'pipingBag' },
    { id: 'mixer', name: 'Stand mixer', price: 429, icon: 'standMixer' },
    { id: 'whisk', name: 'Balloon whisk', price: 14, icon: 'whisk' },
    { id: 'pin', name: 'French rolling pin', price: 29, icon: 'rollingPin' },
  ];
  const LEOS_PICKS = ['tin', 'pan', 'bag'];

  // What this beat remembers while it's on screen.
  let stage;
  let view;
  let cart;
  let form;        // last values typed in the sign-up form
  let phone;       // E.164 number returned by the server
  let blockedMsg;  // friendly message if Lookup blocked the number
  let qrDataUrl;

  function start(stageEl) {
    stage = stageEl;
    cart = [];
    form = {};
    phone = null;
    blockedMsg = null;
    qrDataUrl = null;
    show('shop');
  }

  function show(next) {
    view = next;
    stage.innerHTML = ui.webFrame(ui.storeNav(cart.length) + `<div class="store-main">${VIEWS[view]()}</div>`, URLS[view]);
    wire();
  }

  const URLS = {
    shop: 'twill.com/bakeware',
    account: 'twill.com/account/create',
    code: 'twill.com/account/verify',
    totpIntro: 'twill.com/account/security',
    totpScan: 'twill.com/account/security',
    done: 'twill.com/order/confirmed',
  };

  const total = () => cart.reduce((sum, id) => sum + PRODUCTS.find((p) => p.id === id).price, 0);
  const masked = (p) => (p ? '•••• ' + p.slice(-4) : '');
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------------------------------------------------------------------------
  // Screens (each returns HTML)
  // ---------------------------------------------------------------------------
  const VIEWS = {
    shop: () => `
      <h1>Bakeware</h1>
      <p class="sub">Professional tools for home bakers.</p>
      <div class="store-cols">
        <div class="products">
          ${PRODUCTS.map((p) => `
            <div class="product">
              <div class="product-img">${ui.icons[p.icon]}</div>
              <div class="product-info">
                <div class="product-name">${p.name}</div>
                <div class="product-price">${ui.money(p.price)}</div>
                <button class="btn btn-small ${cart.includes(p.id) ? 'btn-ghost' : ''}" data-add="${p.id}" ${cart.includes(p.id) ? 'disabled' : ''}>
                  ${cart.includes(p.id) ? 'In cart' : 'Add to cart'}
                </button>
              </div>
            </div>`).join('')}
        </div>
        ${cartSummary(true)}
      </div>`,

    account: () => `
      <div class="form-narrow">
        <div class="steps-mini"><span class="on"></span><span></span><span></span></div>
        <h1>Create your account</h1>
        <p class="sub">Save your cart, track orders and earn rewards on every purchase.</p>
        <form id="signup-form" novalidate>
          <div class="field-row">
            <div class="field"><label for="f-name">Full name</label><input id="f-name" name="name" autocomplete="off" value="${esc(form.name)}"></div>
            <div class="field"><label for="f-username">Username</label><input id="f-username" name="username" autocomplete="off" value="${esc(form.username)}"></div>
          </div>
          <div class="field"><label for="f-email">Email</label><input id="f-email" name="email" type="email" autocomplete="off" value="${esc(form.email)}"></div>
          <div class="field"><label for="f-address">Shipping address</label><input id="f-address" name="addressLine1" autocomplete="off" value="${esc(form.addressLine1)}"></div>
          <div class="field-row">
            <div class="field"><label for="f-city">City</label><input id="f-city" name="city" autocomplete="off" value="${esc(form.city)}"></div>
            <div class="field-row">
              <div class="field"><label for="f-region">State</label><input id="f-region" name="region" autocomplete="off" value="${esc(form.region)}"></div>
              <div class="field"><label for="f-postal">ZIP</label><input id="f-postal" name="postalCode" autocomplete="off" value="${esc(form.postalCode)}"></div>
            </div>
          </div>
          <div class="field"><label for="f-password">Password</label><input id="f-password" name="password" type="password" autocomplete="new-password" value="${esc(form.password)}"></div>
          <div class="field ${blockedMsg ? 'invalid' : ''}">
            <label for="f-phone">Mobile number</label>
            <div class="phone-row">
              <select name="country" aria-label="Country">${ui.countryOptions(form.country || 'US')}</select>
              <input id="f-phone" name="phone" type="tel" autocomplete="off" placeholder="(415) 555-0123" value="${esc(form.phone)}">
            </div>
          </div>
          ${blockedMsg ? `<div class="notice notice-warn">${esc(blockedMsg)}</div>` : ''}
          <label class="check"><input type="checkbox" name="consentAccount" ${form.consentAccount ? 'checked' : ''}>
            <span>I agree to receive account and security messages (such as verification codes) from Twill by SMS. <em>Required.</em></span></label>
          <label class="check"><input type="checkbox" name="consentMarketing" ${form.consentMarketing ? 'checked' : ''}>
            <span>Send me offers, recipes and new arrivals by SMS. Msg &amp; data rates may apply. Reply STOP to opt out.</span></label>
          <div id="form-error"></div>
          <button class="btn btn-block" type="submit" id="create-btn">Create account</button>
        </form>
      </div>`,

    code: () => `
      <div class="form-narrow">
        <div class="steps-mini"><span class="on"></span><span class="on"></span><span></span></div>
        <h1>Confirm your number</h1>
        <p class="sub">We sent a 6-digit code to ${masked(phone)}.</p>
        <form id="code-form" novalidate>
          <div class="field"><label for="f-code">Verification code</label>
            <input id="f-code" class="code-input" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
          <div id="form-error"></div>
          <button class="btn btn-block" type="submit" id="verify-btn">Verify</button>
        </form>
        <p class="muted center" style="margin-top:14px">
          Didn't get it? <a href="#" data-action="resend">Send a new code</a> · <a href="#" data-action="change-number">Use a different number</a>
        </p>
      </div>`,

    totpIntro: () => `
      <div class="form-narrow">
        <div class="steps-mini"><span class="on"></span><span class="on"></span><span class="on"></span></div>
        <div class="notice notice-ok">Phone number confirmed.</div>
        <h1>Protect your account</h1>
        <p class="sub">Add an authenticator app as a second way to sign in. We'll use it to confirm big orders, reward redemptions and account changes — even if you lose access to your phone number.</p>
        <div id="form-error"></div>
        <button class="btn btn-block" id="totp-start-btn">Set up authenticator app</button>
      </div>`,

    totpScan: () => `
      <div class="form-narrow center">
        <div class="steps-mini"><span class="on"></span><span class="on"></span><span class="on"></span></div>
        <h1>Scan this code</h1>
        <p class="sub">Open your authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…) and scan the QR code.</p>
        <img class="qr" src="${qrDataUrl}" width="220" height="220" alt="QR code for your authenticator app">
        <form id="totp-form" novalidate style="text-align:left">
          <div class="field"><label for="f-totp">Enter the 6-digit code from the app</label>
            <input id="f-totp" class="code-input" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
          <div id="form-error"></div>
          <button class="btn btn-block" type="submit" id="totp-verify-btn">Finish setup</button>
        </form>
      </div>`,

    done: () => `
      <div class="form-narrow center">
        <div class="big-check">✓</div>
        <h1>Welcome to Twill, ${esc((form.name || 'Leo').split(' ')[0])}</h1>
        <p class="sub">Your account is protected with a verified phone number and an authenticator app.</p>
        <div class="card" style="text-align:left">
          <h2>Order confirmed</h2>
          ${cart.map((id) => { const p = PRODUCTS.find((x) => x.id === id); return `<div class="summary-line"><span>${p.name}</span><span>${ui.money(p.price)}</span></div>`; }).join('')}
          <div class="summary-line total"><span>Total</span><span>${ui.money(total())}</span></div>
          <p class="muted">+${Math.round(total() * 10).toLocaleString('en-US')} reward points earned</p>
        </div>
      </div>`,
  };

  function cartSummary(withCheckout) {
    return `
      <div class="card">
        <h2>Your cart</h2>
        ${cart.length
          ? cart.map((id) => { const p = PRODUCTS.find((x) => x.id === id); return `<div class="cart-item"><span class="thumb">${ui.icons[p.icon]}</span><span>${p.name}</span><span>${ui.money(p.price)}</span></div>`; }).join('')
          : '<p class="empty-cart">Your cart is empty.</p>'}
        <div class="summary-line total"><span>Subtotal</span><span>${ui.money(total())}</span></div>
        ${withCheckout ? `<button class="btn btn-block" id="checkout-btn" ${cart.length ? '' : 'disabled'}>Checkout</button>` : ''}
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Button and form handlers for whichever screen is showing
  // ---------------------------------------------------------------------------
  function showError(message) {
    const el = document.getElementById('form-error');
    if (el) el.innerHTML = message ? `<div class="notice notice-warn">${esc(message)}</div>` : '';
  }

  function wire() {
    stage.querySelectorAll('[data-add]').forEach((btn) =>
      btn.addEventListener('click', () => { cart.push(btn.dataset.add); show('shop'); }));

    const checkout = document.getElementById('checkout-btn');
    if (checkout) checkout.addEventListener('click', () => show('account'));

    const signupForm = document.getElementById('signup-form');
    if (signupForm) signupForm.addEventListener('submit', onCreateAccount);

    const codeForm = document.getElementById('code-form');
    if (codeForm) {
      codeForm.addEventListener('submit', onCheckCode);
      document.getElementById('f-code').focus();
    }

    const totpStart = document.getElementById('totp-start-btn');
    if (totpStart) totpStart.addEventListener('click', onTotpStart);

    const totpForm = document.getElementById('totp-form');
    if (totpForm) {
      totpForm.addEventListener('submit', onTotpVerify);
      document.getElementById('f-totp').focus();
    }

    stage.querySelectorAll('[data-action]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      if (a.dataset.action === 'resend') sendCode();
      if (a.dataset.action === 'change-number') { blockedMsg = null; show('account'); }
    }));
  }

  // Step 1: save the account + consent, then ask the server to send a code.
  async function onCreateAccount(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    form = {
      name: fd.get('name').trim(),
      username: fd.get('username').trim(),
      email: fd.get('email').trim(),
      password: fd.get('password'),
      addressLine1: fd.get('addressLine1').trim(),
      city: fd.get('city').trim(),
      region: fd.get('region').trim(),
      postalCode: fd.get('postalCode').trim(),
      country: fd.get('country'),
      phone: fd.get('phone').trim(),
      consentAccount: fd.get('consentAccount') === 'on',
      consentMarketing: fd.get('consentMarketing') === 'on',
    };

    const btn = document.getElementById('create-btn');
    ui.busy(btn, true, 'Creating account…');
    const res = await Twill.post('/api/signup/account', form);
    if (!res.ok) { ui.busy(btn, false); return showError(res.data.error); }
    phone = res.data.phone;

    ui.busy(btn, true, 'Checking your number…');
    await sendCode(btn);
  }

  // Step 2: server checks rate limit → Lookup line type → sends SMS via Verify.
  async function sendCode(btn) {
    const res = await Twill.post('/api/signup/send-code');
    if (btn) ui.busy(btn, false);

    if (res.data.blocked) {
      // Lookup said this isn't a safe number to text. No SMS was sent.
      blockedMsg = res.data.error;
      return show('account');
    }
    if (!res.ok) return showError(res.data.error); // e.g. rate limit, trial account

    blockedMsg = null;
    if (view !== 'code') show('code');
    if (res.data.simulatedCode) ui.smsToast(`Your Twill verification code is: ${res.data.simulatedCode}`);
  }

  // Step 3: check the code Leo typed.
  async function onCheckCode(e) {
    e.preventDefault();
    const code = new FormData(e.target).get('code').trim();
    const btn = document.getElementById('verify-btn');
    ui.busy(btn, true, 'Checking…');
    const res = await Twill.post('/api/signup/check-code', { code });
    ui.busy(btn, false);
    if (!res.ok) return showError(res.data.error);
    show('totpIntro');
  }

  // Step 4: create the TOTP factor and show the QR code.
  async function onTotpStart() {
    const btn = document.getElementById('totp-start-btn');
    ui.busy(btn, true, 'Preparing…');
    const res = await Twill.post('/api/signup/totp/start');
    ui.busy(btn, false);
    if (!res.ok) return showError(res.data.error);
    qrDataUrl = res.data.qrDataUrl;
    show('totpScan');
  }

  // Step 5: confirm the first code from the app.
  async function onTotpVerify(e) {
    e.preventDefault();
    const code = new FormData(e.target).get('code').trim();
    const btn = document.getElementById('totp-verify-btn');
    ui.busy(btn, true, 'Checking…');
    const res = await Twill.post('/api/signup/totp/verify', { code });
    ui.busy(btn, false);
    if (!res.ok) return showError(res.data.error);
    show('done');
    Twill.journey.complete('signup');
  }

  // Presenter shortcut: fill in Leo's details on the current screen.
  function fillLeo(leo) {
    if (view === 'shop') {
      cart = [...LEOS_PICKS];
      return show('shop');
    }
    if (view === 'account') {
      form = {
        name: leo.name, username: leo.username, email: leo.email, password: 'CakeLover!2026',
        addressLine1: leo.addressLine1, city: leo.city, region: leo.state, postalCode: leo.postalCode,
        country: leo.country, phone: leo.phone || form.phone || '', consentAccount: true, consentMarketing: true,
      };
      show('account');
    }
  }

  Twill.journey.register({ id: 'signup', label: 'Sign-up', render: start, fillLeo });
})();
