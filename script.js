/* QM MOD iOS — script.js v6 (no GSAP) */
console.log('[QM] script loaded');

/* ===== LOADER — tự tắt sau 2.2s ===== */
window.addEventListener('load', () => {
    const loader = document.getElementById('loader');
    if (!loader) return;
    setTimeout(() => {
        loader.classList.add('done');
        setTimeout(() => { loader.style.display = 'none'; }, 600);
    }, 2200);
});

/* ===== TYPING ===== */
const TYPING_TEXT = [
    'MOD GAME iOS — GIÁ RẺ NHẤT',
    'NHẬN LINK TẢI TRONG 30 GIÂY',
    'BẢO HÀNH TRỌN ĐỜI'
];
let ti = 0, ci = 0, deleting = false;
function typing() {
    const el = document.getElementById('typing');
    if (!el) return;
    const cur = TYPING_TEXT[ti];
    el.textContent = deleting ? cur.slice(0, ci--) : cur.slice(0, ci++);
    if (!deleting && ci > cur.length) { deleting = true; setTimeout(typing, 1600); return; }
    if (deleting && ci < 0) { deleting = false; ti = (ti + 1) % TYPING_TEXT.length; ci = 0; }
    setTimeout(typing, deleting ? 35 : 75);
}
typing();

/* ===== PRODUCTS DATA ===== */
const PRODUCTS_DATA = [
    { id: 1, name: 'BUSSID — Mod Xe Khách', game: 'BUSSID', price: 25000, desc: 'Mod xe khách cho các thiết bị iOS', badge: 'new', badgeText: 'NEW' },
    { id: 2, name: 'GTA San Andreas — Mod Xe Độ', game: 'GTA SAN', price: 35000, desc: 'Mod xe độ cho iOS', badge: 'sale', badgeText: 'SALE' },
    { id: 3, name: 'Truckers of Europe 3 — Hack Full', game: 'TOE3', price: 20000, desc: 'Hack full tiền', badge: 'hot', badgeText: 'HOT' },
    { id: 4, name: 'Truck Simulator USA EVO — Hack Full', game: 'TRUCK SIM', price: 25000, desc: 'Hack full tiền', badge: '', badgeText: '' },
    { id: 5, name: 'Combo 3 App Premium', game: 'LOCKET', price: 25000, desc: 'Locket Gold + Spotify Premium + YouTube Premium', badge: 'vip', badgeText: 'VIP' }
];

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('vi-VN') + 'đ';

let currentGame = 'all';
let currentSort = 'default';
let currentSearch = '';
let wishlist = JSON.parse(localStorage.getItem('qm_wishlist') || '[]');

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
            ${p.badge ? `<div class="product-badge ${p.badge}">${p.badgeText}</div>` : ''}
            <button class="wishlist-btn ${wishlist.includes(p.id) ? 'active' : ''}" data-wish="${p.id}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <div class="product-game">${p.game}</div>
            <div class="product-name">${p.name}</div>
            <div class="product-desc">${p.desc}</div>
            <div class="product-price">${fmt(p.price)}</div>
            <button class="btn btn-primary btn-full" data-buy="${p.id}">MUA NGAY</button>
        </div>
    `).join('');

    grid.querySelectorAll('[data-buy]').forEach(b => {
        b.addEventListener('click', () => location.href = `checkout.html?id=${b.dataset.buy}`);
    });
    grid.querySelectorAll('[data-wish]').forEach(b => {
        b.addEventListener('click', e => {
            e.stopPropagation();
            const id = parseInt(b.dataset.wish);
            const i = wishlist.indexOf(id);
            if (i >= 0) wishlist.splice(i, 1); else wishlist.push(id);
            localStorage.setItem('qm_wishlist', JSON.stringify(wishlist));
            updateWishlist();
            renderProducts();
        });
    });
}

function updateWishlist() {
    const el = $('wishlistCount');
    if (el) el.textContent = wishlist.length;
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
});

/* ===== GLOBAL FUNCTIONS ===== */
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
    body.innerHTML += `<div class="chat-msg user">${v}</div>`;
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

/* ===== INIT ===== */
renderProducts();
updateWishlist();