require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const {
  makeWASocket,
  delay,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let sock;
let isConnected = false;

// ========== دالة إنشاء مجلد المصادقة مع إعادة المحاولة ==========
function ensureAuthFolder(folderPath, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
        console.log(`✅ Auth folder created at: ${folderPath}`);
      }
      return true;
    } catch (err) {
      console.error(`❌ Attempt ${i + 1} failed to create auth folder: ${err.message}`);
      if (i < maxRetries - 1) {
        // تجربة مسار مختلف في المحاولة التالية
        folderPath = `/tmp/auth_${Date.now()}`;
      }
    }
  }
  return false;
}

async function startBaileys() {
  // 🟢 استخدام مسار بديل مع إعادة المحاولة
  let authPath = '/tmp/auth_info_baileys';
  const created = ensureAuthFolder(authPath);
  
  if (!created) {
    // آخر محاولة: استخدام مسار في المجلد الحالي
    authPath = path.join(__dirname, 'auth_info_baileys');
    if (!fs.existsSync(authPath)) {
      try {
        fs.mkdirSync(authPath, { recursive: true });
      } catch (e) {
        console.error('Cannot create auth folder anywhere. Exiting...');
        process.exit(1);
      }
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  
  sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino().child({ level: 'silent' })),
    },
    printQRInTerminal: false,
    defaultQueryTimeoutMs: undefined,
    markOnlineOnConnect: true,
    connectTimeoutMs: 30000,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      console.log('✅ Baileys connected');
      isConnected = true;
    }
    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting...', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(startBaileys, 5000);
      } else {
        console.log('Logged out. Delete auth folder and restart.');
        process.exit(1);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // طلب رمز الاقتران تلقائيًا
  if (!isConnected) {
    try {
      const phoneNumber = process.env.WHATSAPP_PHONE_NUMBER;
      const pairingCode = await sock.requestPairingCode(phoneNumber);
      console.log('📱 Pairing Code:', pairingCode);
      console.log('اذهب إلى WhatsApp > Linked Devices > Link a Device > Enter code manually');
    } catch (e) {
      console.error('Failed to request pairing code:', e.message);
    }
  }
}

startBaileys();

// ========== واجهة API للإرسال ==========
app.post('/api/send', async (req, res) => {
  if (!isConnected) return res.status(503).json({ error: 'Bot not connected yet' });

  const { message, mediaUrl, caption, phones, delayMin, delayMax } = req.body;
  if (!phones || phones.length === 0) return res.status(400).json({ error: 'Missing phones' });
  if (!message && !mediaUrl) return res.status(400).json({ error: 'Missing message or mediaUrl' });

  let results = [];
  for (const phone of phones) {
    const cleanPhone = phone.toString().replace(/[^0-9]/g, '');
    if (!cleanPhone) continue;
    try {
      const content = {};
      if (mediaUrl) {
        const isVideo = mediaUrl.match(/\.(mp4|mov|avi)/i);
        content[isVideo ? 'video' : 'image'] = { url: mediaUrl };
        if (caption) content.caption = caption;
      } else {
        content.text = message;
      }
      
      await sock.sendMessage(`${cleanPhone}@s.whatsapp.net`, content);
      results.push({ phone: cleanPhone, status: 'sent' });
      
      const dMin = parseInt(delayMin) || 4000;
      const dMax = parseInt(delayMax) || 8000;
      const wait = Math.floor(Math.random() * (dMax - dMin + 1)) + dMin;
      await delay(wait);
      
    } catch (e) {
      results.push({ phone: cleanPhone, status: 'failed', error: e.message });
      await delay(2000);
    }
  }

  res.json({ success: true, results });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));
