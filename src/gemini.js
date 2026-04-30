const axios = require('axios');

// ═══════════════════════════════════════════════════
// إعدادات OpenRouter – آمنة لأن المفتاح في HostingGuru
// ═══════════════════════════════════════════════════
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL_NAME = 'openai/gpt-4o-mini'; // قوي ومجاني حالياً

// ═══════════════════════════════════════════════════
// الدالة الرئيسية
// ═══════════════════════════════════════════════════
async function getReply({ message, imageUrl, systemPrompt, contactContext, videos }) {
  if (!OPENROUTER_API_KEY) {
    console.error('❌ OPENROUTER_API_KEY not set');
    return { reply: '⚠️ الخدمة غير متاحة حالياً.', videos: [] };
  }

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

    console.log(`✅ Reply generated via ${MODEL_NAME}`);
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
