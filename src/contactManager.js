const { Contact, Message } = require('./database');

async function getOrCreateContact(phone) {
  let contact = await Contact.findOne({ phone });
  if (!contact) {
    contact = new Contact({ phone });
    await contact.save();
  } else {
    contact.lastContact = new Date();
    contact.totalMessages += 1;
    await contact.save();
  }
  return contact;
}

async function getConversationHistory(phone, limit = 16) {
  const messages = await Message.find({ phone })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
  return messages.reverse();
}

async function saveMessage(phone, role, content, type = 'text') {
  const msg = new Message({ phone, role, content, type });
  await msg.save();
}

function buildContactContext(contact, history) {
  const isNew   = contact.totalMessages <= 1;
  const isKnown = contact.isKnown;
  const firstDate = contact.firstContact.toLocaleDateString('ar-EG');
  const lastDate  = contact.lastContact.toLocaleDateString('ar-EG');

  // 1. تحليل الاحتياج من الرسائل السابقة
  let lastUserRequest = '';
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') {
      lastUserRequest = history[i].content;
      break;
    }
  }

  // 2. توجيه السياق بوضوح للنموذج
  let ctx = '';
  if (isNew) {
    ctx = `[شخص جديد يتواصل للمرة الأولى - رقمه: ${contact.phone}]`;
  } else if (isKnown) {
    ctx = `[عميل معروف - ${contact.name || contact.phone} - أول تواصل: ${firstDate}]`;
    if (contact.notes) ctx += ` [ملاحظات: ${contact.notes}]`;
  } else {
    ctx = `[عميل متكرر - ${contact.totalMessages} رسالة - آخر تواصل: ${lastDate}]`;
  }

  // 3. إضافة آخر احتياج بوضوح
  if (lastUserRequest && !isNew) {
    ctx += `\n\n[آخر طلب من العميل: "${lastUserRequest}"]`;
  }

  // 4. إضافة المحادثة الأخيرة كمرجع
  if (history.length > 0) {
    const recent = history.slice(-5).map(m =>
      `${m.role === 'user' ? 'العميل' : 'أنت (عبدالله)'}: ${m.content}`
    ).join('\n');
    ctx += `\n\n[آخر محادثة للسياق]:\n${recent}`;
  }

  return ctx;
}

module.exports = {
  getOrCreateContact,
  getConversationHistory,
  saveMessage,
  buildContactContext
};
