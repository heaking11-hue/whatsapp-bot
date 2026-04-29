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

// (Health Check) نقطة فحص السلامة
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// الاتصال بقاعدة البيانات - اسم المتغير الصحيح MONGODB_URI
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// المسارات الأساسية
app.use('/webhook', webhookRouter);
app.use('/dashboard', dashboardRouter);
app.get('/', (req, res) => res.redirect('/dashboard'));

// 0.0.0.0 الاستماع على جميع الواجهات
const PORT = process.env.PORT || 8000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
