const os = require('os');
const express = require('express');
const QRCode = require('qrcode');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 4567;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname + '/public'));
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

// ---- Auto-detect LAN IP ----
function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}
const LAN_IP = getLanIp();
const PUBLIC_URL = process.env.PUBLIC_URL || `http://${LAN_IP}:${PORT}`;
app.locals.lanIp = LAN_IP;
app.locals.publicUrl = PUBLIC_URL;
app.locals.port = PORT;

// Get the public-facing URL for QR codes
function publicUrl(req) {
  const queryHost = req.query && req.query.host;
  if (queryHost) return queryHost;
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  return `http://${LAN_IP}:${PORT}`;
}

// ---- Admin Routes ----

app.get('/', async (req, res) => {
  const codes = await db.getAllCodes();
  res.render('index', { codes });
});

app.get('/new', (req, res) => {
  res.render('new');
});

app.post('/new', async (req, res) => {
  const { name, targetUrl, host } = req.body;
  if (!name || !targetUrl) {
    return res.redirect('/new?error=名称和跳转链接不能为空');
  }
  const id = await db.createCode({ name: name.trim(), targetUrl: targetUrl.trim() });
  const qrUrl = host ? `/qr/${id}?host=${encodeURIComponent(host)}` : `/qr/${id}`;
  res.redirect(qrUrl);
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

// ---- QR Code Display ----
app.get('/qr/:id', async (req, res) => {
  const code = await db.getCodeById(req.params.id);
  if (!code) return res.status(404).send('未找到该活码');

  const base = publicUrl(req);
  const redirectUrl = `${base}/r/${code.id}`;
  let qrDataUrl = null;
  try {
    qrDataUrl = await QRCode.toDataURL(redirectUrl, {
      width: 400, margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch (e) {
    console.error('QR generation error:', e);
  }
  res.render('qr', { code, qrDataUrl, redirectUrl, queryHost: req.query.host || '' });
});

// ---- Redirect Endpoint (the fixed URL in the QR code) ----
app.get('/r/:id', async (req, res) => {
  const code = await db.getCodeById(req.params.id);
  if (!code) {
    return res.status(404).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:80px 20px;">
        <h1>404</h1><p>该活码不存在或已被删除</p><a href="/">返回管理后台</a>
      </body></html>`);
  }
  await db.incrementScanCount(code.id);
  res.redirect(code.targetUrl);
});

// ---- Start ----
async function start() {
  await db.initialize();
  app.listen(PORT, () => {
    console.log(`活码工具已启动`);
    console.log(`  本地:    http://localhost:${PORT}`);
    console.log(`  局域网:  http://${LAN_IP}:${PORT}`);
    if (process.env.PUBLIC_URL) {
      console.log(`  公网:    ${PUBLIC_URL}`);
    }
    if (process.env.DATABASE_URL) {
      console.log(`  数据库:  PostgreSQL`);
    } else {
      console.log(`  数据库:  JSON 文件（本地开发）`);
      console.log(`  ⚠ 生产环境请设置 DATABASE_URL 环境变量连接数据库`);
    }
  });
}
start().catch(e => { console.error('启动失败:', e); process.exit(1); });
