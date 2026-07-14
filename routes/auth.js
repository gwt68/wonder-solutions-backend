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

module.exports = { router, requireAuth };
