require('dotenv').config();
const express = require('express');
const cors = require('cors');

const voiceRoutes = require('./routes/voice');
const contactsRoutes = require('./routes/contacts');
const groupsRoutes = require('./routes/groups');
const messagesRoutes = require('./routes/messages');
const settingsRoutes = require('./routes/settings');
const { router: authRoutes } = require('./routes/auth');
const { router: sendsRoutes, processDueSends } = require('./routes/sends');
const publicRoutes = require('./routes/public');

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded data
app.use(express.json());

app.use('/voice', voiceRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/sends', sendsRoutes);
app.use('/api/public', publicRoutes);

app.get('/', (req, res) => res.send('Wonder Solutions backend is running.'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// Check every minute for scheduled sends whose time has come
setInterval(processDueSends, 60 * 1000);
