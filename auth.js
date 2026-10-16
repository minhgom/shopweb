/* ============================================
   QM MOD iOS - auth.js (v2 - Backend API)
   Xử lý đăng nhập / đăng ký qua Node.js Backend
   ============================================ */

// ⚠️ Backend cùng domain, dùng đường dẫn tương đối
const API_BASE = '/api';

// ====== MỞ POPUP ĐĂNG NHẬP/ĐĂNG KÝ ======
function openAuthPopup() {
  if (document.getElementById('authPopup')) return;

  const popup = document.createElement('div');
  popup.id = 'authPopup';
  popup.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;" onclick="if(event.target===this)closeAuthPopup()">
      <div style="background:#111;border:1px solid #333;border-radius:16px;padding:32px;width:100%;max-width:400px;color:#fff;font-family:'Be Vietnam Pro',sans-serif;box-sizing:border-box;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h2 style="margin:0;font-size:22px;">ĐĂNG NHẬP</h2>
          <button onclick="closeAuthPopup()" style="background:none;border:none;color:#888;font-size:20px;cursor:pointer;padding:0;">✕</button>
        </div>
        <input id="authEmail" type="email" placeholder="Email" style="width:100%;padding:12px;margin-bottom:12px;background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#fff;box-sizing:border-box;font-family:inherit;">
        <input id="authPass" type="password" placeholder="Mật khẩu" style="width:100%;padding:12px;margin-bottom:16px;background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#fff;box-sizing:border-box;font-family:inherit;">
        <button onclick="doLogin()" style="width:100%;padding:12px;background:#3b82f6;border:none;border-radius:8px;color:#fff;font-weight:700;cursor:pointer;margin-bottom:8px;font-family:inherit;font-size:14px;">ĐĂNG NHẬP</button>
        <button onclick="doRegister()" style="width:100%;padding:12px;background:transparent;border:1px solid #3b82f6;border-radius:8px;color:#3b82f6;font-weight:700;cursor:pointer;font-family:inherit;font-size:14px;">ĐĂNG KÝ</button>
        <p id="authMsg" style="text-align:center;margin-top:12px;font-size:14px;min-height:20px;"></p>
      </div>
    </div>
  `;
  document.body.appendChild(popup);
}

function closeAuthPopup() {
  const p = document.getElementById('authPopup');
  if (p) p.remove();
}

// ====== ĐĂNG NHẬP ======
async function doLogin() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPass').value;
  const msg = document.getElementById('authMsg');

  if (!email || !password) {
    msg.textContent = 'Nhập đủ email và mật khẩu';
    msg.style.color = '#ef4444';
    return;
  }

  msg.textContent = 'Đang xử lý...';
  msg.style.color = '#3b82f6';

  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      localStorage.setItem('user', email);
      if (data.token) localStorage.setItem('token', data.token);
      if (data.user && data.user.is_admin) {
        localStorage.setItem('is_admin', '1');
      }
      msg.textContent = 'Đăng nhập thành công!';
      msg.style.color = '#22c55e';
      setTimeout(() => {
        closeAuthPopup();
        location.reload();
      }, 800);
    } else {
      msg.textContent = data.error || 'Sai thông tin đăng nhập';
      msg.style.color = '#ef4444';
    }
  } catch (err) {
    msg.textContent = 'Lỗi kết nối: ' + err.message;
    msg.style.color = '#ef4444';
  }
}

// ====== ĐĂNG KÝ ======
async function doRegister() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPass').value;
  const msg = document.getElementById('authMsg');

  if (!email || !password) {
    msg.textContent = 'Nhập đủ email và mật khẩu';
    msg.style.color = '#ef4444';
    return;
  }

  if (password.length < 6) {
    msg.textContent = 'Mật khẩu phải từ 6 ký tự';
    msg.style.color = '#ef4444';
    return;
  }

  msg.textContent = 'Đang xử lý...';
  msg.style.color = '#3b82f6';

  try {
    const res = await fetch(`${API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      localStorage.setItem('user', email);
      if (data.token) localStorage.setItem('token', data.token);
      msg.textContent = 'Đăng ký thành công!';
      msg.style.color = '#22c55e';
      setTimeout(() => {
        closeAuthPopup();
        location.reload();
      }, 800);
    } else {
      msg.textContent = data.error || 'Đăng ký thất bại';
      msg.style.color = '#ef4444';
    }
  } catch (err) {
    msg.textContent = 'Lỗi kết nối: ' + err.message;
    msg.style.color = '#ef4444';
  }
}

// ====== TỰ ĐỘNG ĐỔI NÚT KHI ĐÃ LOGIN ======
document.addEventListener('DOMContentLoaded', () => {
  const user = localStorage.getItem('user');
  const loginBtn = document.querySelector('.nav-actions .btn-primary');

  if (!loginBtn) return;

  if (user) {
    loginBtn.textContent = user.split('@')[0];
    loginBtn.onclick = async () => {
      if (confirm('Đăng xuất khỏi ' + user + '?')) {
        try {
          await fetch(`${API_BASE}/logout`, {
            method: 'POST',
            credentials: 'include'
          });
        } catch (e) { /* ignore */ }
        localStorage.removeItem('user');
        localStorage.removeItem('token');
        localStorage.removeItem('is_admin');
        location.reload();
      }
    };
  } else {
    loginBtn.onclick = (e) => {
      e.preventDefault();
      openAuthPopup();
    };
  }
});