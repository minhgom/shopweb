// ============================================================
// QM MOD iOS — Backend Server (Security Enhanced)
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
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ===== SECURITY: HEADERS =====
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
});

// ===== BODY LIMIT =====
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

// ===== STATIC FILES =====
app.use(express.static(path.join(__dirname)));

// ===== RATE LIMITERS =====
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: { error: 'Quá nhiều request, vui lòng thử lại sau' },
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api', globalLimiter);

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Quá nhiều lần đăng nhập. Đợi 15 phút.' }
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { error: 'Quá nhiều tài khoản. Đợi 1 giờ.' }
});

const orderLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    message: { error: 'Quá nhiều đơn hàng. Đợi 1 giờ.' }
});

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
            const ext = path.extname(file.originalname).toLowerCase();
            const allowed = ['.ipa', '.mp4', '.mov', '.png', '.jpg', '.jpeg'];
            if (!allowed.includes(ext)) return cb(new Error('File type không hợp lệ'));
            const name = crypto.randomBytes(16).toString('hex') + ext;
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
        ipa_path TEXT,
        video_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        customer_email TEXT,
        product_id INTEGER NOT NULL,
        order_code TEXT UNIQUE NOT NULL,
        download_token TEXT,
        status TEXT DEFAULT 'paid',
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
        ip TEXT,
        action TEXT,
        detail TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Tạo admin mặc định
const adminExists = db.prepare('SELECT id FROM admins WHERE username = ?').get('admin');
if (!adminExists) {
    bcrypt.hash('admin123', 10).then(hash => {
        db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run('admin', hash);
        console.log('[DB] Admin mặc định: admin / admin123');
    });
}
console.log('[DB] All tables ready');

// ===== SECURITY LOG =====
function logSecurity(req, action, detail = '') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    try {
        db.prepare('INSERT INTO security_logs (ip, action, detail) VALUES (?, ?, ?)').run(ip, action, detail);
    } catch (e) {}
}

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
        const user = db.prepare('SELECT id, username, email, is_banned FROM users WHERE id = ?').get(uid);
        if (!user) return res.status(401).json({ error: 'User không tồn tại' });
        if (user.is_banned) return res.status(403).json({ error: 'Tài khoản bị khoá' });
        req.user = user;
        next();
    } catch (err) {
        return res.status(500).json({ error: 'Lỗi server' });
    }
}

function requireAdmin(req, res, next) {
    if (!req.cookies.isAdmin) return res.status(403).json({ error: 'Không có quyền' });
    next();
}

// ===== VALIDATION =====
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function sanitize(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[<>]/g, '').trim().slice(0, 500);
}

// ===== USER: REGISTER =====
app.post('/api/register', registerLimiter, async (req, res) => {
    const username = sanitize(req.body.username);
    const email = sanitize(req.body.email).toLowerCase();
    const password = req.body.password;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Thiếu thông tin' });
    }
    if (username.length < 3 || username.length > 30) {
        return res.status(400).json({ error: 'Tên từ 3-30 ký tự' });
    }
    if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Email không hợp lệ' });
    }
    if (password.length < 6 || password.length > 100) {
        return res.status(400).json({ error: 'Mật khẩu từ 6-100 ký tự' });
    }

    try {
        const hash = await bcrypt.hash(password, 12);
        const result = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
            .run(username, email, hash);

        logSecurity(req, 'register', `user=${username}`);
        res.json({ success: true, user: { id: result.lastInsertRowid, username, email } });
    } catch (err) {
        if (err.message.includes('UNIQUE')) {
            if (err.message.includes('username')) return res.status(400).json({ error: 'Tên đã tồn tại' });
            if (err.message.includes('email')) return res.status(400).json({ error: 'Email đã đăng ký' });
        }
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== USER: LOGIN =====
app.post('/api/login', loginLimiter, async (req, res) => {
    const email = sanitize(req.body.email).toLowerCase();
    const password = req.body.password;

    if (!email || !password) {
        return res.status(400).json({ error: 'Thiếu thông tin' });
    }

    try {
        const user = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(email, email);
        if (!user) {
            logSecurity(req, 'login_fail', `email=${email}`);
            return res.status(401).json({ error: 'Email hoặc mật khẩu sai' });
        }
        if (user.is_banned) {
            return res.status(403).json({ error: 'Tài khoản bị khoá' });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            logSecurity(req, 'login_fail', `email=${email}`);
            return res.status(401).json({ error: 'Email hoặc mật khẩu sai' });
        }

        const sessionToken = crypto.randomBytes(32).toString('hex');
        res.cookie('uid', user.id, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 3600 * 1000
        });
        res.cookie('sid', sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 3600 * 1000
        });

        logSecurity(req, 'login_success', `user=${user.username}`);
        res.json({
            success: true,
            user: { id: user.id, username: user.username, email: user.email }
        });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== USER: LOGOUT =====
app.post('/api/logout', (req, res) => {
    res.clearCookie('uid');
    res.clearCookie('sid');
    res.json({ success: true });
});

// ===== USER: ME =====
app.get('/api/me', (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) return res.status(401).json({ error: 'Chưa đăng nhập' });
    try {
        const user = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(uid);
        if (!user) return res.status(401).json({ error: 'Không tìm thấy' });
        res.json({ user });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== USER: FORGOT PASSWORD =====
app.post('/api/forgot', loginLimiter, async (req, res) => {
    const email = sanitize(req.body.email).toLowerCase();
    if (!email || !validateEmail(email)) {
        return res.status(400).json({ error: 'Email không hợp lệ' });
    }

    try {
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!user) return res.status(404).json({ error: 'Email không tồn tại' });

        const token = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + 30 * 60 * 1000;

        db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?')
            .run(token, expires, user.id);

        const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
        const resetLink = `${baseUrl}/reset.html?token=${token}`;

        await transporter.sendMail({
            from: `"QM MOD iOS" <${process.env.GMAIL_USER}>`,
            to: email,
            subject: 'Đặt lại mật khẩu - QM MOD iOS',
            html: `<div style="font-family:Arial;max-width:600px;margin:auto;padding:30px;background:#f4f6fb;">
                <h2 style="color:#e63946;">Đặt lại mật khẩu</h2>
                <p>Xin chào <b>${user.username}</b>,</p>
                <a href="${resetLink}" style="display:inline-block;padding:14px 28px;background:#0a0a0a;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;margin:20px 0;">ĐẶT LẠI MẬT KHẨU</a>
                <p style="color:#666;font-size:13px;">Link có hiệu lực 30 phút.</p>
            </div>`
        });

        logSecurity(req, 'forgot_password', `email=${email}`);
        res.json({ success: true });
    } catch (err) {
        console.error('Forgot error:', err);
        res.status(500).json({ error: 'Không gửi được mail' });
    }
});

// ===== USER: RESET PASSWORD =====
app.post('/api/reset', loginLimiter, async (req, res) => {
    const token = sanitize(req.body.token);
    const password = req.body.password;
    if (!token || !password) return res.status(400).json({ error: 'Thiếu thông tin' });
    if (password.length < 6 || password.length > 100) {
        return res.status(400).json({ error: 'Mật khẩu từ 6-100 ký tự' });
    }

    try {
        const user = db.prepare('SELECT * FROM users WHERE reset_token = ? AND reset_expires > ?')
            .get(token, Date.now());
        if (!user) return res.status(400).json({ error: 'Token sai hoặc hết hạn' });

        const hash = await bcrypt.hash(password, 12);
        db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?')
            .run(hash, user.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== CHECKOUT: Tạo đơn (KHÔNG cần login) =====
app.post('/api/checkout', orderLimiter, (req, res) => {
    const product_id = parseInt(req.body.product_id);
    const method = sanitize(req.body.method);
    const amount = parseInt(req.body.amount);
    const customer_email = sanitize(req.body.customer_email || '').toLowerCase();

    if (!product_id || !method || !amount) {
        return res.status(400).json({ error: 'Thiếu thông tin' });
    }

    try {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
        if (!product) return res.status(404).json({ error: 'Sản phẩm không tồn tại' });

        const orderCode = 'QM' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const downloadToken = crypto.randomBytes(32).toString('hex');

        const result = db.prepare(`
            INSERT INTO orders (customer_email, product_id, order_code, download_token, status, paid_at)
            VALUES (?, ?, ?, ?, 'paid', CURRENT_TIMESTAMP)
        `).run(customer_email || null, product_id, orderCode, downloadToken);

        logSecurity(req, 'checkout', `order=${orderCode}`);

        res.json({
            success: true,
            order_code: orderCode,
            download_token: downloadToken,
            product_name: product.name,
            game: product.game,
            amount: amount
        });
    } catch (err) {
        console.error('Checkout error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== CHECKOUT: Gửi mail + hiện link tải =====
app.post('/api/send-download', orderLimiter, async (req, res) => {
    const orderCode = sanitize(req.body.order_code);
    const email = sanitize(req.body.email || '').toLowerCase();

    if (!orderCode) return res.status(400).json({ error: 'Thiếu mã đơn' });
    if (!email || !validateEmail(email)) {
        return res.status(400).json({ error: 'Email không hợp lệ' });
    }

    try {
        const order = db.prepare(`
            SELECT o.*, p.name as product_name, p.game, p.ipa_path, p.video_url
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.order_code = ?
        `).get(orderCode);

        if (!order) return res.status(404).json({ error: 'Đơn không tồn tại' });

        // Cập nhật email nếu chưa có
        if (!order.customer_email) {
            db.prepare('UPDATE orders SET customer_email = ? WHERE id = ?').run(email, order.id);
        }

        const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
        const downloadLink = `${baseUrl}/download.html?token=${order.download_token}`;

        // Gửi mail
        try {
            await transporter.sendMail({
                from: `"QM MOD iOS" <${process.env.GMAIL_USER}>`,
                to: email,
                subject: `Đơn hàng ${orderCode} - Link tải ${order.product_name}`,
                html: `<div style="font-family:Arial;max-width:600px;margin:auto;padding:30px;background:#f4f6fb;">
                    <h2 style="color:#16a34a;">✓ Thanh toán thành công</h2>
                    <p>Cảm ơn bạn đã mua <b>${order.product_name}</b> (${order.game}).</p>
                    <p><b>Mã đơn:</b> <span style="color:#e63946;">${orderCode}</span></p>
                    <p>Bấm nút dưới để tải file IPA:</p>
                    <a href="${downloadLink}" style="display:inline-block;padding:14px 28px;background:#0a0a0a;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;margin:20px 0;">📥 TẢI FILE IPA</a>
                    <p style="color:#666;font-size:13px;">Link này dành riêng cho bạn, đừng chia sẻ.</p>
                    <p style="color:#666;font-size:13px;">Cần ESign để cài đặt. Mua tại muacert.com</p>
                </div>`
            });
        } catch (mailErr) {
            console.error('Send mail error:', mailErr.message);
        }

        logSecurity(req, 'send_download', `order=${orderCode}`);

        res.json({
            success: true,
            order_code: orderCode,
            download_link: downloadLink,
            product_name: order.product_name,
            game: order.game
        });
    } catch (err) {
        console.error('Send download error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== DOWNLOAD bằng token =====
app.get('/api/download-by-token/:token', (req, res) => {
    const token = req.params.token;
    if (!token || token.length !== 64) {
        return res.status(400).json({ error: 'Token không hợp lệ' });
    }

    try {
        const order = db.prepare(`
            SELECT o.*, p.name as product_name, p.game, p.ipa_path, p.video_url
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.download_token = ?
        `).get(token);

        if (!order) return res.status(404).json({ error: 'Link không tồn tại' });

        res.json({
            success: true,
            product_name: order.product_name,
            game: order.game,
            ipa_path: order.ipa_path,
            video_url: order.video_url,
            order_code: order.order_code
        });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== USER DOWNLOADS =====
app.get('/api/my-downloads', requireLogin, (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT o.id, o.order_code, o.status, o.paid_at, o.download_token,
                   p.name as product_name, p.game, p.ipa_path, p.video_url
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.customer_email = ? OR o.user_id = ?
            ORDER BY o.created_at DESC
        `).all(req.user.email, req.user.id);
        res.json({ downloads: rows });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== ADMIN: LOGIN =====
app.post('/api/admin/login', loginLimiter, async (req, res) => {
    const username = sanitize(req.body.username);
    const password = req.body.password;

    try {
        const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
        if (!admin) {
            logSecurity(req, 'admin_login_fail', `user=${username}`);
            return res.status(401).json({ error: 'Sai tài khoản' });
        }
        const match = await bcrypt.compare(password, admin.password_hash);
        if (!match) {
            logSecurity(req, 'admin_login_fail', `user=${username}`);
            return res.status(401).json({ error: 'Sai mật khẩu' });
        }
        res.cookie('isAdmin', admin.id, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 3600 * 1000
        });
        logSecurity(req, 'admin_login_success', `user=${username}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== ADMIN: UPLOAD PRODUCT =====
app.post('/api/admin/upload-product', requireAdmin, upload.fields([
    { name: 'ipa', maxCount: 1 },
    { name: 'video', maxCount: 1 }
]), (req, res) => {
    const name = sanitize(req.body.name);
    const game = sanitize(req.body.game);
    const price = parseInt(req.body.price);

    if (!name || !game || !price) {
        return res.status(400).json({ error: 'Thiếu thông tin' });
    }

    const ipa_path = req.files && req.files.ipa ? '/uploads/' + req.files.ipa[0].filename : null;
    const video_url = req.files && req.files.video ? '/videos/' + req.files.video[0].filename : null;

    try {
        const result = db.prepare('INSERT INTO products (name, game, price, ipa_path, video_url) VALUES (?, ?, ?, ?, ?)')
            .run(name, game, price, ipa_path, video_url);
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== ADMIN: PRODUCTS =====
app.get('/api/admin/products', requireAdmin, (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== ADMIN: ORDERS =====
app.get('/api/admin/orders', requireAdmin, (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT o.*, p.name as product_name, p.game
            FROM orders o
            JOIN products p ON o.product_id = p.id
            ORDER BY o.created_at DESC
        `).all();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== ADMIN: DELETE PRODUCT =====
app.post('/api/admin/delete-product/:id', requireAdmin, (req, res) => {
    try {
        db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== ADMIN: DELETE ORDER =====
app.post('/api/admin/delete-order/:id', requireAdmin, (req, res) => {
    try {
        db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== ADMIN: BAN USER =====
app.post('/api/admin/ban-user/:id', requireAdmin, (req, res) => {
    try {
        db.prepare('UPDATE users SET is_banned = 1 WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== ADMIN: SECURITY LOGS =====
app.get('/api/admin/security-logs', requireAdmin, (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM security_logs ORDER BY id DESC LIMIT 200').all();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// ===== 404 =====
app.use((req, res) => {
    res.status(404).send('Không tìm thấy');
});

// ===== ERROR HANDLER =====
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Lỗi server' });
});

// ===== START =====
app.listen(PORT, () => {
    console.log(`[+] Server chạy: http://localhost:${PORT}`);
    console.log(`[+] Admin: http://localhost:${PORT}/admin.html`);
});