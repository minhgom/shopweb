/* ============================================
   QM MOD iOS — ANIMATION UPGRADE PACK (JS)
   Load AFTER script.js, right before </body>:
   <script src="script.js"></script>
   <script src="animations.js"></script>
   ============================================ */
(function () {
  'use strict';

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;

  /* ---------- 0a. Liquid-glass specular hotspot (follows cursor on each glass surface) ---------- */
  function initGlassSpecular() {
    if (prefersReduced || noHover) return;
    const selector = '.glass, .navbar, .hero-badge, .product-toolbar, .tabs, .chat-box';
    document.querySelectorAll(selector).forEach(el => {
      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        el.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      });
    });
  }

  /* ---------- 0b. PowerPoint-style Morph: open the product modal FROM the clicked card ----------
     FLIP technique:
       First  -> capture the clicked card's on-screen rect (capture phase, before
                 the site's own openMorph() handler toggles .morph-overlay.on)
       Last   -> once .on is added, the modal is already laid out in its final
                 spot (overlay is always display:flex, just invisible) — read
                 that rect immediately
       Invert -> jump the modal to the card's old position/size with a
                 transform (no transition), so visually nothing has moved yet
       Play   -> clear the inline transform on the next frame; the existing
                 CSS transition (--morph-ease) animates it back to its natural
                 centered size — reading as one continuous shape-change rather
                 than a fade+scale
  ---------------------------------------------------------------------------- */
  function initMorphFLIP() {
    const overlay = document.getElementById('morphOverlay');
    const card = overlay ? overlay.querySelector('.morph-card') : null;
    if (!overlay || !card) return;

    let originRect = null;

    // capture phase so this runs before the inline onclick that opens the modal
    document.addEventListener('click', (e) => {
      const source = e.target.closest('.category-card, .product-card, [data-morph-source]');
      if (source) originRect = source.getBoundingClientRect();
    }, true);

    if (prefersReduced) return; // keep the simple CSS fade/scale fallback

    const mo = new MutationObserver(() => {
      if (!overlay.classList.contains('on') || !originRect) return;

      const target = card.getBoundingClientRect();
      const dx = (originRect.left + originRect.width / 2) - (target.left + target.width / 2);
      const dy = (originRect.top + originRect.height / 2) - (target.top + target.height / 2);
      const sx = Math.max(originRect.width / target.width, 0.1);
      const sy = Math.max(originRect.height / target.height, 0.1);

      // Invert: jump to the card's position/size instantly
      card.style.transition = 'none';
      card.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      card.style.opacity = '0.4';
      // eslint-disable-next-line no-unused-expressions
      card.offsetHeight; // force reflow

      // Play: release on the next frame so the CSS transition animates it
      requestAnimationFrame(() => {
        card.style.transition = '';
        card.style.transform = '';
        card.style.opacity = '';
      });

      originRect = null; // consume — don't replay on unrelated class toggles
    });
    mo.observe(overlay, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------- 1. Floating particle field ---------- */
  function buildParticles() {
    if (prefersReduced) return;
    const field = document.createElement('div');
    field.className = 'particle-field';
    const count = window.innerWidth < 768 ? 14 : 28;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      const size = 2 + Math.random() * 4;
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      p.style.left = Math.random() * 100 + 'vw';
      p.style.setProperty('--drift', (Math.random() * 80 - 40) + 'px');
      p.style.animationDuration = (12 + Math.random() * 14) + 's';
      p.style.animationDelay = (Math.random() * 14) + 's';
      field.appendChild(p);
    }
    document.body.appendChild(field);
  }

  /* ---------- 2. Loader letter stagger (sets --i per span) ---------- */
  function tagLoaderLetters() {
    document.querySelectorAll('.loader-title span').forEach((span, i) => {
      span.style.setProperty('--i', i);
    });
  }

  /* ---------- 2b. Loader percent counter, synced to the loader-bar-fill animation ---------- */
  function runLoaderPercent() {
    const el = document.getElementById('loaderPercent');
    if (!el) return;
    const durationMs = 1600; // matches .loader-bar-fill animation: barFill 1.6s in effects.css
    if (prefersReduced) { el.textContent = '100%'; return; }
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / durationMs);
      // ease-out to roughly match the bar's own easing
      const eased = 1 - Math.pow(1 - t, 2);
      el.textContent = Math.round(eased * 100) + '%';
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ---------- 3. Scroll reveal via IntersectionObserver ---------- */
  function initScrollReveal() {
    // auto-tag common blocks that don't already have a reveal class
    const autoTargets = [
      '.esign-box', '.category-card', '.guide-step', '.support-card',
      '.cta-card', '.product-card'
    ];
    autoTargets.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        if (!el.className.match(/reveal/)) el.classList.add('reveal');
      });
    });
    document.querySelectorAll('.section-header').forEach(el => el.classList.add('reveal-left'));
    document.querySelectorAll('.categories-grid, .guide-grid, .support-grid').forEach(el => el.classList.add('stagger'));

    if (prefersReduced) {
      document.querySelectorAll('.reveal, .reveal-scale, .reveal-left, .reveal-right, .stagger')
        .forEach(el => el.classList.add('in-view'));
      return;
    }

    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.reveal, .reveal-scale, .reveal-left, .reveal-right, .stagger')
      .forEach(el => io.observe(el));
  }

  // Products are injected dynamically by script.js — watch the grid and reveal new cards
  function watchDynamicGrid() {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;
    const io2 = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io2.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    const mo = new MutationObserver(() => {
      grid.querySelectorAll('.product-card:not(.reveal)').forEach((card, i) => {
        card.classList.add('reveal');
        card.style.transitionDelay = Math.min(i * 0.05, 0.4) + 's';
        if (prefersReduced) { card.classList.add('in-view'); }
        else { io2.observe(card); }
      });
    });
    mo.observe(grid, { childList: true });
  }

  /* ---------- 4. Magnetic buttons ---------- */
  function initMagneticButtons() {
    if (prefersReduced || window.matchMedia('(hover: none)').matches) return;
    document.querySelectorAll('.btn').forEach(btn => {
      btn.addEventListener('mousemove', (e) => {
        const r = btn.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        btn.style.transform = `translate(${x * 0.18}px, ${y * 0.28}px)`;
      });
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    });
  }

  /* ---------- 5. Card tilt (category + product cards) ---------- */
  function initTilt() {
    if (prefersReduced || window.matchMedia('(hover: none)').matches) return;
    document.body.addEventListener('mousemove', (e) => {
      const card = e.target.closest('.category-card, .product-card');
      if (!card) return;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      card.style.setProperty('--rx', ((0.5 - py) * 6).toFixed(2) + 'deg');
      card.style.setProperty('--ry', ((px - 0.5) * 6).toFixed(2) + 'deg');
      card.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
      card.style.setProperty('--my', (py * 100).toFixed(1) + '%');
    });
    document.body.addEventListener('mouseleave', () => {
      document.querySelectorAll('.category-card, .product-card').forEach(card => {
        card.style.removeProperty('--rx');
        card.style.removeProperty('--ry');
      });
    }, true);
  }

  /* ---------- 6. Sliding tab indicator ---------- */
  function initTabIndicator() {
    const tabs = document.querySelector('.tabs');
    if (!tabs) return;
    const indicator = document.createElement('div');
    indicator.className = 'tab-indicator';
    tabs.prepend(indicator);

    function moveTo(tabEl) {
      if (!tabEl) return;
      indicator.style.width = tabEl.offsetWidth + 'px';
      indicator.style.transform = `translateX(${tabEl.offsetLeft - 6}px)`;
    }
    const active = tabs.querySelector('.tab.active') || tabs.querySelector('.tab');
    requestAnimationFrame(() => moveTo(active));

    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (btn) requestAnimationFrame(() => moveTo(btn));
    });
    window.addEventListener('resize', () => {
      moveTo(tabs.querySelector('.tab.active'));
    });
  }

  /* ---------- 7. Cursor glow ---------- */
  function initCursorGlow() {
    if (prefersReduced || window.matchMedia('(hover: none)').matches) return;
    const glow = document.createElement('div');
    glow.className = 'cursor-glow';
    document.body.appendChild(glow);
    let raf = null;
    window.addEventListener('mousemove', (e) => {
      glow.classList.add('active');
      if (raf) return;
      raf = requestAnimationFrame(() => {
        glow.style.setProperty('--cx', e.clientX + 'px');
        glow.style.setProperty('--cy', e.clientY + 'px');
        raf = null;
      });
    });
    document.addEventListener('mouseleave', () => glow.classList.remove('active'));
  }

  /* ---------- 8. Price pop when morph modal opens (works with existing openMorph in script.js) ---------- */
  function initPricePop() {
    const priceEl = document.getElementById('morphPrice');
    if (!priceEl) return;
    const mo = new MutationObserver(() => {
      priceEl.classList.remove('price-pop');
      void priceEl.offsetWidth; // restart animation
      priceEl.classList.add('price-pop');
    });
    mo.observe(priceEl, { childList: true, characterData: true, subtree: true });
  }

  /* ---------- 9. Button click ripple origin (keeps your existing .clicked class working) ---------- */
  function initRippleOrigin() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn');
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      btn.style.setProperty('--rx', ((e.clientX - r.left) / r.width * 100) + '%');
      btn.style.setProperty('--ry', ((e.clientY - r.top) / r.height * 100) + '%');
    });
  }

  function init() {
    tagLoaderLetters();
    runLoaderPercent();
    buildParticles();
    initGlassSpecular();
    initMorphFLIP();
    initScrollReveal();
    watchDynamicGrid();
    initMagneticButtons();
    initTilt();
    initTabIndicator();
    initCursorGlow();
    initPricePop();
    initRippleOrigin();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();/* ===== GLASS SPECULAR — hotspot chạy theo cursor ===== */
(function initGlassSpecular() {
    const selector = '.glass, .navbar, .hero-badge, .product-toolbar, .tabs, .chat-box, .btn-outline';
    document.querySelectorAll(selector).forEach(el => {
        el.addEventListener('mousemove', e => {
            const r = el.getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * 100;
            const y = ((e.clientY - r.top) / r.height) * 100;
            el.style.setProperty('--mx', x + '%');
            el.style.setProperty('--my', y + '%');
        });
        el.addEventListener('mouseleave', () => {
            el.style.removeProperty('--mx');
            el.style.removeProperty('--my');
        });
    });
})();

/* ===== MORPH FLIP — modal mọc ra từ card ===== */
(function initMorphFLIP() {
    const overlay = document.getElementById('morphOverlay');
    const card = overlay && overlay.querySelector('.morph-card');
    if (!overlay || !card) return;

    window.addEventListener('morph-open', e => {
        const src = e.detail && e.detail.source;
        if (!src) return;
        const from = src.getBoundingClientRect();
        // reset để đo vị trí đích
        card.style.transition = 'none';
        card.style.transform = 'none';
        card.style.opacity = '1';
        const to = card.getBoundingClientRect();
        const dx = from.left - to.left + (from.width - to.width) / 2;
        const dy = from.top - to.top + (from.height - to.height) / 2;
        const sx = from.width / to.width;
        const sy = from.height / to.height;
        card.style.transformOrigin = 'center center';
        card.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
        card.style.opacity = '0.3';
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                card.style.transition = '';
                card.style.transform = '';
                card.style.opacity = '';
            });
        });
    });
})();