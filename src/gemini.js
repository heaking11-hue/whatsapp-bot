const axios = require('axios');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// نستخدم نموذج Llama Vision اللي بيفهم الصور - مجاني حالياً
const TEXT_MODEL = 'llama-3.3-70b-versatile'; // للنصوص
const VISION_MODEL = 'llama-3.2-11b-vision-preview'; // للصور

async function getReply({ message, imageUrl, systemPrompt, contactContext, videos }) {
  if (!GROQ_API_KEY) {
    return { reply: '⚠️ الخدمة غير متاحة حالياً.', videos: [] };
  }

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

  // تجهيز الرسالة
  const messages = [{ role: 'user', content: fullPrompt }];

  // لو فيه صورة، نضيفها كجزء من المحتوى
  if (imageUrl) {
    // بنبعت الصورة كـ image_url جوه نفس الرسالة
    messages[0].content = [
      { type: 'text', text: fullPrompt },
      { type: 'image_url', image_url: { url: imageUrl } }
    ];
  }

  // نختار النموذج المناسب (Vision لو فيه صورة، Text لو مفيش)
  const selectedModel = imageUrl ? VISION_MODEL : TEXT_MODEL;

  try {
    const response = await axios.post(
      GROQ_URL,
      {
        model: selectedModel,
        messages,
        max_tokens: 700,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 25000
      }
    );

    const fullText = response.data.choices[0].message.content.trim();

    // استخراج الفيديوهات المختارة
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

    console.log(`✅ Reply generated via ${selectedModel}`);
    return { reply: cleanReply, videos: selectedVideos };

  } catch (error) {
    console.error('Groq error:', error.response?.data || error.message);
    
    // لو نموذج Vision فشل، نجرب النموذج النصي كاحتياطي
    if (imageUrl) {
      console.log('⚠️ Vision model failed, trying text-only model...');
      try {
        const textOnlyMessages = [{ role: 'user', content: fullPrompt + '\n\n[ملاحظة: العميل أرسل صورة، لكني لم أتمكن من رؤيتها. سأرد على النص فقط.]' }];
        
        const textResponse = await axios.post(
          GROQ_URL,
          {
            model: TEXT_MODEL,
            messages: textOnlyMessages,
            max_tokens: 700,
            temperature: 0.7
          },
          {
            headers: {
              'Authorization': `Bearer ${GROQ_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 25000
          }
        );

        const textFullText = textResponse.data.choices[0].message.content.trim();
        
        const videoRegex2 = /\[VIDEO:([^\]]+)\]/g;
        const videoIds2 = [];
        let match2;
        while ((match2 = videoRegex2.exec(textFullText)) !== null) {
          videoIds2.push(match2[1].trim());
        }

        const cleanReply2 = textFullText.replace(/\[VIDEO:[^\]]+\]/g, '').trim();
        const selectedVideos2 = videoIds2
          .map(id => videos.find(v => v._id.toString() === id))
          .filter(Boolean);

        return { reply: cleanReply2, videos: selectedVideos2 };
      } catch (textError) {
        console.error('Text fallback also failed:', textError.message);
      }
    }

    return {
      reply: 'آسف، في تأخير بسيط. ابعت رسالتك تاني بعد لحظة.',
      videos: []
    };
  }
}

module.exports = { getReply };
