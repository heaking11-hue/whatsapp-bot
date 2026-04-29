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

// Health check - مهم لـ HostingGuru
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    time: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

app.use('/webhook', webhookRouter);
app.use('/dashboard', dashboardRouter);
app.get('/', (req, res) => res.redirect('/dashboard'));

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
