const axios = require('axios');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant'; // نموذج خفيف وسريع وحدوده عالية جداً

async function getReply({ message, imageUrl, systemPrompt, contactContext, videos }) {
  // 1. التحقق من مفتاح Groq API
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('❌ GROQ_API_KEY غير موجود في متغيرات البيئة.');
    return { reply: '⚠️ الخدمة غير متاحة حالياً.', videos: [] };
  }

  // 2. تجهيز معلومات الشقق
  const videoList = videos.length === 0
    ? 'لا توجد فيديوهات.'
    : videos.map(v => `ID:${v._id} | ${v.title}`).join('\n');

  // 3. بناء تعليمات النظام (System Prompt) داخلياً
  const defaultSystemPrompt = `أنت "عبدالله"، وسيط عقاري في مكتب الهضبة الوسطى. بتتكلم مصري محترم.
لما حد يسلم عليك: رد بتحية بسيطة (وعليكم السلام، صباح النور).
لما حد يطلب شقق أو يبعت صورة: ابعت كل الفيديوهات (استخدم [VIDEO:ALL]).
لما حد يسأل عن تفاصيل مش عندك: حوله على أ/ محمد فريد 01111631219.
متخترعش أسعار من دماغك. متكررش نفس الجملة.`;

  const systemMessage = `${systemPrompt || defaultSystemPrompt}

السياق: ${contactContext}

كتالوج الشقق المتاحة:
${videoList}

ملاحظة: ${imageUrl ? 'العميل أرسل صورة.' : 'العميل أرسل نصاً.'}`;

  try {
    // 4. إرسال الطلب إلى Groq API
    const response = await axios.post(
      GROQ_URL,
      {
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: message }
        ],
        max_tokens: 250, // عدد كلمات الرد
        temperature: 0.6 // مستوى الإبداع
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000 // 15 ثانية فقط
      }
    );

    let fullText = response.data.choices[0].message.content.trim();

    // 5. استخراج الفيديوهات المطلوبة
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

    return { reply: cleanReply || 'تمام، الشقق المتاحة في محيط شارع الجامعة.', videos: selectedVideos };

  } catch (error) {
    console.error('خطأ في Groq:', error.message);
    // 6. رد احتياطي في حالة وجود أي خطأ
    return {
      reply: 'معلش، حصلت مشكلة تقنية بسيطة. ممكن تحاول تاني؟',
      videos: []
    };
  }
}

module.exports = { getReply };
