// ============================================================
// QM MOD iOS — Backend Server (Full + Upload IPA/Video + Backup)
// ============================================================
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
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

// ===== UPLOAD SETUP =====
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const VIDEO_DIR = path.join(UPLOAD_DIR, 'videos');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR);

// Upload IPA
const ipaStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = Date.now() + '_' + Math.random().toString(36).substring(2, 8) + ext;
        cb(null, name);
    }
});

// Upload video
const videoStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, VIDEO_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = Date.now() + '_' + Math.random().toString(36).substring(2, 8) + ext;
        cb(null, name);
    }
});

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
    limits: { fileSize: 5 * 1024 * 1024 * 1024 } // 5GB
});

app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/videos', express.static(VIDEO_DIR));

// ===== DATABASE =====
const DB_PATH = process.env.NODE_ENV === 'production'
    ? path.join(__dirname, 'users.db')
    : path.join(__dirname, 'users.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            reset_token TEXT,
            reset_expires INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            game TEXT NOT NULL,
            price INTEGER NOT NULL,
            ipa_path TEXT,
            video_url TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            order_code TEXT UNIQUE NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            paid_at DATETIME,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER,
            user_id INTEGER NOT NULL,
            method TEXT NOT NULL,
            amount INTEGER NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    bcrypt.hash('admin123', 10).then(hash => {
        db.run('INSERT OR IGNORE INTO admins (username, password_hash) VALUES (?, ?)',
            ['admin', hash]);
    });

    console.log('[DB] All tables ready');
});

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
    db.get('SELECT id, username, email FROM users WHERE id = ?', [uid], (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'User không tồn tại' });
        req.user = user;
        next();
    });
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
        db.run('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
            [username, email, hash], function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        if (err.message.includes('username')) return res.status(400).json({ error: 'Tên đã tồn tại' });
                        if (err.message.includes('email')) return res.status(400).json({ error: 'Email đã đăng ký' });
                    }
                    return res.status(500).json({ error: err.message });
                }
                res.json({ success: true, user: { id: this.lastID, username, email } });
            });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Thiếu thông tin' });

    db.get('SELECT * FROM users WHERE email = ? OR username = ?', [email, email], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(401).json({ error: 'Email hoặc mật khẩu sai' });

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Email hoặc mật khẩu sai' });

        res.cookie('uid', user.id, { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 });
        res.json({ success: true, user: { id: user.id, username: user.username, email: user.email } });
    });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('uid');
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    const uid = req.cookies.uid;
    if (!uid) return res.status(401).json({ error: 'Chưa đăng nhập' });
    db.get('SELECT id, username, email FROM users WHERE id = ?', [uid], (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Không tìm thấy' });
        res.json({ user });
    });
});

app.post('/api/forgot', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Thiếu email' });

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'Email không tồn tại' });

        const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
        const expires = Date.now() + 30 * 60 * 1000;

        db.run('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?',
            [token, expires, user.id], async (err2) => {
                if (err2) return res.status(500).json({ error: err2.message });

                const resetLink = `http://localhost:${PORT}/reset.html?token=${token}`;
                try {
                    await transporter.sendMail({
                        from: `"QM MOD iOS" <${process.env.GMAIL_USER}>`,
                        to: email,
                        subject: 'Dat lai mat khau - QM MOD iOS',
                        html: `<div style="font-family:Arial;max-width:600px;margin:auto;padding:30px;background:#f4f6fb;">
                            <h2 style="color:#e63946;">Đặt lại mật khẩu</h2>
                            <p>Xin chào <b>${user.username}</b>,</p>
                            <p>Bấm nút bên dưới:</p>
                            <a href="${resetLink}" style="display:inline-block;padding:14px 28px;background:#0a0a0a;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold;margin:20px 0;">ĐẶT LẠI MẬT KHẨU</a>
                            <p style="color:#666;font-size:13px;">Link có hiệu lực 30 phút.</p>
                        </div>`
                    });
                    res.json({ success: true });
                } catch (mailErr) {
                    res.status(500).json({ error: 'Không gửi được mail: ' + mailErr.message });
                }
            });
    });
});

app.post('/api/reset', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Thiếu thông tin' });
    if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu từ 6 ký tự' });

    db.get('SELECT * FROM users WHERE reset_token = ? AND reset_expires > ?',
        [token, Date.now()], async (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!user) return res.status(400).json({ error: 'Token sai hoặc hết hạn' });

            const hash = await bcrypt.hash(password, 10);
            db.run('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?',
                [hash, user.id], (err2) => {
                    if (err2) return res.status(500).json({ error: err2.message });
                    res.json({ success: true });
                });
        });
});

// ===== CHECKOUT =====
app.post('/api/checkout', requireLogin, (req, res) => {
    const { product_id, method, amount } = req.body;
    if (!product_id || !method || !amount) return res.status(400).json({ error: 'Thiếu thông tin' });

    const orderCode = 'QM' + Math.random().toString(36).substring(2, 8).toUpperCase();

    db.get('SELECT * FROM products WHERE id = ?', [product_id], (err, product) => {
        if (err || !product) return res.status(404).json({ error: 'Sản phẩm không tồn tại' });

        db.run('INSERT INTO orders (user_id, product_id, order_code, status) VALUES (?, ?, ?, ?)',
            [req.user.id, product_id, orderCode, 'pending'], function(err2) {
                if (err2) return res.status(500).json({ error: err2.message });

                db.run('INSERT INTO payments (order_id, user_id, method, amount, status) VALUES (?, ?, ?, ?, ?)',
                    [this.lastID, req.user.id, method, amount, 'pending'], (err3) => {
                        if (err3) console.error('[PAYMENT ERROR]', err3);
                        res.json({ success: true, order_code: orderCode, status: 'pending' });
                    });
            });
    });
});

app.get('/api/order-status/:code', requireLogin, (req, res) => {
    db.get('SELECT order_code, status, created_at, paid_at FROM orders WHERE order_code = ? AND user_id = ?',
        [req.params.code, req.user.id], (err, row) => {
            if (err || !row) return res.status(404).json({ error: 'Đéo tìm thấy' });
            res.json(row);
        });
});

// ===== ADMIN =====
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM admins WHERE username = ?', [username], async (err, admin) => {
        if (err || !admin) return res.status(401).json({ error: 'Sai tài khoản' });
        const match = await bcrypt.compare(password, admin.password_hash);
        if (!match) return res.status(401).json({ error: 'Sai mật khẩu' });
        res.cookie('isAdmin', admin.id, { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 });
        res.json({ success: true });
    });
});

app.post('/api/admin/upload-product', requireAdmin, upload.fields([
    { name: 'ipa', maxCount: 1 },
    { name: 'video', maxCount: 1 }
]), (req, res) => {
    const { name, game, price } = req.body;
    const ipa_path = req.files && req.files.ipa ? '/uploads/' + req.files.ipa[0].filename : null;
    const video_url = req.files && req.files.video ? '/videos/' + req.files.video[0].filename : null;

    db.run('INSERT INTO products (name, game, price, ipa_path, video_url) VALUES (?, ?, ?, ?, ?)',
        [name, game, price, ipa_path, video_url], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID });
        });
});

app.get('/api/admin/products', requireAdmin, (req, res) => {
    db.all('SELECT * FROM products ORDER BY id DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
    db.all(`
        SELECT o.*, u.email as user_email, u.username, p.name as product_name, p.game
        FROM orders o
        JOIN users u ON o.user_id = u.id
        JOIN products p ON o.product_id = p.id
        ORDER BY o.created_at DESC
    `, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/admin/confirm-order/:code', requireAdmin, (req, res) => {
    const orderCode = req.params.code;
    db.run('UPDATE orders SET status = ?, paid_at = CURRENT_TIMESTAMP WHERE order_code = ?',
        ['paid', orderCode], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Đơn không tồn tại' });
            db.run('UPDATE payments SET status = ? WHERE order_id = (SELECT id FROM orders WHERE order_code = ?)',
                ['success', orderCode]);
            res.json({ success: true, order_code: orderCode });
        });
});

app.post('/api/admin/reject-order/:code', requireAdmin, (req, res) => {
    const orderCode = req.params.code;
    db.run('UPDATE orders SET status = ? WHERE order_code = ?', ['failed', orderCode], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        db.run('UPDATE payments SET status = ? WHERE order_id = (SELECT id FROM orders WHERE order_code = ?)',
            ['failed', orderCode]);
        res.json({ success: true });
    });
});

app.post('/api/admin/delete-order/:code', requireAdmin, (req, res) => {
    const orderCode = req.params.code;
    db.run('DELETE FROM payments WHERE order_id = (SELECT id FROM orders WHERE order_code = ?)', [orderCode]);
    db.run('DELETE FROM orders WHERE order_code = ?', [orderCode], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.post('/api/admin/delete-product/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM products WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ===== BACKUP DATABASE =====
app.get('/api/admin/backup-db', requireAdmin, (req, res) => {
    const backupPath = path.join(__dirname, 'backup_' + Date.now() + '.db');
    try {
        fs.copyFileSync(DB_PATH, backupPath);
        res.download(backupPath, 'users_backup.db', (err) => {
            if (err) console.error(err);
            setTimeout(() => { try { fs.unlinkSync(backupPath); } catch(e) {} }, 5000);
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/restore-db', requireAdmin, upload.single('dbfile'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Thiếu file' });
    try {
        fs.copyFileSync(req.file.path, DB_PATH);
        fs.unlinkSync(req.file.path);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ===== USER DOWNLOAD =====
app.get('/api/my-downloads', requireLogin, (req, res) => {
    db.all(`
        SELECT o.id, o.order_code, o.status, o.paid_at,
               p.name as product_name, p.game, p.ipa_path, p.video_url
        FROM orders o
        JOIN products p ON o.product_id = p.id
        WHERE o.user_id = ?
        ORDER BY o.created_at DESC
    `, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ downloads: rows });
    });
});

app.get('/api/download/:order_code', requireLogin, (req, res) => {
    db.get(`
        SELECT o.user_id, o.status, p.ipa_path, p.name
        FROM orders o
        JOIN products p ON o.product_id = p.id
        WHERE o.order_code = ?
    `, [req.params.order_code], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Đơn đéo tồn tại' });
        if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Đây đéo phải đơn của bạn' });
        if (row.status !== 'paid') return res.status(403).json({ error: 'Đơn chưa được xác nhận' });
        if (!row.ipa_path) return res.status(404).json({ error: 'File chưa có' });

        res.json({ success: true, url: row.ipa_path, name: row.name });
    });
});

// ===== START =====
app.listen(PORT, () => {
    console.log(`[DB] All tables ready`);
    console.log(`[+] Server chạy: http://localhost:${PORT}`);
    console.log(`[+] Admin: http://localhost:${PORT}/admin.html`);
    console.log(`[+] Admin user: admin / admin123`);
});