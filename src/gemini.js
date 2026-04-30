var axios = require('axios');

var GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
var GROQ_MODEL = 'llama-3.3-70b-versatile';

async function getReply(options) {
  var message        = options.message        || '';
  var systemPrompt   = options.systemPrompt   || '';
  var contactContext = options.contactContext  || '';
  var videos         = options.videos         || [];
  var history        = options.history        || [];

  var apiKey = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) return { reply: 'mesh mawgood delwakty.', videos: [] };

  var videoList = videos.length === 0
    ? 'no videos'
    : videos.map(function(v) {
        return 'ID:' + v._id + ' title:' + v.title + ' keywords:' + v.keywords;
      }).join('\n');

  var systemText = systemPrompt + '\n\n'
    + 'Person info: ' + contactContext + '\n\n'
    + 'Videos library:\n' + videoList + '\n\n'
    + 'Rules:\n'
    + '1. You are a real human not a bot - never say you are AI\n'
    + '2. Always reply in Egyptian Arabic dialect (عامية مصرية)\n'
    + '3. Short natural replies like real WhatsApp messages\n'
    + '4. Remember everything said in this conversation\n'
    + '5. Answer any question intelligently and naturally\n'
    + '6. If you dont know something say so naturally\n'
    + '7. Do NOT start every message with greetings\n'
    + '8. If a video fits the question add at the end only: [VIDEO:id]\n'
    + '9. If no video fits do NOT write VIDEO at all\n'
    + '10. Be warm friendly and smart like a real Egyptian person\n';

  var messages = [{ role: 'system', content: systemText }];

  if (history && history.length > 0) {
    for (var i = 0; i < history.length; i++) {
      messages.push({
        role:    history[i].role === 'user' ? 'user' : 'assistant',
        content: history[i].content
      });
    }
  }

  messages.push({ role: 'user', content: message });

  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      var resp = await axios.post(
        GROQ_URL,
        {
          model:       GROQ_MODEL,
          messages:    messages,
          max_tokens:  400,
          temperature: 0.85,
          stream:      false
        },
        {
          headers: {
            'Content-Type':  'application/json',
            'Authorization': 'Bearer ' + apiKey
          },
          timeout: 20000
        }
      );

      var fullText = '';
      if (resp.data && resp.data.choices && resp.data.choices[0] &&
          resp.data.choices[0].message) {
        fullText = resp.data.choices[0].message.content || '';
      }
      fullText = fullText.trim();
      if (!fullText) return { reply: 'hawel tani.', videos: [] };

      var videoRegex = /\[VIDEO:([^\]]+)\]/g;
      var videoIds   = [];
      var match;
      while ((match = videoRegex.exec(fullText)) !== null) {
        videoIds.push(match[1].trim());
      }

      var cleanReply     = fullText.replace(/\[VIDEO:[^\]]+\]/g, '').trim();
      var selectedVideos = videoIds.map(function(id) {
        return videos.find(function(v) { return v._id.toString() === id; });
      }).filter(Boolean);

      return { reply: cleanReply, videos: selectedVideos };

    } catch(e) {
      var st = e.response && e.response.status;
      console.error('Groq attempt ' + (attempt + 1) + ':', st, e.message);
      if (attempt < 2 && (st === 429 || st === 503 || !st)) {
        await new Promise(function(r) { setTimeout(r, (attempt + 1) * 1500); });
      } else {
        break;
      }
    }
  }

  return { reply: 'fi daght bseet, hawel tani.', videos: [] };
}

module.exports = { getReply: getReply };        return extractVideosAndReply(textFullText, videos, TEXT_MODEL);

      } catch (textError) {
        console.error('❌ Text fallback also failed:', textError.message);
      }
    }

    return {
      reply: 'آسف، في تأخير بسيط. ابعت رسالتك تاني بعد لحظة.',
      videos: []
    };
  }
}

// دالة مساعدة لاستخراج الفيديوهات وتنظيف النص
function extractVideosAndReply(fullText, videos, modelUsed) {
  const videoRegex = /\[VIDEO:([^\]]+)\]/g;
  const videoIds = [];
  let match;
  while ((match = videoRegex.exec(fullText)) !== null) {
    videoIds.push(match[1].trim());
  }

  const cleanReply = fullText.replace(/\[VIDEO:[^\]]+\]/g, '').trim();
  const selectedVideos = videoIds
    .map(id => videos.find(v => v._id.toString() === id))
    .filter(Boolean);

  console.log(`✅ Reply generated via ${modelUsed}`);
  return { reply: cleanReply, videos: selectedVideos };
}

module.exports = { getReply };
