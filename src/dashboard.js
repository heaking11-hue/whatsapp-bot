const express    = require('express');
const router     = express.Router();
const cloudinary = require('cloudinary').v2;
const multer     = require('multer');
const upload     = multer({ storage: multer.memoryStorage() });

const { Video, Contact, Message, getSetting, setSetting } = require('./database');
const { broadcastText, broadcastVideo, sendToNumbers }    = require('./broadcast');
const { sendText }                                         = require('./whatsapp');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function auth(req, res, next) {
  const pass = req.query.pass || req.body.pass || req.headers['x-password'];
  if (pass === process.env.DASHBOARD_PASSWORD) return next();
  if (req.method === 'GET') {
    return res.send(`
      <html dir="rtl"><head><meta charset="UTF-8">
      <style>
        body{font-family:Arial;display:flex;justify-content:center;align-items:center;
          min-height:100vh;background:#f0f4f8;margin:0}
        .box{background:white;padding:40px;border-radius:12px;text-align:center;
          box-shadow:0 4px 20px rgba(0,0,0,0.1)}
        input{padding:12px;border:1px solid #ddd;border-radius:8px;font-size:16px;
          width:220px;margin:10px 0;display:block}
        button{padding:12px 30px;background:#1a1a2e;color:white;border:none;
          border-radius:8px;font-size:16px;cursor:pointer;margin-top:10px}
      </style></head>
      <body><div class="box">
        <h2>🤖 WhatsApp Bot</h2>
        <form method="GET">
          <input type="password" name="pass" placeholder="كلمة السر" required>
          <button type="submit">دخول</button>
        </form>
      </div></body></html>
    `);
  }
  res.status(401).json({ error: 'Unauthorized' });
}

router.get('/', auth, async (req, res) => {
  const pass          = req.query.pass;
  const isActive      = await getSetting('is_active', true);
  const systemPrompt  = await getSetting('system_prompt', '');
  const videos        = await Video.find({}).sort({ createdAt: -1 }).lean();
  const contacts      = await Contact.find({}).sort({ lastContact: -1 }).limit(20).lean();
  const totalContacts = await Contact.countDocuments();
  const totalMessages = await Message.countDocuments();

  res.send(`
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp Bot</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;background:#f0f4f8}
  .header{background:#1a1a2e;color:white;padding:18px 28px;
    display:flex;justify-content:space-between;align-items:center}
  .header h1{font-size:19px}
  .badge{padding:6px 16px;border-radius:20px;font-size:13px;
    background:${isActive?'#4CAF50':'#f44336'};color:white}
  .container{max-width:1100px;margin:0 auto;padding:20px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
    gap:14px;margin-bottom:18px}
  .card{background:white;border-radius:12px;padding:18px;
    box-shadow:0 2px 8px rgba(0,0,0,0.06)}
  .card h3{font-size:12px;color:#888;margin-bottom:6px}
  .card .num{font-size:26px;font-weight:bold;color:#1a1a2e}
  .section{background:white;border-radius:12px;padding:22px;
    box-shadow:0 2px 8px rgba(0,0,0,0.06);margin-bottom:18px}
  .section h2{font-size:16px;color:#1a1a2e;margin-bottom:14px;
    border-bottom:2px solid #f0f4f8;padding-bottom:9px}
  input,textarea,select{width:100%;padding:10px 13px;border:1px solid #ddd;
    border-radius:8px;font-size:14px;font-family:Arial;margin-bottom:9px}
  textarea{min-height:90px;resize:vertical}
  .btn{padding:10px 22px;border:none;border-radius:8px;font-size:14px;
    cursor:pointer;font-weight:bold}
  .btn-dark{background:#1a1a2e;color:white}
  .btn-green{background:#4CAF50;color:white}
  .btn-red{background:#f44336;color:white}
  .btn-orange{background:#FF9800;color:white}
  .vcard{border:1px solid #e0e0e0;border-radius:10px;padding:15px;margin-bottom:11px}
  .vcard h4{font-size:14px;color:#1a1a2e;margin-bottom:5px}
  .vcard p{font-size:12px;color:#666;margin-bottom:3px}
  .kw{display:inline-block;padding:2px 9px;border-radius:11px;font-size:11px;
    background:#e3f2fd;color:#1565c0;margin:2px}
  .crow{display:flex;justify-content:space-between;align-items:center;
    padding:9px 0;border-bottom:1px solid #f0f0f0}
  .crow:last-child{border-bottom:none}
  .row2{display:flex;gap:10px}
  .row2>*{flex:1}
  .info{padding:11px 14px;border-radius:8px;font-size:13px;
    background:#d1ecf1;color:#0c5460;margin-bottom:9px}
  label{font-size:12px;color:#666;display:block;margin-bottom:2px}
</style>
</head>
<body>

<div class="header">
  <h1>🤖 WhatsApp Bot Dashboard</h1>
  <div style="display:flex;align-items:center;gap:12px">
    <span class="badge">${isActive?'✅ شغّال':'⏸️ متوقف'}</span>
    <form method="POST" action="/dashboard/toggle?pass=${pass}" style="margin:0">
      <button class="btn btn-orange" type="submit">
        ${isActive?'إيقاف مؤقت':'تشغيل'}
      </button>
    </form>
  </div>
</div>

<div class="container">

  <div class="grid">
    <div class="card"><h3>إجمالي الأشخاص</h3><div class="num">${totalContacts}</div></div>
    <div class="card"><h3>إجمالي الرسائل</h3><div class="num">${totalMessages}</div></div>
    <div class="card"><h3>عدد الفيديوهات</h3><div class="num">${videos.length}</div></div>
    <div class="card"><h3>حالة البوت</h3>
      <div class="num" style="font-size:18px;color:${isActive?'#4CAF50':'#f44336'}">
        ${isActive?'يعمل 24/7':'متوقف'}
      </div>
    </div>
  </div>

  <!-- إعدادات الذكاء الاصطناعي -->
  <div class="section">
    <h2>🧠 شخصية الذكاء الاصطناعي</h2>
    <form method="POST" action="/dashboard/settings?pass=${pass}">
      <label>اكتب هنا إزاي عايز البوت يتكلم ويرد</label>
      <textarea name="system_prompt">${systemPrompt}</textarea>
      <button class="btn btn-dark" type="submit">💾 حفظ</button>
    </form>
  </div>

  <!-- إضافة فيديو -->
  <div class="section">
    <h2>📹 إضافة فيديو جديد</h2>
    <div class="info">
      ارفع الفيديو على Cloudinary الأول، بعدين هات الرابط وحطه هنا.
      الفيديو بيتبعت من Cloudinary مباشرة — مش بياخد من نت تليفونك.
    </div>
    <form method="POST" action="/dashboard/videos/add?pass=${pass}">
      <div class="row2">
        <div>
          <label>رابط الفيديو من Cloudinary (ينتهي بـ .mp4)</label>
          <input name="cloudinaryUrl" placeholder="https://res.cloudinary.com/..." required>
        </div>
        <div>
          <label>عنوان الفيديو</label>
          <input name="title" placeholder="مثال: شرح الأسعار" required>
        </div>
      </div>
      <label>الكلمات المفتاحية (الذكاء الاصطناعي بيستخدمها يختار الفيديو)</label>
      <input name="keywords" placeholder="مثال: سعر، تكلفة، كم، أسعار" required>
      <label>الوصف (ده اللي بيظهر تحت الفيديو في واتساب)</label>
      <textarea name="description"
        placeholder="اكتب هنا الوصف اللي هيظهر تحت الفيديو..."
        style="min-height:70px" required></textarea>
      <button class="btn btn-green" type="submit">➕ إضافة الفيديو</button>
    </form>
  </div>

  <!-- قائمة الفيديوهات -->
  <div class="section">
    <h2>🎬 مكتبة الفيديوهات (${videos.length} فيديو)</h2>
    ${videos.length === 0
      ? '<p style="color:#888;text-align:center;padding:20px">مفيش فيديوهات لسه. ضيف فيديو من فوق.</p>'
      : videos.map(v => `
        <div class="vcard">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div style="flex:1">
              <h4>🎥 ${v.title}</h4>
              <p>
                ${v.keywords.split('،').map(k =>
                  `<span class="kw">${k.trim()}</span>`
                ).join('')}
              </p>
              <p style="margin-top:6px"><strong>الوصف:</strong> ${v.description}</p>
              <p style="font-size:11px;color:#aaa;margin-top:4px">
                ${v.cloudinaryUrl.substring(0,55)}...
              </p>
            </div>
            <form method="POST"
              action="/dashboard/videos/delete/${v._id}?pass=${pass}"
              style="margin-right:12px">
              <button class="btn btn-red" type="submit"
                onclick="return confirm('تمسح الفيديو ده؟')">🗑️</button>
            </form>
          </div>
        </div>
      `).join('')
    }
  </div>

  <!-- إرسال جماعي -->
  <div class="section">
    <h2>📢 رسالة جماعية</h2>
    <div class="info">
      لو سيبت خانة الأرقام فاضية، هتتبعت لكل الأشخاص اللي كلّموك قبل كده.
      لو حطيت أرقام، هتتبعت لهم بس — حتى لو مش مسجّلين عندك.
    </div>
    <form method="POST" action="/dashboard/broadcast?pass=${pass}">
      <label>الرسالة</label>
      <textarea name="message" placeholder="اكتب الرسالة هنا..." required></textarea>
      <label>أرقام معينة (سطر لكل رقم - اتركها فاضية للكل)</label>
      <textarea name="custom_phones"
        placeholder="966501234567&#10;966507654321"
        style="min-height:80px"></textarea>
      <button class="btn btn-dark" type="submit">🚀 إرسال</button>
    </form>
  </div>

  <!-- إرسال لشخص معين -->
  <div class="section">
    <h2>💬 إرسال لشخص معين</h2>
    <form method="POST" action="/dashboard/send?pass=${pass}">
      <div class="row2">
        <div>
          <label>رقم الهاتف مع كود الدولة</label>
          <input name="phone" placeholder="966501234567" required>
        </div>
        <div>
          <label>الرسالة</label>
          <input name="message" placeholder="اكتب الرسالة" required>
        </div>
      </div>
      <button class="btn btn-green" type="submit">📤 إرسال</button>
    </form>
  </div>

  <!-- الأشخاص -->
  <div class="section">
    <h2>👥 آخر الأشخاص اللي كلّموك (${totalContacts} إجمالي)</h2>
    ${contacts.map(c => `
      <div class="crow">
        <div>
          <strong>${c.name || c.phone}</strong>
          ${c.isKnown
            ? '<span class="kw" style="background:#d4edda;color:#155724">معروف</span>'
            : ''}
          <div style="font-size:11px;color:#888">
            ${c.totalMessages} رسالة ·
            آخر تواصل: ${new Date(c.lastContact).toLocaleDateString('ar-EG')}
          </div>
        </div>
        <form method="POST"
          action="/dashboard/contacts/${c.phone}/mark-known?pass=${pass}"
          style="margin:0">
          <button class="btn"
            style="padding:5px 12px;font-size:11px;
              background:${c.isKnown?'#d4edda':'#e3f2fd'};
              color:${c.isKnown?'#155724':'#1565c0'};border:none;
              border-radius:8px;cursor:pointer">
            ${c.isKnown ? '✓ معروف' : 'اعمله معروف'}
          </button>
        </form>
      </div>
    `).join('')}
  </div>

</div>
</body>
</html>
  `);
});

router.post('/toggle', auth, async (req, res) => {
  const current = await getSetting('is_active', true);
  await setSetting('is_active', !current);
  res.redirect(`/dashboard?pass=${req.query.pass}`);
});

router.post('/settings', auth, async (req, res) => {
  await setSetting('system_prompt', req.body.system_prompt || '');
  res.redirect(`/dashboard?pass=${req.query.pass}`);
});

router.post('/videos/add', auth, async (req, res) => {
  try {
    const { cloudinaryUrl, title, description, keywords } = req.body;
    await new Video({ cloudinaryUrl, title, description, keywords }).save();
  } catch (e) {
    console.error('Add video error:', e.message);
  }
  res.redirect(`/dashboard?pass=${req.query.pass}`);
});

router.post('/videos/delete/:id', auth, async (req, res) => {
  await Video.findByIdAndDelete(req.params.id);
  res.redirect(`/dashboard?pass=${req.query.pass}`);
});

router.post('/broadcast', auth, async (req, res) => {
  const { message, custom_phones } = req.body;
  let results;
  if (custom_phones && custom_phones.trim()) {
    const phones = custom_phones.trim().split('\n')
      .map(p => p.trim().replace(/[^0-9]/g, ''))
      .filter(p => p.length > 6);
    results = await sendToNumbers(phones, message);
  } else {
    results = await broadcastText(message);
  }
  res.redirect(`/dashboard?pass=${req.query.pass}`);
});

router.post('/send', auth, async (req, res) => {
  const { phone, message } = req.body;
  await sendText(phone.replace(/[^0-9]/g, ''), message);
  res.redirect(`/dashboard?pass=${req.query.pass}`);
});

router.post('/contacts/:phone/mark-known', auth, async (req, res) => {
  const c = await Contact.findOne({ phone: req.params.phone });
  if (c) { c.isKnown = !c.isKnown; await c.save(); }
  res.redirect(`/dashboard?pass=${req.query.pass}`);
});

module.exports = router;
