var axios = require('axios');

var GROQ_URL        = 'https://api.groq.com/openai/v1/chat/completions';
var GROQ_TEXT_MODEL = 'gemma2-9b-it';
var GROQ_VIS_MODEL  = 'meta-llama/llama-4-scout-17b-16e-instruct';

async function getReply(options) {
  var message        = options.message        || '';
  var imageBase64    = options.imageBase64    || null;
  var imageMime      = options.imageMime      || 'image/jpeg';
  var systemPrompt   = options.systemPrompt   || '';
  var contactContext = options.contactContext  || '';
  var videos         = options.videos         || [];
  var history        = options.history        || [];

  var apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('GROQ_API_KEY missing!');
    return { reply: 'الخدمة مش متاحة.', videos: [] };
  }

  var videoList = videos.length === 0
    ? 'No videos.'
    : videos.map(function(v) {
        return 'ID=' + v._id + ' title=' + v.title + ' keywords=' + v.keywords;
      }).join('\n');

  var systemText = systemPrompt
    + '\n\nContact info: ' + contactContext
    + '\n\nVideos:\n' + videoList
    + '\n\nRULES (never break these):'
    + '\n1. ALWAYS reply in Egyptian Arabic colloquial dialect. Never use English or formal Arabic.'
    + '\n2. You are a real human, not AI. Never admit being AI or bot.'
    + '\n3. Keep replies short and natural like real WhatsApp.'
    + '\n4. Remember the full conversation and build on it intelligently.'
    + '\n5. Answer any question thoughtfully.'
    + '\n6. If you see an image, describe and respond to it in Egyptian Arabic.'
    + '\n7. NEVER send a message unprompted. Only reply when user sends a message.'
    + '\n8. Do NOT repeat yourself or use same phrases.'
    + '\n9. Do NOT start with greetings every single message.'
    + '\n10. If a video fits the question, write ONLY at the end: [VIDEO:id]'
    + '\n11. If no video fits, do NOT write VIDEO at all.';

  var useVision = !!imageBase64;
  var model     = useVision ? GROQ_VIS_MODEL : GROQ_TEXT_MODEL;

  var messages = [{ role: 'system', content: systemText }];

  // تاريخ المحادثة
  for (var i = 0; i < history.length; i++) {
    messages.push({
      role:    history[i].role === 'user' ? 'user' : 'assistant',
      content: history[i].content
    });
  }

  // الرسالة الحالية
  if (useVision) {
    messages.push({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:' + imageMime + ';base64,' + imageBase64 } },
        { type: 'text', text: message || 'describe this image' }
      ]
    });
  } else {
    messages.push({ role: 'user', content: message });
  }

  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      var resp = await axios.post(
        GROQ_URL,
        { model: model, messages: messages, max_tokens: 400, temperature: 0.8, stream: false },
        {
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
          timeout: 25000
        }
      );

      var fullText = '';
      if (resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message) {
        fullText = resp.data.choices[0].message.content || '';
      }
      fullText = fullText.trim();
      if (!fullText) return { reply: 'حاول تاني.', videos: [] };

      var videoRegex = /\[VIDEO:([^\]]+)\]/g;
      var videoIds   = [];
      var m;
      while ((m = videoRegex.exec(fullText)) !== null) videoIds.push(m[1].trim());

      var cleanReply     = fullText.replace(/\[VIDEO:[^\]]+\]/g, '').trim();
      var selectedVideos = videoIds
        .map(function(id) { return videos.find(function(v) { return v._id.toString() === id; }); })
        .filter(Boolean);

      return { reply: cleanReply, videos: selectedVideos };

    } catch(e) {
      var st = e.response && e.response.status;
      console.error('Groq attempt ' + (attempt+1) + ':', st, e.message);
      if (attempt < 2 && (st === 429 || st === 503 || !st)) {
        await new Promise(function(r) { setTimeout(r, (attempt+1) * 2000); });
      } else { break; }
    }
  }

  return { reply: 'في ضغط، ابعت تاني بعد شوية.', videos: [] };
}

module.exports = { getReply: getReply };
