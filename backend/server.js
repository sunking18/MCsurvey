/**
 * 亲子心理健康问卷 · 后端存储服务（MySQL 版 · Docker 部署）
 * - 提交问卷：/api/submit（自动记录 IP、设备型号、答题时间）
 * - 导出数据：/api/export、/api/export.csv（含设备与留痕信息）
 * - 微信网页授权：/api/wechat/*（可选，配置 MP_APPID 后启用）
 * - 同时 serve 前端静态文件（index.html / poster.html / admin.html）
 *
 * 配置（backend/.env 或 docker/.env）：
 *   EXPORT_KEY      数据导出密钥
 *   PORT            端口，默认 3000
 *   MYSQL_HOST      MySQL 地址（Docker 默认 mysql）
 *   MYSQL_PORT      MySQL 端口，默认 3306
 *   MYSQL_USER      MySQL 用户名
 *   MYSQL_PASSWORD  MySQL 密码
 *   MYSQL_DATABASE  MySQL 数据库名，默认 survey
 *   MP_APPID        公众号 AppID（可选）
 *   MP_SECRET       公众号 AppSecret（可选）
 *   PUBLIC_BASE_URL 强制回调根域名（可选）
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

// 轻量 .env 加载
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
app.set('trust proxy', true);

const PORT = process.env.PORT || 3000;
const EXPORT_KEY = process.env.EXPORT_KEY || 'admin123';

// 微信公众号网页授权（可选）
const MP_APPID = process.env.MP_APPID || '';
const MP_SECRET = process.env.MP_SECRET || '';
const MP_ENABLED = !!(MP_APPID && MP_SECRET);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';

// MySQL 配置
const MYSQL_HOST = process.env.MYSQL_HOST || 'localhost';
const MYSQL_PORT = parseInt(process.env.MYSQL_PORT || '3306', 10);
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'survey';

// 前端静态文件目录（项目根目录）
const ROOT_DIR = path.join(__dirname, '..');

// ========== MySQL 连接池 ==========
let pool;

async function initPool() {
  pool = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4'
  });

  // 等待连接就绪 + 自动建表
  const conn = await pool.getConnection();
  try {
    // responses 表
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS responses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        gender TEXT, age TEXT, occupation TEXT, income TEXT, contact TEXT,
        name_code TEXT, phone_last4 TEXT, city TEXT, area TEXT,
        lie_flag TINYINT DEFAULT 0,
        ip TEXT, user_agent TEXT, device_model TEXT, screen TEXT,
        start_time DATETIME, submit_time DATETIME, server_time DATETIME,
        children_count TEXT,
        child_age_1 TEXT, child_gender_1 TEXT,
        child_age_2 TEXT, child_gender_2 TEXT,
        child_age_3 TEXT, child_gender_3 TEXT,
        child_extra TEXT,
        openid TEXT, wechat_nickname TEXT, wechat_headimgurl TEXT,
        payload_json JSON,
        answers JSON, scores JSON, report_html TEXT,
        INDEX idx_openid (openid),
        INDEX idx_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // sessions 表（微信会话）
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        token VARCHAR(64) PRIMARY KEY,
        openid VARCHAR(64) NOT NULL,
        nickname TEXT,
        headimgurl TEXT,
        sex TINYINT DEFAULT 0,
        city TEXT,
        province TEXT,
        country TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_openid (openid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ MySQL 表已就绪（responses + sessions）');
  } finally {
    conn.release();
  }
}

// ========== 静态文件托管 ==========
app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use('/assets', express.static(path.join(ROOT_DIR, 'assets')));
app.get('/', (req, res) => res.sendFile(path.join(ROOT_DIR, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(ROOT_DIR, 'index.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(ROOT_DIR, 'admin.html')));
app.get('/poster.html', (req, res) => res.sendFile(path.join(ROOT_DIR, 'poster.html')));

// 公众号网页授权域名校验文件白名单
app.get(/^\/MP_verify_[A-Za-z0-9]+\.txt$/, (req, res) => {
  const f = path.basename(req.path);
  const fp = path.join(ROOT_DIR, f);
  if (fs.existsSync(fp)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.sendFile(fp);
  }
  res.status(404).end();
});

// ========== 工具函数 ==========

function clientIp(req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (xff) return xff;
  if (req.headers['x-real-ip']) return req.headers['x-real-ip'];
  return req.socket.remoteAddress || req.ip || '';
}

// ========== 提交问卷 ==========
app.post('/api/submit', async (req, res) => {
  const { user, answers, scores, report_html, lie_flag, start_time, submit_time, device, token } = req.body;
  if (!user || !answers || !scores) {
    return res.status(400).json({ success: false, message: '缺少必要字段' });
  }

  const ip = clientIp(req);
  const ua = (device && device.ua) || req.get('user-agent') || '';
  const deviceModel = (device && device.device_model) || '';
  const screen = (device && device.screen) || '';
  const serverTime = new Date().toISOString();

  let openid = '';
  let wxNick = '';
  let wxHead = '';

  // 若带微信会话令牌，查 openid
  if (MP_ENABLED && token) {
    try {
      const [rows] = await pool.execute(
        'SELECT openid, nickname, headimgurl FROM sessions WHERE token=?',
        [token]
      );
      if (rows.length > 0) {
        openid = rows[0].openid || '';
        wxNick = rows[0].nickname || '';
        wxHead = rows[0].headimgurl || '';
      }
    } catch (e) { /* 查不到就继续匿名提交 */ }
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO responses (
        created_at, gender, age, occupation, income, contact,
        name_code, phone_last4, city, area, lie_flag,
        ip, user_agent, device_model, screen, start_time, submit_time, server_time,
        children_count, child_age_1, child_gender_1,
        child_age_2, child_gender_2, child_age_3, child_gender_3, child_extra,
        openid, wechat_nickname, wechat_headimgurl, payload_json,
        answers, scores, report_html
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        new Date(),
        user.gender || '', user.age || '', user.occupation || '', user.income || '', user.contact || '',
        user.name_code || '', user.phone_last4 || '', user.city || '', user.area || '',
        lie_flag ? 1 : 0,
        ip, ua, deviceModel, screen,
        start_time ? new Date(start_time) : null,
        submit_time ? new Date(submit_time) : null,
        new Date(serverTime),
        user.children_count || '',
        user.child_age_1 || '', user.child_gender_1 || '',
        user.child_age_2 || '', user.child_gender_2 || '',
        user.child_age_3 || '', user.child_gender_3 || '',
        user.child_extra || '',
        openid, wxNick, wxHead,
        JSON.stringify(req.body),
        JSON.stringify(answers || {}), JSON.stringify(scores || {}),
        report_html || ''
      ]
    );
    res.json({ success: true, id: result.insertId });
  } catch (e) {
    console.error('保存失败：', e);
    res.status(500).json({ success: false, message: '数据库写入失败' });
  }
});

// ========== 题项维度备注（CSV 表头用） ==========
const Q_META = [
  '开放尊重', '规则协商', '主动询问', '控制式沟通', '开放表达', '引导讨论',
  '孩子表达意愿', '情绪升级', '批评优先', '情感沟通', '沟通安全感', '倾听接纳',
  '学习状态担忧', '父母能力焦虑', '教育资源焦虑', '考试焦虑', '焦虑外化', '考试焦虑',
  '成绩焦虑', '教育投入焦虑', '父母无力感', '学校环境焦虑', '学习执行担忧', '学习自主性担忧',
  '适应变化', '应对困难', '情绪调节', '成长感', '恢复力', '自我效能',
  '压力下专注', '坚持性', '勇于面对', '情绪平复'
];

// ========== 导出 JSON ============
app.get('/api/export', async (req, res) => {
  if (req.query.key !== EXPORT_KEY) return res.status(401).json({ success: false, message: '密钥错误' });
  try {
    const [rows] = await pool.execute('SELECT * FROM responses ORDER BY id DESC');
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// ========== 导出 CSV ============
app.get('/api/export.csv', async (req, res) => {
  if (req.query.key !== EXPORT_KEY) return res.status(401).send('密钥错误');
  try {
    const [rows] = await pool.execute('SELECT * FROM responses ORDER BY id DESC');

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
      ...qHeaders, 'lie_1（注意力检测题）', 'report_html'
    ];
    const lines = [headers.map(esc).join(',')];

    for (const r of rows) {
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
        r.child_age_1, r.child_gender_1, r.child_age_2, r.child_gender_2,
        r.child_age_3, r.child_gender_3, r.child_extra,
        s.comm ? s.comm.total : '', s.anx ? s.anx.total : '', s.res ? s.res.total : '',
        ...flat,
        lie[0] !== null && lie[0] !== undefined ? lie[0] : '',
        (r.report_html || '').replace(/\s+/g, ' ')
      ];
      lines.push(row.map(esc).join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="responses_${Date.now()}.csv"`);
    res.send('\uFEFF' + lines.join('\n'));
  } catch (e) {
    res.status(500).send('查询失败');
  }
});

// ========== 微信公众号网页授权 ============

// 1) 返回微信授权跳转地址
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

// 2) 微信授权回调：用 code 换取 access_token + 用户信息，建会话后回跳首页带 #token
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
    } catch (e) { /* ignore */ }

    const sessionToken = crypto.randomBytes(16).toString('hex');
    await pool.execute(
      'INSERT INTO sessions(token, openid, nickname, headimgurl, sex, city, province, country) VALUES(?,?,?,?,?,?,?,?)',
      [sessionToken, openid, info.nickname || '', info.headimgurl || '', info.sex || 0, info.city || '', info.province || '', info.country || '']
    );
    res.redirect(`/index.html#token=${sessionToken}`);
  } catch (e) {
    console.error('微信授权失败：', e.message);
    res.redirect('/index.html');
  }
});

// 3) 前端凭 token 换取会话
app.get('/api/wechat/session', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(401).json({ success: false });
  try {
    const [rows] = await pool.execute(
      'SELECT openid, nickname, headimgurl, sex, city, province, country FROM sessions WHERE token=?',
      [token]
    );
    if (rows.length === 0) return res.status(401).json({ success: false });
    const r = rows[0];
    res.json({ success: true, wechat: { openid: r.openid, nickname: r.nickname, headimgurl: r.headimgurl, sex: r.sex, city: r.city, province: r.province, country: r.country } });
  } catch (e) {
    res.status(401).json({ success: false });
  }
});

// 4) 该微信用户的历史作答列表
app.get('/api/wechat/my-reports', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(401).json({ success: false });
  try {
    const [sess] = await pool.execute('SELECT openid FROM sessions WHERE token=?', [token]);
    if (sess.length === 0) return res.status(401).json({ success: false });
    const [rows] = await pool.execute(
      'SELECT id, created_at, wechat_nickname FROM responses WHERE openid=? ORDER BY id DESC',
      [sess[0].openid]
    );
    res.json({ success: true, reports: (rows || []).map(r => ({ id: r.id, created_at: r.created_at, nickname: r.wechat_nickname || '' })) });
  } catch (e) {
    res.status(401).json({ success: false });
  }
});

// 5) 取某次报告完整数据（仅限本人 openid）
app.get('/api/wechat/report/:id', async (req, res) => {
  const { token } = req.query;
  const id = req.params.id;
  if (!token) return res.status(401).json({ success: false });
  try {
    const [sess] = await pool.execute('SELECT openid FROM sessions WHERE token=?', [token]);
    if (sess.length === 0) return res.status(401).json({ success: false });
    const [rows] = await pool.execute(
      'SELECT id, payload_json, wechat_nickname, created_at FROM responses WHERE id=? AND openid=?',
      [id, sess[0].openid]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: '未找到该报告' });
    let payload = {};
    try { payload = JSON.parse(rows[0].payload_json || '{}'); } catch (e3) {}
    res.json({ success: true, payload, nickname: rows[0].wechat_nickname || '', created_at: rows[0].created_at });
  } catch (e) {
    res.status(401).json({ success: false });
  }
});

// ========== 健康检查 ============
app.get('/api/health', async (req, res) => {
  let dbOk = false;
  try {
    await pool.execute('SELECT 1');
    dbOk = true;
  } catch (e) { /* ignore */ }
  res.json({
    success: true,
    message: '服务正常',
    mp_enabled: MP_ENABLED,
    database: dbOk ? 'mysql connected' : 'mysql error'
  });
});

// ========== 启动 ============
async function start() {
  try {
    await initPool();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ 问卷后端已启动：http://0.0.0.0:${PORT}`);
      console.log(`   前端访问：http://0.0.0.0:${PORT}/index.html`);
      console.log(`   管理导出：http://0.0.0.0:${PORT}/admin.html`);
      console.log(`   数据库：mysql://${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}`);
      console.log(`   微信授权：${MP_ENABLED ? '已启用' : '未配置（退化为匿名采集）'}`);
    });
  } catch (e) {
    console.error('❌ 启动失败：', e.message);
    process.exit(1);
  }
}

start();
