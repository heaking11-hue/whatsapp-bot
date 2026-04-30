const axios = require('axios');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL_NAME = 'llama-3.3-70b-versatile';

const TOOLS = [
  {
    type: "function",
    function: {
      name: "send_all_videos",
      description: "Use this ONLY when the user explicitly asks to see properties or sends a photo. This will send ALL available video tours.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "A short intro message before the videos, like: 'These are all available units around the university street.'"
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
      description: "Use this when the user asks for details you don't have or for a physical tour.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  }
];

async function getReply({ message, imageUrl, systemPrompt, contactContext, videos }) {
  let apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { reply: '⚠️ الخدمة غير متاحة حالياً.', videos: [] };

  const videoCatalog = videos.length > 0 
    ? videos.map(v => `ID:${v._id} - ${v.title}`).join('\n')
    : '(لا توجد فيديوهات متاحة حالياً)';

  const systemMessage = `${systemPrompt}
  
  === معلومات الشخص المتحدث ===
  ${contactContext} (إذا كان جديداً، ابدأ بالترحيب واسأل عن احتياجه).

  === مكتبة الفيديوهات المتاحة ===
  ${videoCatalog}

  === قاعدة ذهبية ===
  مهما حدث، يجب أن ترد باللغة العربية الفصحى أو العامية المصرية. أي رد بأي لغة أخرى ممنوع تماماً.`;

  const userMessage = imageUrl 
    ? `[المستخدم أرسل صورة للتو]\n${message}`
    : message;

  const messages = [
    { role: "system", content: systemMessage },
    { role: "user", content: userMessage }
  ];

  let loopCount = 0;
  const MAX_LOOPS = 3; // أمان إضافي

  while (loopCount < MAX_LOOPS) {
    loopCount++;
    try {
      const response = await axios.post(GROQ_URL, {
        model: MODEL_NAME,
        messages: messages,
        tools: TOOLS,
        tool_choice: "auto",
        max_tokens: 700,
        temperature: 0.7
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 25000
      });

      const assistantMessage = response.data.choices[0].message;
      
      // إذا انتهى الحوار (لا توجد طلبات أدوات)
      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        let finalReply = assistantMessage.content || "";
        
        // تنظيف الرد النهائي: إزالة أي كلمات إنجليزية طاردة
        finalReply = finalReply.replace(/\[VIDEO:ALL\]/g, '').trim();
        if (!finalReply) finalReply = "تمام، هبعتلك الشقق المتاحة دلوقتي.";
        
        // إرسال جميع الفيديوهات إذا كان الرد يحتوي على [VIDEO:ALL] (للتوافق)
        const videoIds = assistantMessage.content?.includes('[VIDEO:ALL]') ? videos.map(v => v._id) : [];
        const selectedVideos = videoIds.map(id => videos.find(v => v._id.toString() === id.toString())).filter(Boolean);
        
        return { reply: finalReply, videos: selectedVideos };
      }

      // تنفيذ طلبات الأدوات
      messages.push(assistantMessage); // إضافة رد النموذج
      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);
        let toolResult = "";

        if (toolName === "send_all_videos") {
          // نضيف علامة [VIDEO:ALL] ليعرف webhook.js أنه يجب إرسال جميع الفيديوهات
          const introMsg = toolArgs.message || "الشقق المتاحة في مكتب الهضبة الوسطى.";
          toolResult = `[سيتم إرسال جميع الفيديوهات الآن. قل للعميل: "${introMsg}". ثم اكتب [VIDEO:ALL] في ردك التالي.]`;
        } else if (toolName === "send_manager_contact") {
          toolResult = `تفضل، أرسل للعميل هذه الرسالة: "للتواصل مع مدير المكتب أ/ محمد فريد على 01111631219. قول له أنك كلمت عبدالله."`;
        }
        
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: toolResult });
      }

    } catch (error) {
      console.error('Groq API Error:', error.response?.data || error.message);
      // محاولة أخيرة بدون أدوات
      try {
        let simpleMessages = [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ];
        let fallbackResponse = await axios.post(GROQ_URL, {
          model: MODEL_NAME, messages: simpleMessages, max_tokens: 500, temperature: 0.7
        }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 20000 });
        return { reply: fallbackResponse.data.choices[0].message.content.trim(), videos: [] };
      } catch (finalError) {
        return { reply: 'معلش، الدنيا زحمت شوية. ممكن تعيد الرسالة؟', videos: [] };
      }
    }
  }
}

module.exports = { getReply };
