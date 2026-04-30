require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');

const webhookRouter = require('./src/webhook');
const dashboardRouter = require('./src/dashboard');

const app = express();

// ──────────────────────────────────────────────
// إعدادات Express للأداء العالي والاستقرار
// ──────────────────────────────────────────────
app.set('trust proxy', 1); // لو فيه reverse proxy
app.disable('x-powered-by'); // أمان إضافي
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'views')));

// ──────────────────────────────────────────────
// نقطة فحص السلامة – هي اللي بتمنع السيرفر من النوم
// ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  // 0: disconnected, 1: connected, 2: connecting, 3: disconnecting
  const dbStatus = dbState === 1 ? 'connected' : dbState === 2 ? 'connecting' : 'disconnected';
  res.status(dbState === 1 ? 200 : 503).json({
    status: dbState === 1 ? 'ok' : 'degraded',
    db: dbStatus,
    uptime: process.uptime(),
    memory: process.memoryUsage().heapUsed,
    timestamp: new Date().toISOString()
  });
});

// نقطة ping سريعة عشان uptime checker
app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

// ──────────────────────────────────────────────
// الاتصال بقاعدة البيانات مع إعادة المحاولة التلقائية
// ──────────────────────────────────────────────
const connectDB = async (retries = 5, delayMs = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        maxPoolSize: 5,
        minPoolSize: 1,
        heartbeatFrequencyMS: 10000,
      });
      console.log('✅ MongoDB connected');
      return true;
    } catch (err) {
      console.error(`❌ MongoDB attempt ${i + 1}/${retries} failed: ${err.message}`);
      if (i < retries - 1) {
        console.log(`🔄 Retrying in ${delayMs / 1000}s...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  console.error('❌ MongoDB connection failed after all retries – starting anyway');
  return false;
};

connectDB();

// ──────────────────────────────────────────────
// المسارات
// ──────────────────────────────────────────────
app.use('/webhook', webhookRouter);
app.use('/dashboard', dashboardRouter);
app.get('/', (req, res) => res.redirect('/dashboard'));

// ──────────────────────────────────────────────
// التقاط الأخطاء العامة (منع الانهيار)
// ──────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Unhandled Express error:', err.message);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────
// السيرفر مع إعدادات keep-alive محسنة
// ──────────────────────────────────────────────
const PORT = process.env.PORT || 8000;
const server = http.createServer(app);

// إعدادات keep-alive لمنع قطع الاتصال
server.keepAliveTimeout = 120 * 1000; // دقيقتين
server.headersTimeout = 125 * 1000; // أطول شوية من keepAliveTimeout
server.maxHeadersCount = 0; // غير محدود
server.requestTimeout = 60 * 1000; // دقيقة للطلب الواحد

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT} (keepAlive=${server.keepAliveTimeout}ms)`);
});

// ──────────────────────────────────────────────
// الإغلاق النظيف (Graceful Shutdown)
// ──────────────────────────────────────────────
const gracefulShutdown = async (signal) => {
  console.log(`\n⚠️ ${signal} received – shutting down gracefully...`);
  
  // منع الطلبات الجديدة
  server.close(() => {
    console.log('🛑 HTTP server closed');
  });

  try {
    // إغلاق قاعدة البيانات
    await mongoose.connection.close();
    console.log('✅ MongoDB disconnected');
  } catch (err) {
    console.error('❌ MongoDB disconnect error:', err.message);
  }

  // الخروج بعد 10 ثواني كحد أقصى
  setTimeout(() => {
    console.log('🛑 Forcing exit');
    process.exit(0);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ──────────────────────────────────────────────
// التقاط الأخطاء غير المتوقعة – منع الانهيار
// ──────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err.message, err.stack);
  // عدم الخروج، الاستمرار في التشغيل
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled rejection:', reason);
});

module.exports = app;
