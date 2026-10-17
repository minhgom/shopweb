// QM MOD iOS — Backend v21 (Upstash Redis + Drive streaming fix)
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Resend } = require('resend');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { google } = require('googleapis');
const { pipeline } = require('stream/promises');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://shopweb-jgeo.onrender.com';
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

// ===== COOKIE SECRET =====
let COOKIE_SECRET = process.env.COOKIE_SECRET;
if (!COOKIE_SECRET) {
    COOKIE_SECRET = crypto.randomBytes(32).toString('hex');
    console.warn('[WARN] Chưa đặt COOKIE_SECRET (mỗi lần restart sẽ làm mất đăng nhập + link tải cũ)');
}

// ===== RESEND =====
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.FROM_EMAIL || 'QM MOD iOS <onboarding@resend.dev>';

// ===== CORS =====
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const CROSS_SITE = ALLOWED_ORIGINS.length > 0;

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser(COOKIE_SECRET));
if (CROSS_SITE) app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));

app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

// ===== STATIC =====
const PUBLIC_DIR = path.join(__dirname, 'public');
const HAS_PUBLIC = fs.existsSync(PUBLIC_DIR);
const BLOCKED_FILES = new Set([
    'server.js', 'database.json', 'database.json.tmp', 'drive-service.json',
    'package.json', 'package-lock.json', 'render.yaml'
]);
if (!HAS_PUBLIC) {
    app.use((req, res, next) => {
        let p;
        try { p = decodeURIComponent(req.path); } catch { return res.status(400).end(); }
        const parts = p.split('/').filter(Boolean);
        const bad = parts.some(s =>
            s.startsWith('.') ||
            s === 'node_modules' ||
            BLOCKED_FILES.has(s.toLowerCase()) ||
            /\.(env|key|pem|log)$/i.test(s)
        );
        if (bad && !p.startsWith('/api/')) return res.status(404).send('Không tìm thấy');
        next();
    });
}
app.use(express.static(HAS_PUBLIC ? PUBLIC_DIR : __dirname, { dotfiles: 'ignore' }));

// ============================================================
//  GOOGLE DRIVE — dùng service account để tải file IPA
//  (file phải được SHARE cho email của service account)
// ============================================================
let driveAuthOptions = {
    scopes: ['https://www.googleapis.com/auth/drive']
};
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    try {
        driveAuthOptions.credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    } catch (e) {
        console.error('[Drive] Lỗi parse JSON từ env:', e.message);
        driveAuthOptions.keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || './drive-service.json';
    }
} else {
    driveAuthOptions.keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || './drive-service.json';
}
const driveAuth = new google.auth.GoogleAuth(driveAuthOptions);
const drive = google.drive({ version: 'v3', auth: driveAuth });

const driveMetaCache = new Map();
async function getDriveMeta(fileId, force) {
    const hit = driveMetaCache.get(fileId);
    if (!force && hit && hit.exp > Date.now()) return hit.meta;
    const r = await drive.files.get({
        fileId,
        fields: 'id,name,size,mimeType',
        supportsAllDrives: true
    });
    driveMetaCache.set(fileId, { meta: r.data, exp: Date.now() + 10 * 60 * 1000 });
    return r.data;
}

function driveErrorInfo(e) {
    const code = Number(e && (e.code || (e.response && e.response.status))) || 0;
    if (code === 404) return { status: 404, msg: 'File không tìm thấy trên Drive (sai ID hoặc chưa share cho service account)' };
    if (code === 403) return { status: 502, msg: 'Drive từ chối quyền truy cập hoặc quá hạn mức tải' };
    if (code === 416) return { status: 416, msg: 'Range không hợp lệ' };
    return { status: 502, msg: 'Lỗi tải file' };
}

function safeFilename(name, fallback) {
    const s = String(name || fallback || 'download.ipa')
        .replace(/[^\x20-\x7E]/g, '_')
        .replace(/[\r\n"\\/]/g, '')
        .trim();
    return s || 'download.ipa';
}

function isMegaUrl(u) {
    try {
        const url = new URL(String(u));
        if (url.protocol !== 'https:') return false;
        const h = url.hostname.toLowerCase();
        return h === 'mega.nz' || h === 'mega.co.nz' || h.endsWith('.mega.nz');
    } catch { return false; }
}

// Stream file từ Drive về trình duyệt (private, không cần public link)
async function sendDriveFile(req, res, file) {
    const meta = await getDriveMeta(file.id);
    const total = Number(meta.size) || Number(file.size) || null;
    const filename = safeFilename(file.name || meta.name, 'download.ipa');

    const reqHeaders = {};
    if (req.headers.range && total) reqHeaders.Range = req.headers.range;

    const dr = await drive.files.get(
        { fileId: file.id, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream', headers: reqHeaders }
    );

    const partial = dr.status === 206;
    res.status(partial ? 206 : 200);
    // luôn là octet-stream để trình duyệt LƯU FILE chứ không mở như trang HTML
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    if (dr.headers['content-range']) res.setHeader('Content-Range', dr.headers['content-range']);
    const len = dr.headers['content-length'] || (!partial && total ? String(total) : null);
    if (len) res.setHeader('Content-Length', String(len));
    res.setHeader('Content-Disposition',
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(dr.data, res);
}

function sendDownloadError(res, e, tag) {
    console.error(`[${tag}]`, e && e.message);
    if (res.headersSent) return res.destroy();
    const info = driveErrorInfo(e);
    res.status(info.status).type('text/plain; charset=utf-8').send(info.msg);
}

// ============================================================
//  UPSTASH REDIS — storage cho DB
// ============================================================
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const DB_KEY = 'shopweb:db';

async function redisGet(key) {
    if (!UPSTASH_URL || !UPSTASH_TOKEN) throw new Error('Missing Upstash env');
    const r = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    if (!r.ok) throw new Error(`Redis GET ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return j.result;
}

async function redisSet(key, value) {
    if (!UPSTASH_URL || !UPSTASH_TOKEN) throw new Error('Missing Upstash env');
    const r = await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
        body: String(value)
    });
    if (!r.ok) throw new Error(`Redis SET ${r.status}: ${await r.text()}`);
    return true;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ============================================================
//  DB LOAD/SAVE (Upstash)
// ============================================================
function emptyDB() {
    return { users: [], products: [], orders: [], nextUserId: 1, nextProductId: 1, nextOrderId: 1 };
}

// CHỈ trả DB rỗng khi Redis thật sự chưa có dữ liệu.
// Nếu lỗi mạng/Upstash → throw, để server KHÔNG khởi động rồi ghi đè DB rỗng lên dữ liệu thật.
async function loadDB() {
    let lastErr;
    for (let i = 1; i <= 4; i++) {
        try {
            const raw = await redisGet(DB_KEY);
            if (!raw) {
                console.warn('[RedisDB] Chưa có dữ liệu, tạo DB mới');
                return emptyDB();
            }
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const orders = Array.isArray(parsed.orders) ? parsed.orders : [];
            const maxOrderId = orders.reduce((m, o) => Math.max(m, Number(o.id) || 0), 0);
            console.log('[RedisDB] Loaded —', parsed.users?.length || 0, 'users,', parsed.products?.length || 0, 'products');
            return {
                users: Array.isArray(parsed.users) ? parsed.users : [],
                products: Array.isArray(parsed.products) ? parsed.products : [],
                orders,
                nextUserId: Number(parsed.nextUserId) || 1,
                nextProductId: Number(parsed.nextProductId) || 1,
                nextOrderId: Number(parsed.nextOrderId) || (maxOrderId + 1)
            };
        } catch (e) {
            lastErr = e;
            console.error(`[RedisDB] Load fail (lần ${i}/4):`, e.message);
            if (i < 4) await sleep(1500 * i);
        }
    }
    throw lastErr;
}

async function saveDBToStorage(data) {
    const body = JSON.stringify(data);
    for (let i = 1; i <= 3; i++) {
        try {
            await redisSet(DB_KEY, body);
            return true;
        } catch (e) {
            console.error(`[RedisDB] Save fail (lần ${i}/3):`, e.message);
            if (i < 3) await sleep(800 * i);
        }
    }
    return false;
}

// ===== DB + AUTO SAVE =====
let db = emptyDB();
let dbReady = false;
let saveInFlight = false;
let saveQueued = false;

async function saveDB() {
    if (!dbReady) return;
    if (saveInFlight) { saveQueued = true; return; }
    saveInFlight = true;
    saveQueued = false;
    try {
        await saveDBToStorage(db);
    } finally {
        saveInFlight = false;
        if (saveQueued) { saveQueued = false; saveDB(); }
    }
}

// Flush khi tắt
process.on('SIGTERM', async () => {
    console.log('[DB] SIGTERM, flushing...');
    if (dbReady) await saveDBToStorage(db);
    process.exit(0);
});
process.on('SIGINT', async () => {
    if (dbReady) await saveDBToStorage(db);
    process.exit(0);
});

// ============================================================
//  PASSWORD
// ============================================================
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return salt + ':' + hash;
}
function verifyPassword(password, stored) {
    try {
        if (!stored || !stored.includes(':')) return false;
        const [salt, hash] = stored.split(':');
        const check = crypto.scryptSync(password, salt, 64).toString('hex');
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
    } catch { return false; }
}

// ===== HELPERS =====
function validateEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function sanitize(s) { return typeof s === 'string' ? s.replace(/[<>]/g, '').trim().slice(0, 500) : ''; }
function validPassword(p) { return typeof p === 'string' && p.length >= 6 && p.length <= 200; }
function extractDriveId(url) {
    if (!url) return null;
    let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
    if (m) return m[1];
    m = url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
    return m ? m[1] : null;
}
function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ============================================================
//  SIGNED DOWNLOAD TOKEN
//  i = Drive file id, u = link ngoài (MEGA), n = tên, l = nhãn, s = size, m = mime
// ============================================================
function makeDownloadToken(orderCode, files, productName, ttlMs) {
    const payload = {
        o: orderCode,
        n: productName || '',
        f: (files || []).map(f => ({
            i: f.file_id || null,
            u: f.url || null,
            n: f.name || 'file.ipa',
            l: f.label || 'File',
            s: f.size || null,
            m: f.mime || 'application/octet-stream'
        })),
        e: Date.now() + (ttlMs || 7 * 24 * 3600 * 1000)
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', COOKIE_SECRET).update(body).digest('base64url');
    return body + '.' + sig;
}

function verifyDownloadToken(token) {
    try {
        const parts = String(token || '').split('.');
        if (parts.length !== 2) return null;
        const [body, sig] = parts;
        const expect = crypto.createHmac('sha256', COOKIE_SECRET).update(body).digest('base64url');
        if (!safeEqual(sig, expect)) return null;
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (!payload.e || payload.e <= Date.now()) return null;
        return payload;
    } catch { return null; }
}

// Rate limit
const attempts = new Map();
function rateLimit(key, max, windowMs) {
    const now = Date.now();
    const list = (attempts.get(key) || []).filter(t => now - t < windowMs);
    if (list.length >= max) { attempts.set(key, list); return false; }
    list.push(now);
    attempts.set(key, list);
    return true;
}
setInterval(() => attempts.clear(), 60 * 60 * 1000).unref();

// ===== COOKIE + TOKEN =====
const COOKIE_OPTS = {
    httpOnly: true,
    secure: CROSS_SITE ? true : IS_PROD,
    sameSite: CROSS_SITE ? 'none' : 'lax',
    signed: true,
    maxAge: 7 * 24 * 3600 * 1000,
    path: '/'
};
const CLEAR_OPTS = {
    httpOnly: true,
    secure: COOKIE_OPTS.secure,
    sameSite: COOKIE_OPTS.sameSite,
    path: '/'
};

function signToken(kind, id) {
    const exp = Date.now() + 7 * 24 * 3600 * 1000;
    const body = `${kind}.${id}.${exp}`;
    const sig = crypto.createHmac('sha256', COOKIE_SECRET).update(body).digest('base64url');
    return `${body}.${sig}`;
}
function verifyToken(token, kind) {
    const p = String(token || '').split('.');
    if (p.length !== 4) return null;
    const [k, id, exp, sig] = p;
    if (k !== kind) return null;
    const expect = crypto.createHmac('sha256', COOKIE_SECRET).update(`${k}.${id}.${exp}`).digest('base64url');
    if (!safeEqual(sig, expect)) return null;
    if (!(Number(exp) > Date.now())) return null;
    const n = parseInt(id);
    return Number.isInteger(n) ? n : null;
}

function readId(req, name) {
    const v = req.signedCookies && req.signedCookies[name];
    const n = parseInt(v);
    if (Number.isInteger(n)) return n;
    const m = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
    return m ? verifyToken(m[1], name === 'isAdmin' ? 'a' : 'u') : null;
}

// ============================================================
//  ENSURE ADMIN
// ============================================================
function ensureAdmin() {
    const envPass = process.env.ADMIN_PASSWORD;
    let a = db.users.find(u => u.username === 'admin' && u.is_admin);
    if (!a) {
        const pass = envPass || crypto.randomBytes(9).toString('hex');
        db.users.push({
            id: db.nextUserId++,
            username: 'admin',
            email: 'admin@shopweb.local',
            password_hash: hashPassword(pass),
            is_admin: true,
            is_banned: 0,
            created_at: new Date().toISOString()
        });
        saveDB();
        console.log('[DB] Đã tạo admin');
    } else if (envPass && !verifyPassword(envPass, a.password_hash)) {
        a.password_hash = hashPassword(envPass);
        a.is_banned = 0;
        saveDB();
        console.log('[DB] Cập nhật mật khẩu admin');
    }
}

// ===== MIDDLEWARE =====
function requireLogin(req, res, next) {
    const id = readId(req, 'uid');
    if (!id) return res.status(401).json({ error: 'Chưa đăng nhập' });
    const u = db.users.find(x => x.id === id);
    if (!u || u.is_banned) return res.status(403).json({ error: 'Không hợp lệ' });
    req.user = u;
    next();
}
function requireAdmin(req, res, next) {
    const id = readId(req, 'isAdmin');
    const u = id && db.users.find(x => x.id === id && x.is_admin && !x.is_banned);
    if (!u) return res.status(403).json({ error: 'Không có quyền' });
    req.admin = u;
    next();
}

// ============================================================
//  AUTH
// ============================================================
app.post('/api/register', (req, res) => {
    try {
        const email = sanitize(req.body.email).toLowerCase();
        const password = req.body.password;
        const username = sanitize(req.body.username) || email.split('@')[0] || 'user';

        if (!email || !password) return res.status(400).json({ error: 'Thiếu thông tin' });
        if (!validateEmail(email)) return res.status(400).json({ error: 'Email sai' });
        if (!validPassword(password)) return res.status(400).json({ error: 'Pass 6+ ký tự' });
        if (db.users.find(u => u.email === email)) return res.status(400).json({ error: 'Email đã tồn tại' });
        if (username.toLowerCase() === 'admin') return res.status(400).json({ error: 'Tên này không được dùng' });

        const user = {
            id: db.nextUserId++,
            username, email,
            password_hash: hashPassword(password),
            reset_token: null, reset_expires: null,
            is_banned: 0, is_admin: false,
            created_at: new Date().toISOString()
        };
        db.users.push(user);
        saveDB();

        res.cookie('uid', user.id, COOKIE_OPTS);
        res.json({ success: true, token: signToken('u', user.id), user: { id: user.id, username, email } });
    } catch (e) {
        console.error('[register]', e);
        res.status(500).json({ error: 'Lỗi: ' + e.message });
    }
});

app.post('/api/login', (req, res) => {
    try {
        if (!rateLimit('login:' + req.ip, 15, 15 * 60 * 1000)) {
            return res.status(429).json({ error: 'Thử quá nhiều lần, đợi 15 phút' });
        }
        const email = sanitize(req.body.email).toLowerCase();
        const password = req.body.password;

        if (!email || typeof password !== 'string' || !password) return res.status(400).json({ error: 'Thiếu thông tin' });

        const u = db.users.find(x => x.email === email || x.username.toLowerCase() === email);
        if (!u) return res.status(401).json({ error: 'Sai thông tin' });
        if (u.is_banned) return res.status(403).json({ error: 'Bị khoá' });
        if (!verifyPassword(password, u.password_hash)) return res.status(401).json({ error: 'Sai thông tin' });

        res.cookie('uid', u.id, COOKIE_OPTS);
        if (u.is_admin) res.cookie('isAdmin', u.id, COOKIE_OPTS);
        res.json({
            success: true,
            token: signToken('u', u.id),
            admin_token: u.is_admin ? signToken('a', u.id) : undefined,
            user: { id: u.id, username: u.username, email: u.email, is_admin: !!u.is_admin }
        });
    } catch (e) {
        console.error('[login]', e);
        res.status(500).json({ error: 'Lỗi: ' + e.message });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('uid', CLEAR_OPTS);
    res.clearCookie('isAdmin', CLEAR_OPTS);
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    const id = readId(req, 'uid') || readId(req, 'isAdmin');
    if (!id) return res.json({ logged: false });
    const u = db.users.find(x => x.id === id);
    if (!u || u.is_banned) return res.json({ logged: false });
    res.json({
        logged: true,
        user: { id: u.id, username: u.username, email: u.email, is_admin: !!u.is_admin }
    });
});

app.post('/api/forgot', async (req, res) => {
    try {
        if (!rateLimit('forgot:' + req.ip, 5, 15 * 60 * 1000)) {
            return res.status(429).json({ error: 'Thử quá nhiều lần, đợi 15 phút' });
        }
        const email = sanitize(req.body.email).toLowerCase();
        if (!validateEmail(email)) return res.status(400).json({ error: 'Email sai' });
        const u = db.users.find(x => x.email === email);

        if (!u) return res.json({ success: true });

        const token = crypto.randomBytes(32).toString('hex');
        u.reset_token = token;
        u.reset_expires = Date.now() + 30 * 60 * 1000;
        saveDB();

        const link = `${BASE_URL}/reset.html?token=${token}`;
        if (resend) {
            try {
                await resend.emails.send({
                    from: FROM_EMAIL, to: email,
                    subject: 'Đặt lại mật khẩu',
                    html: `<p>Xin chào <b>${u.username}</b>,</p><p><a href="${link}">ĐẶT LẠI MẬT KHẨU</a> (30 phút)</p>`
                });
            } catch (mailErr) {
                console.error('[forgot] Resend error:', mailErr.message);
            }
        }
        res.json({ success: true });
    } catch (e) {
        console.error('[forgot]', e.message);
        res.status(500).json({ error: 'Lỗi: ' + e.message });
    }
});

app.post('/api/reset', (req, res) => {
    try {
        const token = sanitize(req.body.token);
        const password = req.body.password;
        if (!token || !validPassword(password)) return res.status(400).json({ error: 'Thiếu thông tin' });
        const u = db.users.find(x => x.reset_token && x.reset_token === token && x.reset_expires > Date.now());
        if (!u) return res.status(400).json({ error: 'Token sai/hết hạn' });
        u.password_hash = hashPassword(password);
        u.reset_token = null;
        u.reset_expires = null;
        saveDB();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi: ' + e.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        users: db.users.length,
        products: db.products.length,
        orders: db.orders.length,
        uptime_seconds: Math.round(process.uptime()),
        cookie_secret_from_env: !!process.env.COOKIE_SECRET,
        storage: 'upstash-redis',
        redis_configured: !!(UPSTASH_URL && UPSTASH_TOKEN),
        resend_key_set: !!process.env.RESEND_API_KEY
    });
});

// ============================================================
//  PRODUCTS
// ============================================================
app.get('/api/products', (req, res) => {
    res.json(db.products.map(p => ({
        id: p.id, name: p.name, game: p.game, price: p.price, video_url: p.video_url
    })));
});

app.get('/api/products/:id', (req, res) => {
    const p = db.products.find(x => x.id === parseInt(req.params.id));
    if (!p) return res.status(404).json({ error: 'Không tồn tại' });
    res.json({ id: p.id, name: p.name, game: p.game, price: p.price, video_url: p.video_url });
});

// ============================================================
//  CHECKOUT
// ============================================================
app.post('/api/checkout', (req, res) => {
    try {
        const product_id = parseInt(req.body.product_id);
        const customer_email = sanitize(req.body.customer_email || '').toLowerCase();
        const uid = readId(req, 'uid');

        if (!product_id) return res.status(400).json({ error: 'Thiếu product_id' });
        if (!validateEmail(customer_email)) return res.status(400).json({ error: 'Email sai' });

        const product = db.products.find(x => x.id === product_id);
        if (!product) return res.status(404).json({ error: 'Sản phẩm không tồn tại' });

        const orderCode = 'QM' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const downloadToken = crypto.randomBytes(32).toString('hex');
        const amount = product.price;

        db.orders.push({
            id: db.nextOrderId++,
            user_id: uid,
            customer_email,
            product_id,
            order_code: orderCode,
            download_token: downloadToken,
            token_exp: Date.now() + 7 * 24 * 3600 * 1000,
            downloads: 0,
            max_dl: 10,
            amount,
            status: 'pending',
            created_at: new Date().toISOString(),
            paid_at: null
        });
        saveDB();

        const bankName = process.env.BANK_NAME || 'MB';
        const bank = process.env.BANK_ACCOUNT || '0383415468';
        const qr = `https://img.vietqr.io/image/${bankName}-${bank}-compact2.png?amount=${amount}&addInfo=${orderCode}`;

        res.json({
            success: true, order_code: orderCode, amount,
            product_name: product.name, game: product.game,
            bank_account: bank, bank_name: bankName, qr, transfer_content: orderCode
        });
    } catch (e) {
        console.error('[checkout]', e);
        res.status(500).json({ error: 'Lỗi: ' + e.message });
    }
});

app.get('/api/order/:code/status', (req, res) => {
    const o = db.orders.find(x => x.order_code === req.params.code);
    if (!o) return res.status(404).json({ error: 'Không tồn tại' });
    res.json({
        order_code: o.order_code, status: o.status,
        paid: o.status === 'paid' || o.status === 'delivered',
        delivered: o.status === 'delivered', paid_at: o.paid_at
    });
});

// ============================================================
//  SEPAY WEBHOOK
// ============================================================
app.post('/api/sepay/webhook', async (req, res) => {
    try {
        const key = process.env.SEPAY_API_KEY;
        const auth = req.get('authorization') || '';
        if (!key || !safeEqual(auth, `Apikey ${key}`)) return res.status(401).end();

        const b = req.body || {};
        const content = String(b.content || b.description || '');
        const amount = Number(b.transferAmount || b.amount || 0);
        console.log(`[sepay] +${amount} | "${content}"`);

        const m = content.match(/QM[A-F0-9]{8}/i);
        if (!m) return res.json({ ok: true, matched: false });

        const code = m[0].toUpperCase();
        const order = db.orders.find(x => x.order_code === code);
        if (!order) return res.json({ ok: true, matched: false });
        if (order.status === 'delivered') return res.json({ ok: true, matched: true, already: true });
        if (amount < order.amount) return res.json({ ok: true, matched: true, underpaid: true });

        order.status = 'delivered';
        order.paid_at = new Date().toISOString();

        const product = db.products.find(x => x.id === order.product_id);
        const signedToken = makeDownloadToken(
            order.order_code,
            (product && product.files) || [],
            product ? product.name : '',
            7 * 24 * 3600 * 1000
        );
        order.signed_token = signedToken;
        saveDB();

        const link = `${BASE_URL}/download.html?t=${signedToken}`;
        if (resend) {
            try {
                await resend.emails.send({
                    from: FROM_EMAIL,
                    to: order.customer_email,
                    subject: `Đơn ${code} — Link tải ${product ? product.name : ''}`,
                    html: `<h2 style="color:#16a34a">✓ Thanh toán thành công</h2>
                        <p>Đơn <b>${code}</b> — ${amount.toLocaleString('vi-VN')}đ</p>
                        <p><b>${product ? product.name : ''}</b></p>
                        <a href="${link}" style="display:inline-block;padding:14px 28px;background:#0a0a0a;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold">MỞ TRANG TẢI</a>`
                });
            } catch (e) { console.error('[sepay] mail fail:', e.message); }
        }

        res.json({ ok: true, matched: true, delivered: true });
    } catch (e) {
        console.error('[sepay]', e);
        res.status(500).json({ error: 'Lỗi' });
    }
});

// ============================================================
//  DOWNLOAD — SIGNED TOKEN
// ============================================================
app.get('/api/dl-info/:token', (req, res) => {
    const { token } = req.params;
    const payload = verifyDownloadToken(token);
    if (!payload) return res.status(410).json({ error: 'Link hết hạn hoặc không hợp lệ' });
    res.json({
        success: true,
        order_code: payload.o,
        product_name: payload.n,
        files: (payload.f || []).map((f, i) => ({
            index: i,
            label: f.l,
            name: f.n,
            size: f.s,
            url: '/api/dl/' + encodeURIComponent(token) + '?i=' + i
        }))
    });
});

app.get('/api/dl/:token', async (req, res) => {
    const plain = (code, msg) => res.status(code).type('text/plain; charset=utf-8').send(msg);

    const payload = verifyDownloadToken(req.params.token);
    if (!payload) return plain(410, 'Link hết hạn hoặc không hợp lệ');

    const idx = parseInt(req.query.i || 0);
    const f = Number.isInteger(idx) && idx >= 0 && payload.f && payload.f[idx];
    if (!f) return plain(404, 'File không tồn tại');

    // File host ngoài (MEGA) → chuyển hướng
    if (f.u) {
        if (!isMegaUrl(f.u)) return plain(404, 'Link không hợp lệ');
        return res.redirect(f.u);
    }

    // File Google Drive → STREAM QUA SERVER (service account).
    // KHÔNG redirect sang drive.google.com/uc: file private nên Google trả trang HTML đăng nhập → trình duyệt lưu thành .htm
    if (!f.i) return plain(404, 'File không tồn tại');
    try {
        await sendDriveFile(req, res, { id: f.i, name: f.n, mime: f.m, size: f.s });
    } catch (e) {
        sendDownloadError(res, e, 'signed-dl');
    }
});

app.get('/api/order-files/:token', (req, res) => {
    const { token } = req.params;

    if (token.includes('.')) {
        const payload = verifyDownloadToken(token);
        if (!payload) return res.status(410).json({ error: 'Hết hạn hoặc không hợp lệ' });
        return res.json({
            success: true,
            order_code: payload.o,
            product_name: payload.n,
            game: '',
            files: (payload.f || []).map((f, i) => ({
                index: i, label: f.l, name: f.n, size: f.s,
                url: '/api/dl/' + encodeURIComponent(token) + '?i=' + i
            }))
        });
    }

    if (!token || token.length !== 64) return res.status(400).json({ error: 'Token sai' });

    const o = db.orders.find(x => x.download_token === token);
    if (!o) return res.status(404).json({ error: 'Link không tồn tại' });
    if (o.status !== 'delivered') return res.status(403).json({ error: 'Chưa thanh toán' });
    if (o.token_exp && o.token_exp <= Date.now()) return res.status(410).json({ error: 'Link hết hạn' });

    const p = db.products.find(x => x.id === o.product_id);
    const files = (p && p.files) || [];

    res.json({
        success: true,
        order_code: o.order_code,
        product_name: p ? p.name : '',
        game: p ? p.game : '',
        files: files.map((f, i) => ({
            index: i,
            label: f.label || `File ${i + 1}`,
            name: f.name || `file_${i + 1}.ipa`,
            size: f.size || null,
            url: `/api/file/${token}/${i}`
        }))
    });
});

app.get('/api/file/:token/:index', async (req, res) => {
    const plain = (code, msg) => res.status(code).type('text/plain; charset=utf-8').send(msg);
    try {
        const { token, index } = req.params;
        if (!token || token.length !== 64) return plain(400, 'Token sai');
        const idx = parseInt(index);
        if (isNaN(idx) || idx < 0) return plain(400, 'Index sai');

        const o = db.orders.find(x => x.download_token === token);
        if (!o) return plain(404, 'Link không tồn tại');
        if (o.status !== 'delivered') return plain(403, 'Chưa thanh toán');
        if (o.token_exp && o.token_exp <= Date.now()) return plain(410, 'Link hết hạn');
        if (o.max_dl && o.downloads >= o.max_dl) return plain(429, 'Hết lượt tải');

        const p = db.products.find(x => x.id === o.product_id);
        const f = (p && p.files && p.files[idx]);
        if (!f) return plain(404, 'File không tồn tại');

        // chỉ tính lượt tải với request đầu (không tính các request Range tiếp theo)
        const isContinuation = req.headers.range && !/^bytes=0-/.test(req.headers.range);
        if (!isContinuation) {
            o.downloads = (o.downloads || 0) + 1;
            saveDB();
        }

        if (f.url) {
            if (!isMegaUrl(f.url)) return plain(404, 'Link không hợp lệ');
            return res.redirect(f.url);
        }
        if (!f.file_id) return plain(404, 'File không tồn tại');

        await sendDriveFile(req, res, {
            id: f.file_id,
            name: f.name || `${p.name}_${idx + 1}.ipa`,
            mime: f.mime,
            size: f.size
        });
    } catch (e) {
        sendDownloadError(res, e, 'proxy');
    }
});

app.get('/api/file/:token', (req, res) => {
    res.redirect(`/api/file/${encodeURIComponent(req.params.token)}/0`);
});

// ============================================================
//  USER DOWNLOADS
// ============================================================
app.get('/api/my-downloads', requireLogin, (req, res) => {
    const rows = db.orders
        .filter(o => o.customer_email === req.user.email || o.user_id === req.user.id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .map(o => {
            const p = db.products.find(x => x.id === o.product_id);
            let freshToken = o.download_token;
            if (o.status === 'delivered') {
                freshToken = makeDownloadToken(
                    o.order_code,
                    (p && p.files) || [],
                    p ? p.name : '',
                    7 * 24 * 3600 * 1000
                );
            }
            return {
                id: o.id, order_code: o.order_code, status: o.status,
                paid_at: o.paid_at, download_token: freshToken,
                amount: o.amount, created_at: o.created_at,
                product_name: p ? p.name : '',
                game: p ? p.game : '',
                video_url: p ? p.video_url : ''
            };
        });
    res.json({ downloads: rows });
});

// ============================================================
//  ADMIN
// ============================================================
app.post('/api/admin/login', (req, res) => {
    try {
        if (!rateLimit('admin:' + req.ip, 10, 15 * 60 * 1000)) {
            return res.status(429).json({ error: 'Thử quá nhiều lần, đợi 15 phút' });
        }
        const username = sanitize(req.body.username);
        const password = req.body.password;

        if (!username || typeof password !== 'string' || !password) return res.status(400).json({ error: 'Thiếu thông tin' });

        const a = db.users.find(x => x.username === username && x.is_admin);
        if (!a || !verifyPassword(password, a.password_hash)) {
            return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
        }

        res.cookie('isAdmin', a.id, COOKIE_OPTS);
        res.cookie('uid', a.id, COOKIE_OPTS);
        res.json({
            success: true,
            token: signToken('u', a.id),
            admin_token: signToken('a', a.id),
            user: { id: a.id, username: a.username, email: a.email, is_admin: true }
        });
    } catch (e) {
        console.error('[admin-login]', e);
        res.status(500).json({ error: 'Lỗi: ' + e.message });
    }
});

app.post('/api/admin/upload-product', requireAdmin, (req, res) => {
    try {
        const name = sanitize(req.body.name);
        const game = sanitize(req.body.game);
        const price = parseInt(req.body.price);
        const video_url = sanitize(req.body.video_url || '');
        const rawFiles = Array.isArray(req.body.files) ? req.body.files : [];

        if (!name || !game || !price) return res.status(400).json({ error: 'Thiếu thông tin' });
        if (!rawFiles.length) return res.status(400).json({ error: 'Cần ít nhất 1 file' });

        const files = [];
        for (const f of rawFiles) {
            const rawUrl = String(f.url || '').trim().slice(0, 1000);
            const base = {
                label: sanitize(f.label || 'File'),
                name: sanitize(f.name || `${name}_${files.length + 1}.ipa`),
                mime: sanitize(f.mime || 'application/octet-stream'),
                size: parseInt(f.size) || null
            };

            if (isMegaUrl(rawUrl)) {
                files.push({ ...base, file_id: null, url: rawUrl });
                continue;
            }

            const fileId = extractDriveId(rawUrl);
            if (!fileId) return res.status(400).json({ error: `Link Drive/MEGA sai: ${rawUrl || '(trống)'}` });
            files.push({ ...base, file_id: fileId });
        }

        const product = {
            id: db.nextProductId++,
            name, game, price, files, video_url,
            created_at: new Date().toISOString()
        };
        db.products.push(product);
        saveDB();

        res.json({ success: true, id: product.id, file_count: files.length });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Lỗi: ' + e.message });
    }
});

app.get('/api/admin/products', requireAdmin, (req, res) => {
    res.json(db.products.slice().reverse().map(p => ({
        id: p.id, name: p.name, game: p.game, price: p.price,
        video_url: p.video_url, created_at: p.created_at,
        file_count: (p.files || []).length, files: p.files || []
    })));
});

// Kiểm tra từng file Drive có tải được không + cho biết email service account cần share
app.get('/api/admin/check-drive', requireAdmin, async (req, res) => {
    try {
        let serviceAccount = null;
        try { serviceAccount = (await driveAuth.getCredentials()).client_email || null; } catch {}

        const out = [];
        for (const p of db.products) {
            for (const [i, f] of (p.files || []).entries()) {
                const row = { product_id: p.id, product: p.name, index: i, label: f.label };
                if (f.url) {
                    out.push({ ...row, type: 'external', ok: isMegaUrl(f.url) });
                    continue;
                }
                try {
                    const m = await getDriveMeta(f.file_id, true);
                    out.push({ ...row, type: 'drive', ok: true, drive_name: m.name, size: Number(m.size) || null });
                } catch (e) {
                    out.push({ ...row, type: 'drive', ok: false, error: driveErrorInfo(e).msg });
                }
            }
        }
        res.json({
            share_drive_files_with: serviceAccount,
            all_ok: out.every(x => x.ok),
            files: out
        });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi: ' + e.message });
    }
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
    res.json(db.orders.slice().reverse().slice(0, 200).map(o => {
        const p = db.products.find(x => x.id === o.product_id);
        return {
            id: o.id, order_code: o.order_code, user_email: o.customer_email,
            status: o.status, amount: o.amount, created_at: o.created_at,
            download_token: o.download_token,
            product_name: p ? p.name : '',
            game: p ? p.game : ''
        };
    }));
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
    res.json(db.users.slice().reverse().map(u => ({
        id: u.id, username: u.username, email: u.email,
        is_banned: u.is_banned, is_admin: u.is_admin, created_at: u.created_at
    })));
});

app.post('/api/admin/delete-product/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    db.products = db.products.filter(p => p.id !== id);
    saveDB();
    res.json({ success: true });
});

app.post('/api/admin/confirm-order/:code', requireAdmin, async (req, res) => {
    try {
        const o = db.orders.find(x => x.order_code === req.params.code);
        if (!o) return res.status(404).json({ error: 'Không tồn tại' });
        if (o.status === 'delivered') return res.json({ success: true, already: true });

        o.status = 'delivered';
        o.paid_at = new Date().toISOString();

        const p = db.products.find(x => x.id === o.product_id);
        const signedToken = makeDownloadToken(
            o.order_code,
            (p && p.files) || [],
            p ? p.name : '',
            7 * 24 * 3600 * 1000
        );
        o.signed_token = signedToken;
        saveDB();

        const link = `${BASE_URL}/download.html?t=${signedToken}`;
        if (resend) {
            try {
                await resend.emails.send({
                    from: FROM_EMAIL, to: o.customer_email,
                    subject: `Đơn ${o.order_code} — Link tải ${p ? p.name : ''}`,
                    html: `<p>Đơn <b>${o.order_code}</b> đã thanh toán.</p><p><a href="${link}">MỞ TRANG TẢI</a></p>`
                });
            } catch (e) { console.error('mail fail:', e.message); }
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi: ' + e.message });
    }
});

app.post('/api/admin/reject-order/:code', requireAdmin, (req, res) => {
    const o = db.orders.find(x => x.order_code === req.params.code);
    if (o) { o.status = 'rejected'; saveDB(); }
    res.json({ success: true });
});

app.post('/api/admin/delete-order/:code', requireAdmin, (req, res) => {
    db.orders = db.orders.filter(o => o.order_code !== req.params.code);
    saveDB();
    res.json({ success: true });
});

app.post('/api/admin/ban-user/:id', requireAdmin, (req, res) => {
    const u = db.users.find(x => x.id === parseInt(req.params.id));
    if (u && !u.is_admin) { u.is_banned = 1; saveDB(); }
    res.json({ success: true });
});

app.post('/api/admin/unban-user/:id', requireAdmin, (req, res) => {
    const u = db.users.find(x => x.id === parseInt(req.params.id));
    if (u) { u.is_banned = 0; saveDB(); }
    res.json({ success: true });
});

// ============================================================
//  404 + ERROR
// ============================================================
app.use((req, res) => res.status(404).send('Không tìm thấy'));
app.use((err, req, res, next) => {
    console.error('[FATAL]', err);
    res.status(500).json({ error: 'Lỗi server' });
});

// ============================================================
//  BOOT
// ============================================================
(async () => {
    console.log('[BOOT] Loading DB from Upstash...');
    try {
        db = await loadDB();
    } catch (e) {
        if (process.env.ALLOW_EMPTY_DB === '1') {
            console.error('[BOOT] Không đọc được DB, ALLOW_EMPTY_DB=1 nên chạy với DB rỗng');
            db = emptyDB();
        } else {
            console.error('[BOOT] Không đọc được DB từ Upstash → DỪNG để không ghi đè dữ liệu thật:', e.message);
            process.exit(1);
        }
    }
    dbReady = true;
    console.log('[DB] ready —', db.users.length, 'users,', db.products.length, 'products,', db.orders.length, 'orders');
    ensureAdmin();

    app.listen(PORT, () => console.log(`[+] http://localhost:${PORT}`));
})();