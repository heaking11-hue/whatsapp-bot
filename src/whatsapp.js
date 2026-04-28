const axios = require('axios');

function getHeaders() {
  return {
    'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
    'Content-Type': 'application/json'
  };
}

function getBaseUrl() {
  return `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`;
}

async function sendText(to, text) {
  try {
    await axios.post(getBaseUrl(), {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text, preview_url: false }
    }, { headers: getHeaders() });
    console.log(`✅ Text sent to ${to}`);
  } catch (e) {
    console.error('sendText error:', e.response?.data || e.message);
  }
}

async function sendVideo(to, videoUrl, caption) {
  try {
    await axios.post(getBaseUrl(), {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'video',
      video: { link: videoUrl, caption }
    }, { headers: getHeaders() });
    console.log(`✅ Video sent to ${to}`);
  } catch (e) {
    console.error('sendVideo error:', e.response?.data?.error || e.message);
    await sendText(to, `📹 ${caption}`);
  }
}

async function sendTemplate(to, templateName, language = 'ar') {
  try {
    await axios.post(getBaseUrl(), {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: language } }
    }, { headers: getHeaders() });
  } catch (e) {
    console.error('sendTemplate error:', e.response?.data || e.message);
  }
}

function extractMessage(entry) {
  try {
    const value = entry.changes[0].value;
    const msg   = value.messages?.[0];
    if (!msg) return null;

    const from  = msg.from;
    const msgId = msg.id;
    let text    = '';
    let imageUrl = null;
    const msgType = msg.type;

    if (msg.type === 'text') {
      text = msg.text.body;
    } else if (msg.type === 'image') {
      text     = msg.image?.caption || '[صورة]';
      imageUrl = `__media:${msg.image.id}`;
    } else if (msg.type === 'video') {
      text = msg.video?.caption || '[فيديو]';
    } else if (msg.type === 'audio' || msg.type === 'voice') {
      text = '[رسالة صوتية]';
    } else if (msg.type === 'document') {
      text = '[مستند]';
    } else if (msg.type === 'location') {
      text = '[موقع جغرافي]';
    } else if (msg.type === 'sticker') {
      text = '[ستيكر]';
    } else {
      text = '[رسالة]';
    }

    return { from, text, msgId, msgType, imageUrl };
  } catch (e) {
    console.error('extractMessage error:', e.message);
    return null;
  }
}

async function fetchMediaUrl(mediaId) {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      { headers: getHeaders() }
    );
    return res.data.url || null;
  } catch (e) {
    console.error('fetchMediaUrl error:', e.message);
    return null;
  }
}

module.exports = {
  sendText,
  sendVideo,
  sendTemplate,
  extractMessage,
  fetchMediaUrl
};
