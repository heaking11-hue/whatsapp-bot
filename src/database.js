const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  phone:         { type: String, required: true, unique: true },
  name:          { type: String, default: '' },
  isKnown:       { type: Boolean, default: false },
  notes:         { type: String, default: '' },
  firstContact:  { type: Date, default: Date.now },
  lastContact:   { type: Date, default: Date.now },
  totalMessages: { type: Number, default: 0 },
  isBlocked:     { type: Boolean, default: false },
});

const messageSchema = new mongoose.Schema({
  phone:     { type: String, required: true },
  role:      { type: String, enum: ['user','assistant'], required: true },
  content:   { type: String, required: true },
  type:      { type: String, default: 'text' },
  timestamp: { type: Date, default: Date.now },
});
messageSchema.index({ phone: 1, timestamp: -1 });

const videoSchema = new mongoose.Schema({
  cloudinaryUrl:   { type: String, required: true },
  title:           { type: String, required: true },
  description:     { type: String, required: true },
  keywords:        { type: String, required: true },
  createdAt:       { type: Date, default: Date.now },
});

const settingSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed,
});

const Contact = mongoose.model('Contact', contactSchema);
const Message = mongoose.model('Message', messageSchema);
const Video   = mongoose.model('Video', videoSchema);
const Setting = mongoose.model('Setting', settingSchema);

async function getSetting(key, defaultValue = '') {
  const s = await Setting.findOne({ key });
  return s ? s.value : defaultValue;
}

async function setSetting(key, value) {
  await Setting.findOneAndUpdate({ key }, { value }, { upsert: true });
}

module.exports = { Contact, Message, Video, Setting, getSetting, setSetting };
