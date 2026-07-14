const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../db/pool');
const { requireAuth } = require('./auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 }, // 16MB, generous for a voice note
});

// GET all messages (without the heavy audio_data blob)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, type, text_content, audio_url, audio_mime_type,
              (audio_data IS NOT NULL) AS has_uploaded_audio, created_at
       FROM messages ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST create a message (text/TTS-based, from the web portal)
router.post('/', requireAuth, async (req, res) => {
  const { title, type, text_content, audio_url } = req.body;
  if (!type) return res.status(400).json({ error: 'type is required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO messages (title, type, text_content, audio_url)
       VALUES ($1, $2, $3, $4) RETURNING id, title, type, text_content, audio_url, created_at`,
      [title || null, type, text_content || null, audio_url || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

// POST upload an audio file from the computer
router.post('/upload', requireAuth, upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file was uploaded' });

  const title = req.body.title || req.file.originalname;

  try {
    const { rows } = await pool.query(
      `INSERT INTO messages (title, type, audio_data, audio_mime_type)
       VALUES ($1, 'voice_note', $2, $3)
       RETURNING id, title, type, text_content, audio_url, created_at`,
      [title, req.file.buffer, req.file.mimetype]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save uploaded audio' });
  }
});

// GET the actual playable audio for a message — handles both:
//  - uploaded files (served directly from the database)
//  - phone recordings (proxied from Twilio, which requires authenticated access)
router.get('/:id/audio', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT audio_data, audio_mime_type, audio_url FROM messages WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).end();
    const msg = rows[0];

    if (msg.audio_data) {
      res.set('Content-Type', msg.audio_mime_type || 'audio/mpeg');
      return res.send(msg.audio_data);
    }

    if (msg.audio_url) {
      const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
      const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
      console.log(`Twilio creds check — sid length: ${sid.length}, token length: ${token.length}`);

      if (!sid || !token) {
        console.error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN environment variable');
        return res.status(500).json({ error: 'Server is missing Twilio credentials' });
      }

      const auth = Buffer.from(`${sid}:${token}`).toString('base64');
      const twilioRes = await fetch(msg.audio_url, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!twilioRes.ok) {
        const body = await twilioRes.text().catch(() => '');
        console.error(`Twilio recording fetch failed: ${twilioRes.status} ${twilioRes.statusText} — ${body}`);
        return res.status(502).json({
          error: 'Could not fetch recording from Twilio',
          twilioStatus: twilioRes.status,
          twilioBody: body.slice(0, 300),
        });
      }
      res.set('Content-Type', twilioRes.headers.get('content-type') || 'audio/mpeg');
      const buffer = Buffer.from(await twilioRes.arrayBuffer());
      return res.send(buffer);
    }

    res.status(404).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load audio' });
  }
});

// DELETE a message
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM messages WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

module.exports = router;
