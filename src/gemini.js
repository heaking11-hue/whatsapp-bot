const axios = require('axios');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = 'llama-3.3-70b-versatile'; // أقوى نموذج يدعم الأدوات

// تعريف الأدوات (Tools) المتاحة للبوت
const tools = [
  {
    type: "function",
    function: {
      name: "send_all_videos",
      description: "إرسال جميع الفيديوهات المتاحة في مكتبة الشقق دفعة واحدة. تُستخدم عندما يطلب العميل رؤية الشقق المتاحة أو يرسل صورة.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "نص مصاحب لإرسال الفيديوهات، مثل: 'الشقق المتاحة في محيط شارع الجامعة'"
          }
        },
        required: ["message"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_manager_contact",
      description: "إرسال معلومات الاتصال بمدير المكتب. تُستخدم عندما يطلب العميل تفاصيل غير موجودة أو معاينة.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "reply_naturally",
      description: "الرد على التحيات أو الشكر أو الدعاء أو أي كلام عام بشكل طبيعي ومهذب من غير استخدام أدوات أخرى.",
      parameters: {
        type: "object",
        properties: {
          greeting_type: {
            type: "string",
            enum: ["salam", "morning", "thanks", "duaa", "goodbye", "other"],
            description: "نوع التحية أو الموقف"
          },
          personal_message: {
            type: "string",
            description: "الرد المناسب الذي سيراه العميل"
          }
        },
        required: ["greeting_type", "personal_message"]
      }
    }
  }
];

// تنفيذ الأدوات محلياً
function executeTool(toolCall) {
  const { name, arguments: args } = toolCall.function;
  const parsedArgs = JSON.parse(args);

  if (name === "send_all_videos") {
    // سنرجع نصاً يحتوي على إشارات الفيديو، وسيتولى webhook.js الباقي
    return {
      role: "tool",
      content: `لقد طلبت إرسال جميع الفيديوهات المتاحة. سيتم إرسالها الآن. (استخدم [VIDEO:ALL] في ردك للإشارة إلى إرسال جميع الفيديوهات. سيتم استبدالها تلقائياً)`
    };
  } else if (name === "send_manager_contact") {
    return {
      role: "tool",
      content: `معلومات المدير: الاسم: أ/ محمد فريد. رقم الهاتف: 01111631219.`
    };
  } else if (name === "reply_naturally") {
    // لا نحتاج لفعل شيء، النموذج سيستخدم الرسالة المرفقة
    return {
      role: "tool",
      content: `تم توليد الرد الطبيعي بنجاح. استخدم الرسالة التي حددتها للعميل.`
    };
  }
  return { role: "tool", content: "" };
}

async function getReply({ message, imageUrl, systemPrompt, contactContext, videos }) {
  if (!GROQ_API_KEY) {
    return { reply: '⚠️ الخدمة غير متاحة حالياً.', videos: [] };
  }

  const videoList = videos.length === 0
    ? 'No videos available.'
    : videos.map(v => `ID:${v._id} | Title:${v.title} | Description:${v.description}`).join('\n');

  const fullPrompt = `${systemPrompt}

=== معلومات الشخص المتحدث ===
${contactContext}

=== مكتبة الفيديوهات المتاحة ===
${videoList}

=== رسالة الشخص ===
${message}
${imageUrl ? '[صورة مرفقة]' : ''}`;

  // بناء محتوى الرسالة الأولى (قد تحتوي على نص وصورة)
  const userContent = [];
  if (imageUrl) {
    userContent.push({ type: "image_url", image_url: { url: imageUrl } });
  }
  userContent.push({ type: "text", text: fullPrompt });

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent }
  ];

  try {
    // الاستدعاء الأول: قد يطلب فيه النموذج استخدام أداة
    let response = await axios.post(GROQ_URL, {
      model: MODEL,
      messages,
      tools: tools,
      tool_choice: "auto",
      max_tokens: 700,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    });

    let aiMessage = response.data.choices[0].message;
    
    // إذا طلب النموذج استدعاء أدوات
    while (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
      // نضيف رد النموذج (الذي يحتوي على tool_calls) إلى المحادثة
      messages.push(aiMessage);
      
      // ننفذ كل أداة طلبها ونجمع النتائج
      for (const toolCall of aiMessage.tool_calls) {
        const toolResult = executeTool(toolCall);
        messages.push(toolResult);
      }
      
      // نعيد الاستدعاء مع نتائج الأدوات ليحصل على الرد النهائي
      response = await axios.post(GROQ_URL, {
        model: MODEL,
        messages,
        max_tokens: 700,
        temperature: 0.7
      }, {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      });
      
      aiMessage = response.data.choices[0].message;
    }

    // الرد النهائي من النموذج
    const finalText = aiMessage.content.trim();
    
    // معالجة إشارات الفيديو الخاصة
    let allVideosIds = [];
    let cleanReply = finalText;
    
    if (finalText.includes('[VIDEO:ALL]')) {
      // إذا طلب إرسال جميع الفيديوهات
      allVideosIds = videos.map(v => v._id);
      cleanReply = finalText.replace('[VIDEO:ALL]', '');
    } else {
      // وإلا فاستخرج الإشارات الفردية
      const videoRegex = /\[VIDEO:([^\]]+)\]/g;
      let match;
      while ((match = videoRegex.exec(finalText)) !== null) {
        allVideosIds.push(match[1].trim());
      }
      cleanReply = finalText.replace(/\[VIDEO:[^\]]+\]/g, '');
    }
    
    // تنظيف الرد النهائي
    cleanReply = cleanReply.trim();
    
    // تحويل IDs إلى كائنات فيديو حقيقية
    const selectedVideos = allVideosIds
      .map(id => videos.find(v => v._id.toString() === id.toString()))
      .filter(Boolean);

    return { reply: cleanReply || 'تمام، الشقق المتاحة في محيط شارع الجامعة.', videos: selectedVideos };

  } catch (error) {
    console.error('Groq Agent error:', error.response?.data || error.message);
    return {
      reply: 'آسف، حصل مشكلة تقنية بسيطة. جرب تاني بعد لحظة.',
      videos: []
    };
  }
}

module.exports = { getReply };
