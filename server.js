require('dotenv').config();
const express    = require('express');
const mongoose   = require('mongoose');
const bodyParser = require('body-parser');
const path       = require('path');

const webhookRouter   = require('./src/webhook');
const dashboardRouter = require('./src/dashboard');

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'views')));

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    time: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

app.get('/test-gemini', async (req, res) => {
  try {
    const axios = require('axios');
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.json({ success: false, error: 'GEMINI_API_KEY missing' });
    }
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        contents: [{ role: 'user', parts: [{ text: 'قل مرحبا' }] }],
        generationConfig: { maxOutputTokens: 50 }
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    const text = response.data.candidates[0].content.parts[0].text;
    res.json({ success: true, reply: text });
  } catch (err) {
    res.json({
      success: false,
      status: err.response?.status,
      error: err.response?.data || err.message
    });
  }
});

app.use('/webhook', webhookRouter);
app.use('/dashboard', dashboardRouter);
app.get('/', (req, res) => res.redirect('/dashboard'));

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log('🚀 Server running on port ' + PORT);
});
