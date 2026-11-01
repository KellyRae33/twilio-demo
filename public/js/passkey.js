// =============================================================================
// passkey.js — the browser side of passkeys.
//
// The browser (not this page) talks to Leo's device: Face ID, fingerprint,
// Windows Hello, or his phone. The page only passes options in and the
// signed answer back to our server. Binary values travel as base64url text.
//
//   Twill.passkey.supported            can this browser use passkeys?
//   Twill.passkey.register()           sign-up: create a passkey
//   Twill.passkey.confirm(url, body)   step-up: sign a challenge, send it to url
//   Twill.passkey.choiceHtml(...)      the "use passkey / enter code" block
// =============================================================================

window.Twill = window.Twill || {};

Twill.passkey = (function () {
  const supported = Boolean(window.PublicKeyCredential && navigator.credentials);

  // base64url text <-> bytes
  function toBytes(text) {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  }
  function toText(buffer) {
    let binary = '';
    new Uint8Array(buffer).forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // A friendly message for the usual ways a passkey prompt ends badly.
  function failure(err) {
    const cancelled = err && (err.name === 'NotAllowedError' || err.name === 'AbortError');
    return {
      ok: false,
      data: { error: cancelled ? 'Passkey prompt closed. Try again, or use another way.' : `Your device couldn't use a passkey (${err && err.name}).` },
    };
  }

  // Sign-up: ask the server for options, have the device make a passkey,
  // send the result back. Returns the server's response ({ ok, data }).
  async function register() {
    const start = await Twill.post('/api/passkey/register/start');
    if (!start.ok) return start;
    const o = start.data.options;
    let cred;
    try {
      cred = await navigator.credentials.create({
        publicKey: { ...o, challenge: toBytes(o.challenge), user: { ...o.user, id: toBytes(o.user.id) } },
      });
    } catch (err) {
      return failure(err);
    }
    const r = cred.response;
    const credential = {
      id: cred.id,
      rawId: toText(cred.rawId),
      type: cred.type,
      authenticatorAttachment: cred.authenticatorAttachment,
      response: {
        clientDataJSON: toText(r.clientDataJSON),
        attestationObject: toText(r.attestationObject),
        transports: r.getTransports ? r.getTransports() : [],
        // The public key, so our server can check signatures later.
        publicKey: r.getPublicKey && r.getPublicKey() ? toText(r.getPublicKey()) : null,
        publicKeyAlgorithm: r.getPublicKeyAlgorithm ? r.getPublicKeyAlgorithm() : null,
      },
    };
    return Twill.post('/api/passkey/register/finish', { credential });
  }

  // Step-up: get a fresh challenge, have the device sign it, then send the
  // signed answer to the beat's own step-up endpoint (url) with any extra body.
  async function confirm(url, body = {}) {
    const start = await Twill.post('/api/passkey/challenge');
    if (!start.ok) return start;
    const o = start.data.options;
    let cred;
    try {
      cred = await navigator.credentials.get({
        publicKey: {
          ...o,
          challenge: toBytes(o.challenge),
          allowCredentials: o.allowCredentials.map((c) => ({ ...c, id: toBytes(c.id) })),
        },
      });
    } catch (err) {
      return failure(err);
    }
    const r = cred.response;
    const passkey = {
      id: cred.id,
      rawId: toText(cred.rawId),
      type: cred.type,
      authenticatorAttachment: cred.authenticatorAttachment,
      response: {
        clientDataJSON: toText(r.clientDataJSON),
        authenticatorData: toText(r.authenticatorData),
        signature: toText(r.signature),
        userHandle: r.userHandle ? toText(r.userHandle) : null,
      },
    };
    return Twill.post(url, { ...body, passkey });
  }

  // The step-up block: a passkey button and/or an authenticator code form,
  // depending on what Leo set up. factors = { passkey: bool, totp: bool }.
  function choiceHtml({ factors, formId, inputId, buttonId, buttonLabel, error }) {
    const errorBox = error ? `<div class="notice notice-warn">${error}</div>` : '';
    const passkeyBtn = factors.passkey
      ? `<button class="btn btn-block" type="button" data-passkey>Confirm with passkey</button>`
      : '';
    const or = factors.passkey && factors.totp ? '<p class="muted center or-line">or enter the code from your authenticator app</p>' : '';
    const form = factors.totp
      ? `<form id="${formId}" novalidate>
          <div class="field"><label for="${inputId}">6-digit code</label>
            <input id="${inputId}" class="code-input" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
          <button class="btn ${factors.passkey ? 'btn-ghost ' : ''}btn-block" type="submit" id="${buttonId}">${buttonLabel}</button>
        </form>`
      : '';
    return passkeyBtn + or + form + errorBox;
  }

  return { supported, register, confirm, choiceHtml };
})();
