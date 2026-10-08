// ============================================================
// QM MOD iOS — Backend Server (better-sqlite3)
// ============================================================
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors());
app.use(express.static(path.join(__dirname)));

// ===== UPLOAD =====
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const VIDEO_DIR = path.join(UPLOAD_DIR, 'videos');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            if (file.fieldname === 'video') cb(null, VIDEO_DIR);
            else cb(null, UPLOAD_DIR);
        },
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname);
            const name = Date.now() + '_' + Math.random().toString(36).substring(2, 8) + ext;
            cb(null, name);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 * 1024 }
});

app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/videos', express.static(VIDEO_DIR));

// ===== DATABASE =====
const DB_PATH = path.join(__dirname, 'users.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        reset_token TEXT,
        reset_expires INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        game TEXT NOT NULL,
        price INTEGER NOT NULL,
        ipa_path TEXT,
        video_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        order_code TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        paid_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        user_id INTEGER NOT NULL,
        method TEXT NOT NULL,
        amount INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

bcrypt.hash('admin123', 10).then(hash => {
    db.prepare('INSERT OR IGNORE INTO admins (username, password_hash) VALUES (?, ?)').run('admin', hash);
});

console.log('[DB] All tables ready');

// ===== MAIL =====
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

// ===== MIDDLEWARE =====
function requireLogin(req, res, next) {
    const uid = req.cookies.uid;
    if (!uid) return res.status(401).json({ error: 'Chưa đăng nhập' });
    try {
        const user = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(uid);
        if (!user) return res.status(401).json({ error: 'User không tồn tại' });
        req.user = user;
        next();
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}

function requireAdmin(req, res, next) {
    if (!req.cookies.isAdmin) return res.status(403).json({ error: 'Đéo có quyền' });
    next();
}

// ===== USER ROUTES =====

app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'Thiếu thông tin' });
    if (username.length < 3) return res.status(400).json({ error: 'Tên từ 3 ký tự' });
    if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu từ 6 ký tự' });

    try {
        const hash = await bcrypt.hash(password, 10);
        const result = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
            .run(username, email, hash);
        res.json({ success: true, user: { id: result.lastInsertRowid, username, email } });
    } catch (err) {
        if (err.message.includes('UNIQUE')) {
            if (err.message.includes('username')) return res.status(400).json({ error: 'Tên đã tồn tại' });
            if (err.message.includes('email')) return res.status(400).json({ error: 'Email đã đăng ký' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Thiếu thông tin' });

    try {
        const user = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(email, email);
        if (!user) return res.status(401).json({ error: 'Email hoặc mật khẩu sai' });

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Email hoặc mật khẩu sai' });

        res.cookie('uid', user.id, { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 });
        res.json({ success: true, user: { id: user.id, username: user.username, email: user.email } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('uid');
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) return res.status(401).json({ error: 'Chưa đăng nhập' });
    try {
        const user = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(uid);
        if (!user) return res.status(401).json({ error: 'Không tìm thấy' });
        res.json({ user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/forgot', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Thiếu email' });

    try {
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!user) return res.status(404).json({ error: 'Email không tồn tại' });

        const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
        const expires = Date.now() + 30 * 60 * 1000;

        db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?')
            .run(token, expires, user.id);

        const resetLink = `http://localhost:${PORT}/reset.html?token=${token}`;

        await transporter.sendMail({
            from: `"QM MOD iOS" <${process.env.GMAIL_USER}>`,
            to: email,
            subject: 'Dat lai mat khau - QM MOD iOS',
            html: `<div style="font-family:Arial;max-width:600px;margin:auto;padding:30px;background:#f4f6fb;">
                <h2 style="color:#e63946;">Đặt lại mật khẩu</h2>
                <p>Xin chào <b>${user.username}</b>,</p>
                <a href="${resetLink}" style="display:inline-block;padding:14px 28px;background:#0a0a0a;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;margin:20px 0;">ĐẶT LẠI MẬT KHẨU</a>
                <p style="color:#666;font-size:13px;">Link có hiệu lực 30 phút.</p>
            </div>`
        });
        res.json({ success: true });
    } catch (mailErr) {
        res.status(500).json({ error: 'Không gửi được mail: ' + mailErr.message });
    }
});

app.post('/api/reset', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Thiếu thông tin' });
    if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu từ 6 ký tự' });

    try {
        const user = db.prepare('SELECT * FROM users WHERE reset_token = ? AND reset_expires > ?')
            .get(token, Date.now());
        if (!user) return res.status(400).json({ error: 'Token sai hoặc hết hạn' });

        const hash = await bcrypt.hash(password, 10);
        db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?')
            .run(hash, user.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== CHECKOUT =====
app.post('/api/checkout', requireLogin, (req, res) => {
    const { product_id, method, amount } = req.body;
    if (!product_id || !method || !amount) return res.status(400).json({ error: 'Thiếu thông tin' });

    const orderCode = 'QM' + Math.random().toString(36).substring(2, 8).toUpperCase();

    try {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
        if (!product) return res.status(404).json({ error: 'Sản phẩm không tồn tại' });

        const result = db.prepare('INSERT INTO orders (user_id, product_id, order_code, status) VALUES (?, ?, ?, ?)')
            .run(req.user.id, product_id, orderCode, 'pending');

        db.prepare('INSERT INTO payments (order_id, user_id, method, amount, status) VALUES (?, ?, ?, ?, ?)')
            .run(result.lastInsertRowid, req.user.id, method, amount, 'pending');

        res.json({ success: true, order_code: orderCode, status: 'pending' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/order-status/:code', requireLogin, (req, res) => {
    try {
        const row = db.prepare('SELECT order_code, status, created_at, paid_at FROM orders WHERE order_code = ? AND user_id = ?')
            .get(req.params.code, req.user.id);
        if (!row) return res.status(404).json({ error: 'Đéo tìm thấy' });
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== ADMIN =====
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
        if (!admin) return res.status(401).json({ error: 'Sai tài khoản' });
        const match = await bcrypt.compare(password, admin.password_hash);
        if (!match) return res.status(401).json({ error: 'Sai mật khẩu' });
        res.cookie('isAdmin', admin.id, { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/upload-product', requireAdmin, upload.fields([
    { name: 'ipa', maxCount: 1 },
    { name: 'video', maxCount: 1 }
]), (req, res) => {
    const { name, game, price } = req.body;
    const ipa_path = req.files && req.files.ipa ? '/uploads/' + req.files.ipa[0].filename : null;
    const video_url = req.files && req.files.video ? '/videos/' + req.files.video[0].filename : null;

    try {
        const result = db.prepare('INSERT INTO products (name, game, price, ipa_path, video_url) VALUES (?, ?, ?, ?, ?)')
            .run(name, game, price, ipa_path, video_url);
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/products', requireAdmin, (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT o.*, u.email as user_email, u.username, p.name as product_name, p.game
            FROM orders o
            JOIN users u ON o.user_id = u.id
            JOIN products p ON o.product_id = p.id
            ORDER BY o.created_at DESC
        `).all();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/confirm-order/:code', requireAdmin, (req, res) => {
    try {
        const result = db.prepare('UPDATE orders SET status = ?, paid_at = CURRENT_TIMESTAMP WHERE order_code = ?')
            .run('paid', req.params.code);
        if (result.changes === 0) return res.status(404).json({ error: 'Đơn không tồn tại' });
        db.prepare('UPDATE payments SET status = ? WHERE order_id = (SELECT id FROM orders WHERE order_code = ?)')
            .run('success', req.params.code);
        res.json({ success: true, order_code: req.params.code });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/reject-order/:code', requireAdmin, (req, res) => {
    try {
        db.prepare('UPDATE orders SET status = ? WHERE order_code = ?').run('failed', req.params.code);
        db.prepare('UPDATE payments SET status = ? WHERE order_id = (SELECT id FROM orders WHERE order_code = ?)')
            .run('failed', req.params.code);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/delete-order/:code', requireAdmin, (req, res) => {
    try {
        db.prepare('DELETE FROM payments WHERE order_id = (SELECT id FROM orders WHERE order_code = ?)').run(req.params.code);
        db.prepare('DELETE FROM orders WHERE order_code = ?').run(req.params.code);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/delete-product/:id', requireAdmin, (req, res) => {
    try {
        db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== USER DOWNLOAD =====
app.get('/api/my-downloads', requireLogin, (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT o.id, o.order_code, o.status, o.paid_at,
                   p.name as product_name, p.game, p.ipa_path, p.video_url
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.user_id = ?
            ORDER BY o.created_at DESC
        `).all(req.user.id);
        res.json({ downloads: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/download/:order_code', requireLogin, (req, res) => {
    try {
        const row = db.prepare(`
            SELECT o.user_id, o.status, p.ipa_path, p.name
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.order_code = ?
        `).get(req.params.order_code);

        if (!row) return res.status(404).json({ error: 'Đơn đéo tồn tại' });
        if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Đây đéo phải đơn của bạn' });
        if (row.status !== 'paid') return res.status(403).json({ error: 'Đơn chưa được xác nhận' });
        if (!row.ipa_path) return res.status(404).json({ error: 'File chưa có' });

        res.json({ success: true, url: row.ipa_path, name: row.name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== SEPAY WEBHOOK =====
app.post('/api/sepay/webhook', (req, res) => {
    const data = req.body;
    console.log('[SEPAY] Nhận webhook:', JSON.stringify(data));

    if (data.transferType !== 'in') return res.json({ success: true });

    const content = (data.content || '').toUpperCase();
    const amount = parseInt(data.transferAmount);

    try {
        const orders = db.prepare('SELECT * FROM orders WHERE status = ?').all('pending');
        let matchedOrder = null;
        for (const o of orders) {
            if (content.includes(o.order_code)) {
                matchedOrder = o;
                break;
            }
        }

        if (!matchedOrder) {
            console.log('[SEPAY] Không khớp đơn nào');
            return res.json({ success: true });
        }

        const product = db.prepare('SELECT price FROM products WHERE id = ?').get(matchedOrder.product_id);
        if (!product || amount < product.price) {
            console.log('[SEPAY] Số tiền không khớp');
            return res.json({ success: true });
        }

        db.prepare('UPDATE orders SET status = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run('paid', matchedOrder.id);
        db.prepare('UPDATE payments SET status = ? WHERE order_id = ?')
            .run('success', matchedOrder.id);
        console.log('[SEPAY] ✓ Đã xác nhận đơn', matchedOrder.order_code);
        res.json({ success: true });
    } catch (err) {
        console.log('[SEPAY] Lỗi:', err.message);
        res.json({ success: true });
    }
});

// ===== START =====
app.listen(PORT, () => {
    console.log(`[+] Server chạy: http://localhost:${PORT}`);
    console.log(`[+] Admin: http://localhost:${PORT}/admin.html`);
    console.log(`[+] Admin user: admin / admin123`);
});