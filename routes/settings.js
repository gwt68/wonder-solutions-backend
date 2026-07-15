const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAuth } = require('./auth');

router.use(requireAuth);

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

// PUT update the web portal login password
router.put('/portal-password', async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  try {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('portal_password', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [password]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// GET current portal username
router.get('/portal-username', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'portal_username'`);
    res.json({ username: rows.length ? rows[0].value : 'admin' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch username' });
  }
});

// PUT update the web portal login username
router.put('/portal-username', async (req, res) => {
  const { username } = req.body;
  if (!username || username.trim().length < 2) {
    return res.status(400).json({ error: 'Username must be at least 2 characters' });
  }
  try {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('portal_username', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [username.trim()]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update username' });
  }
});

// PUT set/update the account recovery key (used for "forgot username/password")
router.put('/recovery-key', async (req, res) => {
  const { recovery_key } = req.body;
  if (!recovery_key || recovery_key.length < 4) {
    return res.status(400).json({ error: 'Recovery key must be at least 4 characters' });
  }
  try {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('recovery_key', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [recovery_key]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update recovery key' });
  }
});

module.exports = router;
