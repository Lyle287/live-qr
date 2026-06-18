// 轻量的跳转处理函数 — 不加载 Express/qrcode/EJS，冷启动极快
const { Client } = require('pg');

module.exports = async (req, res) => {
  // 从 URL 中提取 ID（例如 /r/ac5f33b08b213c23）
  const id = req.url.replace('/r/', '').split('?')[0];
  if (!id) {
    res.writeHead(400);
    res.end('Missing code ID');
    return;
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });

  try {
    await client.connect();
    const result = await client.query('SELECT target_url FROM codes WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404</h1><p>该活码不存在或已被删除</p><a href="https://live-qr-henna.vercel.app">返回管理后台</a>');
      return;
    }
    // 先跳转，异步更新计数
    const targetUrl = result.rows[0].target_url;
    client.query('UPDATE codes SET scan_count = scan_count + 1, updated_at = NOW() WHERE id = $1', [id])
      .catch(() => {}); // 计数失败不影响跳转
    res.writeHead(302, { 'Location': targetUrl });
    res.end();
  } catch (e) {
    console.error('Redirect error:', e.message);
    // 重试一次
    try {
      await client.connect();
      const result = await client.query('SELECT target_url FROM codes WHERE id = $1', [id]);
      if (result.rows.length > 0) {
        res.writeHead(302, { 'Location': result.rows[0].target_url });
        res.end();
        return;
      }
    } catch (e2) {
      console.error('Retry also failed:', e2.message);
    }
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>服务器繁忙</h1><p>请刷新重试</p>');
  } finally {
    await client.end().catch(() => {});
  }
};
