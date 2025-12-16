function showView(view) {
  document.getElementById('loginView').style.display = (view === 'login') ? 'block' : 'none';
  document.getElementById('registerView').style.display = (view === 'register') ? 'block' : 'none';
}

document.getElementById('switchToRegister').addEventListener('click', (e) => {
  e.preventDefault();
  showView('register');
});

document.getElementById('switchToLogin').addEventListener('click', (e) => {
  e.preventDefault();
  showView('login');
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    const res = await window.api.login(data);
    if (res?.token) {
      localStorage.setItem('token', res.token);
      window.api.navigateTo('home.html');
    } else {
      alert(res.error || "Login failed");
    }
  } catch (err) {
    alert("Error: " + err.message);
  }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    const res = await window.api.register(data);
    if (res?.success) {
      alert("Registration successful!");
      showView('login');
    } else {
      alert(res.error || "Registration failed");
    }
  } catch (err) {
    alert("Error: " + err.message);
  }
});
