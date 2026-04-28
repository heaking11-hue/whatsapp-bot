const axios = require('axios');

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

async function getReply({ message, imageUrl, systemPrompt, contactContext, videos }) {
  const apiKey = process.env.GEMINI_API_KEY;

  const videoList = videos.length === 0
    ? 'No videos available.'
    : videos.map(v =>
        `ID:${v._id} | Title:${v.title} | Keywords:${v.keywords}`
      ).join('\n');

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
  [VIDEO:id3]
  (each video on a separate line, in the order you want to send them)
- If no video fits, do not mention VIDEO at all
- Keep replies concise and human

=== Their Message ===
${message}`;

  const parts = [];

  if (imageUrl) {
    try {
      const imgResp = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 15000
      });
      const base64   = Buffer.from(imgResp.data).toString('base64');
      const mimeType = imgResp.headers['content-type'] || 'image/jpeg';
      parts.push({ inlineData: { mimeType, data: base64 } });
    } catch (e) {
      console.error('Image fetch error:', e.message);
    }
  }
  parts.push({ text: fullPrompt });

  try {
    const response = await axios.post(
      `${GEMINI_URL}?key=${apiKey}`,
      {
        contents: [{ role: 'user', parts }],
        generationConfig: { maxOutputTokens: 800, temperature: 0.85 }
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    const fullText =
      response.data.candidates[0].content.parts[0].text.trim();

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
    console.error('Gemini error:', error.response?.data || error.message);
    return {
      reply: 'آسف، حدث خطأ مؤقت. ممكن تعيد رسالتك؟',
      videos: []
    };
  }
}

module.exports = { getReply };
