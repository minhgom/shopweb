/* QM MOD iOS — auth.js
 * Tự gắn token đăng nhập (Authorization: Bearer ...) vào mọi request /api/ cùng domain.
 * Nhờ vậy đăng nhập vẫn hoạt động kể cả khi trình duyệt (Safari iOS) không lưu cookie.
 * Phải nạp TRƯỚC script.js và các script khác:  <script src="auth.js"></script>
 */
(function () {
    if (window.QMAuth) return;

    var K_USER = 'qm_token';
    var K_ADMIN = 'qm_admin_token';

    function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function set(k, v) {
        try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {}
    }

    window.QMAuth = {
        save: function (data) {
            if (!data) return;
            set(K_USER, data.token || null);
            set(K_ADMIN, data.admin_token || null);
        },
        clear: function () { set(K_USER, null); set(K_ADMIN, null); },
        hasToken: function () { return !!get(K_USER); }
    };

    var originalFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
        try {
            var rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
            var u = new URL(rawUrl, location.href);
            if (u.origin === location.origin && u.pathname.indexOf('/api/') === 0) {
                var token = u.pathname.indexOf('/api/admin/') === 0 ? get(K_ADMIN) : get(K_USER);
                if (token) {
                    init = init || {};
                    var headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
                    if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
                    init.headers = headers;
                    if (!init.credentials) init.credentials = 'same-origin';
                }
            }
        } catch (e) { /* không chặn request nếu có lỗi */ }
        return originalFetch(input, init);
    };
})();   