var express = require('express');
var router  = express.Router();
var wa      = require('./whatsapp');
var gemini  = require('./gemini');
var db      = require('./database');
var cm      = require('./contactManager');

var processedMsgIds = {};
var messageQueue    = [];
var isProcessing    = false;

// رقم البوت نفسه عشان منردش على نفسنا
var BOT_PHONE = process.env.PHONE_NUMBER_ID || '';

function processQueue() {
  if (isProcessing || messageQueue.length === 0) return;
  isProcessing = true;
  processNext();
}

async function processNext() {
  if (messageQueue.length === 0) {
    isProcessing = false;
    return;
  }
  var task = messageQueue.shift();
  try { await handleMessage(task); } catch(e) { console.error('Queue error:', e.message); }
  setTimeout(processNext, 800);
}

// التحقق من الـ webhook
router.get('/', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    console.log('Webhook verified');
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// استقبال الرسائل
router.post('/', async function(req, res) {
  res.sendStatus(200);

  try {
    var body = req.body;
    if (!body || body.object !== 'whatsapp_business_account') return;

    var entries = body.entry || [];
    for (var i = 0; i < entries.length; i++) {
      var changes = entries[i].changes || [];
      for (var j = 0; j < changes.length; j++) {
        var value = changes[j].value;
        if (!value) continue;

        // تجاهل status updates (delivered, read, sent)
        if (value.statuses && value.statuses.length > 0) continue;

        // تجاهل لو مفيش messages
        if (!value.messages || value.messages.length === 0) continue;

        var msg = value.messages[0];

        // تجاهل لو مفيش msg
        if (!msg) continue;

        // تجاهل رسايل النظام والـ ephemeral
        if (msg.type === 'ephemeral') continue;
        if (msg.type === 'system') continue;

        // تجاهل لو البوت بيرد على نفسه
        var from = msg.from || '';
        if (!from) continue;

        // منع تكرار نفس الرسالة
        var msgId = msg.id || '';
        if (processedMsgIds[msgId]) continue;
        processedMsgIds[msgId] = true;

        // تنضيف الـ cache لو كبر أوي
        var keys = Object.keys(processedMsgIds);
        if (keys.length > 500) delete processedMsgIds[keys[0]];

        // استخرج النص والصورة
        var text      = '';
        var imageData = null;

        if (msg.type === 'text' && msg.text) {
          text = msg.text.body || '';
        } else if (msg.type === 'image' && msg.image) {
          text      = msg.image.caption || '';
          imageData = { id: msg.image.id, mime: msg.image.mime_type || 'image/jpeg' };
        } else if (msg.type === 'video' && msg.video) {
          text = msg.video.caption || '[فيديو]';
        } else if (msg.type === 'audio' || msg.type === 'voice') {
          text = '[رسالة صوتية]';
        } else if (msg.type === 'document') {
          text = '[مستند]';
        } else if (msg.type === 'sticker') {
          text = '[ستيكر]';
        } else if (msg.type === 'location') {
          text = '[موقع]';
        } else {
          text = '[رسالة]';
        }

        // تجاهل لو مفيش محتوى
        if (!text && !imageData) continue;

        console.log('New message from ' + from + ': ' + text);

        messageQueue.push({
          from:      from,
          text:      text,
          msgType:   msg.type,
          imageData: imageData
        });
      }
    }

    // شغّل الطابور
    processQueue();

  } catch(e) {
    console.error('Webhook post error:', e.message);
  }
});

async function handleMessage(data) {
  var from      = data.from;
  var text      = data.text;
  var msgType   = data.msgType;
  var imageData = data.imageData;

  try {
    // تحقق إن البوت شغّال
    var isActive = await db.getSetting('is_active', true);
    if (!isActive) return;

    var contact = await cm.getOrCreateContact(from);
    if (contact.isBlocked) return;

    var history        = await cm.getConversationHistory(from, 12);
    var contactContext = cm.buildContactContext(contact, history);
    var systemPrompt   = await db.getSetting('system_prompt',
      'You are a helpful assistant. Always reply in Egyptian Arabic dialect.');
    var videos = await db.Video.find({}).lean();

    // جيب الصورة لو موجودة
    var imageBase64 = null;
    var imageMime   = 'image/jpeg';
    if (imageData && imageData.id) {
      try {
        var axios    = require('axios');
        var mediaRes = await axios.get(
          'https://graph.facebook.com/v19.0/' + imageData.id,
          { headers: { 'Authorization': 'Bearer ' + process.env.WHATSAPP_TOKEN } }
        );
        var imgUrl  = mediaRes.data.url;
        imageMime   = imageData.mime || 'image/jpeg';
        var imgData = await axios.get(imgUrl, {
          responseType: 'arraybuffer',
          headers: { 'Authorization': 'Bearer ' + process.env.WHATSAPP_TOKEN }
        });
        imageBase64 = Buffer.from(imgData.data).toString('base64');
      } catch(imgErr) {
        console.error('Image fetch error:', imgErr.message);
      }
    }

    // احفظ رسالة المستخدم
    await cm.saveMessage(from, 'user', text || '[image]', msgType);

    // اطلب الرد
    var result = await gemini.getReply({
      message:        text,
      imageBase64:    imageBase64,
      imageMime:      imageMime,
      systemPrompt:   systemPrompt,
      contactContext: contactContext,
      videos:         videos,
      history:        history
    });

    if (result.reply) {
      await wa.sendText(from, result.reply);
      await cm.saveMessage(from, 'assistant', result.reply, 'text');
    }

    // ابعت الفيديوهات
    if (result.videos && result.videos.length > 0) {
      for (var i = 0; i < result.videos.length; i++) {
        await new Promise(function(r) { setTimeout(r, 1500); });
        await wa.sendVideo(from, result.videos[i].cloudinaryUrl, result.videos[i].description);
      }
    }

    console.log('Done handling message from ' + from);

  } catch(e) {
    console.error('handleMessage error for ' + from + ':', e.message);
  }
}

module.exports = router;
