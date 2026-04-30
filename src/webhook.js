var express = require('express');
var router  = express.Router();
var wa      = require('./whatsapp');
var gemini  = require('./gemini');
var db      = require('./database');
var cm      = require('./contactManager');

var processedMsgIds = {};
var messageQueue    = [];
var isProcessing    = false;

function processQueue() {
  if (isProcessing || messageQueue.length === 0) return;
  isProcessing = true;
  processNext();
}

async function processNext() {
  if (messageQueue.length === 0) { isProcessing = false; return; }
  var task = messageQueue.shift();
  try { await handleMessage(task); } catch(e) { console.error('Queue error:', e.message); }
  setTimeout(processNext, 500);
}

router.get('/', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    console.log('Webhook verified');
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

router.post('/', async function(req, res) {
  res.sendStatus(200);
  try {
    var body = req.body;
    if (body.object !== 'whatsapp_business_account') return;
    var isActive = await db.getSetting('is_active', true);
    if (!isActive) return;

    var entries = body.entry || [];
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (entry.changes && entry.changes[0] && entry.changes[0].value && entry.changes[0].value.statuses) continue;
      var msgData = wa.extractMessage(entry);
      if (!msgData) continue;
      if (processedMsgIds[msgData.msgId]) continue;
      processedMsgIds[msgData.msgId] = true;
      var keys = Object.keys(processedMsgIds);
      if (keys.length > 1000) delete processedMsgIds[keys[0]];
      messageQueue.push(msgData);
      console.log('Queued: ' + msgData.from + ' - ' + msgData.text);
    }
    processQueue();
  } catch(e) { console.error('Webhook error:', e.message); }
});

async function handleMessage(data) {
  var from     = data.from;
  var text     = data.text;
  var msgType  = data.msgType;
  var imageUrl = data.imageUrl;

  try {
    var contact = await cm.getOrCreateContact(from);
    if (contact.isBlocked) return;

    // جيب تاريخ المحادثة كاملاً
    var history        = await cm.getConversationHistory(from, 15);
    var contactContext = cm.buildContactContext(contact, history);
    var systemPrompt   = await db.getSetting('system_prompt',
      'أنت تجيب على رسائل واتساب. رد بشكل طبيعي جداً كأنك إنسان حقيقي وصاحب الحساب نفسه.');
    var videos = await db.Video.find({}).lean();

    var resolvedImageUrl = null;
    if (imageUrl && imageUrl.indexOf('__media:') === 0) {
      resolvedImageUrl = await wa.fetchMediaUrl(imageUrl.replace('__media:', ''));
    }

    // احفظ رسالة المستخدم
    await cm.saveMessage(from, 'user', text, msgType);

    // ابعت للـ Gemini مع كل تاريخ المحادثة
    var result = await gemini.getReply({
      message:        text,
      imageUrl:       resolvedImageUrl,
      systemPrompt:   systemPrompt,
      contactContext: contactContext,
      videos:         videos,
      history:        history  // ← هنا بنبعت كل المحادثة
    });

    if (result.reply) {
      await wa.sendText(from, result.reply);
      await cm.saveMessage(from, 'assistant', result.reply);
    }

    if (result.videos && result.videos.length > 0) {
      for (var i = 0; i < result.videos.length; i++) {
        await new Promise(function(r) { setTimeout(r, 1500); });
        await wa.sendVideo(from, result.videos[i].cloudinaryUrl, result.videos[i].description);
      }
    }

    console.log('Done: ' + from);
  } catch(e) { console.error('handleMessage error:', e.message); }
}

module.exports = router;
