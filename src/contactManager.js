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

async function getConversationHistory(phone, limit = 10) {
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

  let ctx = '';
  if (isNew) {
    ctx = `[شخص جديد يتواصل للمرة الأولى - رقمه: ${contact.phone}]`;
  } else if (isKnown) {
    ctx = `[شخص معروف - ${contact.name || contact.phone} - أول تواصل: ${firstDate}]`;
    if (contact.notes) ctx += ` [ملاحظاتك: ${contact.notes}]`;
  } else {
    ctx = `[تواصل معك من قبل - ${contact.totalMessages} رسالة - آخر تواصل: ${lastDate}]`;
  }

  if (history.length > 0) {
    const recent = history.slice(-5).map(m =>
      `${m.role === 'user' ? 'الشخص' : 'أنت'}: ${m.content}`
    ).join('\n');
    ctx += `\n\nآخر محادثة:\n${recent}`;
  }
  return ctx;
}

module.exports = {
  getOrCreateContact,
  getConversationHistory,
  saveMessage,
  buildContactContext
};
