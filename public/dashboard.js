// التخزين المحلي
let templates = JSON.parse(localStorage.getItem('templates') || '[]');
let contactLists = JSON.parse(localStorage.getItem('contactLists') || '[]');

// عرض القوالب والقوائم عند التحميل
window.onload = () => {
  renderTemplates();
  renderContactLists();
};

// === القوالب ===
function renderTemplates() {
  document.getElementById('templateList').innerHTML = templates.map((t, i) => `
    <div class="item">
      <span>${t.name}</span>
      <div>
        <button onclick="applyTemplateByIndex(${i})">استخدام</button>
        <button onclick="deleteTemplate(${i})">حذف</button>
      </div>
    </div>
  `).join('');
  document.getElementById('templateSelect').innerHTML = '<option value="">-- يدوي --</option>' + templates.map((t, i) => `<option value="${i}">${t.name}</option>`).join('');
}

function addTemplate() {
  const name = prompt('اسم القالب:');
  if (!name) return;
  const url = prompt('رابط الفيديو/الصورة:');
  const caption = prompt('الوصف:');
  templates.push({ name, url, caption });
  localStorage.setItem('templates', JSON.stringify(templates));
  renderTemplates();
}

function applyTemplateByIndex(index) {
  const t = templates[index];
  document.getElementById('mediaUrl').value = t.url;
  document.getElementById('messageText').value = t.caption;
}

function deleteTemplate(index) { templates.splice(index, 1); localStorage.setItem('templates', JSON.stringify(templates)); renderTemplates(); }

// === قوائم الأرقام ===
function renderContactLists() {
  document.getElementById('contactListPanel').innerHTML = contactLists.map((c, i) => `
    <div class="item">
      <span>${c.name} (${c.phones.length} رقم)</span>
      <div>
        <button onclick="applyContactListByIndex(${i})">استخدام</button>
        <button onclick="deleteContactList(${i})">حذف</button>
      </div>
    </div>
  `).join('');
  document.getElementById('contactListSelect').innerHTML = '<option value="">-- يدوي --</option>' + contactLists.map((c, i) => `<option value="${i}">${c.name} (${c.phones.length})</option>`).join('');
}

function addContactList() {
  const name = prompt('اسم القائمة:');
  if (!name) return;
  const raw = prompt('الصق الأرقام (كل رقم في سطر):');
  const phones = raw.split('\n').map(p => p.trim()).filter(p => p);
  contactLists.push({ name, phones });
  localStorage.setItem('contactLists', JSON.stringify(contactLists));
  renderContactLists();
}

function applyContactListByIndex(index) {
  document.getElementById('phones').value = contactLists[index].phones.join('\n');
}

function deleteContactList(index) { contactLists.splice(index, 1); localStorage.setItem('contactLists', JSON.stringify(contactLists)); renderContactLists(); }

// === الإرسال ===
async function sendMessages() {
  const mediaUrl = document.getElementById('mediaUrl').value.trim();
  const message = document.getElementById('messageText').value.trim();
  const phonesRaw = document.getElementById('phones').value.trim();
  if (!message && !mediaUrl) return alert('أدخل رسالة أو رابط وسائط');
  if (!phonesRaw) return alert('أدخل أرقام الهواتف');
  const phones = phonesRaw.split('\n').map(p => p.trim()).filter(p => p);
  const sendBtn = document.getElementById('sendBtn');
  sendBtn.disabled = true;
  document.getElementById('status').innerText = 'جار الإرسال...';
  
  try {
    const res = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        mediaUrl,
        phones,
        delayMin: document.getElementById('delayMin').value,
        delayMax: document.getElementById('delayMax').value
      })
    });
    const data = await res.json();
    document.getElementById('status').innerText = data.success ? `تم الإرسال بنجاح إلى ${data.results.filter(r => r.status === 'sent').length} جهة اتصال.` : 'فشل الإرسال.';
  } catch (err) {
    document.getElementById('status').innerText = 'حدث خطأ: ' + err.message;
  } finally {
    sendBtn.disabled = false;
  }
}
