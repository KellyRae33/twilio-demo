// =============================================================================
// api.js — how the storefront talks to our server.
//
// The browser never talks to Twilio directly (and never sees credentials).
// It calls our server, which calls Twilio and sends back:
//   - the result for the storefront, and
//   - "entries" for the Behind-the-scenes panel.
// =============================================================================

window.Twill = window.Twill || {};

// POST JSON to our server. Panel entries in the reply are shown automatically.
// Returns { ok, status, data }. Never throws, so beats can just check `ok`.
Twill.post = async function post(path, body) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json();
    if (data.entries && data.entries.length) await Twill.panel.addAll(data.entries);
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    // Our own server is unreachable (it was stopped, or crashed).
    return { ok: false, status: 0, data: { error: "Can't reach the Twill server. Is `npm start` still running?" } };
  }
};

Twill.get = async function get(path) {
  const res = await fetch(path);
  return res.json();
};
