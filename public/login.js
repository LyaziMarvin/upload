// login.js

// 🔐 Show / hide password logic on Login page
const passwordInput = document.getElementById('passwordInput');
const togglePasswordBtn = document.getElementById('togglePassword');

function togglePassword() {
  if (!passwordInput || !togglePasswordBtn) return;

  const isPassword = passwordInput.type === 'password';
  passwordInput.type = isPassword ? 'text' : 'password';

  // Swap SVG icons
  const eye = `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="#444" viewBox="0 0 24 24">
      <path d="M12 5c-7 0-11 7-11 7s4 7 11 7 11-7 11-7-4-7-11-7zm0 12a5 5 0 110-10 5 5 0 010 10z"/>
    </svg>`;

  const eyeOff = `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="#444" viewBox="0 0 24 24">
      <path d="M1 1l22 22-1.5 1.5L18 19.5c-1.8 1-3.8 1.5-6 1.5-7 0-11-7-11-7 1.3-2.3 3.1-4.3 5.3-5.7L1 2.5 1 1zm11 4c7 0 11 7 11 7-.7 1.2-1.6 2.4-2.7 3.3L10.3 5.3c.5-.2 1.1-.3 1.7-.3z"/>
    </svg>`;

  togglePasswordBtn.innerHTML = isPassword ? eyeOff : eye;
  togglePasswordBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
}


if (passwordInput && togglePasswordBtn) {
  togglePasswordBtn.addEventListener('click', togglePassword);
  togglePasswordBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      togglePassword();
    }
  });
}

// Existing login logic
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const messageEl = document.getElementById('loginMessage');
  messageEl.textContent = ""; // Clear old message

  // NEW: read selected mode (online/offline) and store globally
  const selectedMode =
    document.querySelector('input[name="mode"]:checked')?.value || 'online';
  // Reuse qaModel as the global app mode key
  localStorage.setItem('qaModel', selectedMode);

  try {
    const res = await window.api.login(data);
    if (res?.token) {
      localStorage.setItem('token', res.token);
      window.api.navigateTo('index.html'); // Or your main page
    } else {
      messageEl.style.color = "red";
      messageEl.textContent = res.error || "Login failed";
    }
  } catch (err) {
    messageEl.style.color = "red";
    messageEl.textContent = "Error: " + err.message;
  }
});

document.getElementById('goToRegister').addEventListener('click', (e) => {
  e.preventDefault();
  window.api.navigateTo('register.html');
});
