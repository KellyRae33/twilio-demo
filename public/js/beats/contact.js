// =============================================================================
// beats/contact.js — BEAT 3: Leo switches to business contact details.
//
// Screens (website, Account settings):
//   settings  → current details + new email and phone
//   verify    → prove it's Leo with a factor he ALREADY has:
//               authenticator app, or a text to his CURRENT number
//   newPhone  → Lookup + code to the NEW number (proves he can receive texts)
//   done      → saved; alerts go to the OLD email and phone
//
// All decisions happen on the server (routes/contact.js).
// =============================================================================

(function () {
  const { ui } = Twill;

  let stage;
  let view;
  let info;      // from /api/contact/start
  let form;      // { newEmail, newPhone, country }
  let methods;   // which existing factors are allowed: 'totp', 'sms_old'
  let method;    // the one Leo picked
  let codeSent;  // has a code been sent for the current step?
  let newPhoneMasked;
  let saved;
  let error;

  async function start(stageEl) {
    stage = stageEl;
    stage.innerHTML = '';
    form = { newEmail: '', newPhone: '', country: 'US' };
    error = null;
    const res = await Twill.post('/api/contact/start');
    info = res.data;
    show('settings');
  }

  // Customer-facing style for a masked number: "•••• 0142".
  const ending = (masked) => '•••• ' + String(masked).slice(-4);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const errorBox = () => (error ? `<div class="notice notice-warn">${esc(error)}</div>` : '');

  function show(next) {
    view = next;
    stage.innerHTML = ui.webFrame(`
      ${ui.storeNav(0)}
      <div class="store-main">
        <div class="settings">
          <aside class="settings-menu">
            <div class="settings-hello">Hi, ${esc(info.name.split(' ')[0])}</div>
            <span>Orders</span><span class="on">Contact details</span><span>Security</span><span>Rewards</span>
          </aside>
          <section class="settings-main">${VIEWS[view]()}</section>
        </div>
      </div>`, 'twill.com/account/contact');
    wire();
  }

  const VIEWS = {
    settings: () => `
      <h1>Contact details</h1>
      <p class="sub">Leo is switching to his new business email and phone.</p>
      <div class="card current">
        <div class="summary-line"><span class="muted">Current email</span><span>${esc(info.email)}</span></div>
        <div class="summary-line"><span class="muted">Current mobile</span><span>${esc(ending(info.phoneMasked))}</span></div>
      </div>
      <form id="change-form" novalidate class="form-left">
        <div class="field"><label for="f-new-email">New email</label>
          <input id="f-new-email" name="newEmail" type="email" autocomplete="off" value="${esc(form.newEmail)}"></div>
        <div class="field"><label for="f-new-phone">New mobile number</label>
          <div class="phone-row">
            <select name="country" aria-label="Country">${ui.countryOptions(form.country)}</select>
            <input id="f-new-phone" name="newPhone" type="tel" autocomplete="off" placeholder="(503) 555-0142" value="${esc(form.newPhone)}">
          </div>
        </div>
        ${errorBox()}
        <button class="btn" type="submit" id="save-btn">Save changes</button>
      </form>`,

    verify: () => `
      <h1>Confirm it's you</h1>
      <p class="sub">To protect your account, confirm this change using your authenticator app${methods.includes('sms_old') ? ' or your current phone number' : ''}.</p>
      ${!method ? `
        <div class="method-list">
          ${methods.includes('totp') ? '<button class="method" data-method="totp"><b>Authenticator app</b><span class="muted">Enter the 6-digit code from your app</span></button>' : ''}
          ${methods.includes('sms_old') ? `<button class="method" data-method="sms_old"><b>Text message</b><span class="muted">Send a code to ${esc(ending(info.phoneMasked))}</span></button>` : ''}
        </div>
        ${errorBox()}` : `
        <form id="identity-form" novalidate class="form-left">
          <div class="field"><label for="f-id-code">${method === 'totp' ? 'Code from your authenticator app' : `Code sent to ${esc(ending(info.phoneMasked))}`}</label>
            <input id="f-id-code" class="code-input" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
          ${errorBox()}
          <button class="btn" type="submit" id="identity-btn">Confirm</button>
          <a href="#" class="muted back-link" data-action="other-method">Use a different method</a>
        </form>`}`,

    newPhone: () => `
      <div class="notice notice-ok">Thanks, it's you. One last step.</div>
      <h1>Verify your new number</h1>
      <p class="sub">We'll text a code to ${esc(ending(newPhoneMasked))} to make sure you can receive messages there.</p>
      ${!codeSent ? `
        ${errorBox()}
        <button class="btn" id="send-new-btn">Send code</button>
        ${error ? '<a href="#" class="muted back-link" data-action="edit">Edit details</a>' : ''}` : `
        <form id="new-code-form" novalidate class="form-left">
          <div class="field"><label for="f-new-code">Code sent to ${esc(ending(newPhoneMasked))}</label>
            <input id="f-new-code" class="code-input" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
          ${errorBox()}
          <button class="btn" type="submit" id="new-code-btn">Verify and save</button>
        </form>`}`,

    done: () => `
      <div class="big-check" style="margin:0 0 14px">✓</div>
      <h1>Contact details updated</h1>
      <p class="sub">We've let you know at your previous email and phone number, just in case.</p>
      <div class="card current">
        <div class="summary-line"><span class="muted">Email</span><span>${esc(saved.email)}</span></div>
        <div class="summary-line"><span class="muted">Mobile</span><span>${esc(ending(saved.phoneMasked))}</span></div>
      </div>`,
  };

  function wire() {
    const changeForm = document.getElementById('change-form');
    if (changeForm) changeForm.addEventListener('submit', onRequest);

    stage.querySelectorAll('[data-method]').forEach((b) => b.addEventListener('click', () => chooseMethod(b.dataset.method)));

    const idForm = document.getElementById('identity-form');
    if (idForm) { idForm.addEventListener('submit', onVerifyIdentity); document.getElementById('f-id-code').focus(); }

    const sendNew = document.getElementById('send-new-btn');
    if (sendNew) sendNew.addEventListener('click', onSendNew);

    const newForm = document.getElementById('new-code-form');
    if (newForm) { newForm.addEventListener('submit', onConfirmNew); document.getElementById('f-new-code').focus(); }

    stage.querySelectorAll('[data-action]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      error = null;
      if (a.dataset.action === 'other-method') { method = null; show('verify'); }
      if (a.dataset.action === 'edit') show('settings');
    }));
  }

  // 1. Ask to change. The server checks for a SIM swap and says which
  //    existing factors Leo may use.
  async function onRequest(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    form = { newEmail: fd.get('newEmail').trim(), newPhone: fd.get('newPhone').trim(), country: fd.get('country') };
    const btn = document.getElementById('save-btn');
    ui.busy(btn, true, 'Saving…');
    const res = await Twill.post('/api/contact/request', form);
    if (!res.ok) { error = res.data.error; return show('settings'); }
    error = null;
    methods = res.data.methods;
    method = null;
    show('verify');
  }

  // 2. Leo picks a method. For SMS, the code goes to his CURRENT number.
  async function chooseMethod(m) {
    error = null;
    if (m === 'sms_old') {
      const res = await Twill.post('/api/contact/send-old-code');
      if (!res.ok) { error = res.data.error; return show('verify'); }
      if (res.data.simulatedCode) ui.smsToast(`Your Twill verification code is: ${res.data.simulatedCode}`, `Messages · ${ending(info.phoneMasked)}`);
    }
    method = m;
    show('verify');
  }

  async function onVerifyIdentity(e) {
    e.preventDefault();
    const code = new FormData(e.target).get('code').trim();
    const btn = document.getElementById('identity-btn');
    ui.busy(btn, true, 'Checking…');
    const res = await Twill.post('/api/contact/verify-identity', { method, code });
    if (!res.ok) { error = res.data.error; return show('verify'); }
    error = null;
    codeSent = false;
    newPhoneMasked = res.data.newPhoneMasked;
    show('newPhone');
  }

  // 3. Lookup the NEW number, then text it a code.
  async function onSendNew() {
    const btn = document.getElementById('send-new-btn');
    ui.busy(btn, true, 'Checking number…');
    const res = await Twill.post('/api/contact/send-new-code');
    if (!res.ok) { error = res.data.error; return show('newPhone'); }
    error = null;
    codeSent = true;
    show('newPhone');
    if (res.data.simulatedCode) ui.smsToast(`Your Twill verification code is: ${res.data.simulatedCode}`, `Messages · ${ending(newPhoneMasked)}`);
  }

  // 4. Confirm, save, and show the alerts sent to the OLD email and phone.
  async function onConfirmNew(e) {
    e.preventDefault();
    const code = new FormData(e.target).get('code').trim();
    const btn = document.getElementById('new-code-btn');
    ui.busy(btn, true, 'Saving…');
    const res = await Twill.post('/api/contact/confirm-new', { code });
    if (!res.ok) { error = res.data.error; return show('newPhone'); }
    saved = res.data;
    show('done');
    ui.clearToasts(); // make room for the two alerts
    for (const n of saved.notifications) {
      if (n.channel === 'SMS') ui.smsToast(n.text, `Messages · ${ending(n.to)}`);
      else ui.emailToast(n.text, `Mail · ${n.to}`);
    }
    Twill.journey.complete('contact');
  }

  // Presenter shortcut: fill in Leo's new business details.
  function fillLeo() {
    if (view !== 'settings') return;
    form = { newEmail: info.suggested.email, newPhone: info.suggested.phone, country: 'US' };
    show('settings');
  }

  Twill.journey.register({ id: 'contact', label: 'Contact change', render: start, fillLeo });
})();
