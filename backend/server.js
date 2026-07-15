/**
 * 亲子心理健康问卷 · 后端存储服务（纯匿名采集，无登录）
 * - 提交问卷：/api/submit（自动记录 IP、设备型号、答题时间）
 * - 导出数据：/api/export、/api/export.csv（含设备与留痕信息）
 * - 同时 serve 前端静态文件（index.html / poster.html / admin.html）
 *
 * 配置（backend/.env）：
 *   EXPORT_KEY   数据导出密钥（管理员在 /admin.html 输入）
 *   PORT         端口，默认 3000
 *
 * 说明：
 *   - 不需要任何微信 / 登录资质，任何能访问部署地址的人均可作答。
 *   - 真实 IP 需部署在公网、并经 Nginx 等反代设置 X-Forwarded-For 后由后端读取。
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

// 轻量 .env 加载（避免引入额外依赖）
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const txt = fs.readFileSync(envPath, 'utf-8');
    txt.split('\n').forEach(line => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    });
  } catch (e) { /* ignore */ }
})();

const app = express();
const PORT = process.env.PORT || 3000;
const EXPORT_KEY = process.env.EXPORT_KEY || 'admin123';

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'responses.db');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '4mb' }));
// 仅显式托管前端页面，避免泄露 backend 源码等目录内容
const ROOT_DIR = path.join(__dirname, '..');
app.use('/assets', express.static(path.join(ROOT_DIR, 'assets')));
app.get('/', (req, res) => res.sendFile(path.join(ROOT_DIR, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(ROOT_DIR, 'index.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(ROOT_DIR, 'admin.html')));
app.get('/poster.html', (req, res) => res.sendFile(path.join(ROOT_DIR, 'poster.html')));

const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT,
    gender TEXT, age TEXT, occupation TEXT, income TEXT, contact TEXT,
    name_code TEXT, phone_last4 TEXT, city TEXT, area TEXT,
    lie_flag INTEGER,
    ip TEXT, user_agent TEXT, device_model TEXT, screen TEXT,
    start_time TEXT, submit_time TEXT, server_time TEXT,
    children_count TEXT, child_age_1 TEXT, child_gender_1 TEXT,
    child_age_2 TEXT, child_gender_2 TEXT, child_age_3 TEXT, child_gender_3 TEXT,
    child_extra TEXT,
    answers TEXT, scores TEXT, report_html TEXT
  )`);
});

// 启动迁移：若旧表缺少相关列，自动补齐
const EXPECTED_COLS = [
  ['name_code', 'TEXT'], ['phone_last4', 'TEXT'], ['city', 'TEXT'], ['area', 'TEXT'],
  ['lie_flag', 'INTEGER'],
  ['ip', 'TEXT'], ['user_agent', 'TEXT'], ['device_model', 'TEXT'], ['screen', 'TEXT'],
  ['start_time', 'TEXT'], ['submit_time', 'TEXT'], ['server_time', 'TEXT']
];
db.serialize(() => {
  db.all("PRAGMA table_info(responses)", (err, rows) => {
    if (err || !rows) return;
    const have = new Set(rows.map(r => r.name));
    EXPECTED_COLS.forEach(([col, type]) => {
      if (!have.has(col)) db.run(`ALTER TABLE responses ADD COLUMN ${col} ${type}`);
    });
  });
});

// 取真实客户端 IP（支持 Nginx 反代 X-Forwarded-For / X-Real-IP）
function clientIp(req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (xff) return xff;
  if (req.headers['x-real-ip']) return req.headers['x-real-ip'];
  return req.socket.remoteAddress || req.ip || '';
}

/* ============ 提交问卷（纯匿名，无需登录） ============ */
app.post('/api/submit', (req, res) => {
  const { user, answers, scores, report_html, lie_flag, start_time, submit_time, device } = req.body;
  if (!user || !answers || !scores) {
    return res.status(400).json({ success: false, message: '缺少必要字段' });
  }
  const ip = clientIp(req);
  const ua = (device && device.ua) || req.get('user-agent') || '';
  const deviceModel = (device && device.device_model) || '';
  const screen = (device && device.screen) || '';
  const serverTime = new Date().toISOString();

  const fields = ['created_at', 'gender', 'age', 'occupation', 'income', 'contact',
    'name_code', 'phone_last4', 'city', 'area', 'lie_flag',
    'ip', 'user_agent', 'device_model', 'screen', 'start_time', 'submit_time', 'server_time',
    'children_count', 'child_age_1', 'child_gender_1', 'child_age_2', 'child_gender_2',
    'child_age_3', 'child_gender_3', 'child_extra',
    'answers', 'scores', 'report_html'];
  const vals = [
    serverTime,
    user.gender || '', user.age || '', user.occupation || '', user.income || '', user.contact || '',
    user.name_code || '', user.phone_last4 || '', user.city || '', user.area || '',
    lie_flag ? 1 : 0,
    ip, ua, deviceModel, screen, start_time || '', submit_time || '', serverTime,
    user.children_count || '', user.child_age_1 || '', user.child_gender_1 || '',
    user.child_age_2 || '', user.child_gender_2 || '', user.child_age_3 || '', user.child_gender_3 || '',
    user.child_extra || '',
    JSON.stringify(answers || {}), JSON.stringify(scores || {}), report_html || ''
  ];
  const cols = fields.join(', ');
  const sql = `INSERT INTO responses (${cols}) VALUES (${fields.map(() => '?').join(', ')})`;
  db.run(sql, vals, function (e2) {
    if (e2) { console.error('保存失败：', e2); return res.status(500).json({ success: false, message: '数据库写入失败' }); }
    res.json({ success: true, id: this.lastID });
  });
});

/* ============ 题项维度备注（仅用于导出 CSV 表头，不在前端显示） ============ */
// 顺序必须与前端 SCALES 的 34 个计分题一一对应
const Q_META = [
  // 第一部分：亲子沟通（12）
  '开放尊重', '规则协商', '主动询问', '控制式沟通', '开放表达', '引导讨论',
  '孩子表达意愿', '情绪升级', '批评优先', '情感沟通', '沟通安全感', '倾听接纳',
  // 第二部分：学业焦虑（12）
  '学习状态担忧', '父母能力焦虑', '教育资源焦虑', '考试焦虑', '焦虑外化', '考试焦虑',
  '成绩焦虑', '教育投入焦虑', '父母无力感', '学校环境焦虑', '学习执行担忧', '学习自主性担忧',
  // 第三部分：心理韧性（10）
  '适应变化', '应对困难', '情绪调节', '成长感', '恢复力', '自我效能',
  '压力下专注', '坚持性', '勇于面对', '情绪平复'
];

/* ============ 导出 JSON ============ */
app.get('/api/export', (req, res) => {
  if (req.query.key !== EXPORT_KEY) return res.status(401).json({ success: false, message: '密钥错误' });
  db.all('SELECT * FROM responses ORDER BY id DESC', (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: '查询失败' });
    res.json({ success: true, count: rows.length, data: rows });
  });
});

/* ============ 导出 CSV ============ */
app.get('/api/export.csv', (req, res) => {
  if (req.query.key !== EXPORT_KEY) return res.status(401).send('密钥错误');
  db.all('SELECT * FROM responses ORDER BY id DESC', (err, rows) => {
    if (err) return res.status(500).send('查询失败');
    const esc = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const qHeaders = Q_META.map((dim, i) => `q${i + 1}（${dim}）`);
    const headers = [
      'id', 'server_time', 'submit_time', 'start_time', '答题时长(秒)',
      'ip', 'device_model', 'user_agent', 'screen',
      'gender', 'age', 'occupation', 'income', 'contact',
      'name_code', 'phone_last4', 'city', 'area', 'lie_flag',
      'children_count',
      'child_age_1', 'child_gender_1', 'child_age_2', 'child_gender_2', 'child_age_3', 'child_gender_3', 'child_extra',
      'comm_total', 'anx_total', 'res_total',
      ...qHeaders, 'lie_1（注意力检测题）', 'report_html'];
    const lines = [headers.map(esc).join(',')];
    rows.forEach(r => {
      let a = {};
      try { a = JSON.parse(r.answers || '{}'); } catch (e) {}
      let s = {};
      try { s = JSON.parse(r.scores || '{}'); } catch (e) {}
      const flat = [];
      ['comm', 'anx', 'res'].forEach(k => {
        const arr = (a[k] && a[k].perQ) ? a[k].perQ : (Array.isArray(a[k]) ? a[k] : []);
        arr.forEach(v => flat.push(v));
      });
      while (flat.length < 34) flat.push('');
      const lie = Array.isArray(a._lie) ? a._lie : [null];
      // 答题时长（秒）= 提交时刻 - 开始作答时刻
      let dur = '';
      if (r.start_time && r.submit_time) {
        const t0 = new Date(r.start_time).getTime();
        const t1 = new Date(r.submit_time).getTime();
        if (!isNaN(t0) && !isNaN(t1) && t1 >= t0) dur = Math.round((t1 - t0) / 1000);
      }
      const row = [
        r.id, r.server_time, r.submit_time, r.start_time, dur,
        r.ip, r.device_model, r.user_agent, r.screen,
        r.gender, r.age, r.occupation, r.income, r.contact,
        r.name_code, r.phone_last4, r.city, r.area, r.lie_flag,
        r.children_count,
        r.child_age_1, r.child_gender_1, r.child_age_2, r.child_gender_2, r.child_age_3, r.child_gender_3, r.child_extra,
        s.comm ? s.comm.total : '', s.anx ? s.anx.total : '', s.res ? s.res.total : '',
        ...flat,
        lie[0] !== null && lie[0] !== undefined ? lie[0] : '',
        (r.report_html || '').replace(/\s+/g, ' ')
      ];
      lines.push(row.map(esc).join(','));
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="responses_' + Date.now() + '.csv"');
    res.send('﻿' + lines.join('\n'));
  });
});

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: '服务正常' });
});

app.listen(PORT, () => {
  console.log(`问卷后端已启动：http://localhost:${PORT}`);
  console.log(`前端访问：http://localhost:${PORT}/index.html`);
  console.log(`管理导出：http://localhost:${PORT}/admin.html`);
  console.log(`数据库：${DB_PATH}`);
});
