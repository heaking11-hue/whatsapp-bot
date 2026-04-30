const axios = require('axios');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_API_KEY = 'sk-or-v1-1e2f84a2c3a4b5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d';
const MODEL_NAME = 'openai/gpt-4o-mini';

async function getReply({ message, imageUrl, systemPrompt, contactContext, videos }) {
  const videoList = videos.length === 0
    ? 'No videos available.'
    : videos.map(v => `ID:${v._id} | Title:${v.title} | Keywords:${v.keywords}`).join('\n');

  const fullPrompt = `${systemPrompt}

=== معلومات الشخص المتحدث ===
${contactContext}

=== مكتبة الفيديوهات ===
${videoList}

=== تعليمات مهمة ===
- رد كأنك صاحب الحساب بالظبط، بشكل طبيعي وبسيط
- لا تذكر أبداً أنك ذكاء اصطناعي أو بوت أو برنامج
- رد بنفس لغة الشخص
- لو فيديو من المكتبة يناسب السؤال، ضيف في نهاية ردك: [VIDEO:id]
- لو أكثر من فيديو يناسب، ضيفهم كلهم: [VIDEO:id1] [VIDEO:id2]
- لو مفيش فيديو مناسب، متذكرش VIDEO خالص
- الرد يكون مختصر وطبيعي

=== رسالة الشخص ===
${message}`;

  const messages = [{ role: 'user', content: fullPrompt }];

  try {
    const response = await axios.post(
      OPENROUTER_URL,
      {
        model: MODEL_NAME,
        messages,
        max_tokens: 700,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://whatsapp-bot-7032.apps.hostingguru.io',
          'X-Title': 'WhatsApp Bot'
        },
        timeout: 30000
      }
    );

    const fullText = response.data.choices[0].message.content.trim();

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

    return { reply: cleanReply, videos: selectedVideos };

  } catch (error) {
    console.error('OpenRouter error:', error.response?.data || error.message);
    return {
      reply: 'آسف، في تأخير بسيط. ابعت رسالتك تاني بعد لحظة.',
      videos: []
    };
  }
}

module.exports = { getReply };  const videoList = videos.length === 0
    ? 'No videos available.'
    : videos.map(v => `ID:${v._id} | Title:${v.title} | Keywords:${v.keywords}`).join('\n');

  const fullPrompt = `${systemPrompt}

=== معلومات الشخص المتحدث ===
${contactContext}

=== مكتبة الفيديوهات ===
${videoList}

=== تعليمات مهمة ===
- رد كأنك صاحب الحساب بالظبط، بشكل طبيعي وبسيط
- لا تذكر أبداً أنك ذكاء اصطناعي أو بوت أو برنامج
- رد بنفس لغة الشخص
- لو فيديو من المكتبة يناسب السؤال، ضيف في نهاية ردك: [VIDEO:id]
- لو أكثر من فيديو يناسب، ضيفهم كلهم: [VIDEO:id1] [VIDEO:id2]
- لو مفيش فيديو مناسب، متذكرش VIDEO خالص
- الرد يكون مختصر وطبيعي

=== رسالة الشخص ===
${message}`;

  // ══════════════════════════════
  // تجهيز أجزاء الطلب
  // ══════════════════════════════
  const parts = [];
  
  // صورة لو موجودة
  if (imageUrl) {
    try {
      const imgResp = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}` }
      });
      const base64 = Buffer.from(imgResp.data).toString('base64');
      const mimeType = imgResp.headers['content-type'] || 'image/jpeg';
      parts.push({ inlineData: { mimeType, data: base64 } });
    } catch (e) {
      console.error('⚠️ Image fetch error:', e.message);
      // نكمل بدون الصورة
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

  // ══════════════════════════════
  // المحاولة عبر كل النماذج بالترتيب
  // ══════════════════════════════
  const startTime = Date.now();
  let result = null;
  let allErrors = [];

  for (const model of MODELS) {
    // لو الوقت خلص، نوقف
    if (Date.now() - startTime > TOTAL_TIMEOUT_MS) {
      console.error('⏰ Total timeout reached');
      break;
    }

    try {
      console.log(`🔄 Trying model: ${model.name}`);
      result = await callOneModel(model, apiKey, requestBody);
      console.log(`✅ [${model.name}] succeeded in ${Date.now() - startTime}ms`);
      break; // نجحنا، نخرج من الحلقة
    } catch (err) {
      const status = err.response?.status || err.status || 'unknown';
      allErrors.push({ model: model.name, status, message: err.message });
      console.warn(`⚠️ [${model.name}] failed: ${status} – ${err.message}`);
      // نجرب النموذج اللي بعده
      continue;
    }
  }

  // ══════════════════════════════
  // لو كل النماذج فشلت
  // ══════════════════════════════
  if (!result) {
    console.error('❌ All models exhausted:', JSON.stringify(allErrors));
    return {
      reply: 'آسف، في تأخير بسيط. ابعت رسالتك تاني بعد لحظة.',
      videos: []
    };
  }

  // ══════════════════════════════
  // استخراج الفيديوهات المختارة
  // ══════════════════════════════
  const videoRegex = /\[VIDEO:([^\]]+)\]/g;
  const videoIds = [];
  let match;
  while ((match = videoRegex.exec(result.text)) !== null) {
    videoIds.push(match[1].trim());
  }

  const cleanReply = result.text.replace(/\[VIDEO:[^\]]+\]/g, '').trim();
  const selectedVideos = videoIds
    .map(id => videos.find(v => v._id.toString() === id))
    .filter(Boolean);

  console.log(`✅ Reply generated via ${result.model}: ${cleanReply.substring(0, 80)}...`);

  return { reply: cleanReply, videos: selectedVideos };
}

module.exports = { getReply };
