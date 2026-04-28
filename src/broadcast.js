const { sendText, sendVideo } = require('./whatsapp');
const { Contact }             = require('./database');

async function broadcastText(message, phones = null) {
  const contacts = phones
    ? await Contact.find({ phone: { $in: phones }, isBlocked: false })
    : await Contact.find({ isBlocked: false });

  const results = { success: 0, failed: 0 };
  for (const contact of contacts) {
    try {
      await sendText(contact.phone, message);
      results.success++;
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      results.failed++;
    }
  }
  return results;
}

async function broadcastVideo(videoUrl, caption, phones = null) {
  const contacts = phones
    ? await Contact.find({ phone: { $in: phones }, isBlocked: false })
    : await Contact.find({ isBlocked: false });

  const results = { success: 0, failed: 0 };
  for (const contact of contacts) {
    try {
      await sendVideo(contact.phone, videoUrl, caption);
      results.success++;
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      results.failed++;
    }
  }
  return results;
}

async function sendToNumbers(phones, message) {
  const results = { success: 0, failed: 0 };
  for (const phone of phones) {
    try {
      const cleanPhone = phone.replace(/[^0-9]/g, '');
      await sendText(cleanPhone, message);
      results.success++;
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      results.failed++;
    }
  }
  return results;
}

module.exports = { broadcastText, broadcastVideo, sendToNumbers };
