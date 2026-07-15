const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// Twilio posts here as an SMS/MMS moves through queued -> sent -> delivered/undelivered/failed.
// Not behind requireAuth — Twilio can't send our login token.
router.post('/sms-status', async (req, res) => {
  const { MessageSid, MessageStatus } = req.body;
  try {
    if (MessageSid) {
      await pool.query(
        `UPDATE sends SET delivery_status = $1 WHERE twilio_sid = $2`,
        [MessageStatus, MessageSid]
      );
    }
  } catch (err) {
    console.error('sms-status webhook error:', err);
  }
  res.status(200).end();
});

// Twilio posts here as a call moves through ringing -> answered/no-answer -> completed,
// including call duration and (if machine detection is on) whether a person or
// voicemail/answering machine picked up.
router.post('/call-status', async (req, res) => {
  const { CallSid, CallStatus, CallDuration, AnsweredBy } = req.body;
  try {
    if (CallSid) {
      await pool.query(
        `UPDATE sends SET
           delivery_status = $1,
           call_duration = COALESCE($2::int, call_duration),
           answered_by = COALESCE($3, answered_by)
         WHERE twilio_sid = $4`,
        [CallStatus, CallDuration || null, AnsweredBy || null, CallSid]
      );
    }
  } catch (err) {
    console.error('call-status webhook error:', err);
  }
  res.status(200).end();
});

module.exports = router;
