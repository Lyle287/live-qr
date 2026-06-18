const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'data', 'codes.json');

// ---- JSON file storage (local dev) ----
function loadFile() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return { codes: [] };
  }
}

function saveFile(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ---- PostgreSQL storage (production) ----
let pool = null;
let usePg = false;

async function initPg() {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS codes (
      id VARCHAR(32) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      target_url TEXT NOT NULL,
      scan_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  usePg = true;
  console.log('已连接 PostgreSQL 数据库');
}

async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

// ---- Public API ----

async function initialize() {
  if (process.env.DATABASE_URL) {
    await initPg();
  } else {
    console.log('未设置 DATABASE_URL，使用本地 JSON 文件存储');
  }
}

async function getAllCodes() {
  if (usePg) {
    const result = await query('SELECT * FROM codes ORDER BY created_at DESC');
    return result.rows.map(r => ({
      id: r.id,
      name: r.name,
      targetUrl: r.target_url,
      scanCount: r.scan_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }
  return loadFile().codes;
}

async function getCodeById(id) {
  if (usePg) {
    const result = await query('SELECT * FROM codes WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
      id: r.id,
      name: r.name,
      targetUrl: r.target_url,
      scanCount: r.scan_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
  const data = loadFile();
  return data.codes.find(c => c.id === id) || null;
}

async function createCode({ name, targetUrl }) {
  const id = crypto.randomBytes(8).toString('hex');
  const now = new Date().toISOString();
  if (usePg) {
    await query(
      'INSERT INTO codes (id, name, target_url, scan_count, created_at, updated_at) VALUES ($1, $2, $3, 0, $4, $5)',
      [id, name, targetUrl, now, now]
    );
  } else {
    const data = loadFile();
    data.codes.push({ id, name, targetUrl, scanCount: 0, createdAt: now, updatedAt: now });
    saveFile(data);
  }
  return id;
}

async function updateCode(id, { name, targetUrl }) {
  const now = new Date().toISOString();
  if (usePg) {
    const result = await query(
      'UPDATE codes SET name = $1, target_url = $2, updated_at = $3 WHERE id = $4',
      [name, targetUrl, now, id]
    );
    return result.rowCount > 0;
  }
  const data = loadFile();
  const code = data.codes.find(c => c.id === id);
  if (!code) return false;
  if (name !== undefined) code.name = name;
  if (targetUrl !== undefined) code.targetUrl = targetUrl;
  code.updatedAt = now;
  saveFile(data);
  return true;
}

async function deleteCode(id) {
  if (usePg) {
    const result = await query('DELETE FROM codes WHERE id = $1', [id]);
    return result.rowCount > 0;
  }
  const data = loadFile();
  const idx = data.codes.findIndex(c => c.id === id);
  if (idx === -1) return false;
  data.codes.splice(idx, 1);
  saveFile(data);
  return true;
}

async function incrementScanCount(id) {
  const now = new Date().toISOString();
  if (usePg) {
    await query(
      'UPDATE codes SET scan_count = scan_count + 1, updated_at = $1 WHERE id = $2',
      [now, id]
    );
  } else {
    const data = loadFile();
    const code = data.codes.find(c => c.id === id);
    if (code) {
      code.scanCount = (code.scanCount || 0) + 1;
      code.updatedAt = now;
      saveFile(data);
    }
  }
}

module.exports = { initialize, getAllCodes, getCodeById, createCode, updateCode, deleteCode, incrementScanCount };
