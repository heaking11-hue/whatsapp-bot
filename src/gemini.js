const axios = require('axios');

const GEMINI_URL =
  'const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// نظام المحاولات المتعددة
async function callGemini(apiKey, requestBody, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.post(
        `${GEMINI_URL}?key=${apiKey}`,
        requestBody,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 25000
        }
      );
      return response.data;
    } catch (err) {
      const status = err.response?.status;
      console.error(`Gemini attempt ${i+1} failed: ${status} - ${err.message}`);
      // لو خطأ 429 (rate limit) أو 503، انتظر وحاول تاني
      if ((status === 429 || status === 503 || !status) && i < retries - 1) {
        await new Promise(r => setTimeout(r, (i + 1) * 2000));
        continue;
      }
      // لو خطأ تاني، ارمي الخطأ
      throw err;
    }
  }
}

async function getReply({ message, imageUrl, systemPrompt, contactContext, videos }) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return { reply: 'الخدمة غير متاحة حالياً.', videos: [] };
  }

  // قائمة الفيديوهات
  const videoList = videos.length === 0
    ? 'No videos available.'
    : videos.map(v =>
        `ID:${v._id} | Title:${v.title} | Keywords:${v.keywords}`
      ).join('\n');

  const fullPrompt = `${systemPrompt}

=== معلومات الشخص المتحدث ===
${contactContext}

=== مكتبة الفيديوهات ===
${videoList}

=== تعليمات مهمة ===
- رد كأنك أنت صاحب الحساب بالظبط، بشكل طبيعي وبسيط
- لا تذكر أبداً أنك ذكاء اصطناعي أو بوت أو برنامج
- رد بنفس لغة الشخص
- لو فيديو من المكتبة يناسب السؤال، ضيف في نهاية ردك: [VIDEO:id]
- لو أكثر من فيديو يناسب، ضيفهم كلهم: [VIDEO:id1] [VIDEO:id2]
- لو مفيش فيديو مناسب، متذكرش VIDEO خالص
- الرد يكون مختصر وطبيعي

=== رسالة الشخص ===
${message}`;

  const parts = [];

  // لو في صورة
  if (imageUrl) {
    try {
      const imgResp = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`
        }
      });
      const base64   = Buffer.from(imgResp.data).toString('base64');
      const mimeType = imgResp.headers['content-type'] || 'image/jpeg';
      parts.push({ inlineData: { mimeType, data: base64 } });
    } catch (e) {
      console.error('Image fetch error:', e.message);
    }
  }
  parts.push({ text: fullPrompt });

  const requestBody = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      maxOutputTokens: 500,
      temperature: 0.7,
      topP: 0.8,
      topK: 40
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  };

  try {
    const data = await callGemini(apiKey, requestBody);
    
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
