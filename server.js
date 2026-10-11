// QM MOD iOS — Backend v5 (multi-file IPA)
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { google } = require('googleapis');
const { pipeline } = require('stream/promises');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use(express.static(path.join(__dirname)));

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false });
app.use('/api', globalLimiter);
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
const orderLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20 });

// ===== DB =====
const db = new Database(path.join(__dirname, 'users.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        reset_token TEXT,
        reset_expires INTEGER,
        is_banned INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        game TEXT NOT NULL,
        price INTEGER NOT NULL,
        files TEXT,
        video_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        customer_email TEXT,
        product_id INTEGER NOT NULL,
        order_code TEXT UNIQUE NOT NULL,
        download_token TEXT UNIQUE,
        token_exp INTEGER,
        downloads INTEGER DEFAULT 0,
        max_dl INTEGER DEFAULT 10,
        amount INTEGER,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        paid_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS security_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT, action TEXT, detail TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Migration cũ → mới
const pCols = db.prepare(`PRAGMA table_info(products)`).all().map(c => c.name);
if (!pCols.includes('files')) db.exec(`ALTER TABLE products ADD COLUMN files TEXT`);
const oCols = db.prepare(`PRAGMA table_info(orders)`).all().map(c => c.name);
if (!oCols.includes('token_exp')) db.exec(`ALTER TABLE orders ADD COLUMN token_exp INTEGER`);
if (!oCols.includes('downloads')) db.exec(`ALTER TABLE orders ADD COLUMN downloads INTEGER DEFAULT 0`);
if (!oCols.includes('max_dl'))    db.exec(`ALTER TABLE orders ADD COLUMN max_dl INTEGER DEFAULT 10`);
if (!oCols.includes('amount'))    db.exec(`ALTER TABLE orders ADD COLUMN amount INTEGER`);

const adminExists = db.prepare('SELECT id FROM admins WHERE username = ?').get('admin');
if (!adminExists) {
    bcrypt.hash('admin123', 10).then(h => db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run('admin', h));
}
console.log('[DB] ready');

// ===== HELPERS =====
function logSecurity(req, action, detail = '') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    try { db.prepare('INSERT INTO security_logs (ip, action, detail) VALUES (?, ?, ?)').run(ip, action, detail); } catch {}
}
function validateEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function sanitize(s) { return typeof s === 'string' ? s.replace(/[<>]/g, '').trim().slice(0, 500) : ''; }
function extractDriveId(url) {
    if (!url) return null;
    let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
    if (m) return m[1];
    m = url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
    return m ? m[1] : null;
}

// ===== DRIVE =====
const driveAuth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || './drive-service.json',
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
});
const drive = google.drive({ version: 'v3', auth: driveAuth });

// ===== MAIL =====
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
});

// ===== MIDDLEWARE =====
function requireLogin(req, res, next) {
    if (!req.cookies.uid) return res.status(401).json({ error: 'Chưa đăng nhập' });
    try {
        const u = db.prepare('SELECT id,username,email,is_banned FROM users WHERE id=?').get(req.cookies.uid);
        if (!u || u.is_banned) return res.status(403).json({ error: 'Không hợp lệ' });
        req.user = u; next();
    } catch { res.status(500).json({ error: 'Lỗi server' }); }
}
function requireAdmin(req, res, next) {
    if (!req.cookies.isAdmin) return res.status(403).json({ error: 'Không có quyền' });
    next();
}

// ===== AUTH =====
app.post('/api/register', registerLimiter, async (req, res) => {
    const username = sanitize(req.body.username);
    const email = sanitize(req.body.email).toLowerCase();
    const password = req.body.password;
    if (!username || !email || !password) return res.status(400).json({ error: 'Thiếu thông tin' });
    if (username.length < 3 || username.length > 30) return res.status(400).json({ error: 'Tên 3-30 ký tự' });
    if (!validateEmail(email)) return res.status(400).json({ error: 'Email sai' });
    if (password.length < 6) return res.status(400).json({ error: 'Pass 6+ ký tự' });
    try {
        const hash = await bcrypt.hash(password, 12);
        const r = db.prepare('INSERT INTO users (username,email,password_hash) VALUES (?,?,?)').run(username, email, hash);
        res.json({ success: true, user: { id: r.lastInsertRowid, username, email } });
    } catch (e) {
        if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'Tên/Email đã tồn tại' });
        res.status(500).json({ error: 'Lỗi server' });
    }
});

app.post('/api/login', loginLimiter, async (req, res) => {
    const email = sanitize(req.body.email).toLowerCase();
    const password = req.body.password;
    try {
        const u = db.prepare('SELECT * FROM users WHERE email=? OR username=?').get(email, email);
        if (!u) return res.status(401).json({ error: 'Sai thông tin' });
        if (u.is_banned) return res.status(403).json({ error: 'Bị khoá' });
        if (!await bcrypt.compare(password, u.password_hash)) return res.status(401).json({ error: 'Sai thông tin' });
        res.cookie('uid', u.id, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 7*24*3600*1000 });
        res.json({ success: true, user: { id: u.id, username: u.username, email: u.email } });
    } catch { res.status(500).json({ error: 'Lỗi server' }); }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('uid'); res.clearCookie('isAdmin');
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    if (!req.cookies.uid) return res.status(401).json({ error: 'Chưa đăng nhập' });
    try {
        const u = db.prepare('SELECT id,username,email FROM users WHERE id=?').get(req.cookies.uid);
        if (!u) return res.status(401).json({ error: 'Không tìm thấy' });
        res.json({ user: u });
    } catch { res.status(500).json({ error: 'Lỗi server' }); }
});

app.post('/api/forgot', loginLimiter, async (req, res) => {
    const email = sanitize(req.body.email).toLowerCase();
    if (!validateEmail(email)) return res.status(400).json({ error: 'Email sai' });
    try {
        const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if (!u) return res.status(404).json({ error: 'Email không tồn tại' });
        const token = crypto.randomBytes(32).toString('hex');
        db.prepare('UPDATE users SET reset_token=?, reset_expires=? WHERE id=?').run(token, Date.now()+30*60*1000, u.id);
        const link = `${process.env.BASE_URL || 'http://localhost:'+PORT}/reset.html?token=${token}`;
        await transporter.sendMail({
            from: `"QM MOD iOS" <${process.env.GMAIL_USER}>`, to: email,
            subject: 'Đặt lại mật khẩu',
            html: `<p>Xin chào <b>${u.username}</b>,</p><p><a href="${link}">ĐẶT LẠI MẬT KHẨU</a> (30 phút)</p>`
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Không gửi được mail' }); }
});

app.post('/api/reset', loginLimiter, async (req, res) => {
    const token = sanitize(req.body.token), password = req.body.password;
    if (!token || !password || password.length < 6) return res.status(400).json({ error: 'Thiếu thông tin' });
    try {
        const u = db.prepare('SELECT * FROM users WHERE reset_token=? AND reset_expires>?').get(token, Date.now());
        if (!u) return res.status(400).json({ error: 'Token sai/hết hạn' });
        const hash = await bcrypt.hash(password, 12);
        db.prepare('UPDATE users SET password_hash=?, reset_token=NULL, reset_expires=NULL WHERE id=?').run(hash, u.id);
        res.json({ success: true });
    } catch { res.status(500).json({ error: 'Lỗi server' }); }
});

// ===== PRODUCTS =====
app.get('/api/products', (req, res) => {
    try { res.json(db.prepare('SELECT id,name,game,price,video_url FROM products ORDER BY id DESC').all()); }
    catch { res.status(500).json({ error: 'Lỗi server' }); }
});

app.get('/api/products/:id', (req, res) => {
    try {
        const p = db.prepare('SELECT id,name,game,price,video_url FROM products WHERE id=?').get(req.params.id);
        if (!p) return res.status(404).json({ error: 'Không tồn tại' });
        res.json(p);
    } catch { res.status(500).json({ error: 'Lỗi server' }); }
});

// ===== CHECKOUT =====
app.post('/api/checkout', orderLimiter, (req, res) => {
    const product_id = parseInt(req.body.product_id);
    const customer_email = sanitize(req.body.customer_email || '').toLowerCase();
    if (!product_id) return res.status(400).json({ error: 'Thiếu product_id' });
    if (!validateEmail(customer_email)) return res.status(400).json({ error: 'Email sai' });

    try {
        const product = db.prepare('SELECT * FROM products WHERE id=?').get(product_id);
        if (!product) return res.status(404).json({ error: 'Sản phẩm không tồn tại' });

        const orderCode = 'QM' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const downloadToken = crypto.randomBytes(32).toString('hex');
        const amount = product.price;

        db.prepare(`INSERT INTO orders (customer_email, product_id, order_code, download_token, token_exp, amount, status) VALUES (?,?,?,?,?,?, 'pending')`)
          .run(customer_email, product_id, orderCode, downloadToken, Date.now()+7*24*3600*1000, amount);

        const bankName = process.env.BANK_NAME || 'MB';
        const bank = process.env.BANK_ACCOUNT || '0383415468';
        const qr = `https://img.vietqr.io/image/${bankName}-${bank}-compact2.png?amount=${amount}&addInfo=${orderCode}`;

        res.json({
            success: true, order_code: orderCode, amount,
            product_name: product.name, game: product.game,
            bank_account: bank, bank_name: bankName, qr, transfer_content: orderCode
        });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Lỗi server' }); }
});

// ===== ORDER STATUS =====
app.get('/api/order/:code/status', (req, res) => {
    try {
        const o = db.prepare('SELECT order_code,status,paid_at FROM orders WHERE order_code=?').get(req.params.code);
        if (!o) return res.status(404).json({ error: 'Không tồn tại' });
        res.json({
            order_code: o.order_code, status: o.status,
            paid: o.status === 'paid' || o.status === 'delivered',
            delivered: o.status === 'delivered', paid_at: o.paid_at
        });
    } catch { res.status(500).json({ error: 'Lỗi server' }); }
});

// ===== SEPAY WEBHOOK =====
app.post('/api/sepay/webhook', express.json(), async (req, res) => {
    const auth = req.get('authorization') || '';
    if (auth !== `Apikey ${process.env.SEPAY_API_KEY}`) { console.warn('[sepay] bad auth'); return res.status(401).end(); }

    const b = req.body || {};
    const content = String(b.content || b.description || '');
    const amount = Number(b.transferAmount || b.amount || 0);
    console.log(`[sepay] +${amount} | "${content}"`);

    const m = content.match(/QM[A-F0-9]{8}/i);
    if (!m) return res.json({ ok: true, matched: false });

    const code = m[0].toUpperCase();
    const order = db.prepare(`SELECT o.*, p.name AS product_name, p.game FROM orders o JOIN products p ON o.product_id=p.id WHERE o.order_code=?`).get(code);
    if (!order) return res.json({ ok: true, matched: false, reason: 'not_found' });
    if (order.status === 'delivered') return res.json({ ok: true, matched: true, already: true });
    if (amount < (order.amount || 0)) return res.json({ ok: true, matched: true, underpaid: true });

    db.prepare(`UPDATE orders SET status='delivered', paid_at=CURRENT_TIMESTAMP WHERE id=?`).run(order.id);

    const link = `${process.env.BASE_URL || 'http://localhost:'+PORT}/download.html?token=${order.download_token}`;
    try {
        await transporter.sendMail({
            from: `"QM MOD iOS" <${process.env.GMAIL_USER}>`, to: order.customer_email,
            subject: `Đơn ${code} — Link tải ${order.product_name}`,
            html: `<div style="font-family:Arial;max-width:600px;margin:auto;padding:30px">
                <h2 style="color:#16a34a">✓ Thanh toán thành công</h2>
                <p>Đơn <b>${code}</b> — ${amount.toLocaleString('vi-VN')}đ</p>
                <p><b>${order.product_name}</b> (${order.game})</p>
                <a href="${link}" style="display:inline-block;padding:14px 28px;background:#0a0a0a;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold">📥 MỞ TRANG TẢI</a>
                <p style="color:#666;font-size:13px">Link riêng, đừng share. Hết hạn 7 ngày. Cần ESign: muacert.com</p>
            </div>`
        });
        console.log(`[sepay] mail OK ${code}`);
    } catch (e) { console.error(`[sepay] mail fail:`, e.message); }

    res.json({ ok: true, matched: true, delivered: true });
});

// ============================================================
//  DOWNLOAD — LIST FILE + TẢI TỪNG FILE
// ============================================================
app.get('/api/order-files/:token', (req, res) => {
    const { token } = req.params;
    if (!token || token.length !== 64) return res.status(400).json({ error: 'Token sai' });
    try {
        const o = db.prepare(`
            SELECT o.status, o.token_exp, o.max_dl, o.downloads,
                   o.order_code, p.name AS product_name, p.game, p.files
            FROM orders o JOIN products p ON o.product_id=p.id
            WHERE o.download_token=?
        `).get(token);
        if (!o) return res.status(404).json({ error: 'Link không tồn tại' });
        if (o.status !== 'delivered') return res.status(403).json({ error: 'Chưa thanh toán' });
        if (o.token_exp && o.token_exp <= Date.now()) return res.status(410).json({ error: 'Link hết hạn' });

        let files = [];
        try { files = JSON.parse(o.files || '[]'); } catch {}

        res.json({
            success: true,
            order_code: o.order_code,
            product_name: o.product_name,
            game: o.game,
            files: files.map((f, i) => ({
                index: i,
                label: f.label || `File ${i + 1}`,
                name: f.name || `file_${i+1}.ipa`,
                size: f.size || null,
                url: `/api/file/${token}/${i}`
            }))
        });
    } catch { res.status(500).json({ error: 'Lỗi server' }); }
});

app.get('/api/file/:token/:index', async (req, res) => {
    const { token, index } = req.params;
    if (!token || token.length !== 64) return res.status(400).json({ error: 'Token sai' });
    const idx = parseInt(index);
    if (isNaN(idx) || idx < 0) return res.status(400).json({ error: 'Index sai' });

    try {
        const o = db.prepare(`
            SELECT o.*, p.name AS product_name, p.files
            FROM orders o JOIN products p ON o.product_id=p.id
            WHERE o.download_token=?
        `).get(token);
        if (!o) return res.status(404).json({ error: 'Link không tồn tại' });
        if (o.status !== 'delivered') return res.status(403).json({ error: 'Chưa thanh toán' });
        if (o.token_exp && o.token_exp <= Date.now()) return res.status(410).json({ error: 'Link hết hạn' });
        if (o.max_dl && o.downloads >= o.max_dl) return res.status(429).json({ error: 'Hết lượt tải' });

        let files = [];
        try { files = JSON.parse(o.files || '[]'); } catch {}
        const f = files[idx];
        if (!f || !f.file_id) return res.status(404).json({ error: 'File không tồn tại' });

        db.prepare(`UPDATE orders SET downloads=downloads+1 WHERE id=?`).run(o.id);

        const dr = await drive.files.get({ fileId: f.file_id, alt: 'media' }, { responseType: 'stream' });
        const safe = String(f.name || `${o.product_name}_${idx+1}.ipa`).replace(/[^\x20-\x7E]/g, '_').replace(/[\r\n"]/g, '');

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

// Backward compatible (file đầu tiên)
app.get('/api/file/:token', async (req, res) => {
    res.redirect(`/api/file/${req.params.token}/0`);
});

app.get('/api/download-by-token/:token', (req, res) => {
    const { token } = req.params;
    if (!token || token.length !== 64) return res.status(400).json({ error: 'Token sai' });
    try {
        const o = db.prepare(`SELECT o.order_code, o.token_exp, p.name AS product_name, p.game, p.video_url FROM orders o JOIN products p ON o.product_id=p.id WHERE o.download_token=?`).get(token);
        if (!o) return res.status(404).json({ error: 'Link không tồn tại' });
        if (o.token_exp && o.token_exp <= Date.now()) return res.status(410).json({ error: 'Hết hạn' });
        res.json({ success: true, product_name: o.product_name, game: o.game, video_url: o.video_url, order_code: o.order_code });
    } catch { res.status(500).json({ error: 'Lỗi server' }); }
});

// ===== USER DOWNLOADS =====
app.get('/api/my-downloads', requireLogin, (req, res) => {
    try {
        const rows = db.prepare(`SELECT o.id, o.order_code, o.status, o.paid_at, o.download_token, p.name AS product_name, p.game, p.video_url FROM orders o JOIN products p ON o.product_id=p.id WHERE o.customer_email=? OR o.user_id=? ORDER BY o.created_at DESC`).all(req.user.email, req.user.id);
        res.json({ downloads: rows });
    } catch { res.status(500).json({ error: 'Lỗi server' }); }
});

// ===== ADMIN =====
app.post('/api/admin/login', loginLimiter, async (req, res) => {
    const username = sanitize(req.body.username), password = req.body.password;
    try {
        const a = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
        if (!a || !await bcrypt.compare(password, a.password_hash)) return res.status(401).json({ error: 'Sai tài khoản' });
        res.cookie('isAdmin', a.id, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 7*24*3600*1000 });
        res.json({ success: true });
    } catch { res.status(500).json({ error: 'Lỗi server' }); }
});

// Nhập nhiều link Drive — body: { name, game, price, video_url, files: [{label, url, name, mime, size}] }
app.post('/api/admin/upload-product', requireAdmin, (req, res) => {
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
            name: sanitize(f.name || `${name}_${files.length+1}.ipa`),
            mime: sanitize(f.mime || 'application/octet-stream'),
            size: parseInt(f.size) || null
        });
    }

    try {
        const r = db.prepare(`INSERT INTO products (name,game,price,files,video_url) VALUES (?,?,?,?,?)`)
                    .run(name, game, price, JSON.stringify(files), video_url || null);
        res.json({ success: true, id: r.lastInsertRowid, file_count: files.length });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Lỗi server' }); }
});

app.get('/api/admin/products', requireAdmin, (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
        res.json(rows.map(p => {
            let files = [];
            try { files = JSON.parse(p.files || '[]'); } catch {}
            return { id: p.id, name: p.name, game: p.game, price: p.price, video_url: p.video_url, created_at: p.created_at, file_count: files.length, files };
        }));
    } catch { res.status(500).json({ error: 'Lỗi server' }); }
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
    try {
        const rows = db.prepare(`SELECT o.id, o.order_code, o.customer_email AS user_email, o.status, o.amount, o.created_at, o.download_token, p.name AS product_name, p.game FROM orders o JOIN products p ON o.product_id=p.id ORDER BY o.created_at DESC LIMIT 200`).all();
        res.json(rows);
    } catch { res.status(500).json({ error: 'Lỗi server' }); }
});

app.post('/api/admin/delete-product/:id', requireAdmin, (req, res) => {
    try { db.prepare('DELETE FROM products WHERE id=?').run(req.params.id); res.json({ success: true }); }
    catch { res.status(500).json({ error: 'Lỗi server' }); }
});

app.post('/api/admin/confirm-order/:code', requireAdmin, async (req, res) => {
    try {
        const o = db.prepare(`SELECT o.*, p.name AS product_name, p.game FROM orders o JOIN products p ON o.product_id=p.id WHERE o.order_code=?`).get(req.params.code);
        if (!o) return res.status(404).json({ error: 'Không tồn tại' });
        if (o.status === 'delivered') return res.json({ success: true, already: true });
        db.prepare(`UPDATE orders SET status='delivered', paid_at=CURRENT_TIMESTAMP WHERE id=?`).run(o.id);

        const link = `${process.env.BASE_URL || 'http://localhost:'+PORT}/download.html?token=${o.download_token}`;
        try {
            await transporter.sendMail({
                from: `"QM MOD iOS" <${process.env.GMAIL_USER}>`, to: o.customer_email,
                subject: `Đơn ${o.order_code} — Link tải ${o.product_name}`,
                html: `<p>Đơn <b>${o.order_code}</b> đã thanh toán.</p><p><a href="${link}">📥 MỞ TRANG TẢI</a></p>`
            });
        } catch (e) { console.error('mail fail:', e.message); }
        res.json({ success: true });
    } catch { res.status(500).json({ error: 'Lỗi server' }); }
});

app.post('/api/admin/reject-order/:code', requireAdmin, (req, res) => {
    try {
        db.prepare(`UPDATE orders SET status='rejected' WHERE order_code=?`).run(req.params.code);
        res.json({ success: true });
    } catch { res.status(500).json({ error: 'Lỗi server' }); }
});

app.post('/api/admin/delete-order/:code', requireAdmin, (req, res) => {
    try { db.prepare('DELETE FROM orders WHERE order_code=?').run(req.params.code); res.json({ success: true }); }
    catch { res.status(500).json({ error: 'Lỗi server' }); }
});

app.post('/api/admin/ban-user/:id', requireAdmin, (req, res) => {
    try { db.prepare('UPDATE users SET is_banned=1 WHERE id=?').run(req.params.id); res.json({ success: true }); }
    catch { res.status(500).json({ error: 'Lỗi server' }); }
});

app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
    const { old_password, new_password } = req.body || {};
    if (!old_password || !new_password || new_password.length < 6)
        return res.status(400).json({ error: 'Thiếu thông tin hoặc pass < 6 ký tự' });
    const adminId = req.cookies.isAdmin;
    const admin = db.prepare('SELECT * FROM admins WHERE id=?').get(adminId);
    if (!admin || !await bcrypt.compare(old_password, admin.password_hash))
        return res.status(401).json({ error: 'Pass cũ sai' });
    const hash = await bcrypt.hash(new_password, 12);
    db.prepare('UPDATE admins SET password_hash=? WHERE id=?').run(hash, adminId);
    res.json({ success: true });
});

app.get('/api/admin/security-logs', requireAdmin, (req, res) => {
    try { res.json(db.prepare('SELECT * FROM security_logs ORDER BY id DESC LIMIT 200').all()); }
    catch { res.status(500).json({ error: 'Lỗi server' }); }
});

// TEMP reset
app.get('/reset-admin-temp', async (req, res) => {
    if (req.query.key !== 'reset-shopweb-2026') return res.status(403).send('Nope');
    const hash = await bcrypt.hash('admin123', 10);
    db.prepare('UPDATE admins SET password_hash=? WHERE username=?').run(hash, 'admin');
    res.send('OK — admin / admin123');
});

app.use((req, res) => res.status(404).send('Không tìm thấy'));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Lỗi server' }); });

app.listen(PORT, () => console.log(`[+] http://localhost:${PORT}`));