const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET all contacts, with their group memberships
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, COALESCE(
        json_agg(
          json_build_object('id', g.id, 'name', g.name)
        ) FILTER (WHERE g.id IS NOT NULL), '[]'
      ) AS groups
      FROM contacts c
      LEFT JOIN contact_groups cg ON cg.contact_id = c.id
      LEFT JOIN groups g ON g.id = cg.group_id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// POST create a new contact
router.post('/', async (req, res) => {
  const { name, phone_number, preferred_method, notes, group_ids } = req.body;
  if (!phone_number) return res.status(400).json({ error: 'phone_number is required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO contacts (name, phone_number, preferred_method, notes)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name || null, phone_number, preferred_method || 'sms', notes || null]
    );
    const contact = rows[0];

    if (Array.isArray(group_ids) && group_ids.length) {
      const values = group_ids.map((gid) => `(${contact.id}, ${gid})`).join(',');
      await pool.query(
        `INSERT INTO contact_groups (contact_id, group_id) VALUES ${values} ON CONFLICT DO NOTHING`
      );
    }

    res.status(201).json(contact);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'A contact with this phone number already exists' });
    res.status(500).json({ error: 'Failed to create contact' });
  }
});

// PUT update a contact
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, phone_number, preferred_method, notes, group_ids } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE contacts SET
         name = COALESCE($1, name),
         phone_number = COALESCE($2, phone_number),
         preferred_method = COALESCE($3, preferred_method),
         notes = COALESCE($4, notes)
       WHERE id = $5 RETURNING *`,
      [name, phone_number, preferred_method, notes, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contact not found' });

    if (Array.isArray(group_ids)) {
      await pool.query('DELETE FROM contact_groups WHERE contact_id = $1', [id]);
      if (group_ids.length) {
        const values = group_ids.map((gid) => `(${id}, ${gid})`).join(',');
        await pool.query(`INSERT INTO contact_groups (contact_id, group_id) VALUES ${values}`);
      }
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// DELETE a contact
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM contacts WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

module.exports = router;
