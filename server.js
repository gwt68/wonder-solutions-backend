require('dotenv').config();
const express = require('express');
const cors = require('cors');

const voiceRoutes = require('./routes/voice');

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded data
app.use(express.json());

app.use('/voice', voiceRoutes);

app.get('/', (req, res) => res.send('Wonder Solutions backend is running.'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
