const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const config = require('./config');

// إعداد الذكاء الاصطناعي مع إيقاف فلاتر الحظر المزعجة
const genAI = new GoogleGenerativeAI(config.GEMINI_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ]
});

// دالة المحاولة التلقائية (بتحاول 3 مرات قبل ما تستسلم)
async function getGeminiReplyWithRetry(userContent, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const result = await model.generateContent(userContent);
            return result.response.text();
        } catch (error) {
            console.log(`[تحذير] فشل المحاولة ${i + 1} مع Gemini:`, error.message);
            if (i === retries - 1) {
                throw error; // لو دي آخر محاولة، ارمي الخطأ
            }
            // استنى ثانيتين قبل ما تجرب تاني
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

async function startAgent() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const sock = makeWASocket({ auth: state, printQRInTerminal: true });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        if (msg.key.participant) return; // تجاهل الجروبات أو الأرقام المتسجلة

        let userContent = [];
        
        if (msg.message.imageMessage) {
            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            userContent.push({ inlineData: { data: buffer.toString("base64"), mimeType: "image/jpeg" } });
            userContent.push(config.SYSTEM_PROMPT + " الزبون أرسل هذه الصورة.");
        } else {
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
            if (!text) return;
            userContent.push(config.SYSTEM_PROMPT + "\nرسالة الزبون: " + text);
        }

        try {
            // استخدام دالة المحاولة التلقائية بدلاً من الاستدعاء المباشر
            const responseText = await getGeminiReplyWithRetry(userContent);

            await sock.sendMessage(sender, { text: responseText });

            // كود إرسال الفيديو (مثال)
            if (responseText.includes("120m")) {
                await sock.sendMessage(sender, { 
                    video: { url: config.VIDEO_MAP["120m"] }, 
                    caption: "تفضل هذا فيديو المعاينة." 
                });
            }
        } catch (error) {
            // الخطأ ده مش هيظهر للزبون غير لو فشل 3 مرات متتالية!
            console.error("خطأ نهائي في الاتصال:", error);
            await sock.sendMessage(sender, { text: "عذراً يا فندم، السيستم فيه تحديث حالياً. هرد على حضرتك في أقرب وقت." });
        }
    });
}

startAgent();
