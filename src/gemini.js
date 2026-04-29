const axios = require('axios');

// بنقرا المفتاح من متغيرات البيئة (اللي ضفتها في HostingGuru)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

async function getReply({ message, imageUrl, systemPrompt, contactContext, videos }) {
  const videoList = videos.length === 0
    ? 'No videos available.'
    : videos.map(v => `ID:${v._id} | Title:${v.title} | Keywords:${v.keywords}`).join('\n');

  const fullPrompt = `${systemPrompt}

=== Contact Info ===
${contactContext}

=== Your Video Library ===
${videoList}

=== Instructions ===
- Reply naturally as the account owner, never mention AI
- Reply in the same language they use
- If one or more videos from the library fit their question, list them at the end like this:
  [VIDEO:id1]
  [VIDEO:id2]
  (each video on a separate line, in the order you want to send them)
- If no video fits, do not mention VIDEO at all
- Keep replies concise and human

=== Their Message ===
${message}`;

  const messages = [{ role: 'user', content: fullPrompt }];

  try {
    const response = await axios.post(
      OPENAI_URL,
      {
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 600,
        temperature: 0.85
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const fullText = response.data.choices[0].message.content.trim();

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
    console.error('OpenAI error:', error.response?.data || error.message);
    return {
      reply: '⚠️ عذراً، حدث خطأ مؤقت. جرب مرة أخرى.',
      videos: []
    };
  }
}

module.exports = { getReply };
