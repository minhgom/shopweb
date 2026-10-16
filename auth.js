/* ============================================
   QM MOD iOS - auth.js (v3 - UI đồng bộ giao diện)
   Đăng nhập / đăng ký qua Node.js Backend (/api)
   - Popup kính mờ sáng, nút đen, điểm nhấn đỏ giống trang chủ
   - Mobile: popup trượt lên dạng bottom-sheet
   - Tab Đăng nhập / Đăng ký, hiện/ẩn mật khẩu, nhập lại mật khẩu
   - Popup tài khoản khi đã đăng nhập (Đơn của tôi / Đăng xuất)
   - Cập nhật cả nút đăng nhập trên PC lẫn trong menu 3 gạch
   ============================================ */
(function () {
  'use strict';

  var API_BASE = window.API_BASE || '/api';
  window.API_BASE = API_BASE;

  /* ---------- Tiện ích ---------- */
  function $(id) { return document.getElementById(id); }

  function read(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function write(k, v) {
    try {
      if (v === null || v === undefined) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch (e) { /* Safari private mode */ }
  }
  function clearSession() {
    write('user', null);
    write('token', null);
    write('is_admin', null);
  }

  async function api(path, method, body) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 25000);
    try {
      var headers = { 'Content-Type': 'application/json' };
      var tk = read('token');
      if (tk) headers['Authorization'] = 'Bearer ' + tk;
      var res = await fetch(API_BASE + path, {
        method: method,
        headers: headers,
        credentials: 'include',
        signal: ctrl.signal,
        body: body ? JSON.stringify(body) : undefined
      });
      var data = null;
      try { data = await res.json(); } catch (e) { /* không phải JSON */ }
      return { res: res, data: data };
    } finally {
      clearTimeout(timer);
    }
  }

  function netError(err) {
    if (err && err.name === 'AbortError') {
      return 'Máy chủ phản hồi chậm (có thể đang khởi động), thử lại sau vài giây nhé.';
    }
    return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.';
  }

  /* ---------- CSS (chèn 1 lần) ---------- */
  function injectStyle() {
    if ($('qma-style')) return;
    var s = document.createElement('style');
    s.id = 'qma-style';
    s.textContent = `
.qma-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;
  background:rgba(10,10,12,.42);-webkit-backdrop-filter:blur(10px) saturate(1.2);backdrop-filter:blur(10px) saturate(1.2);
  opacity:0;transition:opacity .25s ease;overscroll-behavior:contain}
.qma-overlay.show{opacity:1}
.qma-card{position:relative;width:100%;max-width:410px;box-sizing:border-box;max-height:calc(100dvh - 40px);overflow-y:auto;
  background:rgba(255,255,255,.94);border:1px solid rgba(255,255,255,.8);border-radius:28px;padding:30px 26px 24px;color:#0a0a0a;
  font-family:'Be Vietnam Pro',system-ui,-apple-system,sans-serif;
  box-shadow:0 40px 90px -20px rgba(0,0,0,.35),0 2px 0 rgba(255,255,255,.9) inset;
  transform:translateY(20px) scale(.97);transition:transform .4s cubic-bezier(.2,.9,.3,1.15)}
.qma-overlay.show .qma-card{transform:none}
.qma-card *{box-sizing:border-box}
.qma-card.qma-shake{animation:qmaShake .4s}
@keyframes qmaShake{0%,100%{transform:none}20%{transform:translateX(-7px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(3px)}}

.qma-close{position:absolute;top:16px;right:16px;width:36px;height:36px;border:0;border-radius:12px;background:rgba(0,0,0,.05);
  color:#555;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s,transform .2s}
.qma-close:hover{background:rgba(0,0,0,.1);transform:rotate(90deg)}
.qma-tag{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;font-weight:700;letter-spacing:.12em;color:#ff3b57;margin-bottom:6px}
.qma-title{margin:0 0 4px;font-size:27px;font-weight:900;letter-spacing:-.02em;line-height:1.15;padding-right:40px}
.qma-sub{margin:0 0 20px;font-size:13.5px;color:#6b6b76;line-height:1.5}

.qma-tabs{position:relative;display:grid;grid-template-columns:1fr 1fr;padding:4px;margin-bottom:18px;background:rgba(0,0,0,.06);border-radius:14px}
.qma-tab{position:relative;z-index:1;border:0;background:none;padding:10px 0;font:700 13px 'Be Vietnam Pro',system-ui,sans-serif;color:#6b6b76;cursor:pointer;transition:color .25s}
.qma-tab.active{color:#0a0a0a}
.qma-ind{position:absolute;top:4px;left:4px;width:calc(50% - 4px);height:calc(100% - 8px);background:#fff;border-radius:11px;
  box-shadow:0 2px 8px rgba(0,0,0,.12);transition:transform .3s cubic-bezier(.3,.9,.3,1)}
.qma-card[data-mode="register"] .qma-ind{transform:translateX(100%)}

.qma-field{margin-bottom:12px}
.qma-label{display:block;margin:0 0 6px 2px;font:700 10.5px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.1em;color:#8a8a95;text-transform:uppercase}
.qma-input-wrap{position:relative}
.qma-input{width:100%;height:50px;padding:0 16px;border:1.5px solid transparent;border-radius:14px;background:#f1f1f4;color:#0a0a0a;
  font:500 16px 'Be Vietnam Pro',system-ui,sans-serif;outline:none;transition:border-color .2s,background .2s,box-shadow .2s;-webkit-appearance:none;appearance:none}
.qma-input::placeholder{color:#a4a4ae}
.qma-input:focus{background:#fff;border-color:#0a0a0a;box-shadow:0 0 0 4px rgba(10,10,10,.07)}
.qma-input.qma-pw{padding-right:48px}
.qma-eye{position:absolute;top:50%;right:6px;transform:translateY(-50%);width:38px;height:38px;border:0;background:none;border-radius:10px;color:#8a8a95;cursor:pointer;display:flex;align-items:center;justify-content:center}
.qma-eye:hover{color:#0a0a0a;background:rgba(0,0,0,.05)}
.qma-confirm{display:none}
.qma-card[data-mode="register"] .qma-confirm{display:block;animation:qmaFade .3s}
@keyframes qmaFade{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}

.qma-row{display:flex;justify-content:flex-end;margin:-2px 2px 14px}
.qma-card[data-mode="register"] .qma-row{display:none}
.qma-link{font-size:12.5px;font-weight:600;color:#6b6b76;text-decoration:none;transition:color .2s}
.qma-link:hover{color:#ff3b57}

.qma-btn{position:relative;width:100%;height:52px;border:0;border-radius:14px;background:#0a0a0a;color:#fff;cursor:pointer;
  font:800 14px 'Be Vietnam Pro',system-ui,sans-serif;letter-spacing:.04em;display:flex;align-items:center;justify-content:center;gap:8px;
  transition:transform .2s,box-shadow .2s,opacity .2s}
.qma-btn:hover{transform:translateY(-1px);box-shadow:0 10px 24px -6px rgba(0,0,0,.45)}
.qma-btn:active{transform:scale(.98)}
.qma-btn:disabled{opacity:.7;cursor:wait;transform:none;box-shadow:none}
.qma-btn.ghost{background:#f1f1f4;color:#0a0a0a;margin-top:10px}
.qma-btn.ghost:hover{background:#e8e8ed;box-shadow:none}
.qma-btn.danger{background:rgba(255,59,87,.1);color:#e11d3f;margin-top:10px}
.qma-btn.danger:hover{background:rgba(255,59,87,.18);box-shadow:none}
.qma-spin{display:none;width:18px;height:18px;border:2.5px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:qmaSpin .7s linear infinite}
.qma-btn.loading .qma-spin{display:block}
.qma-btn.loading .qma-arrow{display:none}
@keyframes qmaSpin{to{transform:rotate(360deg)}}

.qma-msg{min-height:20px;margin:12px 0 0;padding:0;font-size:13px;font-weight:600;text-align:center;line-height:1.45;border-radius:12px;transition:all .2s}
.qma-msg:not(:empty){padding:10px 12px}
.qma-msg.err{color:#d7122f;background:rgba(255,59,87,.09)}
.qma-msg.ok{color:#15803d;background:rgba(34,197,94,.12)}
.qma-msg.info{color:#444;background:rgba(0,0,0,.05)}
.qma-note{margin:14px 0 0;text-align:center;font-size:11.5px;color:#9a9aa5;line-height:1.5}

.qma-user{display:flex;flex-direction:column;align-items:center;text-align:center;padding:6px 0 18px}
.qma-avatar{width:68px;height:68px;border-radius:22px;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;
  font-size:28px;font-weight:900;text-transform:uppercase;margin-bottom:12px;box-shadow:0 12px 28px -8px rgba(0,0,0,.5)}
.qma-uname{font-size:20px;font-weight:800;letter-spacing:-.01em}
.qma-umail{margin-top:4px;font:500 12px 'JetBrains Mono',ui-monospace,monospace;color:#8a8a95;word-break:break-all}
.qma-badge{display:inline-block;margin-top:8px;padding:3px 10px;border-radius:99px;background:rgba(255,59,87,.1);color:#e11d3f;font:700 10px 'JetBrains Mono',monospace;letter-spacing:.1em}

@media (max-width:520px){
  .qma-overlay{align-items:flex-end;padding:0}
  .qma-card{max-width:none;max-height:92dvh;border-radius:28px 28px 0 0;padding:26px 20px calc(22px + env(safe-area-inset-bottom));transform:translateY(100%)}
  .qma-card::before{content:"";display:block;width:40px;height:4px;border-radius:4px;background:rgba(0,0,0,.15);margin:-10px auto 16px}
}
@media (prefers-reduced-motion:reduce){.qma-overlay,.qma-card,.qma-ind,.qma-btn{transition:none!important;animation:none!important}}
`;
    document.head.appendChild(s);
  }

  /* ---------- Khung popup dùng chung ---------- */
  var lastFocus = null;

  function mount(innerHTML) {
    injectStyle();
    closeAuthPopup(true);
    lastFocus = document.activeElement;

    var ov = document.createElement('div');
    ov.id = 'authPopup';
    ov.className = 'qma-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = '<div class="qma-card" id="qmaCard">' +
      '<button type="button" class="qma-close" aria-label="Đóng">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
      innerHTML + '</div>';

    ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeAuthPopup(); });
    ov.querySelector('.qma-close').addEventListener('click', function () { closeAuthPopup(); });

    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onEsc);
    requestAnimationFrame(function () { requestAnimationFrame(function () { ov.classList.add('show'); }); });
    return ov;
  }

  function onEsc(e) { if (e.key === 'Escape') closeAuthPopup(); }

  function closeAuthPopup(instant) {
    var p = $('authPopup');
    document.removeEventListener('keydown', onEsc);
    if (!p) return;
    p.id = '';
    document.body.style.overflow = '';
    if (instant === true) { p.remove(); return; }
    p.classList.remove('show');
    setTimeout(function () { p.remove(); }, 260);
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  function setMsg(type, text) {
    var m = $('authMsg');
    if (!m) return;
    m.className = 'qma-msg ' + (type || '');
    m.textContent = text || '';
    if (type === 'err') {
      var c = $('qmaCard');
      if (c) { c.classList.remove('qma-shake'); void c.offsetWidth; c.classList.add('qma-shake'); }
    }
  }

  /* ---------- Popup đăng nhập / đăng ký ---------- */
  var EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19c-6.5 0-10-7-10-7a18 18 0 0 1 4.2-5.2M9.9 5.1A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-2.2 3.2M1 1l22 22"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/></svg>';

  function openAuthPopup(mode) {
    if (read('user')) { openAccountPopup(); return; }

    var ov = mount(
      '<div class="qma-tag">// TÀI KHOẢN</div>' +
      '<h2 class="qma-title" id="qmaTitle">ĐĂNG NHẬP</h2>' +
      '<p class="qma-sub" id="qmaSub">Đăng nhập để mua mod và xem lịch sử đơn hàng.</p>' +
      '<div class="qma-tabs">' +
        '<span class="qma-ind"></span>' +
        '<button type="button" class="qma-tab active" data-mode="login">Đăng nhập</button>' +
        '<button type="button" class="qma-tab" data-mode="register">Đăng ký</button>' +
      '</div>' +
      '<form id="qmaForm" novalidate>' +
        '<div class="qma-field"><label class="qma-label" for="authEmail">Email</label>' +
          '<input class="qma-input" id="authEmail" type="email" placeholder="ten@gmail.com" autocomplete="email" inputmode="email" autocapitalize="off" autocorrect="off" spellcheck="false"></div>' +
        '<div class="qma-field"><label class="qma-label" for="authPass">Mật khẩu</label>' +
          '<div class="qma-input-wrap"><input class="qma-input qma-pw" id="authPass" type="password" placeholder="Nhập mật khẩu" autocomplete="current-password">' +
          '<button type="button" class="qma-eye" data-target="authPass" aria-label="Hiện mật khẩu">' + EYE + '</button></div></div>' +
        '<div class="qma-field qma-confirm"><label class="qma-label" for="authPass2">Nhập lại mật khẩu</label>' +
          '<div class="qma-input-wrap"><input class="qma-input qma-pw" id="authPass2" type="password" placeholder="Nhập lại mật khẩu" autocomplete="new-password">' +
          '<button type="button" class="qma-eye" data-target="authPass2" aria-label="Hiện mật khẩu">' + EYE + '</button></div></div>' +
        '<div class="qma-row"><a class="qma-link" href="forgot.html">Quên mật khẩu?</a></div>' +
        '<button type="submit" class="qma-btn" id="qmaSubmit"><span class="qma-spin"></span><span class="qma-label-btn">ĐĂNG NHẬP</span><span class="qma-arrow">→</span></button>' +
      '</form>' +
      '<p class="qma-msg" id="authMsg" aria-live="polite"></p>' +
      '<p class="qma-note">Dùng email thật để nhận file mod tự động.</p>'
    );

    var card = $('qmaCard');
    var form = $('qmaForm');

    function setMode(m) {
      card.setAttribute('data-mode', m);
      var reg = m === 'register';
      $('qmaTitle').textContent = reg ? 'TẠO TÀI KHOẢN' : 'ĐĂNG NHẬP';
      $('qmaSub').textContent = reg ? 'Đăng ký nhanh, nhận file mod trong 30 giây.' : 'Đăng nhập để mua mod và xem lịch sử đơn hàng.';
      ov.querySelector('.qma-label-btn').textContent = reg ? 'TẠO TÀI KHOẢN' : 'ĐĂNG NHẬP';
      $('authPass').setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
      Array.prototype.forEach.call(ov.querySelectorAll('.qma-tab'), function (t) {
        t.classList.toggle('active', t.getAttribute('data-mode') === m);
      });
      setMsg('', '');
    }

    Array.prototype.forEach.call(ov.querySelectorAll('.qma-tab'), function (t) {
      t.addEventListener('click', function () { setMode(t.getAttribute('data-mode')); });
    });

    Array.prototype.forEach.call(ov.querySelectorAll('.qma-eye'), function (b) {
      b.addEventListener('click', function () {
        var inp = $(b.getAttribute('data-target'));
        var show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        b.innerHTML = show ? EYE_OFF : EYE;
        b.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (card.getAttribute('data-mode') === 'register') doRegister(); else doLogin();
    });

    card.setAttribute('data-mode', 'login');
    if (mode === 'register') setMode('register');
    if (window.innerWidth > 520) setTimeout(function () { var i = $('authEmail'); if (i) i.focus(); }, 120);
  }

  /* ---------- Gửi form ---------- */
  function setLoading(on) {
    var b = $('qmaSubmit');
    if (!b) return;
    b.disabled = on;
    b.classList.toggle('loading', on);
  }

  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }

  function finishAuth(email, data, okText) {
    write('user', email);
    if (data && data.token) write('token', data.token);
    if (data && data.user && data.user.is_admin) write('is_admin', '1'); else write('is_admin', null);
    setMsg('ok', okText);
    updateNavUI();
    setTimeout(function () { closeAuthPopup(true); location.reload(); }, 800);
  }

  async function doLogin() {
    var email = ($('authEmail').value || '').trim();
    var password = $('authPass').value;

    if (!email || !password) return setMsg('err', 'Nhập đủ email và mật khẩu.');
    if (!validEmail(email)) return setMsg('err', 'Email chưa đúng định dạng.');

    setLoading(true);
    setMsg('info', 'Đang đăng nhập...');
    try {
      var r = await api('/login', 'POST', { email: email, password: password });
      if (r.res.ok && r.data && r.data.success) {
        finishAuth(email, r.data, 'Đăng nhập thành công!');
      } else {
        setLoading(false);
        setMsg('err', (r.data && r.data.error) || 'Sai email hoặc mật khẩu.');
      }
    } catch (err) {
      setLoading(false);
      setMsg('err', netError(err));
    }
  }

  async function doRegister() {
    var email = ($('authEmail').value || '').trim();
    var password = $('authPass').value;
    var p2 = $('authPass2') ? $('authPass2').value : password;

    if (!email || !password) return setMsg('err', 'Nhập đủ email và mật khẩu.');
    if (!validEmail(email)) return setMsg('err', 'Email chưa đúng định dạng.');
    if (password.length < 6) return setMsg('err', 'Mật khẩu phải từ 6 ký tự.');
    if (password !== p2) return setMsg('err', 'Hai mật khẩu chưa giống nhau.');

    setLoading(true);
    setMsg('info', 'Đang tạo tài khoản...');
    try {
      var r = await api('/register', 'POST', { email: email, password: password });
      if (r.res.ok && r.data && r.data.success) {
        finishAuth(email, r.data, 'Đăng ký thành công!');
      } else {
        setLoading(false);
        setMsg('err', (r.data && r.data.error) || 'Đăng ký thất bại.');
      }
    } catch (err) {
      setLoading(false);
      setMsg('err', netError(err));
    }
  }

  /* ---------- Popup tài khoản (đã đăng nhập) ---------- */
  function openAccountPopup() {
    var email = read('user');
    if (!email) { openAuthPopup(); return; }
    var name = email.split('@')[0];
    var isAdmin = read('is_admin') === '1';

    var ov = mount(
      '<div class="qma-tag">// TÀI KHOẢN</div>' +
      '<div class="qma-user">' +
        '<div class="qma-avatar" id="qmaAvatar"></div>' +
        '<div class="qma-uname" id="qmaName"></div>' +
        '<div class="qma-umail" id="qmaMail"></div>' +
        (isAdmin ? '<span class="qma-badge">ADMIN</span>' : '') +
      '</div>' +
      '<a class="qma-btn" href="history.html" style="text-decoration:none">ĐƠN CỦA TÔI <span class="qma-arrow">→</span></a>' +
      (isAdmin ? '<a class="qma-btn ghost" href="admin.html" style="text-decoration:none">TRANG ADMIN</a>' : '') +
      '<button type="button" class="qma-btn danger" id="qmaLogout">ĐĂNG XUẤT</button>' +
      '<p class="qma-msg" id="authMsg" aria-live="polite"></p>'
    );
    $('qmaAvatar').textContent = name.charAt(0);
    $('qmaName').textContent = name;
    $('qmaMail').textContent = email;
    $('qmaLogout').addEventListener('click', doLogout);
  }

  async function doLogout() {
    var b = $('qmaLogout');
    if (b) { b.disabled = true; b.textContent = 'ĐANG ĐĂNG XUẤT...'; }
    try { await api('/logout', 'POST'); } catch (e) { /* bỏ qua */ }
    clearSession();
    closeAuthPopup(true);
    location.reload();
  }

  /* ---------- Cập nhật nút trên thanh điều hướng ---------- */
  function updateNavUI() {
    var user = read('user');
    var name = user ? user.split('@')[0] : null;

    // Nút trên PC
    Array.prototype.forEach.call(
      document.querySelectorAll('.nav-desktop-login, .nav-actions .btn-primary'),
      function (b) { b.textContent = name || 'Đăng nhập'; }
    );
    // Link trong menu 3 gạch (mobile)
    Array.prototype.forEach.call(
      document.querySelectorAll('.nav-mobile-login'),
      function (a) { a.textContent = name ? '👤 ' + name : 'Đăng nhập'; }
    );
  }

  // Kiểm tra phiên với server (nếu server có GET /api/me). 401/403 => xoá đăng nhập cũ.
  async function verifySession() {
    if (!read('user')) return;
    try {
      var r = await api('/me', 'GET');
      if (r.res.status === 401 || r.res.status === 403) {
        clearSession();
        updateNavUI();
      }
    } catch (e) { /* mạng lỗi / server chưa có /me: giữ nguyên */ }
  }

  function init() {
    updateNavUI();
    verifySession();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* ---------- Xuất ra global (index.html gọi trực tiếp) ---------- */
  window.openAuthPopup = openAuthPopup;
  window.closeAuthPopup = closeAuthPopup;
  window.openAccountPopup = openAccountPopup;
  window.doLogin = doLogin;
  window.doRegister = doRegister;
  window.doLogout = doLogout;
  window.QMAuth = {
    open: openAuthPopup,
    close: closeAuthPopup,
    logout: doLogout,
    isLoggedIn: function () { return !!read('user'); },
    user: function () { return read('user'); }
  };
})();