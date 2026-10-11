// QM MOD iOS — Backend v13 (ZERO native module)
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { google } = require('googleapis');
const { pipeline } = require('stream/promises');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use(express.static(__dirname));

// ===== JSON DB =====
const DB_FILE = path.join(__dirname, 'database.json');

function loadDB() {
    try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const d = JSON.parse(raw);
        return {
            users: d.users || [],
            products: d.products || [],
            orders: d.orders || [],
            nextUserId: d.nextUserId || 1,
            nextProductId: d.nextProductId || 1
        };
    } catch {
        return { users: [], products: [], orders: [], nextUserId: 1, nextProductId: 1 };
    }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

let db = loadDB();
console.log('[DB] ready —', db.users.length, 'users,', db.products.length, 'products');

// ===== PASSWORD HASH (crypto built-in) =====
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return salt + ':' + hash;
}

function verifyPassword(password, stored) {
    try {
        const [salt, hash] = stored.split(':');
        const check = crypto.scryptSync(password, salt, 64).toString('hex');
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
    } catch {
        return false;
    }
}

// ===== HELPERS =====
function validateEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function sanitize(s) { return typeof s === 'string' ? s.replace(/[<>]/g, '').trim().slice(0, 500) : ''; }
function extractDriveId(url) {
    if (!url) return null;
    let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
    if (m) return m[1];
    m = url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
    return m ? m[1] : null;
}

const COOKIE_OPTS = {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 7 * 24 * 3600 * 1000,
    path: '/'
};

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
    const u = db.users.find(x => x.id === parseInt(req.cookies.uid));
    if (!u || u.is_banned) return res.status(403).json({ error: 'Không hợp lệ' });
    req.user = u;
    next();
}

function requireAdmin(req, res, next) {
    if (!req.cookies.isAdmin) return res.status(403).json({ error: 'Không có quyền' });
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

        console.log('[register]', email);

        if (!email || !password) return res.status(400).json({ error: 'Thiếu thông tin' });
        if (!validateEmail(email)) return res.status(400).json({ error: 'Email sai' });
        if (password.length < 6) return res.status(400).json({ error: 'Pass 6+ ký tự' });

        if (db.users.find(u => u.email === email)) {
            return res.status(400).json({ error: 'Email đã tồn tại' });
        }

        const user = {
            id: db.nextUserId++,
            username,
            email,
            password_hash: hashPassword(password),
            reset_token: null,
            reset_expires: null,
            is_banned: 0,
            created_at: new Date().toISOString()
        };
        db.users.push(user);
        saveDB(db);

        res.cookie('uid', user.id, COOKIE_OPTS);
        console.log('[register] success:', email);
        res.json({ success: true, user: { id: user.id, username, email } });
    } catch (e) {
        console.error('[register] ERROR:', e.message);
        res.status(500).json({ error: 'Lỗi: ' + e.message });
    }
});

app.post('/api/login', (req, res) => {
    try {
        const email = sanitize(req.body.email).toLowerCase();
        const password = req.body.password;

        console.log('[login]', email);

        if (!email || !password) return res.status(400).json({ error: 'Thiếu thông tin' });

        const u = db.users.find(x => x.email === email || x.username === email);
        if (!u) return res.status(401).json({ error: 'Sai thông tin' });
        if (u.is_banned) return res.status(403).json({ error: 'Bị khoá' });

        if (!verifyPassword(password, u.password_hash)) {
            return res.status(401).json({ error: 'Sai thông tin' });
        }

        res.cookie('uid', u.id, COOKIE_OPTS);
        console.log('[login] success:', email);
        res.json({ success: true, user: { id: u.id, username: u.username, email: u.email } });
    } catch (e) {
        console.error('[login] ERROR:', e.message);
        res.status(500).json({ error: 'Lỗi: ' + e.message });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('uid', { path: '/' });
    res.clearCookie('isAdmin', { path: '/' });
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    if (!req.cookies.uid) return res.json({ logged: false });
    const u = db.users.find(x => x.id === parseInt(req.cookies.uid));
    if (!u) return res.json({ logged: false });
    res.json({ logged: true, user: { id: u.id, username: u.username, email: u.email } });
});

app.post('/api/forgot', async (req, res) => {
    try {
        const email = sanitize(req.body.email).toLowerCase();
        if (!validateEmail(email)) return res.status(400).json({ error: 'Email sai' });

        const u = db.users.find(x => x.email === email);
        if (!u) return res.status(404).json({ error: 'Email không tồn tại' });

        const token = crypto.randomBytes(32).toString('hex');
        u.reset_token = token;
        u.reset_expires = Date.now() + 30*60*1000;
        saveDB(db);

        const link = `${process.env.BASE_URL || 'https://shopweb-jgeo.onrender.com'}/reset.html?token=${token}`;
        await transporter.sendMail({
            from: `"QM MOD iOS" <${process.env.GMAIL_USER}>`,
            to: email,
            subject: 'Đặt lại mật khẩu',
            html: `<p>Xin chào <b>${u.username}</b>,</p><p><a href="${link}">ĐẶT LẠI MẬT KHẨU</a> (30 phút)</p>`
        });

        res.json({ success: true });
    } catch (e) {
        console.error('[forgot]', e.message);
        res.status(500).json({ error: 'Không gửi được mail' });
    }
});

app.post('/api/reset', (req, res) => {
    try {
        const token = sanitize(req.body.token);
        const password = req.body.password;
        if (!token || !password || password.length < 6) return res.status(400).json({ error: 'Thiếu thông tin' });

        const u = db.users.find(x => x.reset_token === token && x.reset_expires > Date.now());
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
        const uid = req.cookies.uid ? parseInt(req.cookies.uid) : null;

        if (!product_id) return res.status(400).json({ error: 'Thiếu product_id' });
        if (!validateEmail(customer_email)) return res.status(400).json({ error: 'Email sai' });

        const product = db.products.find(x => x.id === product_id);
        if (!product) return res.status(404).json({ error: 'Sản phẩm không tồn tại' });

        const orderCode = 'QM' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const downloadToken = crypto.randomBytes(32).toString('hex');
        const amount = product.price;

        db.orders.push({
            id: db.orders.length + 1,
            user_id: uid,
            customer_email,
            product_id,
            order_code: orderCode,
            download_token: downloadToken,
            token_exp: Date.now() + 7*24*3600*1000,
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
        const auth = req.get('authorization') || '';
        if (auth !== `Apikey ${process.env.SEPAY_API_KEY}`) {
            return res.status(401).end();
        }

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
        const link = `${process.env.BASE_URL || 'https://shopweb-jgeo.onrender.com'}/download.html?token=${order.download_token}`;

        try {
            await transporter.sendMail({
                from: `"QM MOD iOS" <${process.env.GMAIL_USER}>`,
                to: order.customer_email,
                subject: `Đơn ${code} — Link tải ${product.name}`,
                html: `<h2 style="color:#16a34a">✓ Thanh toán thành công</h2>
                    <p>Đơn <b>${code}</b> — ${amount.toLocaleString('vi-VN')}đ</p>
                    <p><b>${product.name}</b></p>
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
            name: f.name || `file_${i+1}.ipa`,
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
        const safe = String(f.name || `${p.name}_${idx+1}.ipa`).replace(/[^\x20-\x7E]/g, '_').replace(/[\r\n"]/g, '');

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
    res.redirect(`/api/file/${req.params.token}/0`);
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
        const username = sanitize(req.body.username);
        const password = req.body.password;

        const a = db.users.find(x => x.username === username && x.is_admin);
        if (!a || !verifyPassword(password, a.password_hash)) {
            return res.status(401).json({ error: 'Sai tài khoản' });
        }

        res.cookie('isAdmin', a.id, COOKIE_OPTS);
        res.json({ success: true });
    } catch (e) {
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
                name: sanitize(f.name || `${name}_${files.length+1}.ipa`),
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
        const link = `${process.env.BASE_URL || 'https://shopweb-jgeo.onrender.com'}/download.html?token=${o.download_token}`;

        try {
            await transporter.sendMail({
                from: `"QM MOD iOS" <${process.env.GMAIL_USER}>`,
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
    if (u) { u.is_banned = 1; saveDB(db); }
    res.json({ success: true });
});

app.post('/api/admin/unban-user/:id', requireAdmin, (req, res) => {
    const u = db.users.find(x => x.id === parseInt(req.params.id));
    if (u) { u.is_banned = 0; saveDB(db); }
    res.json({ success: true });
});

// TEMP reset admin
app.get('/reset-admin-temp', (req, res) => {
    if (req.query.key !== 'reset-shopweb-2026') return res.status(403).send('Nope');
    let a = db.users.find(x => x.username === 'admin' && x.is_admin);
    if (!a) {
        a = {
            id: db.nextUserId++,
            username: 'admin',
            email: 'admin@shopweb.local',
            password_hash: hashPassword('admin123'),
            is_admin: true,
            is_banned: 0,
            created_at: new Date().toISOString()
        };
        db.users.push(a);
    } else {
        a.password_hash = hashPassword('admin123');
    }
    saveDB(db);
    res.send('OK — admin / admin123');
});

// ============================================================
//  404 + ERROR
// ============================================================
app.use((req, res) => res.status(404).send('Không tìm thấy'));
app.use((err, req, res, next) => {
    console.error('[FATAL]', err);
    res.status(500).json({ error: 'Lỗi server: ' + err.message });
});

app.listen(PORT, () => console.log(`[+] http://localhost:${PORT}`));