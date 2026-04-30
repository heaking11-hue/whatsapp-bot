const axios = require('axios');

// ═══════════════════════════════════════════════════
// إعدادات OpenRouter – شغالة وجاهزة
// ═══════════════════════════════════════════════════
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_API_KEY = 'sk-or-v1-1e2f84a2c3a4b5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d';
const MODEL_NAME = 'openai/gpt-4o-mini';

// ═══════════════════════════════════════════════════
// الدالة الرئيسية
// ═══════════════════════════════════════════════════
async function getReply({ message, imageUrl, systemPrompt, contactContext, videos }) {
  // تجهيز قائمة الفيديوهات
  const videoList = videos.length === 0
    ? 'No videos available.'
    : videos.map(v => `ID:${v._id} | Title:${v.title} | Keywords:${v.keywords}`).join('\n');

  // تجميع البرومبت الكامل
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

  // تجهيز الرسالة
  const messages = [{ role: 'user', content: fullPrompt }];

  try {
    // إرسال الطلب إلى OpenRouter
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

    // استخراج النص من الرد
    const fullText = response.data.choices[0].message.content.trim();

    // استخراج الفيديوهات المختارة
    const videoRegex = /\[VIDEO:([^\]]+)\]/g;
    const videoIds = [];
    let match;
    while ((match = videoRegex.exec(fullText)) !== null) {
      videoIds.push(match[1].trim());
    }

    // تنظيف النص من إشارات الفيديو
    const cleanReply = fullText.replace(/\[VIDEO:[^\]]+\]/g, '').trim();
    
    // تجميع الفيديوهات المختارة
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

module.exports = { getReply };
