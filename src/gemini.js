var axios = require('axios');

// Gemini 2.0 Flash - الاحسن في العربية
var GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Groq كـ backup لو Gemini خلص
var GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
var GROQ_MODEL = 'llama-3.3-70b-versatile';

async function callGemini(apiKey, systemText, messages, videos) {
  // حوّل تاريخ المحادثة لـ Gemini format
  var contents = [];
  for (var i = 0; i < messages.length; i++) {
    contents.push({
      role:  messages[i].role === 'user' ? 'user' : 'model',
      parts: [{ text: messages[i].content }]
    });
  }

  var resp = await axios.post(
    GEMINI_URL + '?key=' + apiKey,
    {
      system_instruction: { parts: [{ text: systemText }] },
      contents: contents,
      generationConfig: { maxOutputTokens: 450, temperature: 0.85 }
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 25000 }
  );

  var candidate = resp.data.candidates && resp.data.candidates[0];
  if (!candidate || !candidate.content) return null;
  return candidate.content.parts[0].text || null;
}

async function callGroq(apiKey, systemText, messages) {
  var groqMessages = [{ role: 'system', content: systemText }];
  for (var i = 0; i < messages.length; i++) {
    groqMessages.push({
      role:    messages[i].role === 'user' ? 'user' : 'assistant',
      content: messages[i].content
    });
  }

  var resp = await axios.post(
    GROQ_URL,
    { model: GROQ_MODEL, messages: groqMessages, max_tokens: 450, temperature: 0.85, stream: false },
    {
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      timeout: 20000
    }
  );

  return resp.data.choices[0].message.content || null;
}

function parseReply(fullText, videos) {
  if (!fullText) return { reply: 'حاول تاني.', videos: [] };
  fullText = fullText.trim();

  var videoRegex = /\[VIDEO:([^\]]+)\]/g;
  var videoIds   = [];
  var m;
  while ((m = videoRegex.exec(fullText)) !== null) videoIds.push(m[1].trim());

  var cleanReply     = fullText.replace(/\[VIDEO:[^\]]+\]/g, '').trim();
  var selectedVideos = videoIds
    .map(function(id) { return videos.find(function(v) { return v._id.toString() === id; }); })
    .filter(Boolean);

  return { reply: cleanReply, videos: selectedVideos };
}

async function getReply(options) {
  var message        = options.message        || '';
  var systemPrompt   = options.systemPrompt   || '';
  var contactContext = options.contactContext  || '';
  var videos         = options.videos         || [];
  var history        = options.history        || [];

  var geminiKey = process.env.GEMINI_API_KEY;
  var groqKey   = process.env.GROQ_API_KEY;

  var videoList = videos.length === 0
    ? 'No videos.'
    : videos.map(function(v) {
        return 'ID=' + v._id + ' title=' + v.title + ' keywords=' + v.keywords;
      }).join('\n');

  var systemText = systemPrompt
    + '\n\nContact info: ' + contactContext
    + '\n\nVideos:\n' + videoList
    + '\n\nRULES:'
    + '\n- ALWAYS reply in Egyptian Arabic colloquial. Never English or formal Arabic.'
    + '\n- You are a real smart human, not a bot. Never admit being AI.'
    + '\n- Short natural replies like real WhatsApp.'
    + '\n- Remember the full conversation and build on it.'
    + '\n- Think carefully and give intelligent answers.'
    + '\n- If you see an image, describe it in Egyptian Arabic.'
    + '\n- Do NOT repeat yourself.'
    + '\n- Do NOT greet every single message.'
    + '\n- If a video fits the question add at the end: [VIDEO:id]'
    + '\n- If no video fits do NOT write VIDEO.';

  // بناء المحادثة
  var allMessages = history.slice();
  allMessages.push({ role: 'user', content: message });

  var fullText = null;

  // جرب Gemini الأول
  if (geminiKey) {
    for (var i = 0; i < 3; i++) {
      try {
        fullText = await callGemini(geminiKey, systemText, allMessages, videos);
        if (fullText) break;
      } catch(e) {
        var st = e.response && e.response.status;
        console.error('Gemini attempt ' + (i+1) + ':', st, e.message);
        if (st === 429 || st === 503) {
          // Gemini خلص - اتحول لـ Groq
          console.log('Gemini quota exceeded, switching to Groq...');
          break;
        }
        if (i < 2) await new Promise(function(r) { setTimeout(r, 2000); });
      }
    }
  }

  // لو Gemini فشل، جرب Groq
  if (!fullText && groqKey) {
    for (var j = 0; j < 2; j++) {
      try {
        fullText = await callGroq(groqKey, systemText, allMessages);
        if (fullText) break;
      } catch(e) {
        console.error('Groq attempt ' + (j+1) + ':', e.message);
        if (j < 1) await new Promise(function(r) { setTimeout(r, 1500); });
      }
    }
  }

  if (!fullText) {
    return { reply: 'في ضغط دلوقتي، ابعت تاني بعد شوية.', videos: [] };
  }

  return parseReply(fullText, videos);
}

module.exports = { getReply: getReply };
