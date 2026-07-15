const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// POST public sign-up. Deliberately not behind requireAuth — this is meant to be
// called by anyone visiting the public signup page. Includes a honeypot field
// ('company') that real users never see or fill in, to deter basic spam bots.
router.post('/optin', async (req, res) => {
  const { name, phone_number, company } = req.body;

  if (company) {
    // Honeypot triggered — silently accept without actually doing anything.
    return res.status(200).json({ ok: true });
  }

  if (!phone_number || !phone_number.trim()) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  try {
    await pool.query(
      `INSERT INTO contacts (name, phone_number, preferred_method, consent_source, consent_at)
       VALUES ($1, $2, 'sms', 'website_form', NOW())
       ON CONFLICT (phone_number) DO UPDATE SET
         consent_source = 'website_form',
         consent_at = NOW()`,
      [name || null, phone_number.trim()]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
