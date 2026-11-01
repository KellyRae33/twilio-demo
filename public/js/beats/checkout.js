// =============================================================================
// beats/checkout.js — BEAT 2: Leo orders giveaway prizes in the Twill app.
//
// Screens (inside a phone frame):
//   bag     → quantities, ship-to (Home or a new Studio address), Place order
//   placing → spinner while the server runs its checks (Leo sees nothing else)
//   stepUp  → only if a risk rule fired: enter a code. By SMS normally; Leo's
//             passkey or authenticator app if the SIM was swapped recently or
//             the number now belongs to someone else
//   done    → order confirmed
//
// All decisions happen on the server (routes/checkout.js).
// =============================================================================

(function () {
  const { ui } = Twill;
  const DEVICE_ID = 'twill-app-iphone'; // the phone Leo is using now

  let stage;
  let view;
  let data;     // from /api/checkout/start: products, giveawayOrder, shipping
  let qty;      // { tin: 6, ... }
  let shipTo;   // 'home' | 'new'
  let stepMethod;   // 'sms' | 'factor' (passkey or authenticator app)
  let stepReason;   // why not SMS: 'sim_swap' | 'reassigned'
  let factors;      // which of { passkey, totp } Leo has
  let phoneEnding;  // last 4 digits, for "We texted a code to •••• 9078"
  let placed;
  let error;

  async function start(stageEl) {
    stage = stageEl;
    error = null;
    placed = null;
    stage.innerHTML = '';
    const res = await Twill.post('/api/checkout/start');
    data = res.data;
    qty = { ...data.giveawayOrder };
    shipTo = 'new';
    show('bag');
  }

  function show(next) {
    view = next;
    stage.innerHTML = `
      <div class="scene">
        <div class="scene-caption">
          <div class="scene-kicker">Three months later</div>
          <h2>Leo's first giveaway</h2>
          <p>Leo's baking videos are taking off. He's ordering prizes for a giveaway from the Twill app, shipping to his new studio.</p>
        </div>
        ${ui.phoneFrame(VIEWS[view]())}
      </div>`;
    wire();
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const product = (id) => data.products.find((p) => p.id === id);
  // Display-only total. The server re-prices the order itself.
  const total = () => Object.entries(qty).reduce((sum, [id, n]) => sum + n * product(id).price, 0);

  function appBar(title, back) {
    return `<div class="app-bar">${back ? '<span class="app-back">‹</span>' : '<img class="logo-small" src="img/twill-icon.png" alt="Twill">'}<span class="app-title">${title}</span><span class="app-bar-end"></span></div>`;
  }

  const VIEWS = {
    bag: () => `
      ${appBar('Bag', true)}
      <div class="app-body">
        <h3 class="app-h">Giveaway order</h3>
        ${Object.keys(qty).map((id) => {
          const p = product(id);
          return `
            <div class="app-line">
              <span class="thumb">${ui.icons[p.icon]}</span>
              <div class="app-line-info"><div>${p.name}</div><div class="muted">${ui.money(p.price)} each</div></div>
              <div class="stepper">
                <button type="button" data-dec="${id}" aria-label="Fewer">−</button>
                <span>${qty[id]}</span>
                <button type="button" data-inc="${id}" aria-label="More">+</button>
              </div>
            </div>`;
        }).join('')}

        <h3 class="app-h">Ship to</h3>
        ${['new', 'home'].map((key) => {
          const a = data.shipping[key];
          return `
            <label class="ship-option ${shipTo === key ? 'on' : ''}">
              <input type="radio" name="shipTo" value="${key}" ${shipTo === key ? 'checked' : ''}>
              <span><b>${esc(a.label)}</b>${a.isNew ? ' <span class="badge">New</span>' : ''}<br><span class="muted">${esc(a.line1)}, ${esc(a.city)} ${esc(a.state)}</span></span>
            </label>`;
        }).join('')}
        ${error ? `<div class="notice notice-warn">${esc(error)}</div>` : ''}
      </div>
      <div class="app-footer">
        <div class="summary-line total"><span>Total</span><span>${ui.money(total())}</span></div>
        <button class="btn btn-block" id="place-btn" ${total() ? '' : 'disabled'}>Place order</button>
      </div>`,

    placing: () => `
      ${appBar('Checkout', false)}
      <div class="app-center">
        <div class="spinner-dark"></div>
        <p>Placing your order…</p>
      </div>`,

    stepUp: () => `
      ${appBar('Confirm it’s you', true)}
      <div class="app-body">
        <div class="shield">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>
        </div>
        <h3 class="app-h center">Confirm it’s you</h3>
        <p class="muted center">${stepMethod === 'factor'
          ? `${stepReason === 'reassigned' ? "We can't send a text to your number on file right now." : 'We noticed a recent change to your mobile service.'} To keep your account safe, please confirm with your ${factors.passkey ? 'passkey' : 'authenticator app'}.`
          : `To protect this order, we texted a code to •••• ${esc(phoneEnding)}.`}</p>
        ${stepMethod === 'factor'
          ? Twill.passkey.choiceHtml({ factors, formId: 'stepup-form', inputId: 'f-stepup', buttonId: 'stepup-btn', buttonLabel: 'Confirm order', error: error && esc(error) })
          : `<form id="stepup-form" novalidate>
          <div class="field"><label for="f-stepup">6-digit code</label>
            <input id="f-stepup" class="code-input" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
          ${error ? `<div class="notice notice-warn">${esc(error)}</div>` : ''}
          <button class="btn btn-block" type="submit" id="stepup-btn">Confirm order</button>
        </form>`}
        ${stepMethod === 'sms' ? '<p class="center"><a href="#" class="muted" data-action="resend">Send a new code</a></p>' : ''}
      </div>`,

    done: () => `
      ${appBar('Order placed', false)}
      <div class="app-body center">
        <div class="big-check">✓</div>
        <h3 class="app-h">Thanks, ${esc(data.firstName)}!</h3>
        <p class="muted">Order ${esc(placed.id)} is on its way to ${esc(placed.address.label)}.</p>
        <div class="card" style="text-align:left">
          ${placed.lines.map((l) => `<div class="summary-line"><span>${l.qty} × ${esc(l.name)}</span><span>${ui.money(l.subtotal)}</span></div>`).join('')}
          <div class="summary-line total"><span>Total</span><span>${ui.money(placed.total)}</span></div>
        </div>
        <p class="muted">+${placed.pointsEarned.toLocaleString()} reward points</p>
        <button class="btn btn-ghost btn-block" data-action="again">Place another order</button>
      </div>`,
  };

  function wire() {
    stage.querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', () => { qty[b.dataset.inc] = Math.min(99, qty[b.dataset.inc] + 1); show('bag'); }));
    stage.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => { qty[b.dataset.dec] = Math.max(0, qty[b.dataset.dec] - 1); show('bag'); }));
    stage.querySelectorAll('input[name="shipTo"]').forEach((r) => r.addEventListener('change', () => { shipTo = r.value; show('bag'); }));

    const place = document.getElementById('place-btn');
    if (place) place.addEventListener('click', onPlace);

    const form = document.getElementById('stepup-form');
    if (form) {
      form.addEventListener('submit', onStepUp);
      document.getElementById('f-stepup').focus();
    }

    const passkeyBtn = stage.querySelector('[data-passkey]');
    if (passkeyBtn) passkeyBtn.addEventListener('click', () => onPasskey(passkeyBtn));

    const again = stage.querySelector('[data-action="again"]');
    if (again) again.addEventListener('click', () => { error = null; show('bag'); });

    const resend = stage.querySelector('[data-action="resend"]');
    if (resend) resend.addEventListener('click', onResend);
  }

  // Send the order. The server decides: approve, or ask for a step-up code.
  async function onPlace() {
    error = null;
    show('placing');
    const res = await Twill.post('/api/checkout/place', { items: qty, shipTo, deviceId: DEVICE_ID });
    if (!res.ok) { error = res.data.error; return show('bag'); }
    if (res.data.status === 'step_up') {
      stepMethod = res.data.method;
      stepReason = res.data.reason;
      factors = res.data.factors;
      phoneEnding = res.data.phoneEnding;
      show('stepUp');
      if (res.data.simulatedCode) ui.smsToast(`Your Twill verification code is: ${res.data.simulatedCode}`);
      return;
    }
    finish(res.data.order);
  }

  async function onResend(e) {
    e.preventDefault();
    const res = await Twill.post('/api/checkout/resend');
    error = res.ok ? null : res.data.error;
    show('stepUp');
    if (res.ok && res.data.simulatedCode) ui.smsToast(`Your Twill verification code is: ${res.data.simulatedCode}`);
  }

  async function onStepUp(e) {
    e.preventDefault();
    const code = new FormData(e.target).get('code').trim();
    const btn = document.getElementById('stepup-btn');
    ui.busy(btn, true, 'Checking…');
    const res = await Twill.post('/api/checkout/step-up', { code });
    if (!res.ok) { error = res.data.error; return show('stepUp'); }
    error = null;
    finish(res.data.order);
  }

  // Step-up with the passkey: the device signs a challenge, the server checks it.
  async function onPasskey(btn) {
    ui.busy(btn, true, 'Waiting for your device…');
    const res = await Twill.passkey.confirm('/api/checkout/step-up');
    if (!res.ok) { error = res.data.error; return show('stepUp'); }
    error = null;
    finish(res.data.order);
  }

  function finish(order) {
    placed = order;
    data.shipping[shipTo].isNew = false; // shipped there now, so it's no longer new
    show('done');
    Twill.journey.complete('checkout');
  }

  // Presenter shortcut: reset the bag to Leo's giveaway order.
  function fillLeo() {
    if (view !== 'bag') return;
    qty = { ...data.giveawayOrder };
    shipTo = 'new';
    show('bag');
  }

  Twill.journey.register({ id: 'checkout', label: 'Checkout', render: start, fillLeo });
})();
