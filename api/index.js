const express = require('express');
const os = require('os');
const QRCode = require('qrcode');
const db = require('../db');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname + '/../public'));
app.set('view engine', 'ejs');
app.set('views', __dirname + '/../views');

// ---- Auto-detect LAN IP ----
function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}
const LAN_IP = getLanIp();
app.locals.lanIp = LAN_IP;
app.locals.publicUrl = process.env.PUBLIC_URL || `http://${LAN_IP}:4567`;
app.locals.port = process.env.PORT || 4567;

function publicUrl(req) {
  const qh = req.query && req.query.host;
  if (qh) return qh;
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://${LAN_IP}:4567`;
}

// ---- Routes ----
app.get('/', async (req, res) => {
  const codes = await db.getAllCodes();
  res.render('index', { codes });
});

app.get('/new', (req, res) => res.render('new'));

app.post('/new', async (req, res) => {
  const { name, targetUrl, host } = req.body;
  if (!name || !targetUrl) return res.redirect('/new?error=名称和跳转链接不能为空');
  const id = await db.createCode({ name: name.trim(), targetUrl: targetUrl.trim() });
  res.redirect(host ? `/qr/${id}?host=${encodeURIComponent(host)}` : `/qr/${id}`);
});

app.get('/edit/:id', async (req, res) => {
  const code = await db.getCodeById(req.params.id);
  if (!code) return res.status(404).send('未找到该活码');
  res.render('edit', { code });
});

app.post('/edit/:id', async (req, res) => {
  const { name, targetUrl } = req.body;
  const ok = await db.updateCode(req.params.id, { name: name.trim(), targetUrl: targetUrl.trim() });
  if (!ok) return res.status(404).send('未找到该活码');
  res.redirect('/');
});

app.post('/delete/:id', async (req, res) => {
  await db.deleteCode(req.params.id);
  res.redirect('/');
});

app.get('/qr/:id', async (req, res) => {
  const code = await db.getCodeById(req.params.id);
  if (!code) return res.status(404).send('未找到该活码');
  const base = publicUrl(req);
  const redirectUrl = `${base}/r/${code.id}`;
  let qrDataUrl = null;
  try {
    qrDataUrl = await QRCode.toDataURL(redirectUrl, { width: 400, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
  } catch (e) { console.error('QR error:', e); }
  res.render('qr', { code, qrDataUrl, redirectUrl, queryHost: req.query.host || '' });
});

app.get('/r/:id', async (req, res) => {
  const code = await db.getCodeById(req.params.id);
  if (!code) {
    return res.status(404).send('<html><body style="font-family:sans-serif;text-align:center;padding:80px 20px;"><h1>404</h1><p>该活码不存在或已被删除</p><a href="/">返回管理后台</a></body></html>');
  }
  await db.incrementScanCount(code.id);
  res.redirect(code.targetUrl);
});

// ---- Vercel Serverless Export ----
let initialized = false;
module.exports = async (req, res) => {
  if (!initialized) {
    await db.initialize();
    initialized = true;
  }
  app(req, res);
};
