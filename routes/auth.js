const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../db/pool');

// In-memory session store. Simple and sufficient for a single small backend instance —
// tokens are lost on redeploy/restart, which just means logging in again.
const validTokens = new Map(); // token -> expiry timestamp
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function issueToken() {
  const token = crypto.randomBytes(32).toString('hex');
  validTokens.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const expiry = token && validTokens.get(token);

  if (!expiry || expiry < Date.now()) {
    if (token) validTokens.delete(token);
    return res.status(401).json({ error: 'Not logged in' });
  }
  next();
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM settings WHERE key IN ('portal_username', 'portal_password')`
    );
    const settingsMap = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const correctUsername = settingsMap.portal_username || 'admin';
    const correctPassword = settingsMap.portal_password;

    if (!correctPassword || username !== correctUsername || password !== correctPassword) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }

    res.json({ token: issueToken() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Recovers a forgotten username/password using a separate recovery key
// (set in advance from Settings). Deliberately not behind requireAuth,
// since the whole point is to regain access without being logged in.
router.post('/recover', async (req, res) => {
  const { recovery_key, new_username, new_password } = req.body;
  if (!recovery_key || !new_username || !new_password) {
    return res.status(400).json({ error: 'Recovery key, new username, and new password are all required' });
  }
  if (new_username.trim().length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' });
  if (new_password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'recovery_key'`);
    const correctKey = rows.length ? rows[0].value : null;

    if (!correctKey) {
      return res.status(400).json({ error: 'No recovery key has been set up yet. Set one from Settings while logged in.' });
    }
    if (recovery_key !== correctKey) {
      return res.status(401).json({ error: 'Incorrect recovery key' });
    }

    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('portal_username', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [new_username.trim()]
    );
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('portal_password', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [new_password]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Recovery failed' });
  }
});

module.exports = { router, requireAuth };
