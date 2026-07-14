const express = require('express');
const router = express.Router();
const twilio = require('twilio');

// TEMPORARY diagnostic route — remove once the recording playback issue is resolved.
// Visit this URL directly in a browser; no login required (read-only, no secrets exposed).
router.get('/twilio-test', async (req, res) => {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const result = { sidLength: sid.length, tokenLength: token.length, steps: [] };

  if (!sid || !token) {
    result.steps.push({ step: 'env check', ok: false, detail: 'Missing SID or token in environment' });
    return res.json(result);
  }

  const client = twilio(sid, token);

  // Step 1: can we authenticate at all against the account?
  try {
    const account = await client.api.accounts(sid).fetch();
    result.steps.push({ step: 'fetch account', ok: true, status: account.status, type: account.type });
  } catch (err) {
    result.steps.push({ step: 'fetch account', ok: false, error: err.message, code: err.code, status: err.status });
    return res.json(result); // no point continuing if this fails
  }

  // Step 2: can we list recordings via the SDK?
  let recordings = [];
  try {
    recordings = await client.recordings.list({ limit: 3 });
    result.steps.push({
      step: 'list recordings',
      ok: true,
      count: recordings.length,
      sids: recordings.map((r) => r.sid),
    });
  } catch (err) {
    result.steps.push({ step: 'list recordings', ok: false, error: err.message, code: err.code, status: err.status });
    return res.json(result);
  }

  // Step 3: try downloading the actual media for the first recording, exactly like our /audio route does
  if (recordings.length) {
    const rec = recordings[0];
    const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Recordings/${rec.sid}.mp3`;
    try {
      const auth = Buffer.from(`${sid}:${token}`).toString('base64');
      const mediaRes = await fetch(mediaUrl, { headers: { Authorization: `Basic ${auth}` } });
      const bodyText = mediaRes.ok ? '(binary audio, looks fine)' : await mediaRes.text();
      result.steps.push({
        step: 'fetch media directly',
        ok: mediaRes.ok,
        status: mediaRes.status,
        contentType: mediaRes.headers.get('content-type'),
        body: mediaRes.ok ? undefined : bodyText.slice(0, 300),
      });
    } catch (err) {
      result.steps.push({ step: 'fetch media directly', ok: false, error: err.message });
    }
  }

  res.json(result);
});

module.exports = router;
