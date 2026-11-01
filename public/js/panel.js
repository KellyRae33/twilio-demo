// =============================================================================
// panel.js — draws the "Behind the scenes" log on the right.
//
// Each entry shows: a plain-English title, a LIVE / SIMULATED / APP tag,
// the API that was called, the decision the app made, and (expandable)
// the trimmed request and the JSON response.
// =============================================================================

window.Twill = window.Twill || {};

Twill.panel = (function () {
  const log = document.getElementById('panel-log');
  const STAGGER_MS = 450; // small pause between entries so the audience can follow

  const TAGS = {
    LIVE: '<span class="tag tag-live">LIVE</span>',
    SIMULATED: '<span class="tag tag-sim">SIMULATED</span>',
    APP: '<span class="tag tag-app">APP</span>',
  };

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Pretty-print JSON with simple colors.
  function prettyJson(value) {
    const json = escapeHtml(JSON.stringify(value, null, 2));
    return json.replace(
      /(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
      (match, str, colon, lit, num) => {
        if (str) return colon ? `<span class="json-key">${str}</span>${colon}` : `<span class="json-str">${str}</span>`;
        if (lit) return `<span class="json-lit">${lit}</span>`;
        return `<span class="json-num">${num}</span>`;
      }
    );
  }

  function clearEmptyMessage() {
    const empty = log.querySelector('.panel-empty');
    if (empty) empty.remove();
  }

  // Draw one entry.
  function add(e) {
    clearEmptyMessage();
    // Only the newest entry has its response expanded.
    log.querySelectorAll('details[open]').forEach((d) => d.removeAttribute('open'));

    const el = document.createElement('article');
    el.className = 'entry';
    const time = new Date(e.time || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.innerHTML = `
      <div class="entry-top">
        ${TAGS[e.mode] || TAGS.APP}
        <div class="entry-title">${escapeHtml(e.title)}</div>
        <span class="entry-time">${time}</span>
      </div>
      ${e.api ? `<p class="entry-api">${escapeHtml(e.api)}</p>` : ''}
      ${e.decision ? `<p class="entry-decision">${escapeHtml(e.decision)}</p>` : ''}
      ${e.note ? `<p class="entry-note">${escapeHtml(e.note)}</p>` : ''}
      ${e.request ? `<details><summary>Request</summary><pre>${prettyJson(e.request)}</pre></details>` : ''}
      ${e.response ? `<details open><summary>Response</summary><pre>${prettyJson(e.response)}</pre></details>` : ''}
    `;
    log.appendChild(el);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Draw several entries one after another.
  async function addAll(entries) {
    for (let i = 0; i < entries.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, STAGGER_MS));
      add(entries[i]);
    }
  }

  // A heading in the log when the story moves to a new beat.
  function divider(text) {
    clearEmptyMessage();
    const el = document.createElement('div');
    el.className = 'beat-divider';
    el.textContent = text;
    log.appendChild(el);
  }

  function clear() {
    log.innerHTML = '<p class="panel-empty">Each step Twill\'s server takes will appear here.</p>';
  }

  // Collapse / expand
  const panelEl = document.getElementById('panel');
  document.getElementById('panel-toggle').addEventListener('click', () => panelEl.classList.toggle('collapsed'));
  document.getElementById('panel-clear').addEventListener('click', clear);

  return { add, addAll, divider, clear };
})();
