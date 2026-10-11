// QM MOD iOS — Backend v17 (Resend email)
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
    console.warn('[WARN] Chưa đặt COOKIE_SECRET');
}

// ===== RESEND =====
const resend = new Resend(process.env.RESEND_API_KEY);
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
            /\.(env|json|key|pem|log)$/i.test(s)
        );
        if (bad && !p.startsWith('/api/')) return res.status(404).send('Không tìm thấy');
        next();
    });
}
app.use(express.static(HAS_PUBLIC ? PUBLIC_DIR : __dirname, { dotfiles: 'ignore' }));

// ===== JSON DB =====
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'database.json');

function emptyDB() {
    return { users: [], products: [], orders: [], nextUserId: 1, nextProductId: 1, nextOrderId: 1 };
}

function loadDB() {
    try {
        if (!fs.existsSync(DB_FILE)) throw new Error('no file');
        const raw = fs.readFileSync(DB_FILE, 'utf8').trim();
        if (!raw) throw new Error('empty');
        const d = JSON.parse(raw);
        const orders = Array.isArray(d.orders) ? d.orders : [];
        const maxOrderId = orders.reduce((m, o) => Math.max(m, Number(o.id) || 0), 0);
        return {
            users: Array.isArray(d.users) ? d.users : [],
            products: Array.isArray(d.products) ? d.products : [],
            orders,
            nextUserId: Number(d.nextUserId) || 1,
            nextProductId: Number(d.nextProductId) || 1,
            nextOrderId: Number(d.nextOrderId) || (maxOrderId + 1)
        };
    } catch (e) {
        console.warn('[DB] reset:', e.message);
        try {
            if (fs.existsSync(DB_FILE) && fs.readFileSync(DB_FILE, 'utf8').trim()) {
                fs.renameSync(DB_FILE, DB_FILE + '.corrupt-' + Date.now());
            }
        } catch {}
        return emptyDB();
    }
}

function saveDB(data) {
    try {
        const tmp = DB_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, DB_FILE);
    } catch (e) {
        console.error('[DB] save fail:', e.message);
    }
}

// ===== PASSWORD =====
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

// Rate limit in-memory
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

// ===== LOAD DB + ADMIN =====
let db = loadDB();

(function ensureAdmin() {
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
        saveDB(db);
        console.log('[DB] Đã tạo admin. Tài khoản: admin');
        if (!envPass) console.log('[DB] Mật khẩu admin (chỉ hiện 1 lần):', pass);
    } else if (envPass && !verifyPassword(envPass, a.password_hash)) {
        a.password_hash = hashPassword(envPass);
        a.is_banned = 0;
        saveDB(db);
        console.log('[DB] Đã cập nhật mật khẩu admin theo ADMIN_PASSWORD');
    }
})();
console.log('[DB] ready —', db.users.length, 'users,', db.products.length, 'products');

// ===== DRIVE =====
const driveAuth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || './drive-service.json',
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
});
const drive = google.drive({ version: 'v3', auth: driveAuth });

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
//  AUTH USER
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
            username,
            email,
            password_hash: hashPassword(password),
            reset_token: null,
            reset_expires: null,
            is_banned: 0,
            is_admin: false,
            created_at: new Date().toISOString()
        };
        db.users.push(user);
        saveDB(db);

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

// ===== FORGOT — DÙNG RESEND =====
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
        saveDB(db);

        const link = `${BASE_URL}/reset.html?token=${token}`;
        try {
            const result = await resend.emails.send({
                from: FROM_EMAIL,
                to: email,
                subject: 'Đặt lại mật khẩu',
                html: `<p>Xin chào <b>${u.username}</b>,</p><p><a href="${link}">ĐẶT LẠI MẬT KHẨU</a> (30 phút)</p>`
            });
            console.log('[forgot] Resend:', JSON.stringify(result));
        } catch (mailErr) {
            console.error('[forgot] Resend error:', mailErr.message);
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
        saveDB(db);
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
        uptime_seconds: Math.round(process.uptime()),
        cookie_secret_from_env: !!process.env.COOKIE_SECRET,
        db_file_custom: !!process.env.DB_FILE,
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
        saveDB(db);

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
        saveDB(db);

        const product = db.products.find(x => x.id === order.product_id);
        const link = `${BASE_URL}/download.html?token=${order.download_token}`;

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

        res.json({ ok: true, matched: true, delivered: true });
    } catch (e) {
        console.error('[sepay]', e);
        res.status(500).json({ error: 'Lỗi' });
    }
});

// ============================================================
//  DOWNLOAD
// ============================================================
app.get('/api/order-files/:token', (req, res) => {
    const { token } = req.params;
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
    try {
        const { token, index } = req.params;
        if (!token || token.length !== 64) return res.status(400).json({ error: 'Token sai' });
        const idx = parseInt(index);
        if (isNaN(idx) || idx < 0) return res.status(400).json({ error: 'Index sai' });

        const o = db.orders.find(x => x.download_token === token);
        if (!o) return res.status(404).json({ error: 'Link không tồn tại' });
        if (o.status !== 'delivered') return res.status(403).json({ error: 'Chưa thanh toán' });
        if (o.token_exp && o.token_exp <= Date.now()) return res.status(410).json({ error: 'Link hết hạn' });
        if (o.max_dl && o.downloads >= o.max_dl) return res.status(429).json({ error: 'Hết lượt tải' });

        const p = db.products.find(x => x.id === o.product_id);
        const f = (p && p.files && p.files[idx]);
        if (!f || !f.file_id) return res.status(404).json({ error: 'File không tồn tại' });

        o.downloads = (o.downloads || 0) + 1;
        saveDB(db);

        const dr = await drive.files.get({ fileId: f.file_id, alt: 'media' }, { responseType: 'stream' });
        const safe = String(f.name || `${p.name}_${idx + 1}.ipa`).replace(/[^\x20-\x7E]/g, '_').replace(/[\r\n"]/g, '');

        res.setHeader('Content-Type', f.mime || 'application/octet-stream');
        if (f.size) res.setHeader('Content-Length', String(f.size));
        res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
        res.setHeader('Cache-Control', 'private, no-store');
        await pipeline(dr.data, res);
    } catch (e) {
        console.error('[proxy]', e.message);
        if (!res.headersSent) res.status(502).json({ error: 'Lỗi tải file' });
        else res.destroy();
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
            return {
                id: o.id, order_code: o.order_code, status: o.status,
                paid_at: o.paid_at, download_token: o.download_token,
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
            const fileId = extractDriveId(f.url || '');
            if (!fileId) return res.status(400).json({ error: `Link Drive sai: ${f.url || '(trống)'}` });
            files.push({
                label: sanitize(f.label || 'File'),
                file_id: fileId,
                name: sanitize(f.name || `${name}_${files.length + 1}.ipa`),
                mime: sanitize(f.mime || 'application/octet-stream'),
                size: parseInt(f.size) || null
            });
        }

        const product = {
            id: db.nextProductId++,
            name, game, price, files, video_url,
            created_at: new Date().toISOString()
        };
        db.products.push(product);
        saveDB(db);

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
    saveDB(db);
    res.json({ success: true });
});

app.post('/api/admin/confirm-order/:code', requireAdmin, async (req, res) => {
    try {
        const o = db.orders.find(x => x.order_code === req.params.code);
        if (!o) return res.status(404).json({ error: 'Không tồn tại' });
        if (o.status === 'delivered') return res.json({ success: true, already: true });

        o.status = 'delivered';
        o.paid_at = new Date().toISOString();
        saveDB(db);

        const p = db.products.find(x => x.id === o.product_id);
        const link = `${BASE_URL}/download.html?token=${o.download_token}`;

        try {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: o.customer_email,
                subject: `Đơn ${o.order_code} — Link tải ${p ? p.name : ''}`,
                html: `<p>Đơn <b>${o.order_code}</b> đã thanh toán.</p><p><a href="${link}">MỞ TRANG TẢI</a></p>`
            });
        } catch (e) { console.error('mail fail:', e.message); }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi: ' + e.message });
    }
});

app.post('/api/admin/reject-order/:code', requireAdmin, (req, res) => {
    const o = db.orders.find(x => x.order_code === req.params.code);
    if (o) { o.status = 'rejected'; saveDB(db); }
    res.json({ success: true });
});

app.post('/api/admin/delete-order/:code', requireAdmin, (req, res) => {
    db.orders = db.orders.filter(o => o.order_code !== req.params.code);
    saveDB(db);
    res.json({ success: true });
});

app.post('/api/admin/ban-user/:id', requireAdmin, (req, res) => {
    const u = db.users.find(x => x.id === parseInt(req.params.id));
    if (u && !u.is_admin) { u.is_banned = 1; saveDB(db); }
    res.json({ success: true });
});

app.post('/api/admin/unban-user/:id', requireAdmin, (req, res) => {
    const u = db.users.find(x => x.id === parseInt(req.params.id));
    if (u) { u.is_banned = 0; saveDB(db); }
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

app.listen(PORT, () => console.log(`[+] http://localhost:${PORT}`));