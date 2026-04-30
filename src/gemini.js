const axios = require('axios');

// ═══════════════════════════════════════════════════
// إعدادات النماذج – ممكن تعدلهم بسهولة
// ═══════════════════════════════════════════════════
const MODELS = [
  { name: 'gemini-2.5-flash', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent' },
  { name: 'gemini-1.5-flash', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent' },
  { name: 'gemini-2.0-flash', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent' },
];

const MAX_RETRIES_PER_MODEL = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 16000;
const TOTAL_TIMEOUT_MS = 60000; // دقيقة كاملة للرد

// ═══════════════════════════════════════════════════
// النوم بمدة معينة
// ═══════════════════════════════════════════════════
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════
// هل الخطأ يستحق إعادة المحاولة؟
// ═══════════════════════════════════════════════════
function isRetryableError(status) {
  // 429: rate limit, 503: service unavailable, 500/502/504: server errors
  return [429, 503, 500, 502, 504].includes(status) || !status;
}

// ═══════════════════════════════════════════════════
// استدعاء نموذج واحد مع إعادة المحاولة
// ═══════════════════════════════════════════════════
async function callOneModel(model, apiKey, requestBody, retries = MAX_RETRIES_PER_MODEL) {
  let lastError = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await axios.post(
        `${model.url}?key=${apiKey}`,
        requestBody,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 20000
        }
      );

      // نجاح – نرجع النص مباشرة
      const candidate = response.data?.candidates?.[0];
      if (candidate?.content?.parts?.[0]?.text) {
        return {
          text: candidate.content.parts[0].text.trim(),
          model: model.name,
          finishReason: candidate.finishReason || 'STOP'
        };
      }

      // لو رد لكن مافيش نص (ممكن يكون حظر أمان)
      if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'BLOCKLIST') {
        throw { status: 'SAFETY_BLOCK', message: 'Response blocked by safety filter', retryable: false };
      }

      throw { status: 'EMPTY_RESPONSE', message: 'Empty response from model', retryable: true };

    } catch (err) {
      lastError = err;

      // لو خطأ غير قابل لإعادة المحاولة، نخرج فوراً
      const status = err.response?.status || err.status || 0;
      if (!isRetryableError(status)) {
        console.error(`❌ [${model.name}] Non-retryable error (${status}): ${err.message}`);
        throw err;
      }

      // لو آخر محاولة، نخرج
      if (attempt === retries - 1) {
        console.error(`❌ [${model.name}] All ${retries} retries exhausted (${status})`);
        break;
      }

      // نحسب التأخير مع تشويش عشوائي (jitter)
      const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
      const jitter = Math.random() * 1000;
      console.warn(`⚠️ [${model.name}] Attempt ${attempt + 1}/${retries} failed (${status}). Retrying in ${Math.round((delay + jitter) / 1000)}s...`);
      await sleep(delay + jitter);
    }
  }

  throw lastError || new Error('Model call failed');
}

// ═══════════════════════════════════════════════════
// الدالة الرئيسية – تجرب كل النماذج بالترتيب
// ═══════════════════════════════════════════════════
async function getReply({ message, imageUrl, systemPrompt, contactContext, videos }) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not configured');
    return { reply: '⚠️ الخدمة غير متاحة حالياً – لم يتم تكوين مفتاح API.', videos: [] };
  }

  // ══════════════════════════════
  // تجهيز البرومبت الكامل
  // ══════════════════════════════
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
