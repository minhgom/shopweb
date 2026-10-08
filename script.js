// ============================================================
// QM MOD iOS — By:QuangMinh
// ============================================================
console.log('[QM] Script loaded');

// ===== LOADER =====
(function initLoader() {
    const loader = document.getElementById('loader');
    const percent = document.querySelector('.loader-percent');
    if (!loader) return;

    let p = 0;
    const interval = setInterval(() => {
        p += Math.floor(Math.random() * 12) + 5;
        if (p > 100) p = 100;
        if (percent) percent.textContent = p + '%';
        if (p >= 100) {
            clearInterval(interval);
            setTimeout(() => {
                loader.classList.add('done');
                setTimeout(() => { if (loader.parentNode) loader.remove(); }, 900);
            }, 400);
        }
    }, 100);

    setTimeout(() => {
        if (loader && !loader.classList.contains('done')) {
            loader.classList.add('done');
            setTimeout(() => { if (loader.parentNode) loader.remove(); }, 900);
        }
    }, 4000);
})();

// ===== TYPING =====
function TypeWriter(el, texts, speed) {
    this.el = el;
    this.texts = texts;
    this.speed = speed || 80;
    this.textIndex = 0;
    this.charIndex = 0;
    this.isDeleting = false;
    this.tick();
}
TypeWriter.prototype.tick = function() {
    var self = this;
    var current = self.texts[self.textIndex];

    if (self.isDeleting) {
        self.el.textContent = current.substring(0, self.charIndex--);
    } else {
        self.el.textContent = current.substring(0, self.charIndex++);
    }

    var delay = self.isDeleting ? 40 : self.speed;

    if (!self.isDeleting && self.charIndex === current.length + 1) {
        delay = 2200;
        self.isDeleting = true;
    } else if (self.isDeleting && self.charIndex === 0) {
        self.isDeleting = false;
        self.textIndex = (self.textIndex + 1) % self.texts.length;
        delay = 400;
    }

    setTimeout(function() { self.tick(); }, delay);
};

// ===== SCROLL REVEAL =====
function initScrollReveal() {
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting) entry.target.classList.add('active');
        });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal, .product-card').forEach(function(el) {
        observer.observe(el);
    });
}

// ===== NAVBAR =====
function initNavbarScroll() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;
    window.addEventListener('scroll', function() {
        navbar.classList.toggle('scrolled', window.scrollY > 50);
    });
}

// ===== SCROLL TO =====
function scrollToId(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
}

// ===== AUTH =====
function initAuth() {
    const user = localStorage.getItem('user');
    const authBtn = document.getElementById('authBtn');
    if (!authBtn) return;
    if (user) {
        try {
            const data = JSON.parse(user);
            const name = data.username || (data.email ? data.email.split('@')[0] : 'USER');
            authBtn.innerHTML = name.toUpperCase();
            authBtn.href = 'download.html';
        } catch(e) { console.error(e); }
    }
}

// ===== PRODUCTS =====
const PRODUCTS = [
    { id: 1, name: 'TOE3 — Mod Full', game: 'TOE3', description: 'Mod tiền, xe, logo hãng', price: 20, badge: 'HOT' },
    { id: 2, name: 'BUSSID — Mod Full', game: 'BUSSID', description: 'Mod xe, tiền, skin, map', price: 25, badge: 'NEW' },
    { id: 3, name: 'GTA San — Mod Full', game: 'GTA SAN', description: 'Mod tiền, xe, vũ khí, nhiệm vụ', price: 35, badge: 'SALE' },
    { id: 4, name: 'Truck Sim USA EVO — Mod Full', game: 'TRUCK SIM', description: 'Mod tiền, xe, nhiên liệu', price: 25 },
    { id: 5, name: 'Combo 3 App Pre', game: 'LOCKET', description: 'Locket Gold + YouTube Premium + Spotify', price: 25, badge: 'VIP' }
];

let currentFilter = 'all';
let currentSearch = '';
let currentSort = 'default';
let wishlist = [];
try {
    wishlist = JSON.parse(localStorage.getItem('wishlist') || '[]');
    if (!Array.isArray(wishlist)) wishlist = [];
} catch(e) { wishlist = []; }

function updateWishlistCount() {
    const el = document.getElementById('wishlistCount');
    if (el) el.textContent = wishlist.length;
}

function toggleWishlistItem(id) {
    const idx = wishlist.indexOf(id);
    if (idx === -1) {
        wishlist.push(id);
        showToast('Đã thêm vào yêu thích', 'success');
    } else {
        wishlist.splice(idx, 1);
        showToast('Đã xoá khỏi yêu thích', 'info');
    }
    localStorage.setItem('wishlist', JSON.stringify(wishlist));
    updateWishlistCount();
    renderProducts(currentFilter);
}

function toggleWishlist() {
    if (wishlist.length === 0) return showToast('Chưa có sản phẩm yêu thích', 'info');
    showToast('Bạn có ' + wishlist.length + ' sản phẩm yêu thích', 'info');
}

function handleSearch() {
    const input = document.getElementById('searchInput');
    currentSearch = input ? input.value.toLowerCase() : '';
    renderProducts(currentFilter);
}

function handleSort() {
    const select = document.getElementById('sortSelect');
    currentSort = select ? select.value : 'default';
    renderProducts(currentFilter);
}

function renderProducts(filter) {
    filter = filter || 'all';
    currentFilter = filter;
    const grid = document.getElementById('productsGrid');
    const title = document.getElementById('productTitle');
    const count = document.getElementById('productCount');
    if (!grid) return;

    let filtered = filter === 'all' ? PRODUCTS.slice() : PRODUCTS.filter(function(p) { return p.game === filter; });

    if (currentSearch) {
        filtered = filtered.filter(function(p) {
            return p.name.toLowerCase().indexOf(currentSearch) !== -1 ||
                   p.description.toLowerCase().indexOf(currentSearch) !== -1;
        });
    }

    if (currentSort === 'price-asc') filtered.sort(function(a,b) { return a.price - b.price; });
    else if (currentSort === 'price-desc') filtered.sort(function(a,b) { return b.price - a.price; });
    else if (currentSort === 'name') filtered.sort(function(a,b) { return a.name.localeCompare(b.name); });

    const titles = {
        'all': 'TẤT CẢ SẢN PHẨM',
        'TOE3': 'TRUCKERS OF EUROPE 3',
        'BUSSID': 'BUS SIMULATOR INDONESIA',
        'GTA SAN': 'GTA SAN ANDREAS',
        'TRUCK SIM': 'TRUCK SIMULATOR USA',
        'LOCKET': 'COMBO 3 APP PRE'
    };
    if (title) title.textContent = titles[filter] || 'SẢN PHẨM';
    if (count) count.textContent = filtered.length + ' sản phẩm';

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="empty-state">Không tìm thấy sản phẩm nào</div>';
        return;
    }

    grid.innerHTML = filtered.map(function(p) {
        var badge = p.badge ? '<div class="product-badge ' + p.badge.toLowerCase() + '">' + p.badge + '</div>' : '';
        var wishClass = wishlist.indexOf(p.id) !== -1 ? 'active' : '';
        return '<div class="product-card">' +
            badge +
            '<button class="wishlist-btn ' + wishClass + '" onclick="toggleWishlistItem(' + p.id + ')">♥</button>' +
            '<div class="product-game">' + p.game + '</div>' +
            '<div class="product-name">' + p.name + '</div>' +
            '<div class="product-desc">' + p.description + '</div>' +
            '<div class="product-price">' + p.price + '<small>K</small></div>' +
            '<button class="btn btn-primary morph-btn" onclick="buy(' + p.id + ')">MUA NGAY</button>' +
        '</div>';
    }).join('');

    setTimeout(function() {
        grid.querySelectorAll('.product-card').forEach(function(el, i) {
            setTimeout(function() { el.classList.add('reveal'); }, i * 80);
        });
    }, 50);
}

function filterCategory(game) {
    document.querySelectorAll('.tab').forEach(function(t) {
        t.classList.toggle('active', t.dataset.game === game);
    });
    renderProducts(game);
    scrollToId('products');
}

function buy(id) {
    window.location.href = 'checkout.html?id=' + id;
}

function initTabs() {
    document.querySelectorAll('.tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
            tab.classList.add('active');
            renderProducts(tab.dataset.game);
        });
    });
}

function initBackToTop() {
    const btn = document.getElementById('backToTop');
    if (!btn) return;
    window.addEventListener('scroll', function() {
        btn.classList.toggle('show', window.scrollY > 500);
    });
}

function showToast(msg, type) {
    type = type || 'info';
    const c = document.getElementById('toastContainer');
    if (!c) return;
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(function() { t.classList.add('show'); }, 50);
    setTimeout(function() {
        t.classList.remove('show');
        setTimeout(function() { if (t.parentNode) t.remove(); }, 300);
    }, 3000);
}

function toggleChat() {
    const box = document.getElementById('chatBox');
    if (box) box.classList.toggle('open');
}

function sendChat() {
    const input = document.getElementById('chatInput');
    const body = document.getElementById('chatBody');
    if (!input || !body) return;
    const msg = input.value.trim();
    if (!msg) return;
    body.innerHTML += '<div class="chat-msg user">' + msg + '</div>';
    input.value = '';
    setTimeout(function() {
        body.innerHTML += '<div class="chat-msg bot">Đã nhận tin. Liên hệ Zalo <b>0383415468</b> để hỗ trợ nhanh.</div>';
        body.scrollTop = body.scrollHeight;
    }, 800);
    body.scrollTop = body.scrollHeight;
}

// ===== RIPPLE EFFECT =====
document.addEventListener('click', function(e) {
    const btn = e.target.closest('.btn, .auth-btn, button');
    if (!btn || btn.classList.contains('chat-close')) return;

    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.left = (e.clientX - rect.left) + 'px';
    ripple.style.top = (e.clientY - rect.top) + 'px';
    ripple.style.width = ripple.style.height = Math.max(rect.width, rect.height) + 'px';

    btn.style.position = 'relative';
    btn.style.overflow = 'hidden';
    btn.appendChild(ripple);

    setTimeout(function() { ripple.remove(); }, 800);
});

// ===== INIT =====
document.addEventListener('DOMContentLoaded', function() {
    const typingEl = document.getElementById('typing');
    if (typingEl) {
        new TypeWriter(typingEl, [
            'TRUCKERS OF EUROPE 3',
            'BUS SIMULATOR INDONESIA',
            'GTA SAN ANDREAS',
            'TRUCK SIMULATOR USA',
            'COMBO 3 APP PRE'
        ], 80);
    }
    initScrollReveal();
    initNavbarScroll();
    initAuth();
    initTabs();
    initBackToTop();
    updateWishlistCount();
    renderProducts();
});