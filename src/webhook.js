var express = require('express');
var router  = express.Router();
var axios   = require('axios');
var db      = require('./database');
var cm      = require('./contactManager');

// ── طابور الرسائل ─────────────────────────────────────────────
var queue       = [];
var processing  = false;
var processed   = {};

function addToQueue(task) {
  if (processed[task.msgId]) return;
  processed[task.msgId] = true;
  var keys = Object.keys(processed);
  if (keys.length > 500) delete processed[keys[0]];
  queue.push(task);
  runQueue();
}

function runQueue() {
  if (processing || queue.length === 0) return;
  processing = true;
  next();
}

async function next() {
  if (queue.length === 0) { processing = false; return; }
  var task = queue.shift();
  try { await handle(task); } catch(e) { console.error('Error:', e.message); }
  setTimeout(next, 600);
}

// ── Webhook Verify ────────────────────────────────────────────
router.get('/', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// ── استقبال الرسائل ───────────────────────────────────────────
router.post('/', async function(req, res) {
  res.sendStatus(200);
  try {
    var body = req.body;
    if (!body || body.object !== 'whatsapp_business_account') return;

    var entries = body.entry || [];
    for (var i = 0; i < entries.length; i++) {
      var changes = (entries[i].changes || []);
      for (var j = 0; j < changes.length; j++) {
        var val = changes[j].value;
        if (!val) continue;
        if (val.statuses && val.statuses.length > 0) continue;
        if (!val.messages || val.messages.length === 0) continue;

        var msg = val.messages[0];
        if (!msg || !msg.from || !msg.id) continue;
        if (msg.type === 'system' || msg.type === 'ephemeral') continue;

        var text      = '';
        var imageData = null;

        if (msg.type === 'text' && msg.text) {
          text = msg.text.body || '';
        } else if (msg.type === 'image' && msg.image) {
          text      = msg.image.caption || '';
          imageData = { id: msg.image.id, mime: msg.image.mime_type || 'image/jpeg' };
        } else if (msg.type === 'video')    { text = (msg.video && msg.video.caption) || '[فيديو]'; }
        else if (msg.type === 'audio' || msg.type === 'voice') { text = '[رسالة صوتية]'; }
        else if (msg.type === 'document')   { text = '[مستند]'; }
        else if (msg.type === 'sticker')    { text = '[ستيكر]'; }
        else if (msg.type === 'location')   { text = '[موقع]'; }
        else { text = '[رسالة]'; }

        if (!text && !imageData) continue;

        console.log('MSG from ' + msg.from + ': ' + text);
        addToQueue({ from: msg.from, text: text, msgId: msg.id, msgType: msg.type, imageData: imageData });
      }
    }
  } catch(e) { console.error('Webhook error:', e.message); }
});

// ── معالجة الرسالة ────────────────────────────────────────────
async function handle(data) {
  var from      = data.from;
  var text      = data.text;
  var msgType   = data.msgType;
  var imageData = data.imageData;

  try {
    var isActive = await db.getSetting('is_active', true);
    if (!isActive) return;

    var contact = await cm.getOrCreateContact(from);
    if (contact.isBlocked) return;

    // جيب تاريخ المحادثة كامل
    var history = await cm.getConversationHistory(from, 20);

    // جيب الإعدادات
    var systemPrompt = await db.getSetting('system_prompt',
      'You are a smart helpful assistant. Always reply in Egyptian Arabic dialect.');
    var videos = await db.Video.find({}).lean();

    // جيب الصورة لو موجودة
    var imageBase64 = null;
    var imageMime   = 'image/jpeg';
    if (imageData && imageData.id) {
      try {
        var mRes = await axios.get(
          'https://graph.facebook.com/v19.0/' + imageData.id,
          { headers: { 'Authorization': 'Bearer ' + process.env.WHATSAPP_TOKEN } }
        );
        imageMime = imageData.mime || 'image/jpeg';
        var iRes  = await axios.get(mRes.data.url, {
          responseType: 'arraybuffer',
          headers: { 'Authorization': 'Bearer ' + process.env.WHATSAPP_TOKEN }
        });
        imageBase64 = Buffer.from(iRes.data).toString('base64');
      } catch(ie) { console.error('Image error:', ie.message); }
    }

    // احفظ رسالة المستخدم
    await cm.saveMessage(from, 'user', text || '[image]', msgType);

    // بناء context للشخص
    var isNew    = contact.totalMessages <= 1;
    var isKnown  = contact.isKnown;
    var ctx      = isNew    ? 'New person, first time contacting.' :
                   isKnown  ? 'Known person: ' + (contact.name || from) + (contact.notes ? '. Notes: ' + contact.notes : '') :
                               'Returning person, contacted ' + contact.totalMessages + ' times before.';

    // قائمة الفيديوهات
    var videoList = videos.length === 0 ? '' :
      '\n\nAvailable videos to send:\n' +
      videos.map(function(v) {
        return 'ID=' + v._id + ' | title=' + v.title + ' | keywords=' + v.keywords;
      }).join('\n') +
      '\nIf a video matches the question, add at the END: [VIDEO:id]. If not, do NOT write VIDEO.';

    // System prompt
    var systemText = systemPrompt
      + '\n\nPerson: ' + ctx
      + videoList
      + '\n\nSTRICT RULES:'
      + '\n- ALWAYS reply in Egyptian Arabic dialect only. Use words like: ايه، يعني، تمام، ماشي، يلا، عارف، طب'
      + '\n- You are a real smart human, NOT a bot or AI. Never admit being AI.'
      + '\n- Think deeply and give intelligent complete answers.'
      + '\n- Remember everything in the conversation history.'
      + '\n- Short natural replies like real WhatsApp texting.'
      + '\n- Never repeat yourself or use the same phrases.'
      + '\n- Never start every message with a greeting.'
      + '\n- If image sent, describe and respond to it in Egyptian Arabic.'
      + '\n- NEVER send messages unprompted.';

    // بناء المحادثة لـ Groq
    var messages = [{ role: 'system', content: systemText }];

    // تاريخ المحادثة
    for (var i = 0; i < history.length; i++) {
      messages.push({
        role:    history[i].role === 'user' ? 'user' : 'assistant',
        content: history[i].content
      });
    }

    // الرسالة الحالية
    if (imageBase64) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: text || 'describe this image' },
          { type: 'image_url', image_url: { url: 'data:' + imageMime + ';base64,' + imageBase64 } }
        ]
      });
    } else {
      messages.push({ role: 'user', content: text });
    }

    // ── اطلب الرد من Groq ─────────────────────────────────────
    var reply          = null;
    var selectedVideos = [];
    var groqKey        = process.env.GROQ_API_KEY;

    if (!groqKey) {
      console.error('GROQ_API_KEY missing!');
      return;
    }

    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var resp = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model:       'llama-3.3-70b-versatile',
            messages:    messages,
            max_tokens:  500,
            temperature: 0.75,
            stream:      false
          },
          {
            headers: {
              'Content-Type':  'application/json',
              'Authorization': 'Bearer ' + groqKey
            },
            timeout: 25000
          }
        );

        var fullText = '';
        if (resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message) {
          fullText = resp.data.choices[0].message.content || '';
        }
        fullText = fullText.trim();
        if (!fullText) break;

        // استخرج الفيديوهات
        var videoRegex = /\[VIDEO:([^\]]+)\]/g;
        var videoIds   = [];
        var m;
        while ((m = videoRegex.exec(fullText)) !== null) videoIds.push(m[1].trim());

        reply = fullText.replace(/\[VIDEO:[^\]]+\]/g, '').trim();
        selectedVideos = videoIds
          .map(function(id) { return videos.find(function(v) { return v._id.toString() === id; }); })
          .filter(Boolean);

        break;

      } catch(e) {
        var st = e.response && e.response.status;
        console.error('Groq attempt ' + (attempt+1) + ':', st, e.message);
        if (attempt < 2 && (st === 429 || st === 503 || !st)) {
          await new Promise(function(r) { setTimeout(r, (attempt+1) * 2000); });
        } else { break; }
      }
    }

    if (!reply) {
      console.error('No reply generated for ' + from);
      return;
    }

    // ── ابعت الرد ─────────────────────────────────────────────
    await sendText(from, reply);
    await cm.saveMessage(from, 'assistant', reply, 'text');

    // ابعت الفيديوهات
    for (var vi = 0; vi < selectedVideos.length; vi++) {
      await new Promise(function(r) { setTimeout(r, 1500); });
      await sendVideo(from, selectedVideos[vi].cloudinaryUrl, selectedVideos[vi].description);
      console.log('Video sent: ' + selectedVideos[vi].title);
    }

    console.log('Done: ' + from + ' -> ' + reply.substring(0, 50));

  } catch(e) {
    console.error('Handle error for ' + from + ':', e.message);
  }
}

// ── إرسال رسالة نصية ─────────────────────────────────────────
async function sendText(to, text) {
  try {
    await axios.post(
      'https://graph.facebook.com/v19.0/' + process.env.PHONE_NUMBER_ID + '/messages',
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: { body: text, preview_url: false }
      },
      { headers: { 'Authorization': 'Bearer ' + process.env.WHATSAPP_TOKEN, 'Content-Type': 'application/json' } }
    );
  } catch(e) { console.error('sendText error:', e.response ? JSON.stringify(e.response.data) : e.message); }
}

// ── إرسال فيديو ───────────────────────────────────────────────
async function sendVideo(to, url, caption) {
  try {
    await axios.post(
      'https://graph.facebook.com/v19.0/' + process.env.PHONE_NUMBER_ID + '/messages',
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'video',
        video: { link: url, caption: caption }
      },
      { headers: { 'Authorization': 'Bearer ' + process.env.WHATSAPP_TOKEN, 'Content-Type': 'application/json' } }
    );
  } catch(e) {
    console.error('sendVideo error:', e.message);
    await sendText(to, caption);
  }
}

module.exports = router;
