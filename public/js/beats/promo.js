// =============================================================================
// beats/promo.js — BEAT 5: Twill's promo launch with Leo, and the SMS pumping
// attack it attracts.
//
// This screen is Twill's internal admin dashboard (not Leo's view).
// "Simulate launch" asks the server to run a burst of fake sign-ups through
// the defences (routes/promo.js), then replays the results here as a live feed.
// =============================================================================

(function () {
  const { ui } = Twill;
  const REPLAY_MS = 45; // delay between sign-ups in the replay

  let stage;
  let running = false;

  const OUTCOMES = {
    sent: { label: 'Code sent', cls: 'chip-ok' },
    blocked_line_type: { label: 'Blocked · line type', cls: 'chip-warn' },
    blocked_line_status: { label: 'Blocked · line status', cls: 'chip-info' },
    blocked_fraud_guard: { label: 'Blocked · Fraud Guard', cls: 'chip-bad' },
    blocked_duplicate: { label: 'Blocked · duplicate', cls: 'chip-muted' },
  };

  const TILES = [
    ['attempted', 'Sign-ups attempted'],
    ['blockedLineType', 'Blocked by line type'],
    ['blockedLineStatus', 'Blocked by line status'],
    ['blockedFraudGuard', 'Blocked by Fraud Guard'],
    ['blockedDuplicate', 'Blocked as duplicate'],
    ['sent', 'Codes actually sent'],
    ['spendAvoided', 'SMS spend avoided*'],
  ];

  const mask = (p) => p.slice(0, 5) + '•••' + p.slice(-4);

  function start(stageEl) {
    stage = stageEl;
    running = false;
    stage.innerHTML = ui.webFrame(`
      <div class="store-nav admin-nav"><img class="logo" src="img/twill-logo.png" alt="Twill"><nav><span>Admin</span><span>Promotions</span></nav></div>
      <div class="store-main">
        <div class="promo-head">
          <div>
            <div class="scene-kicker">Launch day</div>
            <h1>LEOBAKES20</h1>
            <p class="sub">20% off bakeware with Leo Marin. Sign up and verify your phone to get the code.</p>
          </div>
          <div class="promo-actions">
            <span class="status-pill" id="promo-status">Ready</span>
            <button class="btn" id="launch-btn">Simulate launch</button>
          </div>
        </div>

        <div class="tiles">
          ${TILES.map(([key, label]) => `
            <div class="tile tile-${key}"><div class="tile-label">${label}</div><div class="tile-value" id="t-${key}">${key === 'spendAvoided' ? '$0.00' : '0'}</div></div>`).join('')}
        </div>

        <div class="bar" id="promo-bar"></div>

        <div class="feed-head"><h2>Live sign-ups</h2><span class="muted">*Placeholder per-message costs from config.js, not Twilio pricing.</span></div>
        <div class="feed" id="promo-feed"><p class="muted">Press "Simulate launch" to start the promo.</p></div>
      </div>`, 'admin.twill.com/promotions/LEOBAKES20');

    document.getElementById('launch-btn').addEventListener('click', launch);
  }

  async function launch() {
    if (running) return;
    running = true;
    const btn = document.getElementById('launch-btn');
    ui.busy(btn, true, 'Launching…');
    setStatus('Live', 'live');

    let data;
    try {
      const res = await fetch('/api/promo/launch', { method: 'POST' });
      data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (err) {
      ui.busy(btn, false);
      running = false;
      return setStatus('Error', '');
    }
    // Panel entries and the live feed animate at the same time.
    await Promise.all([Twill.panel.addAll(data.entries), replay(data)]);

    ui.busy(btn, false);
    btn.textContent = 'Run again';
    setStatus('Complete', '');
    running = false;
    Twill.journey.complete('promo');
  }

  function setStatus(text, cls) {
    const el = document.getElementById('promo-status');
    el.textContent = text;
    el.className = 'status-pill ' + cls;
  }

  // Replay the server's results one sign-up at a time.
  async function replay(data) {
    const totals = { attempted: 0, blockedLineType: 0, blockedLineStatus: 0, blockedFraudGuard: 0, blockedDuplicate: 0, sent: 0, spendAvoided: 0 };
    const KEY = { sent: 'sent', blocked_line_type: 'blockedLineType', blocked_line_status: 'blockedLineStatus', blocked_fraud_guard: 'blockedFraudGuard', blocked_duplicate: 'blockedDuplicate' };
    const feed = document.getElementById('promo-feed');
    feed.innerHTML = '';

    for (const s of data.signups) {
      totals.attempted++;
      totals[KEY[s.outcome]]++;
      if (s.outcome !== 'sent') totals.spendAvoided += s.cost;

      const o = OUTCOMES[s.outcome];
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.innerHTML = `
        <span class="mono">${mask(s.phone)}</span>
        <span class="chip ${o.cls}">${o.label}</span>
        <span class="muted feed-detail">${s.detail}</span>
        <span class="tag ${s.lookup === 'LIVE' ? 'tag-live' : 'tag-sim'}">${s.lookup}</span>`;
      feed.prepend(row);
      while (feed.children.length > 9) feed.lastElementChild.remove();

      drawTotals(totals);
      await new Promise((r) => setTimeout(r, REPLAY_MS));
    }
  }

  function drawTotals(t) {
    for (const [key] of TILES) {
      document.getElementById('t-' + key).textContent = key === 'spendAvoided' ? '$' + t[key].toFixed(2) : t[key];
    }
    // Stacked bar: share of each outcome so far.
    const parts = [['sent', 'chip-ok'], ['blockedLineType', 'chip-warn'], ['blockedLineStatus', 'chip-info'], ['blockedFraudGuard', 'chip-bad'], ['blockedDuplicate', 'chip-muted']];
    document.getElementById('promo-bar').innerHTML = parts
      .map(([k, cls]) => `<span class="${cls}" style="width:${(100 * t[k]) / t.attempted}%"></span>`)
      .join('');
  }

  Twill.journey.register({ id: 'promo', label: 'Promo surge', render: start });
})();
