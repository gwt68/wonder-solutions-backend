const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET current call-in PIN
router.get('/pin', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'call_in_pin'`);
    res.json({ pin: rows.length ? rows[0].value : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch PIN' });
  }
});

// PUT update the call-in PIN
router.put('/pin', async (req, res) => {
  const { pin } = req.body;
  if (!pin || !/^\d{4,8}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must be 4-8 digits' });
  }
  try {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('call_in_pin', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [pin]
    );
    res.json({ pin });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update PIN' });
  }
});

module.exports = router;
