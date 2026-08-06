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
// 问卷前端挂载位置。默认 /survey 子目录；若部署在独立子域（如 survey.xunxinli.com），设为空字符串即根路径。
const SURVEY_PATH = (process.env.SURVEY_PATH !== undefined ? process.env.SURVEY_PATH : '/survey').replace(/\/+$/, '');

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
    charset: 'utf8mb4',
    dateStrings: true
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
        openid VARCHAR(64), wechat_nickname TEXT, wechat_headimgurl TEXT,
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

    // 兼容性升级：为已存在的表添加 total_duration 列
    try {
      await conn.execute(`ALTER TABLE responses ADD COLUMN total_duration INT DEFAULT 0`);
    } catch (e) { /* 列已存在则忽略 */ }
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
        answers, scores, report_html, total_duration
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        report_html || '',
        req.body.total_duration || 0
      ]
    );
    res.json({ success: true, id: result.insertId });
  } catch (e) {
    console.error('保存失败：', e);
    res.status(500).json({ success: false, message: '数据库写入失败' });
  }
});

// ========== 题项元信息 + 选项标签（CSV 表头用） ==========
// 包含完整题干、维度、选项列表、是否反向题
const Q_META = [
  // 量表一：亲子沟通情况（12题）
  { t:'我允许孩子在一些事情上和我有不同意见', dim:'开放尊重', opts:['完全不符合','比较不符合','一般','比较符合','非常符合'], reverse:false },
  { t:'和孩子谈家庭规则或安排时，我会让孩子参与讨论', dim:'规则协商', opts:['完全不符合','比较不符合','一般','比较符合','非常符合'], reverse:false },
  { t:'和孩子谈事情时，我会主动询问孩子的看法', dim:'主动询问', opts:['完全不符合','比较不符合','一般','比较符合','非常符合'], reverse:false },
  { t:'和孩子讨论事情时，我常常坚持自己说了算', dim:'控制式沟通', opts:['完全不符合','比较不符合','一般','比较符合','非常符合'], reverse:true },
  { t:'我鼓励孩子表达不同意见，并说明自己的理由', dim:'开放表达', opts:['完全不符合','比较不符合','一般','比较符合','非常符合'], reverse:false },
  { t:'我会鼓励孩子从不同角度看问题', dim:'引导讨论', opts:['完全不符合','比较不符合','一般','比较符合','非常符合'], reverse:false },
  { t:'孩子愿意告诉我他在想什么', dim:'孩子表达意愿', opts:['完全不符合','比较不符合','一般','比较符合','非常符合'], reverse:false },
  { t:'孩子不认同我的观点时，我通常会很生气', dim:'情绪升级', opts:['完全不符合','比较不符合','一般','比较符合','非常符合'], reverse:true },
  { t:'孩子做得不好时，我会先批评，而不是先了解原因和想法', dim:'批评优先', opts:['完全不符合','比较不符合','一般','比较符合','非常符合'], reverse:true },
  { t:'我和孩子会谈论彼此的感受和情绪', dim:'情感沟通', opts:['完全不符合','比较不符合','一般','比较符合','非常符合'], reverse:false },
  { t:'即使意见不一致，孩子也愿意和我讲话', dim:'沟通安全感', opts:['完全不符合','比较不符合','一般','比较符合','非常符合'], reverse:false },
  { t:'即使不同意孩子的观点，我也愿意认真听他说完', dim:'倾听接纳', opts:['完全不符合','比较不符合','一般','比较符合','非常符合'], reverse:false },
  // 量表二：学业焦虑（12题）
  { t:'孩子学习时经常心不在焉、注意力难以集中，让我感到苦恼', dim:'学习状态担忧', opts:['从不','有时','一般','经常','总是'], reverse:false },
  { t:'我担心自己的能力不足，无法为孩子提供更好的教育支持', dim:'父母能力焦虑', opts:['从不','有时','一般','经常','总是'], reverse:false },
  { t:'想到自己无法为孩子提供更多或更好的教育资源，我会感到心烦', dim:'教育资源焦虑', opts:['从不','有时','一般','经常','总是'], reverse:false },
  { t:'孩子临近重要考试时，我比平时更容易紧张和焦躁', dim:'考试焦虑', opts:['从不','有时','一般','经常','总是'], reverse:false },
  { t:'孩子学习态度不够认真时，我会感到着急，甚至忍不住批评他', dim:'焦虑外化', opts:['从不','有时','一般','经常','总是'], reverse:false },
  { t:'孩子备考重要考试时，我会紧张得睡不好', dim:'考试焦虑', opts:['从不','有时','一般','经常','总是'], reverse:false },
  { t:'孩子考试没考好时，我会急得坐立不安', dim:'成绩焦虑', opts:['从不','有时','一般','经常','总是'], reverse:false },
  { t:'孩子的教育费用支出较多时，我会感到经济负担较重', dim:'教育投入焦虑', opts:['从不','有时','一般','经常','总是'], reverse:false },
  { t:'孩子的作业或学习问题我辅导不来时，会感到无助', dim:'父母无力感', opts:['从不','有时','一般','经常','总是'], reverse:false },
  { t:'想到孩子所在班级或学校的学习环境可能影响学习，我会感到烦心', dim:'学校环境焦虑', opts:['从不','有时','一般','经常','总是'], reverse:false },
  { t:'孩子做作业拖拉、经常不能按时完成时，我会感到着急', dim:'学习执行担忧', opts:['从不','有时','一般','经常','总是'], reverse:false },
  { t:'想到如果没人监督孩子就不会主动学习，我会感到无助', dim:'学习自主性担忧',opts:['从不','有时','一般','经常','总是'], reverse:false },
  // 量表三：心理韧性（10题）
  { t:'当事情和以前不一样时，孩子通常能慢慢适应', dim:'适应变化', opts:['从不这样','很少这样','有时这样','经常这样','总是这样'], reverse:false },
  { t:'遇到不顺利或不好的事情时，孩子通常会尝试想办法应对', dim:'应对困难', opts:['从不这样','很少这样','有时这样','经常这样','总是这样'], reverse:false },
  { t:'遇到让人头疼的难题时，孩子能尝试让自己放松或心情好一些', dim:'情绪调节', opts:['从不这样','很少这样','有时这样','经常这样','总是这样'], reverse:false },
  { t:'努力解决麻烦之后，孩子通常能从中获得经验或信心', dim:'成长感', opts:['从不这样','很少这样','有时这样','经常这样','总是这样'], reverse:false },
  { t:'生病、受伤、受挫或难过之后，孩子通常能较快恢复', dim:'恢复力', opts:['从不这样','很少这样','有时这样','经常这样','总是这样'], reverse:false },
  { t:'即使过程有点困难，孩子通常仍相信自己可以完成或做好', dim:'自我效能', opts:['从不这样','很少这样','有时这样','经常这样','总是这样'], reverse:false },
  { t:'心里着急时，孩子仍能尽量专注，把事情想清楚', dim:'压力下专注', opts:['从不这样','很少这样','有时这样','经常这样','总是这样'], reverse:false },
  { t:'即使一件事没做好，孩子也不容易马上放弃', dim:'坚持性', opts:['从不这样','很少这样','有时这样','经常这样','总是这样'], reverse:false },
  { t:'遇到困难和挑战时，孩子愿意面对或继续尝试', dim:'勇于面对', opts:['从不这样','很少这样','有时这样','经常这样','总是这样'], reverse:false },
  { t:'当孩子伤心、害怕或想发脾气时，通常知道怎样让自己慢慢平静下来', dim:'情绪平复', opts:['从不这样','很少这样','有时这样','经常这样','总是这样'], reverse:false }
];

// 维度名称映射
const DIM_NAMES = { comm: '亲子沟通情况', anx: '学业焦虑', res: '心理韧性' };
const SCALE_KEYS = ['comm', 'anx', 'res'];

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

// 兼容 mysql2 的 JSON 列：可能是对象（已解析）或字符串
function toObjSafe(x) {
  if (x && typeof x === 'object') return x;
  if (x === null || x === undefined || x === '') return {};
  if (typeof x === 'string') { try { return JSON.parse(x); } catch (e) { return {}; } }
  return {};
}

// ========== 从 answers JSON 中提取每题原始分（1-5） ==========
function extractAnswers(answersJson) {
  let a;
  if (answersJson && typeof answersJson === 'object') a = answersJson;
  else { try { a = JSON.parse(answersJson || '{}'); } catch (e) { a = {}; } }
  const result = [];
  for (const k of SCALE_KEYS) {
    const arr = Array.isArray(a[k]) ? a[k] : [];
    for (let i = 0; i < arr.length; i++) {
      const v = parseInt(arr[i], 10);
      result.push((isNaN(v) || v < 1 || v > 5) ? null : v);
    }
  }
  while (result.length < 34) result.push(null);
  return result;
}

// ========== 获取选项文本（原始分 → 选项文字） ==========
function getOptionText(qIdx, rawVal) {
  if (rawVal === null || rawVal === undefined) return '';
  const q = Q_META[qIdx];
  if (!q || !q.opts) return String(rawVal);
  const idx = parseInt(rawVal, 10) - 1;
  if (idx >= 0 && idx < q.opts.length) return q.opts[idx];
  return String(rawVal);
}

// ========== 获取计分值（反向题自动反转） ==========
function getScoreValue(qIdx, rawVal) {
  if (rawVal === null || rawVal === undefined) return '';
  const q = Q_META[qIdx];
  let v = parseInt(rawVal, 10);
  if (isNaN(v) || v < 1 || v > 5) return '';
  if (q && q.reverse) v = 6 - v; // 反转
  return String(v);
}

// ========== 导出 CSV（支持 mode=option|score，完整题干列头） ==========
app.get('/api/export.csv', async (req, res) => {
  if (req.query.key !== EXPORT_KEY) return res.status(401).send('密钥错误');
  try {
    const [rows] = await pool.execute('SELECT * FROM responses ORDER BY id DESC');

    const esc = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    // mode: 'option'=导出选项文本(默认), 'score'=导出李克特分值(反向题已反转)
    const mode = (req.query.mode || 'option').toLowerCase();

    // 表头：q 列显示「题干前20字」
    const qHeaders = Q_META.map((q, i) => {
      const shortTitle = q.t.length > 20 ? q.t.slice(0, 20) + '…' : q.t;
      return `q${i + 1}（${shortTitle}）`;
    });
    const headers = [
      'id', '提交时间', '答题时长(秒)',
      '性别', '年龄', '职业', '收入', '所在城市',
      '姓名缩写', '手机后四位', '子女数',
      '沟通总分', '焦虑总分', '韧性总分',
      ...qHeaders
    ];
    const lines = [headers.map(esc).join(',')];

    for (const r of rows) {
      const scores = extractScores(r.scores);
      const rawVals = extractAnswers(r.answers);

      let dur = '';
      if (r.start_time && r.submit_time) {
        const t0 = new Date(r.start_time).getTime();
        const t1 = new Date(r.submit_time).getTime();
        if (!isNaN(t0) && !isNaN(t1) && t1 >= t0) dur = Math.round((t1 - t0) / 1000);
      }

      // 根据模式决定每题展示内容
      const qVals = rawVals.map((v, i) =>
        mode === 'score' ? esc(getScoreValue(i, v)) : esc(getOptionText(i, v))
      );

      const row = [
        r.id,
        (r.server_time || r.created_at || '').replace(/T/, ' ').slice(0, 19),
        dur,
        r.gender || '', r.age || '', r.occupation || '', r.income || '', r.city || '',
        r.name_code || '', r.phone_last4 || '', r.children_count || '',
        scores.comm || '', scores.anx || '', scores.res || '',
        ...qVals
      ];
      lines.push(row.join(','));
    }

    const suffix = mode === 'score' ? '_score' : '_option';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="survey_responses_${new Date().toISOString().slice(0,10)}${suffix}.csv"`);
    res.send('\uFEFF' + lines.join('\n'));
  } catch (e) {
    console.error('CSV导出失败:', e);
    res.status(500).send('导出失败');
  }
});

// ========== 从 scores JSON 提取各维度总分 ==========
function extractScores(scoresJson) {
  let s;
  if (scoresJson && typeof scoresJson === 'object') s = scoresJson;
  else { try { s = JSON.parse(scoresJson || '{}'); } catch (e) { s = {}; } }
  return {
    comm: (s.comm && s.comm.total) ? s.comm.total : '',
    anx:  (s.anx && s.anx.total) ? s.anx.total : '',
    res:  (s.res && s.res.total) ? s.res.total : ''
  };
}

// ========== 分页查询原始数据（供 admin 表格使用） ==========
app.get('/api/responses', async (req, res) => {
  if (req.query.key !== EXPORT_KEY) return res.status(401).json({ success: false, message: '密钥错误' });
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const search = (req.query.search || '').trim();
    const offset = (page - 1) * pageSize;

    // 构建查询：支持对 gender/age/city/name_code 的模糊搜索
    let whereSql = '';
    let params = [];
    if (search) {
      whereSql = `WHERE gender LIKE ? OR age LIKE ? OR city LIKE ? OR name_code LIKE ? OR occupation LIKE ?`;
      const s = `%${search}%`;
      params = [s, s, s, s, s];
    }

    const countRes = await pool.execute(
      `SELECT COUNT(*) AS total FROM responses ${whereSql}`, params
    );
    const total = countRes[0][0].total;

    const [rows] = await pool.execute(
      `SELECT id, created_at, server_time, gender, age, occupation, income, contact, area,
              name_code, phone_last4, city, children_count,
              child_age_1, child_gender_1, child_age_2, child_gender_2,
              child_age_3, child_gender_3, lie_flag,
              answers, scores, start_time, submit_time, device_model,
              ip, total_duration, report_html
       FROM responses ${whereSql}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (e) {
    console.error('分页查询失败:', e);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// ========== 统计分析 API ==========
app.get('/api/stats', async (req, res) => {
  if (req.query.key !== EXPORT_KEY) return res.status(401).json({ success: false, message: '密钥错误' });
  try {
    const [rows] = await pool.execute(
      `SELECT id, created_at, gender, age, city, children_count, answers, scores, start_time, submit_time
       FROM responses ORDER BY id DESC`
    );

    const total = rows.length;
    if (total === 0) {
      return res.json({
        success: true,
        overview: { total: 0, today: 0, avgDuration: 0 },
        dimensions: {},
        demographics: { gender: {}, age: {}, city: {} },
        dailyTrend: [],
        qStats: []
      });
    }

    // 今日新增
    const _cn = new Date();
    const todayStr = new Date(_cn.getTime() + (_cn.getTimezoneOffset() + 480) * 60000).toISOString().slice(0, 10);
    const todayCount = rows.filter(r => (r.created_at || '').slice(0, 10) === todayStr).length;

    // 维度统计
    const dimData = { comm: [], anx: [], res: [] };
    let totalDur = 0, durCnt = 0;

    // 每题统计（34题）
    const qArrays = Array.from({ length: 34 }, () => []);
    // 人口统计
    const genderMap = {}, ageMap = {}, cityMap = {};
    // 每日趋势
    const dayMap = {};

    for (const r of rows) {
      // 维度分
      const s = toObjSafe(r.scores);
      for (const k of SCALE_KEYS) {
        if (s[k] && typeof s[k].total === 'number') dimData[k].push(s[k].total);
      }

      // 答题时长
      if (r.start_time && r.submit_time) {
        const t0 = new Date(r.start_time).getTime();
        const t1 = new Date(r.submit_time).getTime();
        if (!isNaN(t0) && !isNaN(t1) && t1 >= t0) { totalDur += (t1 - t0) / 1000; durCnt++; }
      }

      // 每题分数
      const qVals = extractAnswers(r.answers);
      qVals.forEach((v, i) => { if (v !== '') qArrays[i].push(v); });

      // 人口统计
      const g = (r.gender || '未填').trim(); genderMap[g] = (genderMap[g] || 0) + 1;
      const a = (r.age || '未填').trim();   ageMap[a] = (ageMap[a] || 0) + 1;
      const c = (r.city || '未填').trim();   cityMap[c] = (cityMap[c] || 0) + 1;

      // 每日趋势
      const d = (r.created_at || '').slice(0, 10); if (d) dayMap[d] = (dayMap[d] || 0) + 1;
    }

    // 维度聚合
    const dimensions = {};
    for (const k of SCALE_KEYS) {
      const arr = dimData[k];
      if (arr.length === 0) { dimensions[k] = { name: DIM_NAMES[k], count: 0, avg: 0, min: 0, max: 0, distribution: {} }; continue; }
      const sum = arr.reduce((a, b) => a + b, 0);
      const avg = Math.round(sum / arr.length * 10) / 10;
      dimensions[k] = {
        name: DIM_NAMES[k],
        count: arr.length,
        avg, min: Math.min(...arr), max: Math.max(...arr),
        distribution: {}
      };
      // 分档统计
      const levels = k === 'anx'
        ? [{ label: '不怎么焦虑', max: 27 }, { label: '一般', max: 35 }, { label: '较强', max: 43 }, { label: '很强', max: 999 }]
        : (k === 'comm'
          ? [{ label: '优秀', min: 45 }, { label: '良好', min: 37 }, { label: '一般', min: 32 }, { label: '不容乐观', min: 0 }]
          : [{ label: '优秀', min: 38 }, { label: '良好', min: 31 }, { label: '一般', min: 25 }, { label: '需关注', min: 0 }]);
      for (const v of arr) {
        let lbl = '';
        if (k === 'anx') {
          lbl = v <= 27 ? '不怎么焦虑' : v <= 35 ? '一般' : v <= 43 ? '较强' : '很强';
        } else if (k === 'comm') {
          lbl = v >= 45 ? '优秀' : v >= 37 ? '良好' : v >= 32 ? '一般' : '不容乐观';
        } else {
          lbl = v >= 38 ? '优秀' : v >= 31 ? '良好' : v >= 25 ? '一般' : '需关注';
        }
        dimensions[k].distribution[lbl] = (dimensions[k].distribution[lbl] || 0) + 1;
      }
    }

    // 每题平均分
    const qStats = qArrays.map((arr, i) => ({
      q: i + 1,
      text: Q_META[i].t || '',
      dim: Q_META[i].dim || '',
      reverse: Q_META[i].reverse || false,
      count: arr.length,
      avg: arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 100) / 100 : 0,
      opts: Q_META[i].opts || []
    }));

    // 每日趋势（最近30天，倒序）
    const dailyTrend = Object.entries(dayMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30);

    res.json({
      success: true,
      overview: {
        total, today: todayCount,
        avgDuration: durCnt > 0 ? Math.round(totalDur / durCnt) : 0
      },
      dimensions,
      demographics: { gender: genderMap, age: ageMap, city: cityMap },
      dailyTrend,
      qStats,
      // 调试：返回第一条记录的原始 answers 样本，用于排查数据为空问题
      _debugSample: rows.length > 0 ? {
        id: rows[0].id,
        answers_type: typeof rows[0].answers,
        answers_preview: (rows[0].answers || '').toString().slice(0, 200),
        scores_preview: (rows[0].scores || '').toString().slice(0, 200)
      } : null
    });
  } catch (e) {
    console.error('统计失败:', e);
    res.status(500).json({ success: false, message: '统计失败' });
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
  if (!MP_ENABLED || !code) return res.redirect(`${SURVEY_PATH}/index.html`);
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
    res.redirect(`${SURVEY_PATH}/index.html#token=${sessionToken}`);
  } catch (e) {
    console.error('微信授权失败：', e.message);
    res.redirect(`${SURVEY_PATH}/index.html`);
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
