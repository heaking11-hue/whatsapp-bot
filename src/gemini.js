var axios = require('axios');

var GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
var GROQ_MODEL = 'llama-3.3-70b-versatile';

async function getReply(options) {
  var message        = options.message        || '';
  var systemPrompt   = options.systemPrompt   || '';
  var contactContext = options.contactContext  || '';
  var videos         = options.videos         || [];
  var history        = options.history        || [];
  var imageBase64    = options.imageBase64    || null;
  var imageMime      = options.imageMime      || 'image/jpeg';

  var apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { reply: 'مش شغال دلوقتي.', videos: [] };

  var videoList = videos.length === 0 ? '' :
    '\n\nVideos you can send:\n' +
    videos.map(function(v) {
      return 'ID=' + v._id + ' title=' + v.title + ' keywords=' + v.keywords;
    }).join('\n') +
    '\nIf a video matches the question, add at the END only: [VIDEO:id]\nIf no video matches, do NOT write VIDEO.';

  var systemContent = systemPrompt
    + '\n\nPerson info: ' + contactContext
    + videoList
    + '\n\nCRITICAL RULES - never break:'
    + '\n1. ALWAYS write in Egyptian Arabic dialect only. Example: ايه، يعني، تمام، ماشي، عارف، يلا'
    + '\n2. You are a real smart human. Never say you are AI.'
    + '\n3. Think carefully before answering any question.'
    + '\n4. Give complete intelligent answers.'
    + '\n5. Remember everything in the conversation.'
    + '\n6. Keep replies natural and short like WhatsApp.'
    + '\n7. Never repeat yourself.'
    + '\n8. Never start every message with a greeting.'
    + '\n9. If someone sends an image, describe and respond to it.'
    + '\n10. NEVER send unprompted messages.';

  var messages = [{ role: 'system', content: systemContent }];

  // تاريخ المحادثة كامل
  for (var i = 0; i < history.length; i++) {
    messages.push({
      role:    history[i].role === 'user' ? 'user' : 'assistant',
      content: history[i].content
    });
  }

  // الرسالة الحالية مع الصورة لو موجودة
  if (imageBase64) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: message || 'describe this image in Egyptian Arabic' },
        { type: 'image_url', image_url: { url: 'data:' + imageMime + ';base64,' + imageBase64 } }
      ]
    });
  } else {
    messages.push({ role: 'user', content: message });
  }

  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      var resp = await axios.post(
        GROQ_URL,
        {
          model:       GROQ_MODEL,
          messages:    messages,
          max_tokens:  500,
          temperature: 0.7,
          stream:      false
        },
        {
          headers: {
            'Content-Type':  'application/json',
            'Authorization': 'Bearer ' + apiKey
          },
          timeout: 25000
        }
      );

      var fullText = '';
      if (resp.data && resp.data.choices &&
          resp.data.choices[0] && resp.data.choices[0].message) {
        fullText = resp.data.choices[0].message.content || '';
      }
      fullText = fullText.trim();
      if (!fullText) return { reply: 'حاول تاني.', videos: [] };

      // استخرج الفيديوهات
      var videoRegex = /\[VIDEO:([^\]]+)\]/g;
      var videoIds   = [];
      var m;
      while ((m = videoRegex.exec(fullText)) !== null) videoIds.push(m[1].trim());

      var cleanReply = fullText.replace(/\[VIDEO:[^\]]+\]/g, '').trim();
      var selectedVideos = videoIds
        .map(function(id) {
          return videos.find(function(v) { return v._id.toString() === id; });
        })
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
