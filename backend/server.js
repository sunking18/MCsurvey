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
const crypto = require('crypto');

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
// 部署在 Nginx 等反代后时，信任 X-Forwarded-* 头，确保 req.protocol 正确返回 https
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;
const EXPORT_KEY = process.env.EXPORT_KEY || 'admin123';

// 微信公众号网页授权配置（可选）：配置 AppID/AppSecret 后，启用
// 「微信内自动识别 / 再看报告」能力。未配置时自动退化为纯匿名采集。
const MP_APPID = process.env.MP_APPID || '';
const MP_SECRET = process.env.MP_SECRET || '';
const MP_ENABLED = !!(MP_APPID && MP_SECRET);
// 可选：强制回调地址根域名（部署后若自动识别的协议/host 不对，可设此值，
// 例如 https://survey.yourdomain.com）。留空则按请求头自动推导。
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';

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
// 公众号网页授权域名校验文件（需放在网站根目录、公网可访问）；
// 仅放行 MP_verify_*.txt 这种白名单文件名，避免泄露其他根目录文件。
app.get(/^\/MP_verify_[A-Za-z0-9]+\.txt$/, (req, res) => {
  const f = path.basename(req.path);
  const fp = path.join(ROOT_DIR, f);
  if (fs.existsSync(fp)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.sendFile(fp);
  }
  res.status(404).end();
});

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
    openid TEXT, wechat_nickname TEXT, wechat_headimgurl TEXT, payload_json TEXT,
    answers TEXT, scores TEXT, report_html TEXT
  )`);
});

// 启动迁移：若旧表缺少相关列，自动补齐
const EXPECTED_COLS = [
  ['name_code', 'TEXT'], ['phone_last4', 'TEXT'], ['city', 'TEXT'], ['area', 'TEXT'],
  ['lie_flag', 'INTEGER'],
  ['ip', 'TEXT'], ['user_agent', 'TEXT'], ['device_model', 'TEXT'], ['screen', 'TEXT'],
  ['start_time', 'TEXT'], ['submit_time', 'TEXT'], ['server_time', 'TEXT'],
  ['openid', 'TEXT'], ['wechat_nickname', 'TEXT'], ['wechat_headimgurl', 'TEXT'], ['payload_json', 'TEXT']
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

// 微信会话表：授权回调后写入 token ↔ openid/用户信息，前端凭 token 换取报告
db.run(`CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  openid TEXT,
  nickname TEXT,
  headimgurl TEXT,
  sex INTEGER,
  city TEXT,
  province TEXT,
  country TEXT,
  created_at TEXT
)`);

// 取真实客户端 IP（支持 Nginx 反代 X-Forwarded-For / X-Real-IP）
function clientIp(req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (xff) return xff;
  if (req.headers['x-real-ip']) return req.headers['x-real-ip'];
  return req.socket.remoteAddress || req.ip || '';
}

/* ============ 提交问卷（匿名 / 微信授权均可） ============ */
app.post('/api/submit', (req, res) => {
  const { user, answers, scores, report_html, lie_flag, start_time, submit_time, device, token } = req.body;
  if (!user || !answers || !scores) {
    return res.status(400).json({ success: false, message: '缺少必要字段' });
  }
  const ip = clientIp(req);
  const ua = (device && device.ua) || req.get('user-agent') || '';
  const deviceModel = (device && device.device_model) || '';
  const screen = (device && device.screen) || '';
  const serverTime = new Date().toISOString();
  const isWx = MP_ENABLED && token;

  // 若带微信会话令牌，查到 openid / 昵称 / 头像后一并入库
  const finish = (wx) => {
    const openid = wx ? (wx.openid || '') : '';
    const wxNick = wx ? (wx.nickname || '') : '';
    const wxHead = wx ? (wx.headimgurl || '') : '';
    const fields = ['created_at', 'gender', 'age', 'occupation', 'income', 'contact',
      'name_code', 'phone_last4', 'city', 'area', 'lie_flag',
      'ip', 'user_agent', 'device_model', 'screen', 'start_time', 'submit_time', 'server_time',
      'children_count', 'child_age_1', 'child_gender_1', 'child_age_2', 'child_gender_2',
      'child_age_3', 'child_gender_3', 'child_extra',
      'openid', 'wechat_nickname', 'wechat_headimgurl', 'payload_json',
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
      openid, wxNick, wxHead, JSON.stringify(req.body),
      JSON.stringify(answers || {}), JSON.stringify(scores || {}), report_html || ''
    ];
    const cols = fields.join(', ');
    const sql = `INSERT INTO responses (${cols}) VALUES (${fields.map(() => '?').join(', ')})`;
    db.run(sql, vals, function (e2) {
      if (e2) { console.error('保存失败：', e2); return res.status(500).json({ success: false, message: '数据库写入失败' }); }
      res.json({ success: true, id: this.lastID });
    });
  };

  if (isWx) {
    db.get('SELECT openid, nickname, headimgurl FROM sessions WHERE token=?', [token], (e, row) => {
      finish(row && row.openid ? row : null);
    });
  } else {
    finish(null);
  }
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
      'openid', 'wechat_nickname',
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
        r.openid, r.wechat_nickname,
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

/* ============ 微信公众号网页授权（OAuth2 snsapi_userinfo） ============ */
// 1) 前端在微信内点击「开始作答」时调用：返回微信授权跳转地址
app.get('/api/wechat/mp/start', (req, res) => {
  if (!MP_ENABLED) return res.json({ enabled: false });
  const redirectUri = PUBLIC_BASE_URL
    ? `${PUBLIC_BASE_URL.replace(/\/$/, '')}/api/wechat/mp/callback`
    : `${req.protocol}://${req.get('x-forwarded-host') || req.get('host')}/api/wechat/mp/callback`;
  const url = 'https://open.weixin.qq.com/connect/oauth2/authorize'
    + `?appid=${MP_APPID}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + '&response_type=code&scope=snsapi_userinfo&state=survey#wechat_redirect';
  res.json({ enabled: true, url });
});

// 2) 微信授权回调：用 code 换取 access_token + 用户信息，建会话后回跳首页并带 #token
app.get('/api/wechat/mp/callback', async (req, res) => {
  const { code } = req.query;
  if (!MP_ENABLED || !code) return res.redirect('/index.html');
  try {
    const tokenUrl = `https://api.weixin.qq.com/sns/oauth2/access_token`
      + `?appid=${MP_APPID}&secret=${MP_SECRET}&code=${code}&grant_type=authorization_code`;
    const r1 = await fetch(tokenUrl).then(r => r.json());
    if (r1.errcode) throw new Error(r1.errmsg || 'oauth_fail');
    const { access_token, openid } = r1;

    let info = { nickname: '', headimgurl: '', sex: 0, city: '', province: '', country: '' };
    try {
      const u = await fetch(`https://api.weixin.qq.com/sns/userinfo?access_token=${access_token}&openid=${openid}&lang=zh_CN`).then(r => r.json());
      if (!u.errcode) info = u;
    } catch (e) { /* 拿不到用户信息也可继续，仅记录 openid */ }

    const token = crypto.randomBytes(16).toString('hex');
    const created_at = new Date().toISOString();
    db.run('INSERT OR REPLACE INTO sessions(token, openid, nickname, headimgurl, sex, city, province, country, created_at) '
      + 'VALUES(?,?,?,?,?,?,?,?,?)',
      [token, openid, info.nickname || '', info.headimgurl || '', info.sex || 0, info.city || '', info.province || '', info.country || '', created_at]);
    res.redirect(`/index.html#token=${token}`);
  } catch (e) {
    console.error('微信授权失败：', e.message);
    res.redirect('/index.html');
  }
});

// 3) 前端凭 token 换取会话（openid / 昵称 / 头像等）
app.get('/api/wechat/session', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(401).json({ success: false });
  db.get('SELECT openid, nickname, headimgurl, sex, city, province, country FROM sessions WHERE token=?', [token], (e, row) => {
    if (e || !row) return res.status(401).json({ success: false });
    res.json({ success: true, wechat: { openid: row.openid, nickname: row.nickname, headimgurl: row.headimgurl, sex: row.sex, city: row.city, province: row.province, country: row.country } });
  });
});

// 4) 该微信用户的历史作答列表（用于「再看报告」）
app.get('/api/wechat/my-reports', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(401).json({ success: false });
  db.get('SELECT openid FROM sessions WHERE token=?', [token], (e, row) => {
    if (e || !row) return res.status(401).json({ success: false });
    db.all('SELECT id, created_at, wechat_nickname FROM responses WHERE openid=? ORDER BY id DESC', [row.openid], (e2, rows) => {
      if (e2) return res.status(500).json({ success: false });
      res.json({ success: true, reports: (rows || []).map(r => ({ id: r.id, created_at: r.created_at, nickname: r.wechat_nickname || '' })) });
    });
  });
});

// 5) 取某次报告的完整数据（仅限本人 openid），前端用现有算分逻辑重渲染
app.get('/api/wechat/report/:id', (req, res) => {
  const { token } = req.query;
  const id = req.params.id;
  if (!token) return res.status(401).json({ success: false });
  db.get('SELECT openid FROM sessions WHERE token=?', [token], (e, row) => {
    if (e || !row) return res.status(401).json({ success: false });
    db.get('SELECT id, payload_json, wechat_nickname, created_at FROM responses WHERE id=? AND openid=?', [id, row.openid], (e2, r) => {
      if (e2 || !r) return res.status(404).json({ success: false, message: '未找到该报告' });
      let payload = {};
      try { payload = JSON.parse(r.payload_json || '{}'); } catch (e3) { /* ignore */ }
      res.json({ success: true, payload, nickname: r.wechat_nickname || '', created_at: r.created_at });
    });
  });
});

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: '服务正常', mp_enabled: MP_ENABLED });
});

app.listen(PORT, () => {
  console.log(`问卷后端已启动：http://localhost:${PORT}`);
  console.log(`前端访问：http://localhost:${PORT}/index.html`);
  console.log(`管理导出：http://localhost:${PORT}/admin.html`);
  console.log(`数据库：${DB_PATH}`);
});
