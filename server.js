require('dotenv').config();
var express    = require('express');
var mongoose   = require('mongoose');
var bodyParser = require('body-parser');
var axios      = require('axios');

var app = express();
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

mongoose.connect(process.env.MONGODB_URI)
  .then(function() { console.log('MongoDB connected'); })
  .catch(function(err) { console.error('MongoDB error:', err.message); });

app.get('/health', function(req, res) {
  res.json({
    status:  'ok',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Test Gemini
app.get('/test-gemini', async function(req, res) {
  var geminiKey = process.env.GEMINI_API_KEY;
  var groqKey   = process.env.GROQ_API_KEY;
  var result    = { gemini_key: !!geminiKey, groq_key: !!groqKey };

  if (geminiKey) {
    try {
      var gr = await axios.post(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + geminiKey,
        { contents: [{ role: 'user', parts: [{ text: 'say hi in Egyptian Arabic' }] }] },
        { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
      );
      result.gemini_status = 'ok';
      result.gemini_reply  = gr.data.candidates[0].content.parts[0].text;
    } catch(e) {
      result.gemini_status = 'error';
      result.gemini_error  = e.response ? e.response.data : e.message;
    }
  }

  if (groqKey) {
    try {
      var gr2 = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'say hi in Egyptian Arabic' }], max_tokens: 50 },
        { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey }, timeout: 15000 }
      );
      result.groq_status = 'ok';
      result.groq_reply  = gr2.data.choices[0].message.content;
    } catch(e) {
      result.groq_status = 'error';
      result.groq_error  = e.response ? e.response.data : e.message;
    }
  }

  res.json(result);
});

app.use('/webhook',   require('./src/webhook'));
app.use('/dashboard', require('./src/dashboard'));
app.get('/', function(req, res) { res.redirect('/dashboard'); });

var PORT = process.env.PORT || 8000;
app.listen(PORT, function() { console.log('Server on port ' + PORT); });
