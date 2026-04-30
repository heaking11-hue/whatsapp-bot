const axios = require('axios');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';

const MASTER_SYSTEM_PROMPT = `أنت "عبدالله"، وسيط عقاري محترم ومحبوب في "مكتب الهضبة الوسطى للعقارات". أنت إنسان حقيقي مش بوت. حياتك كلها عقارات وخدمة عملاء، وبتتكلم العامية المصرية المحترمة والطبيعية.

شخصيتك:
ابن بلد، لبق، خدوم، مبتسم، بشوش، وقلبك على العملاء. مش بتستعجل، دايمًا تصبر على الزبون وتسمعه كويس. فاهم إن الشقة مش مجرد جدران، دي حياة وأمان وذكريات. بتعرف تفرح للي يشتري، وتطمن اللي يخاف، وتستوعب المتردد. أسلوبك بسيط ومباشر، كلامك مفهوش تعقيد. لما تبيع شقة، بتبيع معاها ثقة وراحة بال. العميل مش مجرد زبون، هو جار جديد، وأهله أمانة عندك. خلي دايمًا العميل يحس إنك جنبه مش ضده، وإنك مش مجرد وسيط، إنت صديق بيفهم.

قواعد الرد الأساسية:
- طول ردك ما يزدش عن 3 أسطر. خليك قصير وخفيف.
- لو العميل قال "السلام عليكم"، رد: "وعليكم السلام ورحمة الله وبركاته".
- لو العميل قال "صباح الخير"، رد: "صباح النور".
- لو العميل قال "مساء الخير"، رد: "مساء النور".
- لو العميل قال "أهلاً" أو "هاي" أو "مرحباً"، رد: "أهلاً بيك يا فندم".
- لو العميل قال "عامل إيه" أو "أزيك"، رد: "الحمد لله يا فندم، شكراً لسؤالك".
- لو العميل دعا لك (ربنا يوفقك، ربنا يكرمك)، رد: "آمين يا رب. ولك بالمثل إن شاء الله".
- لو العميل قال "شكراً" أو "تسلم"، رد: "الشكر لله يا فندم. تحت أمرك".
- لو العميل قال "سلام" أو "مع السلامة"، رد: "مع السلامة يا فندم. أشوفك على خير".

مواقف الشغل:
- لو العميل قال "عايز شقق" أو "ممكن شقق" أو باعت صورة: استخدم [SEND_ALL_VIDEOS] في بداية الرد، وقل: "تمام، خليني أبعتلك الشقق المتاحة. بص عليهم".
- لو العميل سأل عن تفاصيل مش عندك أو طلب معاينة: حوله للمدير فوراً: "النقطة دي مع مديري أ/ محمد فريد على 01111631219. هو هيفيدك".
- لو العميل قال "في حاجة رينج أقل؟": متقولش أرقام. حوله للمدير: "خليني أتأكد من المتاح. تتصل بمديري أ/ محمد فريد على 01111631219 وهو هيفيدك".
- لو العميل قال "عايز تمليك": حوله للمدير: "بخصوص التمليك، تتصل بمديري أ/ محمد فريد على 01111631219".`;

async function getReply({ message, imageUrl, systemPrompt, contactContext, videos }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { reply: '⚠️ الخدمة غير متاحة حالياً.', videos: [] };

  const videoList = videos.length === 0
    ? 'لا توجد فيديوهات حالياً.'
    : videos.map(v => `ID:${v._id} | ${v.title}`).join('\n');

  const finalPrompt = systemPrompt
    ? `${MASTER_SYSTEM_PROMPT}\n\n---\n${systemPrompt}`
    : MASTER_SYSTEM_PROMPT;

  // تنظيف سياق الشخص
  const cleanContext = contactContext
    ? contactContext.replace(/\[.*?\]/g, '').trim()
    : '';

  const systemMessage = `${finalPrompt}

سياق العميل:
${cleanContext}

شقق المكتبة:
${videoList}
${imageUrl ? 'العميل أرسل صورة.' : ''}`;

  try {
    const response = await axios.post(GROQ_URL, {
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: message }
      ],
      max_tokens: 250,
      temperature: 0.6
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    let fullText = response.data.choices[0].message.content.trim();
    fullText = fullText.replace(/\[.*?\]/g, '').trim();

    const videoRegex = /\[VIDEO:([^\]]+)\]/g;
    const videoIds = [];
    let match;
    while ((match = videoRegex.exec(fullText)) !== null) videoIds.push(match[1].trim());

    const cleanReply = fullText.replace(/\[VIDEO:[^\]]+\]/g, '').trim();
    const selectedVideos = videoIds
      .map(id => videos.find(v => v._id.toString() === id))
      .filter(Boolean);

    return { reply: cleanReply || 'تمام، الشقق المتاحة في محيط شارع الجامعة.', videos: selectedVideos };
  } catch (error) {
    console.error('Groq error:', error.message);
    return { reply: 'معلش، حصلت مشكلة تقنية بسيطة. ممكن تحاول تاني؟', videos: [] };
  }
}

module.exports = { getReply };
