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
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password is required' });

  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'portal_password'`);
    const correct = rows.length ? rows[0].value : null;

    if (!correct || password !== correct) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    res.json({ token: issueToken() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = { router, requireAuth };
