-- Wonder Solutions messaging platform schema

CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  phone_number VARCHAR(20) NOT NULL UNIQUE,
  preferred_method VARCHAR(20) NOT NULL DEFAULT 'sms', -- 'sms' | 'call' | 'voice_note'
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'web', -- 'web' | 'phone_placeholder'
  audio_label_url TEXT, -- set when created via phone, until renamed on the web portal
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contact_groups (
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, group_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255),
  type VARCHAR(20) NOT NULL, -- 'sms' | 'call' | 'voice_note'
  text_content TEXT,         -- used for sms body and/or TTS script
  audio_url TEXT,            -- used for call playback and voice_note MMS
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sends (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'queued', -- 'queued' | 'sent' | 'delivered' | 'failed'
  twilio_sid VARCHAR(64),
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(64) PRIMARY KEY,
  value TEXT NOT NULL
);

-- Tracks IVR call state per active call, keyed by Twilio's CallSid
CREATE TABLE IF NOT EXISTS call_sessions (
  call_sid VARCHAR(64) PRIMARY KEY,
  step VARCHAR(64) NOT NULL DEFAULT 'pin_entry',
  attempts INTEGER NOT NULL DEFAULT 0,
  data JSONB DEFAULT '{}', -- scratch space: entered digits, pending recording url, etc.
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed the call-in PIN (change this after setup)
INSERT INTO settings (key, value) VALUES ('call_in_pin', '1234')
  ON CONFLICT (key) DO NOTHING;
