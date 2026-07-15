const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAuth } = require('./auth');

router.use(requireAuth);

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
  const { name, phone_number, email, address, preferred_method, methods, notes, group_ids } = req.body;
  if (!phone_number) return res.status(400).json({ error: 'phone_number is required' });

  const enabledMethods = Array.isArray(methods) && methods.length ? methods : [preferred_method || 'sms'];
  const defaultMethod = enabledMethods.includes(preferred_method) ? preferred_method : enabledMethods[0];

  try {
    const { rows } = await pool.query(
      `INSERT INTO contacts (name, phone_number, email, address, preferred_method, methods, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name || null, phone_number, email || null, address || null, defaultMethod, enabledMethods, notes || null]
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

// POST bulk-import contacts (used by the Excel upload feature)
// Expects: { contacts: [{ name, phone_number, email, address, preferred_method, notes }, ...] }
router.post('/bulk', async (req, res) => {
  const { contacts } = req.body;
  if (!Array.isArray(contacts) || !contacts.length) {
    return res.status(400).json({ error: 'contacts array is required' });
  }

  const results = { created: 0, skipped: 0, errors: [] };

  for (const c of contacts) {
    const phone = (c.phone_number || '').toString().trim();
    if (!phone) {
      results.skipped++;
      results.errors.push({ row: c, reason: 'Missing phone number' });
      continue;
    }
    try {
      const method = c.preferred_method || 'sms';
      await pool.query(
        `INSERT INTO contacts (name, phone_number, email, address, preferred_method, methods, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (phone_number) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, contacts.name),
           email = COALESCE(EXCLUDED.email, contacts.email),
           address = COALESCE(EXCLUDED.address, contacts.address),
           notes = COALESCE(EXCLUDED.notes, contacts.notes)`,
        [
          c.name || null,
          phone,
          c.email || null,
          c.address || null,
          method,
          [method],
          c.notes || null,
        ]
      );
      results.created++;
    } catch (err) {
      results.skipped++;
      results.errors.push({ row: c, reason: err.message });
    }
  }

  res.json(results);
});

// PUT update a contact
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, phone_number, email, address, preferred_method, methods, notes, group_ids } = req.body;

  let defaultMethod = preferred_method;
  let enabledMethods = Array.isArray(methods) && methods.length ? methods : null;
  if (enabledMethods && defaultMethod && !enabledMethods.includes(defaultMethod)) {
    defaultMethod = enabledMethods[0];
  }

  try {
    const { rows } = await pool.query(
      `UPDATE contacts SET
         name = COALESCE($1, name),
         phone_number = COALESCE($2, phone_number),
         email = $3,
         address = $4,
         preferred_method = COALESCE($5, preferred_method),
         methods = COALESCE($6, methods),
         notes = $7
       WHERE id = $8 RETURNING *`,
      [name, phone_number, email || null, address || null, defaultMethod, enabledMethods, notes || null, id]
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
