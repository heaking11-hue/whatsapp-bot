const axios = require('axios');

// ═══════════════════════════════════════════════════
// إعدادات الـ AI Agent
// ═══════════════════════════════════════════════════
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.1-8b-instant'; // نموذج خفيف وسريع وحدوده عالية

// ═══════════════════════════════════════════════════
// الدالة الرئيسية (عقل الوكيل)
// ═══════════════════════════════════════════════════
async function getReply({ message, imageUrl, systemPrompt, contactContext, videos }) {
  if (!GROQ_API_KEY) {
    return { reply: '⚠️ الخدمة غير متاحة حالياً.', videos: [] };
  }

  // تجهيز كتالوج الفيديوهات
  const videoList = videos.length === 0
    ? 'لا توجد فيديوهات حالياً.'
    : videos.map(v => `ID:${v._id} - ${v.title}`).join('\n');

  // بناء تعليمات النظام الكاملة
  const systemMessage = `${systemPrompt}

  === معلومات الشخص المتحدث ===
  ${contactContext}

  === مكتبة الفيديوهات المتاحة ===
  ${videoList}

  === آلية عمل الوكيل ===
  أنت وكيل عقاري ذكي.
  - إذا طلب العميل رؤية الشقق أو أرسل صورة، ضع فقط [SEND_ALL_VIDEOS] في بداية ردك.
  - إذا طلب تفاصيل غير موجودة، ضع [SEND_MANAGER] في بداية ردك.
  - للتحيات أو الشكر أو أي كلام عام، رُد بشكل طبيعي ومهذب ومختصر بالعامية المصرية.
  - تذكر دائماً: ردودك قصيرة وطبيعية. لا تكرر نفس الجملة. لا تهلوس.`;

  // رسالة المستخدم (مع الإشارة للصورة لو موجودة)
  const userMessage = imageUrl
    ? `[المستخدم أرسل صورة للتو]\n${message}`
    : message;

  try {
    // الطلب الوحيد والنهائي
    const response = await axios.post(GROQ_URL, {
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage }
      ],
      max_tokens: 250,
      temperature: 0.6
    }, {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    let replyText = response.data.choices[0].message.content.trim();

    // فك طلبات الأدوات من الرد
    const shouldSendAllVideos = replyText.includes('[SEND_ALL_VIDEOS]');
    const shouldSendManager = replyText.includes('[SEND_MANAGER]');

    // تنظيف النص النهائي من أي طلبات أدوات
    replyText = replyText.replace('[SEND_ALL_VIDEOS]', '').replace('[SEND_MANAGER]', '');
    replyText = replyText.trim();

    // إذا طلب إرسال المدير
    if (shouldSendManager) {
      replyText = replyText || 'معلش، النقطة دي مش واضحة عندي. تقدر تتصل بمديري أ/ محمد فريد على 01111631219.';
    }

    // تجهيز الفيديوهات المطلوب إرسالها
    const selectedVideos = shouldSendAllVideos ? [...videos] : [];

    return {
      reply: replyText || 'تمام، هبعتلك الشقق المتاحة دلوقتي.',
      videos: selectedVideos
    };

  } catch (error) {
    console.error('Groq Error:', error.message);
    // محاولة استرداد بسيطة بدون أدوات
    try {
      const simpleResponse = await axios.post(GROQ_URL, {
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        max_tokens: 150,
        temperature: 0.6
      }, {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      return { reply: simpleResponse.data.choices[0].message.content.trim(), videos: [] };
    } catch (finalError) {
      return { reply: 'معلش، حصلت مشكلة تقنية بسيطة. ممكن تحاول تاني؟', videos: [] };
    }
  }
}

module.exports = { getReply };
