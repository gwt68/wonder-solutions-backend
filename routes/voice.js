const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const pool = require('../db/pool');

const VoiceResponse = twilio.twiml.VoiceResponse;
const BASE_URL = process.env.BASE_URL; // e.g. https://wonder-solutions-backend.up.railway.app

// ---------- session helpers ----------

async function getSession(callSid) {
  const { rows } = await pool.query('SELECT * FROM call_sessions WHERE call_sid = $1', [callSid]);
  if (rows.length) return rows[0];
  const { rows: created } = await pool.query(
    `INSERT INTO call_sessions (call_sid, step, attempts, data) VALUES ($1, 'pin_entry', 0, '{}') RETURNING *`,
    [callSid]
  );
  return created[0];
}

async function updateSession(callSid, step, dataPatch = {}, attempts = null) {
  const session = await getSession(callSid);
  const newData = { ...session.data, ...dataPatch };
  const newAttempts = attempts !== null ? attempts : session.attempts;
  await pool.query(
    `UPDATE call_sessions SET step = $1, data = $2, attempts = $3, updated_at = NOW() WHERE call_sid = $4`,
    [step, newData, newAttempts, callSid]
  );
  return { ...session, step, data: newData, attempts: newAttempts };
}

async function clearSession(callSid) {
  await pool.query('DELETE FROM call_sessions WHERE call_sid = $1', [callSid]);
}

async function getPin() {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'call_in_pin'`);
  return rows.length ? rows[0].value : '1234';
}

// ---------- prompt builders ----------

function gatherDigits(twiml, action, prompt, opts = {}) {
  const gather = twiml.gather({
    numDigits: opts.numDigits,
    finishOnKey: opts.finishOnKey ?? '#',
    action,
    method: 'POST',
    timeout: opts.timeout ?? 8,
  });
  gather.say(prompt);
  // if caller enters nothing, Twilio falls through past <Gather> - repeat the menu
  twiml.redirect(action.replace('/handle', '/repeat'));
  return twiml;
}

function say(twiml, text) {
  twiml.say(text);
  return twiml;
}

// ---------- entry point ----------

router.post('/incoming', async (req, res) => {
  const callSid = req.body.CallSid;
  await clearSession(callSid); // fresh session on every new call
  await getSession(callSid); // creates pin_entry session

  const twiml = new VoiceResponse();
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    'Welcome. Please enter your P I N followed by the pound sign.'
  );
  res.type('text/xml').send(twiml.toString());
});

// ---------- single handler, dispatches on session step ----------

router.post('/handle', async (req, res) => {
  const callSid = req.body.CallSid;
  const digits = req.body.Digits;
  // Twilio's RecordingUrl points to the recording *resource*, not the audio file itself.
  // Appending .mp3 gives the actual playable media.
  const recordingUrl = req.body.RecordingUrl ? `${req.body.RecordingUrl}.mp3` : null;
  const session = await getSession(callSid);
  const twiml = new VoiceResponse();

  switch (session.step) {
    case 'pin_entry': {
      const correctPin = await getPin();
      if (digits === correctPin) {
        await updateSession(callSid, 'main_menu');
        mainMenu(twiml);
      } else {
        const attempts = session.attempts + 1;
        if (attempts >= 3) {
          say(twiml, 'Too many incorrect attempts. Goodbye.');
          twiml.hangup();
          await clearSession(callSid);
        } else {
          await updateSession(callSid, 'pin_entry', {}, attempts);
          gatherDigits(twiml, `${BASE_URL}/voice/handle`, 'Incorrect PIN. Please try again, followed by the pound sign.');
        }
      }
      break;
    }

    case 'main_menu': {
      if (digits === '1') {
        await updateSession(callSid, 'record_prompt');
        recordPrompt(twiml);
      } else if (digits === '2') {
        await startReview(callSid, twiml);
      } else if (digits === '3') {
        await updateSession(callSid, 'contact_phone_entry');
        contactPhoneEntry(twiml);
      } else {
        mainMenu(twiml, true);
      }
      break;
    }

    // ----- Branch 1: record a new message -----

    case 'record_prompt': {
      // Twilio hits this after <Record> completes, with RecordingUrl
      if (recordingUrl) {
        await updateSession(callSid, 'record_review', { pending_recording_url: recordingUrl });
        recordReviewPrompt(twiml);
      } else {
        recordPrompt(twiml); // shouldn't normally happen, re-prompt
      }
      break;
    }

    case 'record_review': {
      if (digits === '1') {
        // save
        const { rows } = await pool.query(
          `INSERT INTO messages (title, type, audio_url) VALUES ($1, 'voice_note', $2) RETURNING id`,
          [`Recorded ${new Date().toISOString()}`, session.data.pending_recording_url]
        );
        await updateSession(callSid, 'main_menu', { last_message_id: rows[0].id });
        say(twiml, 'Message saved.');
        mainMenu(twiml);
      } else if (digits === '2') {
        twiml.play(session.data.pending_recording_url);
        recordReviewPrompt(twiml);
      } else if (digits === '3') {
        await updateSession(callSid, 'record_prompt');
        recordPrompt(twiml);
      } else if (digits === '4') {
        await updateSession(callSid, 'main_menu');
        say(twiml, 'Cancelled.');
        mainMenu(twiml);
      } else {
        recordReviewPrompt(twiml, true);
      }
      break;
    }

    // ----- Branch 2: review saved messages -----

    case 'review_list': {
      const ids = session.data.message_ids || [];
      let index = session.data.review_index || 0;

      if (digits === '0') {
        await updateSession(callSid, 'main_menu');
        mainMenu(twiml);
        break;
      }
      if (digits === '2') {
        const currentId = ids[index];
        await pool.query('DELETE FROM messages WHERE id = $1', [currentId]);
      }
      // '1' (keep) and '#' (next) both just advance
      index += 1;
      if (index >= ids.length) {
        say(twiml, 'No more messages.');
        await updateSession(callSid, 'main_menu');
        mainMenu(twiml);
      } else {
        await updateSession(callSid, 'review_list', { review_index: index });
        await playReviewMessage(twiml, ids[index], index, ids.length);
      }
      break;
    }

    // ----- Branch 3: manage contacts -----

    case 'contact_phone_entry': {
      if (digits && digits.length >= 10) {
        await updateSession(callSid, 'contact_phone_confirm', { pending_phone: digits });
        confirmPhone(twiml, digits);
      } else {
        contactPhoneEntry(twiml, true);
      }
      break;
    }

    case 'contact_phone_confirm': {
      if (digits === '1') {
        await updateSession(callSid, 'contact_method_select');
        methodSelect(twiml);
      } else {
        await updateSession(callSid, 'contact_phone_entry');
        contactPhoneEntry(twiml);
      }
      break;
    }

    case 'contact_method_select': {
      const methodMap = { '1': 'sms', '2': 'call', '3': 'voice_note' };
      const method = methodMap[digits];
      if (method) {
        await updateSession(callSid, 'contact_group_offer', { pending_method: method });
        groupOffer(twiml);
      } else {
        methodSelect(twiml, true);
      }
      break;
    }

    case 'contact_group_offer': {
      if (digits === '1') {
        const groups = await pool.query('SELECT id, name FROM groups ORDER BY id');
        await updateSession(callSid, 'contact_group_list', { group_page: groups.rows });
        groupList(twiml, groups.rows);
      } else {
        await saveContact(callSid, twiml, null);
      }
      break;
    }

    case 'contact_group_list': {
      const groupRows = session.data.group_page || [];
      if (digits === '9') {
        await updateSession(callSid, 'contact_group_new_record');
        newGroupRecordPrompt(twiml);
      } else if (digits === '0') {
        await saveContact(callSid, twiml, null);
      } else {
        const idx = parseInt(digits, 10) - 1;
        const group = groupRows[idx];
        if (group) {
          await saveContact(callSid, twiml, group.id);
        } else {
          groupList(twiml, groupRows, true);
        }
      }
      break;
    }

    case 'contact_group_new_record': {
      if (recordingUrl) {
        const { rows } = await pool.query(
          `INSERT INTO groups (name, source, audio_label_url) VALUES ($1, 'phone_placeholder', $2) RETURNING id`,
          [`New group — ${new Date().toLocaleString()}`, recordingUrl]
        );
        await saveContact(callSid, twiml, rows[0].id);
      } else {
        newGroupRecordPrompt(twiml);
      }
      break;
    }

    case 'contact_saved_next': {
      if (digits === '1') {
        await updateSession(callSid, 'contact_phone_entry');
        contactPhoneEntry(twiml);
      } else {
        await updateSession(callSid, 'main_menu');
        mainMenu(twiml);
      }
      break;
    }

    default: {
      say(twiml, 'Something went wrong. Returning to the main menu.');
      await updateSession(callSid, 'main_menu');
      mainMenu(twiml);
    }
  }

  res.type('text/xml').send(twiml.toString());
});

// Handles the case where <Gather> times out with no input - just repeats current prompt
router.post('/repeat', async (req, res) => {
  const callSid = req.body.CallSid;
  const session = await getSession(callSid);
  const twiml = new VoiceResponse();
  // simplest approach: send caller back through /handle with no digits, which
  // re-prompts for most steps. Recording steps rely on Twilio's own timeout instead.
  twiml.redirect(`${BASE_URL}/voice/handle`);
  res.type('text/xml').send(twiml.toString());
});

// ---------- step prompt functions ----------

function mainMenu(twiml, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `${prefix}Press 1 to record a new message. Press 2 to review your messages. Press 3 to manage contacts.`
  );
}

function recordPrompt(twiml) {
  twiml.say('Record your message after the beep. Press pound when finished.');
  twiml.record({
    action: `${BASE_URL}/voice/handle`,
    method: 'POST',
    finishOnKey: '#',
    maxLength: 120,
    playBeep: true,
  });
}

function recordReviewPrompt(twiml, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `${prefix}Press 1 to save this message. Press 2 to hear it back. Press 3 to re-record. Press 4 to cancel.`,
    { numDigits: 1 }
  );
}

async function startReview(callSid, twiml) {
  const { rows } = await pool.query(`SELECT id FROM messages ORDER BY created_at DESC`);
  if (!rows.length) {
    twiml.say('You have no saved messages.');
    await updateSession(callSid, 'main_menu');
    mainMenu(twiml);
    return;
  }
  const ids = rows.map(r => r.id);
  await updateSession(callSid, 'review_list', { message_ids: ids, review_index: 0 });
  twiml.say(`You have ${ids.length} saved messages.`);
  await playReviewMessage(twiml, ids[0], 0, ids.length);
}

async function playReviewMessage(twiml, messageId, index, total) {
  const { rows } = await pool.query('SELECT * FROM messages WHERE id = $1', [messageId]);
  const msg = rows[0];
  const gather = twiml.gather({
    numDigits: 1,
    action: `${BASE_URL}/voice/handle`,
    method: 'POST',
    timeout: 8,
  });
  gather.say(`Message ${index + 1} of ${total}.`);
  if (msg.audio_url) gather.play(msg.audio_url);
  gather.say('Press 1 to keep, press 2 to delete, press pound for the next message, press 0 to return to the main menu.');
  twiml.redirect(`${BASE_URL}/voice/repeat`);
}

function contactPhoneEntry(twiml, retry = false) {
  const prefix = retry ? "That didn't look like a valid number. " : '';
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `${prefix}Enter the phone number followed by the pound sign.`,
    { finishOnKey: '#' }
  );
}

function confirmPhone(twiml, digits) {
  const spaced = digits.split('').join(' ');
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `You entered ${spaced}. Press 1 to confirm, press 2 to re-enter.`,
    { numDigits: 1 }
  );
}

function methodSelect(twiml, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `${prefix}Press 1 for text message. Press 2 for phone call. Press 3 for voice note.`,
    { numDigits: 1 }
  );
}

function groupOffer(twiml) {
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    'Press 1 to assign this contact to a group, or press 2 to skip.',
    { numDigits: 1 }
  );
}

function groupList(twiml, groups, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  const names = groups.map((g, i) => `Group ${i + 1} is ${g.name}.`).join(' ');
  const namesPart = groups.length ? names + ' ' : 'You have no groups yet. ';
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `${prefix}${namesPart}Press the group number, or press 9 to create a new group, or press 0 to skip.`
  );
}

function newGroupRecordPrompt(twiml) {
  twiml.say("Record the new group's name after the beep, then press pound.");
  twiml.record({
    action: `${BASE_URL}/voice/handle`,
    method: 'POST',
    finishOnKey: '#',
    maxLength: 15,
    playBeep: true,
  });
}

async function saveContact(callSid, twiml, groupId) {
  const session = await getSession(callSid);
  const phone = session.data.pending_phone;
  const method = session.data.pending_method;

  const { rows } = await pool.query(
    `INSERT INTO contacts (phone_number, preferred_method) VALUES ($1, $2)
     ON CONFLICT (phone_number) DO UPDATE SET preferred_method = $2
     RETURNING id`,
    [phone, method]
  );
  const contactId = rows[0].id;

  if (groupId) {
    await pool.query(
      `INSERT INTO contact_groups (contact_id, group_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [contactId, groupId]
    );
  }

  await updateSession(callSid, 'contact_saved_next');
  twiml.say('Contact saved.');
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    'Press 1 to add another contact, press 2 to return to the main menu.',
    { numDigits: 1 }
  );
}

module.exports = router;
