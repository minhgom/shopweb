/* ============================================
   QM MOD iOS — ANIMATION PACK v2  (JS)
   Giữ nguyên cách nhúng:  <script src="animations.js" defer></script>

   Có gì trong bản này:
   1. Lò xo (spring physics) dùng chung -> mọi chuyển động mượt, có độ nảy.
   2. Card 3D: nghiêng theo chuột, theo NGÓN TAY khi chạm giữ, có vệt sáng + parallax lớp trong.
   3. Hero nghiêng 3D + parallax nhiều lớp theo con trỏ và theo cuộn trang.
   4. Canvas hạt có chiều sâu (z), né con trỏ / ngón tay, nổ nhẹ khi chạm.
   5. Blob nền trôi theo con trỏ, thanh tiến trình cuộn, vòng sóng khi chạm.
   6. Nút nam châm, viên trượt ở nav + tabs, modal "mọc" từ card (FLIP bằng WAAPI),
      modal nghiêng 3D theo chuột, đếm giá khi cuộn tới.
   Đã bỏ: các đoạn trùng lặp ở cuối file cũ (chạy FLIP & glass 2 lần gây giật).
   ============================================ */
(function () {
  'use strict';

  const doc = document;
  const root = doc.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (s, r) => (r || doc).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || doc).querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ======================================================
     0. LÒ XO DÙNG CHUNG
     ====================================================== */
  class Spring {
    constructor(value, k, c, eps) {
      this.x = value; this.v = 0; this.t = value;
      this.k = k; this.c = c; this.eps = eps || 0.01;
    }
    step(dt) {
      const a = this.k * (this.t - this.x) - this.c * this.v;
      this.v += a * dt;
      this.x += this.v * dt;
    }
    get rest() {
      return Math.abs(this.v) < this.eps && Math.abs(this.t - this.x) < this.eps;
    }
  }

  const activeJobs = new Set();
  let rafId = 0, lastT = 0;

  function wake(job) {
    activeJobs.add(job);
    if (!rafId) { lastT = performance.now(); rafId = requestAnimationFrame(tick); }
  }

  function tick(now) {
    const dt = Math.min((now - lastT) / 1000, 1 / 30);
    lastT = now;
    activeJobs.forEach(job => {
      let rest = true;
      for (let i = 0; i < job.springs.length; i++) {
        const s = job.springs[i];
        s.step(dt / 2); s.step(dt / 2);       // 2 bước con cho ổn định
        if (!s.rest) rest = false;
      }
      job.apply();
      if (rest) {
        job.springs.forEach(s => { s.x = s.t; s.v = 0; });
        job.apply();
        activeJobs.delete(job);
        if (job.onRest) job.onRest();
      }
    });
    rafId = activeJobs.size ? requestAnimationFrame(tick) : 0;
  }

  // trục + góc để dùng với thuộc tính CSS `rotate: x y z angle` (nghiêng 3D 2 trục cùng lúc)
  function axisAngle(nx, ny, maxDeg) {
    const ax = -ny, ay = nx;
    const m = Math.hypot(ax, ay);
    if (m < 1e-3) return { ax: 0, ay: 1, a: 0 };
    return { ax: ax, ay: ay, a: Math.min(m, 1.4) * maxDeg };
  }

  // trạng thái con trỏ dùng chung
  const ptr = { x: innerWidth / 2, y: innerHeight / 2, nx: 0, ny: 0, active: false, type: 'mouse' };

  /* ======================================================
     1. CARD 3D (category / product / support / guide / esign / cta)
     ====================================================== */
  const TILT_TARGETS = [
    ['.category-card', 9],
    ['.product-card', 8],
    ['.support-card', 7],
    ['.guide-step', 6],
    ['.esign-box', 2.5],
    ['.cta-card', 2.5]
  ];
  const cardJobs = new WeakMap();

  function prepareTilt(el, max) {
    if (el.__qmTilt) return;
    el.__qmTilt = true;
    el.classList.add('tilt-card');
    el.setAttribute('data-tilt', String(max));
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    if (!el.querySelector(':scope > .tilt-glare')) {
      const g = doc.createElement('span');
      g.className = 'tilt-glare';
      g.setAttribute('aria-hidden', 'true');
      el.appendChild(g);
    }
  }

  function makeCardJob(el) {
    const max = parseFloat(el.getAttribute('data-tilt')) || 8;
    const j = {
      el: el, max: max, hover: false, pressed: false, px: 0.5, py: 0.5, _t: 0,
      rx: new Spring(0, 230, 19, 0.01),
      ry: new Spring(0, 230, 19, 0.01),
      sc: new Spring(1, 280, 17, 0.0006),
      lift: new Spring(0, 240, 19, 0.04),
      gx: new Spring(0, 150, 17, 0.002),
      gy: new Spring(0, 150, 17, 0.002)
    };
    j.springs = [j.rx, j.ry, j.sc, j.lift, j.gx, j.gy];
    j.apply = function () {
      const s = el.style;
      s.setProperty('--t-rx', j.rx.x.toFixed(2) + 'deg');
      s.setProperty('--t-ry', j.ry.x.toFixed(2) + 'deg');
      s.setProperty('--t-sc', j.sc.x.toFixed(4));
      s.setProperty('--t-lift', j.lift.x.toFixed(2) + 'px');
      s.setProperty('--t-px', j.gx.x.toFixed(3));
      s.setProperty('--t-py', j.gy.x.toFixed(3));
    };
    j.onRest = function () { el.classList.remove('is-active'); };
    j.retarget = function () {
      const on = j.hover || j.pressed;
      if (on) {
        const nx = (j.px - 0.5) * 2, ny = (j.py - 0.5) * 2;
        j.rx.t = -ny * j.max;          // phía con trỏ lún xuống
        j.ry.t = nx * j.max;
        j.gx.t = nx; j.gy.t = ny;
        j.sc.t = j.pressed ? 0.965 : 1.02;
        j.lift.t = j.pressed ? 0 : -8;
        el.classList.add('is-active');
      } else {
        j.rx.t = 0; j.ry.t = 0; j.gx.t = 0; j.gy.t = 0; j.sc.t = 1; j.lift.t = 0;
      }
      el.classList.toggle('is-hover', on);
      wake(j);
    };
    return j;
  }

  function cardJob(el) {
    let j = cardJobs.get(el);
    if (!j) { j = makeCardJob(el); cardJobs.set(el, j); }
    return j;
  }

  function setCardPos(j, e) {
    const el = j.el;
    const r = el.getBoundingClientRect();
    const w = el.offsetWidth || r.width, h = el.offsetHeight || r.height;
    const left = r.left + r.width / 2 - w / 2, top = r.top + r.height / 2 - h / 2;
    j.px = clamp((e.clientX - left) / w, 0, 1);
    j.py = clamp((e.clientY - top) / h, 0, 1);
    el.style.setProperty('--mx', (j.px * 100).toFixed(1) + '%');
    el.style.setProperty('--my', (j.py * 100).toFixed(1) + '%');
  }

  /* ======================================================
     2. NÚT NAM CHÂM (chuột)
     ====================================================== */
  const MAG_SEL = '.btn, .nav-icon-btn, .chat-toggle, .back-to-top';
  const magJobs = new WeakMap();

  function magJob(el) {
    let j = magJobs.get(el);
    if (!j) {
      j = { el: el, bx: new Spring(0, 200, 13, 0.02), by: new Spring(0, 200, 13, 0.02) };
      j.springs = [j.bx, j.by];
      j.apply = function () {
        el.style.setProperty('--bx', j.bx.x.toFixed(2) + 'px');
        el.style.setProperty('--by', j.by.x.toFixed(2) + 'px');
      };
      magJobs.set(el, j);
    }
    return j;
  }

  /* ======================================================
     3. HERO: nghiêng 3D + parallax theo con trỏ
     ====================================================== */
  let heroEl = null, heroJob = null;
  function initHero() {
    heroEl = $('.hero');
    if (!heroEl || reduced) return;
    heroJob = {
      hx: new Spring(0, 60, 14, 0.002),
      hy: new Spring(0, 60, 14, 0.002)
    };
    heroJob.springs = [heroJob.hx, heroJob.hy];
    heroJob.apply = function () {
      const aa = axisAngle(heroJob.hx.x, heroJob.hy.x, 5);
      const s = heroEl.style;
      s.setProperty('--hx', heroJob.hx.x.toFixed(3));
      s.setProperty('--hy', heroJob.hy.x.toFixed(3));
      s.setProperty('--hax', aa.ax.toFixed(3));
      s.setProperty('--hay', aa.ay.toFixed(3));
      s.setProperty('--ha', aa.a.toFixed(2));
    };
  }

  /* ======================================================
     4. NỀN: blob trôi + canvas hạt 3D
     ====================================================== */
  let ambientJob = null;
  function initAmbient() {
    if (reduced) return;
    const wrap = doc.createElement('div');
    wrap.className = 'ambient';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = '<i class="blob b1"></i><i class="blob b2"></i><i class="blob b3"></i>';
    doc.body.insertBefore(wrap, doc.body.firstChild);
    ambientJob = {
      ax: new Spring(0, 30, 10, 0.002),
      ay: new Spring(0, 30, 10, 0.002)
    };
    ambientJob.springs = [ambientJob.ax, ambientJob.ay];
    ambientJob.apply = function () {
      wrap.style.setProperty('--ax', ambientJob.ax.x.toFixed(3));
      wrap.style.setProperty('--ay', ambientJob.ay.x.toFixed(3));
    };
  }

  let fxBurst = function () {};
  function initCanvas() {
    if (reduced) return;
    const cv = doc.createElement('canvas');
    cv.className = 'fx-canvas';
    cv.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const mobile = innerWidth < 768;
    const COUNT = mobile ? 26 : 52;
    const LINK = mobile ? 100 : 130;
    let W = 0, H = 0, dpr = 1, parts = [], running = false, raf = 0;
    let sx = innerWidth / 2;

    // sprite phát sáng vẽ 1 lần, tái sử dụng cho mọi hạt
    const sprite = doc.createElement('canvas');
    sprite.width = sprite.height = 64;
    const sg = sprite.getContext('2d');
    const grad = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(230,57,70,0.55)');
    grad.addColorStop(0.4, 'rgba(230,57,70,0.18)');
    grad.addColorStop(1, 'rgba(230,57,70,0)');
    sg.fillStyle = grad; sg.fillRect(0, 0, 64, 64);

    function size() {
      const nw = innerWidth, nh = innerHeight;
      // iOS đổi innerHeight liên tục khi thanh địa chỉ co giãn -> chỉ resize khi đổi đáng kể
      if (W && nw === W && Math.abs(nh - H) < 160) return;
      W = nw; H = nh;
      dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();

    for (let i = 0; i < COUNT; i++) {
      const z = 0.25 + Math.random() * 0.75;
      parts.push({
        x: Math.random() * W, y: Math.random() * H, z: z,
        r: 10 + Math.random() * 26,
        vx: (Math.random() - 0.5) * 0.18,
        vy: -0.08 - Math.random() * 0.2,
        ox: 0, oy: 0, dx: 0, dy: 0
      });
    }

    fxBurst = function (x, y) {
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const dx = p.dx - x, dy = p.dy - y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 240) {
          const f = (1 - d / 240) * 3.2 * p.z;
          p.ox += (dx / d) * f; p.oy += (dy / d) * f;
        }
      }
    };

    function frame() {
      if (!running) return;
      ctx.clearRect(0, 0, W, H);
      sx += (ptr.x - sx) * 0.06;
      const par = (sx / W - 0.5);
      const sy = window.scrollY || root.scrollTop || 0;

      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        p.x += p.vx * (0.4 + p.z) + p.ox;
        p.y += p.vy * (0.4 + p.z) + p.oy;
        p.ox *= 0.93; p.oy *= 0.93;
        if (p.x < -60) p.x = W + 60; else if (p.x > W + 60) p.x = -60;
        if (p.y < -60) p.y = H + 60; else if (p.y > H + 60) p.y = -60;

        p.dx = p.x - par * 70 * p.z;
        p.dy = (((p.y - sy * 0.14 * p.z) % H) + H) % H;

        if (ptr.active) {            // né con trỏ / ngón tay
          const rx = p.dx - ptr.x, ry = p.dy - ptr.y;
          const d = Math.hypot(rx, ry);
          if (d < 170) {
            const f = (1 - d / 170) * 0.5 * p.z;
            p.ox += (rx / (d || 1)) * f; p.oy += (ry / (d || 1)) * f;
          }
        }
      }

      // đường nối giữa các hạt gần nhau (cùng "tầng sâu")
      ctx.lineWidth = 1;
      for (let i = 0; i < parts.length; i++) {
        const a = parts[i];
        for (let j = i + 1; j < parts.length; j++) {
          const b = parts[j];
          if (Math.abs(a.z - b.z) > 0.3) continue;
          const dx = a.dx - b.dx, dy = a.dy - b.dy;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK * LINK) {
            const al = (1 - Math.sqrt(d2) / LINK) * 0.14 * Math.min(a.z, b.z);
            ctx.strokeStyle = 'rgba(230,57,70,' + al.toFixed(3) + ')';
            ctx.beginPath(); ctx.moveTo(a.dx, a.dy); ctx.lineTo(b.dx, b.dy); ctx.stroke();
          }
        }
      }
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const s = p.r * p.z;
        ctx.globalAlpha = 0.35 + 0.55 * p.z;
        ctx.drawImage(sprite, p.dx - s, p.dy - s, s * 2, s * 2);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    function start() { if (!running) { running = true; raf = requestAnimationFrame(frame); } }
    function stop() { running = false; cancelAnimationFrame(raf); }

    doc.addEventListener('visibilitychange', () => { doc.hidden ? stop() : start(); });
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(size, 150); });
    start();
  }

  /* ======================================================
     5. GÓI SỰ KIỆN CON TRỎ / CHẠM (một chỗ duy nhất)
     ====================================================== */
  const GLASS_SEL = '.glass, .navbar, .hero-badge, .product-toolbar, .tabs, .chat-box, .btn-outline';
  let hoverCard = null, hoverMag = null, hoverGlass = null;
  const pressing = new Set();
  let cursorGlow = null, glowJob = null;

  function releaseHoverCard() {
    if (hoverCard) { hoverCard.hover = false; hoverCard.retarget(); hoverCard = null; }
  }
  function releaseMag() {
    if (hoverMag) { hoverMag.bx.t = 0; hoverMag.by.t = 0; wake(hoverMag); hoverMag = null; }
  }

  function ensureCursorGlow() {
    if (cursorGlow) return;
    cursorGlow = doc.createElement('div');
    cursorGlow.className = 'cursor-glow';
    doc.body.appendChild(cursorGlow);
    glowJob = { gx: new Spring(ptr.x, 90, 18, 0.2), gy: new Spring(ptr.y, 90, 18, 0.2) };
    glowJob.springs = [glowJob.gx, glowJob.gy];
    glowJob.apply = function () {
      cursorGlow.style.setProperty('--cx', glowJob.gx.x.toFixed(1) + 'px');
      cursorGlow.style.setProperty('--cy', glowJob.gy.x.toFixed(1) + 'px');
    };
  }

  const morph = { overlay: null, card: null, job: null, open: false };

  function onPointerMove(e) {
    ptr.x = e.clientX; ptr.y = e.clientY;
    ptr.nx = (e.clientX / innerWidth - 0.5) * 2;
    ptr.ny = (e.clientY / innerHeight - 0.5) * 2;
    ptr.type = e.pointerType;
    ptr.active = true;

    // --- chạm: chỉ cập nhật card đang giữ ---
    if (e.pointerType === 'touch') {
      pressing.forEach(j => { if (j.pressed) { setCardPos(j, e); j.retarget(); } });
      return;
    }

    // --- chuột / bút ---
    ensureCursorGlow();
    cursorGlow.classList.add('active');
    glowJob.gx.t = e.clientX; glowJob.gy.t = e.clientY; wake(glowJob);

    if (ambientJob) { ambientJob.ax.t = ptr.nx; ambientJob.ay.t = ptr.ny; wake(ambientJob); }

    if (heroJob && heroEl && (window.scrollY || 0) < heroEl.offsetHeight + 100) {
      heroJob.hx.t = ptr.nx; heroJob.hy.t = ptr.ny; wake(heroJob);
    }

    if (morph.open && morph.job) {
      morph.job.mx.t = ptr.nx; morph.job.my.t = ptr.ny; wake(morph.job);
    }

    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;

    // card 3D
    const cardEl = t.closest('[data-tilt]');
    if (!cardEl || (hoverCard && hoverCard.el !== cardEl)) releaseHoverCard();
    if (cardEl) {
      const j = cardJob(cardEl);
      if (hoverCard !== j) { hoverCard = j; j.hover = true; }
      setCardPos(j, e);
      j.retarget();
    }

    // nút nam châm
    const magEl = t.closest(MAG_SEL);
    if (!magEl || (hoverMag && hoverMag.el !== magEl)) releaseMag();
    if (magEl) {
      const mj = magJob(magEl);
      hoverMag = mj;
      const r = magEl.getBoundingClientRect();
      mj.bx.t = clamp((e.clientX - (r.left + r.width / 2)) * 0.22, -10, 10);
      mj.by.t = clamp((e.clientY - (r.top + r.height / 2)) * 0.3, -9, 9);
      wake(mj);
    }

    // vệt sáng kính
    const g = t.closest(GLASS_SEL);
    if (g !== hoverGlass) {
      if (hoverGlass) { hoverGlass.style.removeProperty('--mx'); hoverGlass.style.removeProperty('--my'); }
      hoverGlass = g;
    }
    if (g && !g.hasAttribute('data-tilt')) {
      const r = g.getBoundingClientRect();
      g.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      g.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    }
  }

  function onPointerDown(e) {
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.active = true; ptr.type = e.pointerType;
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;

    // vòng sóng + nổ hạt
    if (!t.closest('input, textarea, select, .qma-overlay')) {
      spawnRing(e.clientX, e.clientY);
      fxBurst(e.clientX, e.clientY);
    }

    const cardEl = t.closest('[data-tilt]');
    if (!cardEl) return;
    const j = cardJob(cardEl);
    setCardPos(j, e);
    pressing.add(j);
    if (e.pointerType === 'touch') {
      // đợi 60ms: nếu là cuộn trang thì pointercancel sẽ huỷ, card không bị "giật"
      clearTimeout(j._t);
      j._t = setTimeout(() => { j._t = 0; j.pressed = true; j.retarget(); }, 60);
    } else {
      j.hover = true; hoverCard = j;
      j.pressed = true; j.retarget();
    }
  }

  function onPointerUp(e) {
    const cancelled = e.type === 'pointercancel';
    pressing.forEach(j => {
      if (j._t) {
        clearTimeout(j._t); j._t = 0;
        if (!cancelled) {                     // chạm nhanh: nhún 1 nhịp
          j.pressed = true; j.retarget();
          setTimeout(() => { j.pressed = false; j.retarget(); }, 110);
        }
      } else {
        j.pressed = false; j.retarget();
      }
    });
    pressing.clear();
    if (e.pointerType === 'touch') {
      setTimeout(() => { ptr.active = false; }, 350);
    }
  }

  function onLeaveWindow() {
    ptr.active = false;
    releaseHoverCard(); releaseMag();
    if (cursorGlow) cursorGlow.classList.remove('active');
    if (heroJob) { heroJob.hx.t = 0; heroJob.hy.t = 0; wake(heroJob); }
    if (ambientJob) { ambientJob.ax.t = 0; ambientJob.ay.t = 0; wake(ambientJob); }
    if (morph.job) { morph.job.mx.t = 0; morph.job.my.t = 0; wake(morph.job); }
  }

  function spawnRing(x, y) {
    if (reduced) return;
    const r = doc.createElement('span');
    r.className = 'tap-ring';
    r.style.left = x + 'px'; r.style.top = y + 'px';
    doc.body.appendChild(r);
    setTimeout(() => r.remove(), 750);
  }

  function initPointer() {
    if (reduced) return;
    doc.addEventListener('pointermove', onPointerMove, { passive: true });
    doc.addEventListener('pointerdown', onPointerDown, { passive: true });
    doc.addEventListener('pointerup', onPointerUp, { passive: true });
    doc.addEventListener('pointercancel', onPointerUp, { passive: true });
    doc.addEventListener('mouseout', e => { if (!e.relatedTarget) onLeaveWindow(); });
    window.addEventListener('blur', onLeaveWindow);
  }

  /* ======================================================
     6. SCROLL: tiến trình + parallax hero
     ====================================================== */
  function initScroll() {
    const bar = doc.createElement('div');
    bar.className = 'scroll-progress';
    bar.innerHTML = '<i></i>';
    doc.body.appendChild(bar);
    const fill = bar.firstChild;
    const hero = $('.hero');
    let queued = false;

    function update() {
      queued = false;
      const y = Math.max(0, window.scrollY || root.scrollTop || 0);
      const max = root.scrollHeight - innerHeight;
      fill.style.transform = 'scaleX(' + (max > 0 ? clamp(y / max, 0, 1) : 0).toFixed(4) + ')';
      if (hero && !reduced && y < hero.offsetHeight + 200) {
        hero.style.setProperty('--hs', Math.min(y, 900).toFixed(0));
      }
    }
    window.addEventListener('scroll', () => {
      if (!queued) { queued = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* ======================================================
     7. SCROLL REVEAL + ĐẾM GIÁ
     ====================================================== */
  let revealIO = null;

  function countUp(el) {
    if (reduced || el.__counted) return;
    const m = /^(\d+)(\D*)$/.exec((el.textContent || '').trim());
    if (!m) return;
    el.__counted = true;
    const to = +m[1], suf = m[2], t0 = performance.now(), dur = 900;
    (function f(now) {
      const t = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(to * e) + suf;
      if (t < 1) requestAnimationFrame(f); else el.classList.add('price-pop');
    })(t0);
  }

  function showCard(el) {
    el.classList.add('in-view');
    setTimeout(() => el.classList.add('rv-done'), 1400);
    if (el.classList.contains('category-card')) {
      const p = el.querySelector('.category-price');
      if (p) countUp(p);
    }
  }

  function prepareRevealCard(el, index) {
    if (el.__qmRv) return;
    el.__qmRv = true;
    el.classList.add('rv-card');
    el.style.setProperty('--d', (Math.min(index, 6) * 0.07).toFixed(2) + 's');
    if (reduced || !revealIO) showCard(el); else revealIO.observe(el);
  }

  function initReveal() {
    if ('IntersectionObserver' in window && !reduced) {
      revealIO = new IntersectionObserver(entries => {
        entries.forEach(en => {
          if (!en.isIntersecting) return;
          revealIO.unobserve(en.target);
          if (en.target.classList.contains('rv-card')) showCard(en.target);
          else en.target.classList.add('in-view');
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    }

    TILT_TARGETS.forEach(pair => {
      $$(pair[0]).forEach((el, i) => {
        if (!reduced) prepareTilt(el, pair[1]);
        prepareRevealCard(el, i);
      });
    });

    $$('.section-header').forEach(el => {
      el.classList.add('reveal-left');
      if (reduced || !revealIO) el.classList.add('in-view'); else revealIO.observe(el);
    });

    // sản phẩm do script.js render động -> theo dõi lưới
    const grid = $('#productsGrid');
    if (grid) {
      const handle = () => {
        $$('.product-card', grid).forEach((card, i) => {
          if (!reduced) prepareTilt(card, 8);
          prepareRevealCard(card, i);
        });
      };
      new MutationObserver(handle).observe(grid, { childList: true });
      handle();
    }
  }

  /* ======================================================
     8. TABS: viên trượt kiểu lò xo
     ====================================================== */
  function initTabs() {
    const tabs = $('.tabs');
    if (!tabs) return;
    const ind = doc.createElement('div');
    ind.className = 'tab-indicator';
    tabs.prepend(ind);
    tabs.classList.add('has-indicator');

    function active() { return tabs.querySelector('.tab.active') || tabs.querySelector('.tab'); }
    function move(tab, animate) {
      if (!tab) return;
      if (!animate) ind.style.transition = 'none';
      ind.style.width = tab.offsetWidth + 'px';
      ind.style.height = tab.offsetHeight + 'px';
      ind.style.transform = 'translate(' + tab.offsetLeft + 'px,' + tab.offsetTop + 'px)';
      if (!animate) { void ind.offsetWidth; ind.style.transition = ''; }
    }
    requestAnimationFrame(() => move(active(), false));
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(() => move(active(), false));
    if ('ResizeObserver' in window) new ResizeObserver(() => move(active(), false)).observe(tabs);

    tabs.addEventListener('click', e => {
      const t = e.target.closest('.tab');
      if (!t) return;
      requestAnimationFrame(() => {
        move(t, true);
        try { t.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch (err) {}
      });
    });
  }

  /* ======================================================
     9. NAV: viên trượt theo link đang rê chuột (desktop)
     ====================================================== */
  function initNavPill() {
    const nav = $('.nav-links');
    if (!nav || reduced) return;
    const pill = doc.createElement('span');
    pill.className = 'nav-pill snap';
    nav.insertBefore(pill, nav.firstChild);
    const mq = window.matchMedia('(min-width: 961px)');

    nav.addEventListener('pointerover', e => {
      if (e.pointerType === 'touch' || !mq.matches) return;
      const a = e.target.closest('a');
      if (!a || !nav.contains(a)) return;
      const first = !pill.classList.contains('on');
      if (first) pill.classList.add('snap');
      pill.style.width = a.offsetWidth + 'px';
      pill.style.height = a.offsetHeight + 'px';
      pill.style.transform = 'translate(' + a.offsetLeft + 'px,' + a.offsetTop + 'px)';
      if (first) { void pill.offsetWidth; pill.classList.remove('snap'); }
      pill.classList.add('on');
    });
    nav.addEventListener('pointerleave', () => pill.classList.remove('on'));
  }

  /* ======================================================
     10. MODAL SẢN PHẨM: mọc ra từ card (FLIP bằng WAAPI) + nghiêng 3D
     ====================================================== */
  function initMorph() {
    const overlay = $('#morphOverlay');
    const card = overlay ? $('.morph-card', overlay) : null;
    if (!overlay || !card) return;
    morph.overlay = overlay; morph.card = card;

    let origin = null;
    function grab(el) { if (el) origin = el.getBoundingClientRect(); }

    // chạy ở capture phase để lấy vị trí card TRƯỚC khi script.js mở modal
    doc.addEventListener('click', e => {
      const s = e.target.closest && e.target.closest('.category-card, .product-card, [data-morph-source]');
      if (s) grab(s);
    }, true);
    window.addEventListener('morph-open', e => { if (e.detail && e.detail.source) grab(e.detail.source); });

    // nghiêng 3D theo chuột khi modal mở (dùng thuộc tính `rotate` -> không đụng FLIP)
    if (!reduced) {
      morph.job = { mx: new Spring(0, 70, 14, 0.002), my: new Spring(0, 70, 14, 0.002) };
      morph.job.springs = [morph.job.mx, morph.job.my];
      morph.job.apply = function () {
        const aa = axisAngle(morph.job.mx.x, morph.job.my.x, 4);
        card.style.rotate = aa.ax.toFixed(3) + ' ' + aa.ay.toFixed(3) + ' 0 ' + aa.a.toFixed(2) + 'deg';
      };
      morph.job.onRest = function () { if (!morph.open) card.style.rotate = ''; };
    }

    function playOpen() {
      const o = origin; origin = null;
      if (reduced || !card.animate) return;

      // đo vị trí đích (đã layout xong), tắt transition CSS để không đánh nhau với WAAPI
      card.style.transition = 'none';
      card.style.transform = 'none';
      card.style.opacity = '1';
      const to = card.getBoundingClientRect();

      let from;
      if (o && to.width && to.height) {
        const dx = (o.left + o.width / 2) - (to.left + to.width / 2);
        const dy = (o.top + o.height / 2) - (to.top + to.height / 2);
        from = 'perspective(1200px) translate(' + dx + 'px,' + dy + 'px) scale(' +
               Math.max(o.width / to.width, 0.1) + ',' + Math.max(o.height / to.height, 0.1) + ') rotateX(10deg)';
      } else {
        from = 'perspective(1200px) translate(0,40px) scale(0.92,0.92) rotateX(8deg)';
      }

      const anim = card.animate([
        { transform: from, opacity: 0.35 },
        { opacity: 1, offset: 0.55 },
        { transform: 'perspective(1200px) translate(0,0) scale(1,1) rotateX(0deg)', opacity: 1 }
      ], { duration: 580, easing: 'cubic-bezier(.2,.85,.25,1.04)' });

      const cleanup = () => { card.style.transition = ''; card.style.transform = ''; card.style.opacity = ''; };
      anim.finished.then(cleanup).catch(cleanup);

      // nội dung bên trong lần lượt hiện lên
      Array.prototype.forEach.call(card.children, (c, i) => {
        if (!c.animate) return;
        c.animate([
          { opacity: 0, transform: 'translateY(14px)' },
          { opacity: 1, transform: 'none' }
        ], { duration: 460, delay: 160 + i * 45, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
      });
    }

    let wasOpen = false;
    new MutationObserver(() => {
      const open = overlay.classList.contains('on');
      if (open && !wasOpen) { wasOpen = true; morph.open = true; playOpen(); }
      else if (!open && wasOpen) {
        wasOpen = false; morph.open = false;
        if (morph.job) { morph.job.mx.t = 0; morph.job.my.t = 0; wake(morph.job); }
      }
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  }

  /* ======================================================
     11. LINH TINH: loader %, giá nhún, ripple nút
     ====================================================== */
  function runLoaderPercent() {
    const el = $('#loaderPercent');
    if (!el) return;
    if (reduced) { el.textContent = '100%'; return; }
    const dur = 1600, t0 = performance.now();
    (function f(now) {
      const t = Math.min(1, (now - t0) / dur);
      el.textContent = Math.round((1 - Math.pow(1 - t, 2)) * 100) + '%';
      if (t < 1) requestAnimationFrame(f);
    })(t0);
  }

  function initPricePop() {
    const el = $('#morphPrice');
    if (!el) return;
    new MutationObserver(() => {
      el.classList.remove('price-pop');
      void el.offsetWidth;
      el.classList.add('price-pop');
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }

  function initRippleOrigin() {
    // giữ biến --rx/--ry trên .btn như cũ để effects.css (ripple) vẫn chạy
    doc.addEventListener('click', e => {
      const btn = e.target.closest && e.target.closest('.btn');
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      btn.style.setProperty('--rx', ((e.clientX - r.left) / r.width * 100) + '%');
      btn.style.setProperty('--ry', ((e.clientY - r.top) / r.height * 100) + '%');
    });
  }

  /* ======================================================
     INIT
     ====================================================== */
  function init() {
    runLoaderPercent();
    initHero();
    initAmbient();
    initCanvas();
    initReveal();
    initTabs();
    initNavPill();
    initMorph();
    initPricePop();
    initRippleOrigin();
    initScroll();
    initPointer();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();