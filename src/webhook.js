const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('./database');
const cm = require('./contactManager');

// ── طابور الرسائل ─────────────────────────────────────────────
const queue = [];
let processing = false;
const processed = {};

function addToQueue(task) {
  if (processed[task.msgId]) return;
  processed[task.msgId] = true;
  const keys = Object.keys(processed);
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
  const task = queue.shift();
  try { await handle(task); } catch(e) { console.error('Error:', e.message); }
  setTimeout(next, 600);
}

// ── Webhook Verify ────────────────────────────────────────────
router.get('/', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// ── استقبال الرسائل ───────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (!body || body.object !== 'whatsapp_business_account') return;

    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const val = change.value;
        if (!val) continue;
        if (val.statuses && val.statuses.length > 0) continue;
        if (!val.messages || val.messages.length === 0) continue;

        const msg = val.messages[0];
        if (!msg || !msg.from || !msg.id) continue;
        if (msg.type === 'system' || msg.type === 'ephemeral') continue;

        let text = '';
        let imageData = null;

        if (msg.type === 'text' && msg.text) {
          text = msg.text.body || '';
        } else if (msg.type === 'image' && msg.image) {
          text = msg.image.caption || '';
          imageData = { id: msg.image.id, mime: msg.image.mime_type || 'image/jpeg' };
        } else if (msg.type === 'video') { text = (msg.video && msg.video.caption) || '[فيديو]'; }
        else if (msg.type === 'audio' || msg.type === 'voice') { text = '[رسالة صوتية]'; }
        else if (msg.type === 'document') { text = '[مستند]'; }
        else if (msg.type === 'sticker') { text = '[ستيكر]'; }
        else if (msg.type === 'location') { text = '[موقع]'; }
        else { text = '[رسالة]'; }

        if (!text && !imageData) continue;

        console.log('MSG from ' + msg.from + ': ' + text);
        addToQueue({ from: msg.from, text, msgId: msg.id, msgType: msg.type, imageData });
      }
    }
  } catch(e) { console.error('Webhook error:', e.message); }
});

// ── معالجة الرسالة ────────────────────────────────────────────
async function handle(data) {
  const { from, text, msgType, imageData } = data;

  try {
    const isActive = await db.getSetting('is_active', true);
    if (!isActive) return;

    const contact = await cm.getOrCreateContact(from);
    if (contact.isBlocked) return;

    const history = await cm.getConversationHistory(from, 20);
    const systemPrompt = await db.getSetting('system_prompt',
      'أنت مساعد ذكي ومفيد. تكلم بالعامية المصرية.');
    const videos = await db.Video.find({}).lean();

    let imageBase64 = null;
    let imageMime = 'image/jpeg';
    if (imageData && imageData.id) {
      try {
        const mRes = await axios.get(
          'https://graph.facebook.com/v19.0/' + imageData.id,
          { headers: { 'Authorization': 'Bearer ' + process.env.WHATSAPP_TOKEN } }
        );
        imageMime = imageData.mime || 'image/jpeg';
        const iRes = await axios.get(mRes.data.url, {
          responseType: 'arraybuffer',
          headers: { 'Authorization': 'Bearer ' + process.env.WHATSAPP_TOKEN }
        });
        imageBase64 = Buffer.from(iRes.data).toString('base64');
      } catch(ie) { console.error('Image error:', ie.message); }
    }

    await cm.saveMessage(from, 'user', text || '[image]', msgType);

    const isNew = contact.totalMessages <= 1;
    const isKnown = contact.isKnown;
    const ctx = isNew ? 'شخص جديد، أول مرة يتواصل.' :
                 isKnown ? 'شخص معروف: ' + (contact.name || from) + (contact.notes ? '. ملاحظات: ' + contact.notes : '') :
                            'شخص متكرر، تواصل ' + contact.totalMessages + ' مرات.';

    const videoList = videos.length === 0 ? '' :
      '\n\nفيديوهات متاحة للإرسال:\n' +
      videos.map(v => 'ID=' + v._id + ' | title=' + v.title + ' | keywords=' + v.keywords).join('\n') +
      '\nإذا كان فيديو يناسب السؤال، أضف في النهاية: [VIDEO:id]. إذا لم يناسب، لا تكتب VIDEO.';

    const systemText = systemPrompt
      + '\n\nالشخص: ' + ctx
      + videoList
      + '\n\nقواعد صارمة:'
      + '\n- تكلم بالعامية المصرية فقط.'
      + '\n- أنت إنسان حقيقي، لست بوت أو ذكاء اصطناعي.'
      + '\n- ردود قصيرة وطبيعية مثل محادثات الواتساب.'
      + '\n- لا تكرر نفسك ولا تبدأ كل رسالة بتحية.';

    const messages = [{ role: 'system', content: systemText }];
    for (const msg of history) {
      messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
    }

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

    let reply = null;
    let selectedVideos = [];
    const groqKey = process.env.GROQ_API_KEY;

    if (!groqKey) {
      console.error('GROQ_API_KEY missing!');
      return;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model: 'llama-3.1-8b-instant',
            messages,
            max_tokens: 500,
            temperature: 0.75,
            stream: false
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + groqKey
            },
            timeout: 25000
          }
        );

        let fullText = '';
        if (resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message) {
          fullText = resp.data.choices[0].message.content || '';
        }
        fullText = fullText.trim();
        if (!fullText) break;

        const videoRegex = /\[VIDEO:([^\]]+)\]/g;
        const videoIds = [];
        let m;
        while ((m = videoRegex.exec(fullText)) !== null) videoIds.push(m[1].trim());

        reply = fullText.replace(/\[VIDEO:[^\]]+\]/g, '').trim();
        selectedVideos = videoIds
          .map(id => videos.find(v => v._id.toString() === id))
          .filter(Boolean);

        break;

      } catch(e) {
        const st = e.response && e.response.status;
        console.error('Groq attempt ' + (attempt+1) + ':', st, e.message);
        if (attempt < 2 && (st === 429 || st === 503 || !st)) {
          await new Promise(r => setTimeout(r, (attempt+1) * 2000));
        } else { break; }
      }
    }

    if (!reply) {
      console.error('No reply generated for ' + from);
      return;
    }

    await sendText(from, reply);
    await cm.saveMessage(from, 'assistant', reply, 'text');

    for (const video of selectedVideos) {
      await new Promise(r => setTimeout(r, 1500));
      await sendVideo(from, video.cloudinaryUrl, video.description);
      console.log('Video sent: ' + video.title);
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
      'https://graph.facebook.com/v22.0/' + process.env.PHONE_NUMBER_ID + '/messages',
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
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
      'https://graph.facebook.com/v22.0/' + process.env.PHONE_NUMBER_ID + '/messages',
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'video',
        video: { link: url, caption }
      },
      { headers: { 'Authorization': 'Bearer ' + process.env.WHATSAPP_TOKEN, 'Content-Type': 'application/json' } }
    );
  } catch(e) {
    console.error('sendVideo error:', e.message);
    await sendText(to, caption);
  }
}

module.exports = router;
