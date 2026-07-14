const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET all messages
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM messages ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST create a message (text/TTS-based, from the web portal)
router.post('/', async (req, res) => {
  const { title, type, text_content, audio_url } = req.body;
  if (!type) return res.status(400).json({ error: 'type is required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO messages (title, type, text_content, audio_url)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [title || null, type, text_content || null, audio_url || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

// DELETE a message
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM messages WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

module.exports = router;
