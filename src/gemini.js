const axios = require('axios');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.1-8b-instant'; // نموذج أسرع وحدود أعلى

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

  const messages = [{ role: 'user', content: fullPrompt }];

  try {
    const response = await axios.post(
      GROQ_URL,
      {
        model: GROQ_MODEL,
        messages,
        max_tokens: 500,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
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
    console.error('Groq error:', error.response?.data || error.message);
    return {
      reply: 'آسف، في تأخير بسيط. ابعت رسالتك تاني بعد لحظة.',
      videos: []
    };
  }
}

module.exports = { getReply };
