// =============================================================================
// beats/loyalty.js — BEAT 4: Leo redeems reward points in the Twill app.
//
// Screens (inside a phone frame):
//   rewards → balance + rewards list
//   stepUp  → only for redemptions above the threshold: passkey or
//             authenticator code, whichever Leo set up
//   done    → reward confirmed, new balance
//
// All decisions happen on the server (routes/loyalty.js).
// =============================================================================

(function () {
  const { ui } = Twill;

  let stage;
  let view;
  let data;    // from /api/loyalty/start
  let pending; // reward waiting for the step-up code
  let factors; // which of { passkey, totp } Leo has
  let done;
  let error;

  async function start(stageEl) {
    stage = stageEl;
    stage.innerHTML = '';
    error = null;
    const res = await Twill.post('/api/loyalty/start');
    data = res.data;
    show('rewards');
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pts = (n) => n.toLocaleString('en-US');
  const errorBox = () => (error ? `<div class="notice notice-warn">${esc(error)}</div>` : '');

  function show(next) {
    view = next;
    stage.innerHTML = `
      <div class="scene">
        <div class="scene-caption">
          <div class="scene-kicker">Six months later</div>
          <h2>Cashing in</h2>
          <p>Leo has built up a big points balance from his giveaway orders. He grabs a small reward for himself, then goes for the stand mixer he's been eyeing.</p>
        </div>
        ${ui.phoneFrame(VIEWS[view]())}
      </div>`;
    wire();
  }

  function appBar(title, back) {
    return `<div class="app-bar">${back ? '<span class="app-back">‹</span>' : '<img class="logo-small" src="img/twill-icon.png" alt="Twill">'}<span class="app-title">${title}</span><span class="app-bar-end"></span></div>`;
  }

  const VIEWS = {
    rewards: () => `
      ${appBar('Rewards', false)}
      <div class="app-body">
        <div class="points-hero">
          <div class="muted-light">Your balance</div>
          <div class="points-big">${pts(data.points)} <span>pts</span></div>
        </div>
        ${errorBox()}
        <h3 class="app-h">Redeem</h3>
        ${data.rewards.map((r) => `
          <div class="app-line">
            <span class="thumb">${ui.icons[r.icon]}</span>
            <div class="app-line-info"><div>${esc(r.name)}</div><div class="muted">${pts(r.points)} pts</div></div>
            <button class="btn btn-small" data-redeem="${r.id}" ${r.points > data.points ? 'disabled' : ''}>Redeem</button>
          </div>`).join('')}
      </div>`,

    stepUp: () => `
      ${appBar('Confirm it’s you', true)}
      <div class="app-body">
        <div class="shield">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>
        </div>
        <h3 class="app-h center">Confirm it’s you</h3>
        <p class="muted center">You're redeeming ${pts(pending.points)} points for the ${esc(pending.name)}. For larger rewards, please confirm with your ${factors.passkey ? 'passkey' : 'authenticator app'}.</p>
        ${Twill.passkey.choiceHtml({ factors, formId: 'loyalty-stepup-form', inputId: 'f-loyalty-code', buttonId: 'loyalty-stepup-btn', buttonLabel: 'Confirm redemption', error: error && esc(error) })}
        <p class="center"><a href="#" class="muted" data-action="cancel">Cancel</a></p>
      </div>`,

    done: () => `
      ${appBar('Reward redeemed', false)}
      <div class="app-body center">
        <div class="big-check">✓</div>
        <h3 class="app-h">Enjoy your ${esc(done.reward)}!</h3>
        <p class="muted">${pts(done.points)} points redeemed · ref ${esc(done.id)}</p>
        <div class="points-hero">
          <div class="muted-light">Remaining balance</div>
          <div class="points-big">${pts(done.balance)} <span>pts</span></div>
        </div>
        <button class="btn btn-ghost btn-block" data-action="back">Back to rewards</button>
      </div>`,
  };

  function wire() {
    stage.querySelectorAll('[data-redeem]').forEach((b) => b.addEventListener('click', () => onRedeem(b)));

    const form = document.getElementById('loyalty-stepup-form');
    if (form) {
      form.addEventListener('submit', onStepUp);
      document.getElementById('f-loyalty-code').focus();
    }

    const passkeyBtn = stage.querySelector('[data-passkey]');
    if (passkeyBtn) passkeyBtn.addEventListener('click', () => onPasskey(passkeyBtn));

    stage.querySelectorAll('[data-action]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      error = null;
      show('rewards');
    }));
  }

  // Ask the server. It approves small redemptions, and holds big ones.
  async function onRedeem(btn) {
    ui.busy(btn, true, '…');
    const res = await Twill.post('/api/loyalty/redeem', { rewardId: btn.dataset.redeem });
    if (!res.ok) { error = res.data.error; return show('rewards'); }
    error = null;
    if (res.data.status === 'step_up') {
      pending = res.data.reward;
      factors = res.data.factors;
      return show('stepUp');
    }
    finish(res.data.redemption);
  }

  async function onStepUp(e) {
    e.preventDefault();
    const code = new FormData(e.target).get('code').trim();
    const btn = document.getElementById('loyalty-stepup-btn');
    ui.busy(btn, true, 'Checking…');
    const res = await Twill.post('/api/loyalty/step-up', { code });
    if (!res.ok) { error = res.data.error; return show('stepUp'); }
    error = null;
    finish(res.data.redemption);
  }

  // Step-up with the passkey: the device signs a challenge, the server checks it.
  async function onPasskey(btn) {
    ui.busy(btn, true, 'Waiting for your device…');
    const res = await Twill.passkey.confirm('/api/loyalty/step-up');
    if (!res.ok) { error = res.data.error; return show('stepUp'); }
    error = null;
    finish(res.data.redemption);
  }

  function finish(redemption) {
    done = redemption;
    data.points = redemption.balance;
    show('done');
    if (redemption.points > data.threshold) Twill.journey.complete('loyalty');
  }

  Twill.journey.register({ id: 'loyalty', label: 'Loyalty', render: start });
})();
