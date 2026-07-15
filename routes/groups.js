const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAuth } = require('./auth');

// GET all groups, with member counts
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT g.*, COUNT(cg.contact_id)::int AS member_count
      FROM groups g
      LEFT JOIN contact_groups cg ON cg.group_id = g.id
      GROUP BY g.id
      ORDER BY g.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// POST create a group
router.post('/', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO groups (name, source) VALUES ($1, 'web') RETURNING *`,
      [name]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// PUT rename a group (also used to finalize phone-created placeholder groups)
router.put('/:id', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const { rows } = await pool.query(
      `UPDATE groups SET name = $1, source = 'web' WHERE id = $2 RETURNING *`,
      [name, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Group not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// DELETE a group
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM groups WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// GET contacts within a group
router.get('/:id/contacts', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.* FROM contacts c
       JOIN contact_groups cg ON cg.contact_id = c.id
       WHERE cg.group_id = $1
       ORDER BY c.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch group contacts' });
  }
});

// GET the playable audio for a phone-recorded group name (proxied from Twilio,
// which requires authenticated access)
router.get('/:id/audio-label', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT audio_label_url FROM groups WHERE id = $1', [req.params.id]);
    if (!rows.length || !rows[0].audio_label_url) return res.status(404).end();

    const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
    const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const twilioRes = await fetch(rows[0].audio_label_url, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!twilioRes.ok) return res.status(502).json({ error: 'Could not fetch recording from Twilio' });
    res.set('Content-Type', twilioRes.headers.get('content-type') || 'audio/mpeg');
    const buffer = Buffer.from(await twilioRes.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load audio' });
  }
});

// POST add contacts to a group (used from the group detail view)
router.post('/:id/contacts', requireAuth, async (req, res) => {
  const { contact_ids } = req.body;
  if (!Array.isArray(contact_ids) || !contact_ids.length) {
    return res.status(400).json({ error: 'contact_ids array is required' });
  }
  try {
    const values = contact_ids.map((cid) => `(${parseInt(cid, 10)}, ${req.params.id})`).join(',');
    await pool.query(
      `INSERT INTO contact_groups (contact_id, group_id) VALUES ${values} ON CONFLICT DO NOTHING`
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add contacts to group' });
  }
});

// DELETE remove a single contact from a group
router.delete('/:id/contacts/:contactId', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM contact_groups WHERE group_id = $1 AND contact_id = $2',
      [req.params.id, req.params.contactId]
    );
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove contact from group' });
  }
});

module.exports = router;
