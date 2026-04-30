const express = require('express');
const router  = express.Router();

const { sendText, sendVideo, extractMessage, fetchMediaUrl } = require('./whatsapp');
const { getReply }          = require('./gemini');
const { Video, getSetting } = require('./database');
const {
  getOrCreateContact,
  getConversationHistory,
  saveMessage,
  buildContactContext
} = require('./contactManager');

// ── نظام الطابور عشان الرسائل متتزاحمش ──────────────────────────
const messageQueue = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing || messageQueue.length === 0) return;
  isProcessing = true;

  while (messageQueue.length > 0) {
    const task = messageQueue.shift();
    try {
      await handleMessage(task);
    } catch (err) {
      console.error('Queue processing error:', err.message);
    }
    // انتظر نص ثانية بين كل رسالة والتانية
    await new Promise(r => setTimeout(r, 1000));
  }

  isProcessing = false;
}

// ── الرسائل اللي اتعالجت عشان متتعالجش مرتين ───────────────────
const processedMsgIds = new Set();

// ── التحقق من الـ webhook ────────────────────────────────────────
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ── استقبال الرسائل ──────────────────────────────────────────────
router.post('/', async (req, res) => {
  res.sendStatus(200); // رد على Meta فوراً

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    const isActive = await getSetting('is_active', true);
    if (!isActive) return;

    for (const entry of (body.entry || [])) {
      if (entry.changes?.[0]?.value?.statuses) continue;

      const msgData = extractMessage(entry);
      if (!msgData) continue;

      const { from, text, msgId, msgType, imageUrl } = msgData;

      if (processedMsgIds.has(msgId)) continue;
      processedMsgIds.add(msgId);
      if (processedMsgIds.size > 1000) {
        processedMsgIds.delete(processedMsgIds.values().next().value);
      }

      // ضيف الرسالة في الطابور
      messageQueue.push({ from, text, msgId, msgType, imageUrl });
      console.log(`📥 Queued message from ${from}: ${text} (queue size: ${messageQueue.length})`);
    }

    // شغّل الطابور
    processQueue();

  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

// ── معالجة كل رسالة ──────────────────────────────────────────────
async function handleMessage({ from, text, msgType, imageUrl }) {
  try {
    console.log(`⚙️ Processing message from ${from}: ${text}`);

    const contact = await getOrCreateContact(from);
    if (contact.isBlocked) return;

    const history        = await getConversationHistory(from, 8);
    const contactContext = buildContactContext(contact, history);
    const systemPrompt   = await getSetting('system_prompt',
      'رد على رسائل واتساب بشكل طبيعي كأنك صاحب الحساب. لا تذكر أنك ذكاء اصطناعي أبداً.');
    const videos = await Video.find({}).lean();

    // جيب الصورة لو موجودة
    let resolvedImageUrl = null;
    if (imageUrl && imageUrl.startsWith('__media:')) {
      const mediaId = imageUrl.replace('__media:', '');
      resolvedImageUrl = await fetchMediaUrl(mediaId);
    }

    // احفظ رسالة المستخدم
    await saveMessage(from, 'user', text, msgType);

    // اطلب الرد من Gemini
    const { reply, videos: selectedVideos } = await getReply({
      message:        text,
      imageUrl:       resolvedImageUrl,
      systemPrompt,
      contactContext,
      videos
    });

    // ابعت الرد النصي
    if (reply) {
      await sendText(from, reply);
      await saveMessage(from, 'assistant', reply);
    }

    // ابعت الفيديوهات مع وصفها
    if (selectedVideos && selectedVideos.length > 0) {
      for (const video of selectedVideos) {
        await new Promise(r => setTimeout(r, 1500));
        await sendVideo(from, video.cloudinaryUrl, video.description);
        console.log(`📹 Video sent: ${video.title}`);
      }
    }

    console.log(`✅ Done processing message from ${from}`);

  } catch (err) {
    console.error(`❌ Error handling message from ${from}:`, err.message);
  }
}

module.exports = router;
