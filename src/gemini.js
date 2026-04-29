const axios = require('axios');

// النموذج الأساسي (Gemini 2.5 Flash) والنموذج الاحتياطي (1.5 Flash)
const PRIMARY_MODEL = 'gemini-2.5-flash';
const FALLBACK_MODEL = 'gemini-1.5-flash'; // احتياطي أقل ضغطاً

function getGeminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

// إعادة المحاولة مع تأخير تصاعدي
async function retryWithBackoff(fn, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const status = error.response?.status;
      // 429 (rate limited) أو 503 (service unavailable) نعيد المحاولة
      if ((status === 429 || status === 503) && attempt <= maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s
        console.log(`🔄 Retry attempt ${attempt}/${maxRetries} after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

async function callGemini(model, parts, apiKey) {
  const url = `${getGeminiUrl(model)}?key=${apiKey}`;
  const response = await axios.post(url, {
    contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: 600, temperature: 0.85 }
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 25000
  });
  return response.data.candidates[0].content.parts[0].text.trim();
}

async function getReply({ message, imageUrl, systemPrompt, contactContext, videos }) {
  const apiKey = process.env.GEMINI_API_KEY;

  const videoList = videos.length === 0
    ? 'No videos available.'
    : videos.map(v => `ID:${v._id} | Title:${v.title} | Keywords:${v.keywords}`).join('\n');

  const fullPrompt = `${systemPrompt}

=== Contact Info ===
${contactContext}

=== Your Video Library ===
${videoList}

=== Instructions ===
- Reply naturally as the account owner, never mention AI
- Reply in the same language they use
- If one or more videos from the library fit their question, list them at the end like this:
  [VIDEO:id1]
  [VIDEO:id2]
  [VIDEO:id3]
  (each video on a separate line, in the order you want to send them)
- If no video fits, do not mention VIDEO at all
- Keep replies concise and human

=== Their Message ===
${message}`;

  const parts = [];
  if (imageUrl) {
    try {
      const imgResp = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 15000
      });
      const base64   = Buffer.from(imgResp.data).toString('base64');
      const mimeType = imgResp.headers['content-type'] || 'image/jpeg';
      parts.push({ inlineData: { mimeType, data: base64 } });
    } catch (e) {
      console.error('Image fetch error:', e.message);
    }
  }
  parts.push({ text: fullPrompt });

  try {
    // نحاول بالنموذج الأساسي أولاً مع إعادة المحاولة
    const fullText = await retryWithBackoff(async () => {
      try {
        return await callGemini(PRIMARY_MODEL, parts, apiKey);
      } catch (primaryError) {
        // لو النموذج الأساسي فشل (404/503/429)، نجرب الاحتياطي
        console.warn(`⚠️ Primary model failed, trying fallback...`);
        return await callGemini(FALLBACK_MODEL, parts, apiKey);
      }
    });

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
    console.error('Gemini error:', error.response?.data || error.message);
    // رسالة خطأ مؤقتة مع رمز الحالة للتصحيح
    const statusCode = error.response?.status || 'unknown';
    return {
      reply: `⚠️ عذراً، أواجه ضغطاً عالياً حالياً (خطأ ${statusCode}). جرب بعد قليل.`,
      videos: []
    };
  }
}

module.exports = { getReply };
