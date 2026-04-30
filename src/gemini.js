const axios = require('axios');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// نماذج Groq
const TEXT_MODEL = 'llama-3.3-70b-versatile';        // للنصوص
const VISION_MODEL = 'llama-3.2-11b-vision-preview'; // للصور (يفهم الصور)

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
  let messages = [{ role: 'user', content: fullPrompt }];
  let selectedModel = TEXT_MODEL;

  // لو فيه صورة، نضيفها ونسستخدم نموذج Vision
  if (imageUrl) {
    console.log('🖼️ Image detected, using Vision model...');
    selectedModel = VISION_MODEL;
    messages = [{
      role: 'user',
      content: [
        { type: 'text', text: fullPrompt },
        { type: 'image_url', image_url: { url: imageUrl } }
      ]
    }];
  }

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
    return extractVideosAndReply(fullText, videos, selectedModel);

  } catch (error) {
    console.error(`❌ ${selectedModel} error:`, error.response?.data || error.message);

    // لو نموذج Vision فشل، نجرب النموذج النصي كاحتياطي
    if (imageUrl) {
      console.log('⚠️ Vision model failed. Trying text-only fallback...');
      try {
        const fallbackMessages = [{
          role: 'user',
          content: fullPrompt + '\n\n[ملاحظة: العميل أرسل صورة لكن لم أتمكن من تحليلها تقنياً. سأرد على النص فقط.]'
        }];

        const textResponse = await axios.post(
          GROQ_URL,
          {
            model: TEXT_MODEL,
            messages: fallbackMessages,
            max_tokens: 700,
            temperature: 0.7
          },
          {
            headers: {
              'Authorization': `Bearer ${GROQ_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 20000
          }
        );

        const textFullText = textResponse.data.choices[0].message.content.trim();
        return extractVideosAndReply(textFullText, videos, TEXT_MODEL);

      } catch (textError) {
        console.error('❌ Text fallback also failed:', textError.message);
      }
    }

    return {
      reply: 'آسف، في تأخير بسيط. ابعت رسالتك تاني بعد لحظة.',
      videos: []
    };
  }
}

// دالة مساعدة لاستخراج الفيديوهات وتنظيف النص
function extractVideosAndReply(fullText, videos, modelUsed) {
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

  console.log(`✅ Reply generated via ${modelUsed}`);
  return { reply: cleanReply, videos: selectedVideos };
}

module.exports = { getReply };
