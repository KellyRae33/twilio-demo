// =============================================================================
// presenter.js — the demo controls.
//
// Open with the gear icon (top right) or the ` key (backtick).
//   - Scenario switches (VoIP number, recent SIM swap)
//   - Fill Leo's details, Reset demo
// PUBLIC DEMO: there are no LIVE switches; every Twilio step is simulated.
// Settings live on the server, because the server decides what to call.
// =============================================================================

window.Twill = window.Twill || {};

Twill.presenter = (function () {
  const drawer = document.getElementById('presenter');
  const backdrop = document.getElementById('presenter-backdrop');
  const body = document.getElementById('presenter-body');
  const offlinePill = document.getElementById('offline-pill');
  let status = null;
  let totpTimer = null;


  async function refresh() {
    status = await Twill.get('/api/status');
    offlinePill.hidden = !status.settings.offline;
    if (!drawer.hidden) draw();
    return status;
  }

  async function save(change) {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(change),
    });
    status = await res.json();
    offlinePill.hidden = !status.settings.offline;
    draw();
  }

  function toggle(name, checked, attrs) {
    return `<label class="switch"><input type="checkbox" ${attrs} ${checked ? 'checked' : ''}><span></span></label>`;
  }

  function draw() {
    const s = status.settings;
    body.innerHTML = `
      <p class="status-line">This public copy never calls Twilio. Every Twilio step is <b>simulated</b>, with responses shaped like the real API.</p>

      <h3>Scenarios</h3>
      <div class="ctl-row">
        <div>Phone line type<small>Force a risky Lookup result for sign-up and Beat 3's new number</small></div>
        <select data-scenario="lineTypeOverride">
          ${[['none', 'Normal (mobile)'], ['nonFixedVoip', 'VoIP number'], ['premium', 'Premium-rate'], ['landline', 'Landline']]
            .map(([v, l]) => `<option value="${v}" ${s.scenarios.lineTypeOverride === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="ctl-row">
        <div>Identity Match result<small>Force a result: how well the carrier's records match Leo's name and address</small></div>
        <select data-scenario="identityOverride">
          ${[['none', 'Normal (strong match)'], ['strong', 'Strong match'], ['partial', 'Partial match'], ['noMatch', 'No match']]
            .map(([v, l]) => `<option value="${v}" ${s.scenarios.identityOverride === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="ctl-row">
        <div>Recent SIM swap<small>Beats 2–3: SIM Swap reports a swap in the last 48h</small></div>
        ${toggle('recentSimSwap', s.scenarios.recentSimSwap, 'data-scenario-bool="recentSimSwap"')}
      </div>
      <div class="ctl-row">
        <div>Number reassigned<small>Beat 2: Reassigned Number says Leo's number now belongs to someone else</small></div>
        ${toggle('reassignedNumber', s.scenarios.reassignedNumber, 'data-scenario-bool="reassignedNumber"')}
      </div>
      <div class="ctl-row">
        <div>New number's line status<small>Beat 3: force the Line Status result for Leo's new number</small></div>
        <select data-scenario="lineStatusOverride">
          ${[['none', 'Normal (reachable)'], ['inactive', 'Inactive'], ['unreachable', 'Unreachable']]
            .map(([v, l]) => `<option value="${v}" ${s.scenarios.lineStatusOverride === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>

      <h3>Shortcuts</h3>
      <div id="totp-helper"></div>
      <button class="drawer-btn" data-action="fill">Fill Leo's details on this screen</button>
      <button class="drawer-btn" data-action="reset">Reset demo (keep these settings)</button>
      <button class="drawer-btn danger" data-action="reset-all">Reset demo and settings</button>
    `;
    drawTotpHelper();
  }

  // Show the current code of Leo's simulated authenticator, for visitors who
  // didn't scan the QR code with an authenticator app.
  async function drawTotpHelper() {
    const el = document.getElementById('totp-helper');
    if (!el) return;
    const { code } = await Twill.get('/api/presenter/totp');
    el.innerHTML = code
      ? `<p class="status-line">Leo's authenticator code (if you didn't scan the QR code):</p><div class="code-big">${code}</div>`
      : '';
  }

  body.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-live]')) save({ live: { [t.dataset.live]: t.checked } });
    if (t.matches('[data-scenario]')) save({ scenarios: { [t.dataset.scenario]: t.value } });
    if (t.matches('[data-scenario-bool]')) save({ scenarios: { [t.dataset.scenarioBool]: t.checked } });
  });

  body.addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    if (action === 'fill') {
      const beat = Twill.journey.beats.find((b) => b.id === Twill.journey.current);
      if (beat && beat.fillLeo) beat.fillLeo(status.leo);
      close();
    }
    if (action === 'reset' || action === 'reset-all') {
      await fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetSettings: action === 'reset-all' }),
      });
      await refresh();
      Twill.panel.clear();
      Twill.journey.reset();
      close();
    }
  });

  function open() {
    drawer.hidden = false;
    backdrop.hidden = false;
    refresh();
    totpTimer = setInterval(drawTotpHelper, 5000);
  }

  function close() {
    drawer.hidden = true;
    backdrop.hidden = true;
    clearInterval(totpTimer);
  }

  document.getElementById('presenter-open').addEventListener('click', open);
  document.getElementById('presenter-close').addEventListener('click', close);
  backdrop.addEventListener('click', close);

  // ` key toggles the drawer (ignored while typing in a form field).
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === '`') (drawer.hidden ? open : close)();
    if (e.key === 'Escape') close();
  });

  return { refresh, get status() { return status; } };
})();
