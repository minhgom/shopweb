/* QM MOD iOS — script.js v9 (login state + sản phẩm từ server) */
console.log('[QM] script loaded');

/* ===== LOADER ===== */
window.addEventListener('load', () => {
    const loader = document.getElementById('loader');
    if (!loader) return;
    setTimeout(() => {
        loader.classList.add('done');
        setTimeout(() => { loader.style.display = 'none'; }, 600);
    }, 1800);
});

/* ===== TYPING — TÊN GAME ===== */
const TYPING_TEXT = [
    'BUS SIMULATOR INDONESIA',
    'GTA SAN ANDREAS',
    'TRUCKERS OF EUROPE 3',
    'TRUCK SIMULATOR USA EVO',
    'COMBO 3 APP PREMIUM'
];
let ti = 0, ci = 0, deleting = false;

function typing() {
    const el = document.getElementById('typing');
    if (!el) return;
    const cur = TYPING_TEXT[ti];
    el.textContent = deleting ? cur.slice(0, ci--) : cur.slice(0, ci++);
    if (!deleting && ci > cur.length) { deleting = true; setTimeout(typing, 1500); return; }
    if (deleting && ci < 0) { deleting = false; ti = (ti + 1) % TYPING_TEXT.length; ci = 0; }
    setTimeout(typing, deleting ? 30 : 70);
}

/* ===== PRODUCTS ===== */
// Dữ liệu mô tả/nhãn (dự phòng + bổ sung cho sản phẩm lấy từ server theo TÊN).
// Giá và id THẬT lấy từ server (/api/products) khi có.
const PRODUCT_META = [
    { id: 1, name: 'Bus Simulator Indonesia — Mod Xe Khách', game: 'BUSSID', price: 25000, desc: 'Mod xe khách cho các thiết bị iOS', badge: 'new', badgeText: 'NEW' },
    { id: 2, name: 'GTA San Andreas — Mod Xe Độ', game: 'GTA SAN', price: 35000, desc: 'Mod xe độ cho iOS', badge: 'sale', badgeText: 'SALE' },
    { id: 3, name: 'Truckers of Europe 3 — Hack Full', game: 'TOE3', price: 20000, desc: 'Hack full tiền', badge: 'hot', badgeText: 'HOT' },
    { id: 4, name: 'Truck Simulator USA EVO — Hack Full', game: 'TRUCK SIM', price: 25000, desc: 'Hack full tiền', badge: '', badgeText: '' },
    { id: 5, name: 'Combo 3 App Premium', game: 'LOCKET', price: 25000, desc: 'Locket Gold + Spotify Premium + YouTube Premium', badge: 'vip', badgeText: 'VIP' }
];
let PRODUCTS_DATA = PRODUCT_META.slice();

const $ = id => document.getElementById(id);
const fmt = n => Number(n || 0).toLocaleString('vi-VN') + 'đ';
const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let currentGame = 'all';
let currentSort = 'default';
let currentSearch = '';
let wishlist = [];
try { wishlist = JSON.parse(localStorage.getItem('qm_wishlist') || '[]'); } catch (e) { wishlist = []; }

/* Lấy sản phẩm thật từ server để id khớp với lúc thanh toán */
async function loadProducts() {
    try {
        const r = await fetch('/api/products', { cache: 'no-store' });
        if (!r.ok) return;
        const list = await r.json();
        if (!Array.isArray(list) || !list.length) return; // chưa có sản phẩm -> giữ dữ liệu dự phòng
        PRODUCTS_DATA = list.map(p => {
            const meta = PRODUCT_META.find(m => m.name === p.name) || {};
            return {
                id: p.id,
                name: p.name,
                game: p.game,
                price: p.price,
                desc: meta.desc || '',
                badge: meta.badge || '',
                badgeText: meta.badgeText || ''
            };
        });
        renderProducts();
    } catch (e) {
        console.warn('[QM] không tải được sản phẩm từ server', e);
    }
}

/* ===== PARTICLES ===== */
function spawnParticles(x, y) {
    const colors = ['#e63946', '#ff4757', '#ffb829', '#8052ff'];
    for (let i = 0; i < 14; i++) {
        const p = document.createElement('div');
        p.className = 'click-particle';
        p.style.left = x + 'px';
        p.style.top = y + 'px';
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
        const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.5;
        const dist = 60 + Math.random() * 90;
        p.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
        p.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 900);
    }
}

/* ===== RENDER ===== */
function renderProducts() {
    const grid = $('productsGrid');
    if (!grid) return;

    let list = PRODUCTS_DATA.filter(p => {
        if (currentGame !== 'all' && p.game !== currentGame) return false;
        if (currentSearch && !p.name.toLowerCase().includes(currentSearch.toLowerCase())) return false;
        return true;
    });

    if (currentSort === 'price-asc') list.sort((a, b) => a.price - b.price);
    else if (currentSort === 'price-desc') list.sort((a, b) => b.price - a.price);
    else if (currentSort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));

    const count = $('productCount');
    if (count) count.textContent = list.length + ' sản phẩm';

    if (!list.length) {
        grid.innerHTML = '<div class="empty-state">Không có sản phẩm nào 😢</div>';
        return;
    }

    grid.innerHTML = list.map(p => `
        <div class="product-card">
            ${p.badge ? `<div class="product-badge ${esc(p.badge)}">${esc(p.badgeText)}</div>` : ''}
            <button class="wishlist-btn ${wishlist.includes(p.id) ? 'active' : ''}" data-wish="${p.id}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <div class="product-game">${esc(p.game)}</div>
            <div class="product-name">${esc(p.name)}</div>
            <div class="product-desc">${esc(p.desc)}</div>
            <div class="product-price">${fmt(p.price)}</div>
            <button class="btn btn-primary btn-full" data-morph="${p.id}"><span>MUA NGAY</span></button>
        </div>
    `).join('');

    // Click MUA NGAY — ripple + particles + morph
    grid.querySelectorAll('[data-morph]').forEach(b => {
        b.addEventListener('click', () => {
            b.classList.add('clicked');
            setTimeout(() => b.classList.remove('clicked'), 600);

            const rect = b.getBoundingClientRect();
            spawnParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);

            setTimeout(() => openMorph(parseInt(b.dataset.morph)), 150);
        });
    });

    // Wishlist
    grid.querySelectorAll('[data-wish]').forEach(b => {
        b.addEventListener('click', e => {
            e.stopPropagation();
            const id = parseInt(b.dataset.wish);
            const i = wishlist.indexOf(id);
            if (i >= 0) wishlist.splice(i, 1); else wishlist.push(id);
            try { localStorage.setItem('qm_wishlist', JSON.stringify(wishlist)); } catch (err) {}
            updateWishlist();
            renderProducts();
        });
    });
}

function updateWishlist() {
    const el = $('wishlistCount');
    if (el) el.textContent = wishlist.length;
}

/* ===== MORPH MODAL ===== */
function openMorph(id) {
    const p = PRODUCTS_DATA.find(x => x.id === id);
    if (!p) return;

    const overlay = $('morphOverlay');
    const badge = $('morphBadge');
    const buyBtn = $('morphBuyBtn');

    if (p.badge) {
        badge.textContent = p.badgeText;
        badge.className = 'morph-badge ' + p.badge;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }

    $('morphGame').textContent = p.game;
    $('morphTitle').textContent = p.name;
    $('morphDesc').textContent = p.desc;
    $('morphPrice').textContent = fmt(p.price);

    buyBtn.onclick = () => {
        location.href = 'checkout.html?id=' + p.id;
    };

    overlay.classList.add('on');
    document.body.style.overflow = 'hidden';
}

function closeMorph(e) {
    if (e && e.target !== $('morphOverlay') && !e.target.classList.contains('morph-close')) return;
    $('morphOverlay').classList.remove('on');
    document.body.style.overflow = '';
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMorph();
});

/* ===== ĐĂNG NHẬP: hiển thị trạng thái trên thanh menu ===== */
window.QM_USER = null;

async function doLogout(e) {
    if (e) e.preventDefault();
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch (err) {}
    if (window.QMAuth) QMAuth.clear();
    window.QM_USER = null;
    location.href = '/index.html';
}

function renderAuthUI() {
    const u = window.QM_USER;
    if (!u) return;

    // Tìm các link đăng nhập / đăng ký ở bất kỳ đâu trên trang (menu desktop + mobile)
    const loginLinks = document.querySelectorAll('a[href="login.html"], a[href="/login.html"]');
    const registerLinks = document.querySelectorAll('a[href="register.html"], a[href="/register.html"]');

    loginLinks.forEach(a => {
        if (a.closest('.auth-box')) return; // không đụng vào trang login/register
        a.textContent = '👤 ' + u.username;
        a.setAttribute('href', u.is_admin ? 'admin.html' : '#');
        a.classList.add('is-user');
        if (!u.is_admin) a.addEventListener('click', e => e.preventDefault());
    });

    registerLinks.forEach(a => {
        if (a.closest('.auth-box')) return;
        a.textContent = 'Đăng xuất';
        a.setAttribute('href', '#');
        a.addEventListener('click', doLogout);
    });

    // Nếu menu không có link đăng ký để đổi thành "Đăng xuất" thì thêm 1 nút nhỏ
    if (!registerLinks.length && loginLinks.length && !document.getElementById('qmLogoutBtn')) {
        const first = loginLinks[0];
        const out = document.createElement('a');
        out.id = 'qmLogoutBtn';
        out.href = '#';
        out.textContent = 'Đăng xuất';
        out.className = first.className;
        out.addEventListener('click', doLogout);
        first.insertAdjacentElement('afterend', out);
    }

    document.body.classList.add('logged-in');
}

async function loadAuth() {
    try {
        const r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
        const d = await r.json();
        window.QM_USER = d && d.logged ? d.user : null;
        if (!window.QM_USER && window.QMAuth) QMAuth.clear(); // token cũ/hết hạn thì xoá
        renderAuthUI();
    } catch (e) {
        console.warn('[QM] không kiểm tra được đăng nhập', e);
    }
}

/* ===== EVENTS ===== */
document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        currentGame = t.dataset.game;
        renderProducts();
    });
});

const searchEl = $('searchInput');
if (searchEl) searchEl.addEventListener('input', e => { currentSearch = e.target.value; renderProducts(); });

const sortEl = $('sortSelect');
if (sortEl) sortEl.addEventListener('change', e => { currentSort = e.target.value; renderProducts(); });

/* ===== SCROLL ===== */
window.addEventListener('scroll', () => {
    const nav = document.querySelector('.navbar');
    const btt = $('backToTop');
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 40);
    if (btt) btt.classList.toggle('show', window.scrollY > 400);
}, { passive: true });

/* ===== SCROLL REVEAL ===== */
(function initReveal() {
    const els = document.querySelectorAll(
        '.section-header, .esign-box, .category-card, .guide-step, .support-card, .cta-card'
    );
    els.forEach((el, i) => {
        el.classList.add('reveal');
        if (i % 4 === 1) el.classList.add('reveal-delay-1');
        if (i % 4 === 2) el.classList.add('reveal-delay-2');
        if (i % 4 === 3) el.classList.add('reveal-delay-3');
    });

    const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('in');
                io.unobserve(entry.target);
            }
        });
    }, { threshold: 0.08, rootMargin: '0px 0px -60px 0px' });

    els.forEach(el => io.observe(el));

    setTimeout(() => {
        document.querySelectorAll('.reveal:not(.in)').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.top < window.innerHeight) el.classList.add('in');
        });
    }, 2500);
})();

/* ===== GLOBAL ===== */
function scrollToId(id) {
    const target = document.getElementById(id);
    if (!target) return;
    const offset = target.getBoundingClientRect().top + window.scrollY - 100;
    window.scrollTo({ top: offset, behavior: 'smooth' });
}

function filterCategory(game) {
    currentGame = game;
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.game === game);
    });
    renderProducts();
    scrollToId('products');
}

function toggleChat() {
    const box = $('chatBox');
    if (box) box.classList.toggle('open');
}

function sendChat() {
    const input = $('chatInput');
    const body = $('chatBody');
    if (!input || !body) return;
    const v = input.value.trim();
    if (!v) return;
    body.innerHTML += `<div class="chat-msg user">${esc(v)}</div>`;
    input.value = '';
    body.scrollTop = body.scrollHeight;
    setTimeout(() => {
        const replies = [
            'Dạ bạn cần hỗ trợ gì ạ?',
            'Nhắn Zalo 0383415468 để được phản hồi nhanh nha!',
            'Mod bên mình bảo hành trọn đời nha bạn!'
        ];
        body.innerHTML += `<div class="chat-msg bot">${replies[Math.floor(Math.random() * replies.length)]}</div>`;
        body.scrollTop = body.scrollHeight;
    }, 800);
}

window.scrollToId = scrollToId;
window.filterCategory = filterCategory;
window.toggleChat = toggleChat;
window.sendChat = sendChat;
window.openMorph = openMorph;
window.closeMorph = closeMorph;
window.doLogout = doLogout;

/* ===== INIT ===== */
renderProducts();
updateWishlist();
typing();
loadProducts();
loadAuth();