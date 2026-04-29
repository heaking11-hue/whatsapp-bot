const axios = require('axios');

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

async function callGemini(apiKey, requestBody, retries) {
  retries = retries || 3;
  for (var i = 0; i < retries; i++) {
    try {
      var response = await axios.post(
        GEMINI_URL + '?key=' + apiKey,
        requestBody,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 25000
        }
      );
      return response.data;
    } catch (err) {
      var status = err.response ? err.response.status : 0;
      console.error('Gemini attempt ' + (i+1) + ' failed: ' + status);
      if ((status === 429 || status === 503 || !status) && i < retries - 1) {
        await new Promise(function(r) { setTimeout(r, (i + 1) * 2000); });
        continue;
      }
      throw err;
    }
  }
}

async function getReply(options) {
  var message        = options.message;
  var imageUrl       = options.imageUrl;
  var systemPrompt   = options.systemPrompt;
  var contactContext = options.contactContext;
  var videos         = options.videos;

  var apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return { reply: 'الخدمة غير متاحة.', videos: [] };
  }

  var videoList = videos.length === 0
    ? 'No videos.'
    : videos.map(function(v) {
        return 'ID:' + v._id + ' | Title:' + v.title + ' | Keywords:' + v.keywords;
      }).join('\n');

  var fullPrompt = systemPrompt + '\n\n' +
    '=== معلومات الشخص ===\n' + contactContext + '\n\n' +
    '=== مكتبة الفيديوهات ===\n' + videoList + '\n\n' +
    '=== تعليمات ===\n' +
    '- رد كأنك صاحب الحساب بشكل طبيعي\n' +
    '- لا تذكر أبداً أنك ذكاء اصطناعي\n' +
    '- رد بنفس لغة الشخص\n' +
    '- لو فيديو مناسب اكتب في آخر ردك: [VIDEO:id]\n' +
    '- لو مفيش فيديو مناسب لا تذكر VIDEO\n\n' +
    '=== رسالة الشخص ===\n' + message;

  var parts = [];

  if (imageUrl) {
    try {
      var imgResp = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: { 'Authorization': 'Bearer ' + process.env.WHATSAPP_TOKEN }
      });
      var base64   = Buffer.from(imgResp.data).toString('base64');
      var mimeType = imgResp.headers['content-type'] || 'image/jpeg';
      parts.push({ inlineData: { mimeType: mimeType, data: base64 } });
    } catch (e) {
      console.error('Image fetch error:', e.message);
    }
  }
  parts.push({ text: fullPrompt });

  var requestBody = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: {
      maxOutputTokens: 500,
      temperature: 0.7
    }
  };

  try {
    var data = await callGemini(apiKey, requestBody);

    var candidate = data && data.candidates && data.candidates[0];
    if (!candidate || candidate.finishReason === 'SAFETY') {
      return { reply: 'ممكن توضح سؤالك أكثر؟', videos: [] };
    }

    var fullText = '';
    if (candidate.content && candidate.content.parts && candidate.content.parts[0]) {
      fullText = candidate.content.parts[0].text || '';
    }
    fullText = fullText.trim();

    if (!fullText) {
      return { reply: 'حاول تاني من فضلك.', videos: [] };
    }

    var videoRegex   = /\[VIDEO:([^\]]+)\]/g;
    var videoIds     = [];
    var match;
    while ((match = videoRegex.exec(fullText)) !== null) {
      videoIds.push(match[1].trim());
    }

    var cleanReply = fullText.replace(/\[VIDEO:[^\]]+\]/g, '').trim();

    var selectedVideos = videoIds
      .map(function(id) {
        return videos.find(function(v) { return v._id.toString() === id; });
      })
      .filter(Boolean);

    return { reply: cleanReply, videos: selectedVideos };

  } catch (error) {
    console.error('Gemini final error:', error.message);
    return {
      reply: 'في ضغط دلوقتي، ابعت رسالتك تاني بعد ثواني.',
      videos: []
    };
  }
}

module.exports = { getReply: getReply };    
    // تأكد إن الرد موجود
    const candidate = data?.candidates?.[0];
    if (!candidate || candidate.finishReason === 'SAFETY') {
      return {
        reply: 'آسف، ما قدرتش أفهم رسالتك. ممكن توضح أكثر؟',
        videos: []
      };
    }

    const fullText = candidate.content?.parts?.[0]?.text?.trim() || '';
    if (!fullText) {
      return { reply: 'حاول تاني من فضلك.', videos: [] };
    }

    // استخرج الفيديوهات المختارة
    const videoRegex   = /\[VIDEO:([^\]]+)\]/g;
    const videoIds     = [];
    let match;
    while ((match = videoRegex.exec(fullText)) !== null) {
      videoIds.push(match[1].trim());
    }

    const cleanReply = fullText.replace(/\[VIDEO:[^\]]+\]/g, '').trim();
    const selectedVideos = videoIds
      .map(id => videos.find(v => v._id.toString() === id))
      .filter(Boolean);

    return { reply: cleanReply, videos: selectedVideos };

  } catch (error) {
    console.error('Gemini final error:', error.message);
    // رسالة خطأ طبيعية بدون ذكر تقني
    return {
      reply: 'آسف، في تأخير بسيط. ابعت رسالتك تاني بعد لحظة.',
      videos: []
    };
  }
}

module.exports = { getReply };
