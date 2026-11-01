// =============================================================================
// catalog.js — Twill's products and prices.
//
// The server always prices orders from this list. It never trusts a total sent
// by the browser (or the app), because those can be tampered with.
// =============================================================================

const PRODUCTS = [
  { id: 'tin', name: '12-cup cupcake tin', price: 34, icon: 'cupcakeTin' },
  { id: 'pan', name: 'Rotating cake pan', price: 59, icon: 'cakePan' },
  { id: 'bag', name: 'Piping bag set', price: 18, icon: 'pipingBag' },
  { id: 'mixer', name: 'Stand mixer', price: 429, icon: 'standMixer' },
  { id: 'whisk', name: 'Balloon whisk', price: 14, icon: 'whisk' },
  { id: 'pin', name: 'French rolling pin', price: 29, icon: 'rollingPin' },
];

// Turn { tin: 6, pan: 4 } into priced lines and a total.
function priceOrder(quantities) {
  const lines = [];
  for (const [id, qty] of Object.entries(quantities || {})) {
    const product = PRODUCTS.find((p) => p.id === id);
    const n = Math.max(0, Math.min(99, parseInt(qty, 10) || 0));
    if (product && n > 0) lines.push({ id, name: product.name, qty: n, price: product.price, subtotal: n * product.price });
  }
  const total = lines.reduce((sum, l) => sum + l.subtotal, 0);
  return { lines, total };
}

module.exports = { PRODUCTS, priceOrder };
