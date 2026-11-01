// =============================================================================
// server.js — starts the PUBLIC version of the demo.
//
//   npm install
//   npm start         then open http://localhost:3000
//
// This copy is safe to host for anyone to try: it has no Twilio credentials
// and never calls Twilio. Every step is simulated (see src/twilio.js).
// =============================================================================

const path = require('path');
const express = require('express');
const { perVisitor } = require('./src/state');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // the storefront files
app.use(perVisitor); // each browser gets its own copy of Leo's story (src/state.js)

// API routes, one file per part of the story.
app.use('/api', require('./routes/presenter'));
app.use('/api/signup', require('./routes/signup')); // Beat 1
app.use('/api/passkey', require('./routes/passkey')); // passkey set-up and prompts (Beats 1–4)
app.use('/api/checkout', require('./routes/checkout')); // Beat 2
app.use('/api/contact', require('./routes/contact')); // Beat 3
app.use('/api/loyalty', require('./routes/loyalty')); // Beat 4
app.use('/api/promo', require('./routes/promo')); // Beat 5

// Catch-all for unexpected errors: friendly message, details in the terminal.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.', entries: [] });
});

app.listen(PORT, () => {
  console.log(`\nTwill public demo running at http://localhost:${PORT}`);
  console.log('  Every Twilio step is simulated: no credentials, no API calls.');
  console.log('  Demo controls: click the gear icon or press the ` key\n');
});
