// =============================================================================
// ui.js — small shared building blocks for the storefront.
//   Twill.ui.webFrame(html)     wrap content in a desktop browser window
//   Twill.ui.phoneFrame(html)   wrap content in a phone (the mobile app)
//   Twill.ui.smsToast(text)     show a pretend text message notification
//   Twill.ui.busy(button, on)   show a spinner on a button while waiting
// =============================================================================

window.Twill = window.Twill || {};

Twill.ui = (function () {
  // Simple line drawings for the products (no image files needed).
  const icons = {
    cupcakeTin: '<svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="58" height="36" rx="5"/><circle cx="17" cy="18" r="6"/><circle cx="32" cy="18" r="6"/><circle cx="47" cy="18" r="6"/><circle cx="17" cy="32" r="6"/><circle cx="32" cy="32" r="6"/><circle cx="47" cy="32" r="6"/></svg>',
    cakePan: '<svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="32" cy="14" rx="26" ry="8"/><path d="M6 14v16c0 4.4 11.6 8 26 8s26-3.6 26-8V14"/><path d="M14 40l-4 6h44l-4-6"/></svg>',
    pipingBag: '<svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h30l-8 30H22Z"/><path d="M22 36l4 8 4-8"/><path d="M38 6c6 0 10 3 12 8"/></svg>',
    standMixer: '<svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 44h36"/><path d="M18 44V20h8"/><path d="M18 20c0-8 8-14 18-14h8a8 8 0 0 1 0 16H30"/><path d="M28 30h20l-3 10H31Z"/></svg>',
    whisk: '<svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="2"><path d="M30 46V30"/><path d="M30 30c-10-4-12-26 0-26s10 22 0 26"/><path d="M30 30c-4-6-4-22 0-26 4 4 4 20 0 26"/></svg>',
    rollingPin: '<svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="2"><rect x="14" y="18" width="36" height="12" rx="4"/><path d="M4 24h10M50 24h10"/></svg>',
  };

  function webFrame(content, url = 'twill.com') {
    return `
      <div class="web store">
        <div class="web-bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="url">${url}</span></div>
        ${content}
      </div>`;
  }

  function phoneFrame(content) {
    return `
      <div class="phone store">
        <div class="phone-notch"></div>
        <div class="phone-body">${content}</div>
      </div>`;
  }

  // The top navigation of the website.
  function storeNav(cartCount = 0) {
    return `
      <div class="store-nav">
        <img class="logo" src="img/twill-logo.png" alt="Twill">
        <nav><span>Bakeware</span><span>Tools</span><span>Cookware</span><span>Rewards</span></nav>
        <button class="cart-btn" type="button">Cart<b>${cartCount}</b></button>
      </div>`;
  }

  // A pretend text message, like a notification sliding in on Leo's phone.
  // Only used in SIMULATED mode (in LIVE mode a real text arrives on a real phone).
  function smsToast(text, heading = 'Messages · now') {
    toast(heading, 'SIMULATED SMS', text);
  }

  // A pretend email notification (same look, different label).
  function emailToast(text, heading = 'Mail · now') {
    toast(heading, 'SIMULATED EMAIL', text);
  }

  // Remove any notifications still on screen.
  function clearToasts() {
    document.getElementById('toasts').innerHTML = '';
  }

  function toast(heading, tag, text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<div class="toast-head"><span></span><span class="tag tag-sim">${tag}</span></div><div></div>`;
    el.firstElementChild.firstElementChild.textContent = heading;
    el.lastElementChild.textContent = text;
    el.title = 'Click to dismiss';
    el.addEventListener('click', () => el.remove());
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 45000);
  }

  // Disable a button and show a spinner while waiting for the server.
  function busy(button, on, label) {
    if (on) {
      button.dataset.label = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<span class="spinner"></span>${label || 'Please wait…'}`;
    } else {
      button.disabled = false;
      if (button.dataset.label) button.innerHTML = button.dataset.label;
    }
  }

  // Countries for the phone number selector (dial code shown for clarity).
  const countries = [
    ['US', 'United States', '+1'],
    ['CA', 'Canada', '+1'],
    ['GB', 'United Kingdom', '+44'],
    ['IE', 'Ireland', '+353'],
    ['DE', 'Germany', '+49'],
    ['FR', 'France', '+33'],
    ['ES', 'Spain', '+34'],
    ['NL', 'Netherlands', '+31'],
    ['AU', 'Australia', '+61'],
    ['IN', 'India', '+91'],
    ['BR', 'Brazil', '+55'],
    ['MX', 'Mexico', '+52'],
  ];

  function countryOptions(selected = 'US') {
    return countries
      .map(([code, name, dial]) => `<option value="${code}" ${code === selected ? 'selected' : ''}>${code} ${dial}</option>`)
      .join('');
  }

  function money(n) {
    return '$' + n.toFixed(2);
  }

  return { icons, webFrame, phoneFrame, storeNav, smsToast, emailToast, clearToasts, busy, countryOptions, money };
})();
